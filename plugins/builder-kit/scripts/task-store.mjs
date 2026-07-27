#!/usr/bin/env node
// The kit's task store: one markdown file per task under docs/tasks/.
//
// Why a file per task, and why on disk at all. Native Tasks is a WORKING SET, not a
// record: it garbage-collects a finished list, so state kept only there evaporates at
// exactly the moment a phase closes — the moment the next session most needs it. And a
// single tasks.md conflicts on every concurrent edit. One file per task mirrors the
// native shape (id, subject, description, status) and only conflicts when two people
// touch the same task.
//
// Direction of truth: native Tasks is authoritative while a session is live, and
// docs/tasks/ is authoritative when none has run. hooks/task-mirror.mjs carries the
// live list down to disk; this script is how a skill or a human reads it back.
//
// Format — YAML frontmatter, description as the body:
//
//   ---
//   id: "phase-1"
//   subject: "Phase 1 — scaffold and first green suite"
//   status: open
//   blocks: ["phase-2"]
//   blockedBy: []
//   phase: 1
//   updated: "2026-07-28T02:14:07Z"
//   ---
//   Free-text description.
//
// Usage:
//   node task-store.mjs list  [--status open|in_progress|closed|all] [--phase N] [--json]
//   node task-store.mjs read  <id> [--json]
//   node task-store.mjs write <id> [--subject S] [--status S] [--phase N]
//                                  [--blocks a,b] [--blocked-by a,b]
//                                  [--description TEXT | --description-file F | --description-stdin]
//                                  [--json]
//   node task-store.mjs close <id> [--json]
//
//   --root <dir>   project root (default: cwd). Tasks live at <root>/docs/tasks/.
//
// write MERGES: any field you do not pass keeps its current value, and the body is
// only replaced when you actually supply a description. Exit 0 on success, 1 on error.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

export const TASKS_REL = 'docs/tasks'

// Canonical statuses, plus the native/human spellings that map onto them. Anything
// else is rejected rather than silently coerced: a typo'd status that quietly becomes
// "open" would hide a closed phase.
const STATUS_ALIASES = {
  open: 'open',
  pending: 'open',
  todo: 'open',
  in_progress: 'in_progress',
  'in-progress': 'in_progress',
  active: 'in_progress',
  closed: 'closed',
  completed: 'closed',
  complete: 'closed',
  done: 'closed',
}
export const STATUSES = ['open', 'in_progress', 'closed']

export function normaliseStatus(s) {
  const key = String(s == null ? '' : s).trim().toLowerCase()
  return STATUS_ALIASES[key] || null
}

// Ids arrive from a hook payload, so they are untrusted input on a path. Everything
// outside [a-z0-9._-] collapses to a dash, and a lossy slug carries a hash of the
// original so two different ids can never land on the same file.
export function fileNameFor(id) {
  const raw = String(id == null ? '' : id).trim()
  if (!raw) throw new Error('task id is empty')
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
  if (!slug) return `task-${createHash('sha256').update(raw).digest('hex').slice(0, 12)}.md`
  if (slug === raw) return `${slug}.md`
  return `${slug}-${createHash('sha256').update(raw).digest('hex').slice(0, 8)}.md`
}

export function tasksDir(root = process.cwd()) {
  return join(resolve(root), TASKS_REL)
}

// --- YAML frontmatter, the narrow subset this store writes -------------------
// Deliberately not a general YAML parser. It reads what this file writes, plus the
// shapes a human is likely to hand-edit (bare scalars, block lists).

function unquote(v) {
  const s = v.trim()
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s.slice(1, -1).replace(/\\(["\\n])/g, (_, c) => (c === 'n' ? '\n' : c))
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'")
  return s
}

function parseList(v) {
  const s = v.trim()
  if (!s || s === '[]') return []
  if (s[0] === '[' && s[s.length - 1] === ']') {
    return s
      .slice(1, -1)
      .split(',')
      .map((x) => unquote(x))
      .filter(Boolean)
  }
  return [unquote(s)].filter(Boolean)
}

function parseFrontmatter(text) {
  const lines = text.split('\n')
  if (lines[0].trim() !== '---') return { data: {}, body: text }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return { data: {}, body: text }

  const data = {}
  let listKey = null
  for (let i = 1; i < end; i++) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item && listKey) {
      const val = unquote(item[1])
      if (val) data[listKey].push(val)
      continue
    }
    const kv = /^([A-Za-z][A-Za-z0-9_]*):(?:[ \t]+(.*))?$/.exec(line)
    if (!kv) continue
    const [, key, rawVal] = kv
    const val = rawVal == null ? '' : rawVal.trim()
    if (key === 'blocks' || key === 'blockedBy') {
      if (!val) {
        data[key] = []
        listKey = key // a block list may follow
      } else {
        data[key] = parseList(val)
        listKey = null
      }
      continue
    }
    listKey = null
    data[key] = val === '' ? null : unquote(val)
  }
  return { data, body: lines.slice(end + 1).join('\n').replace(/^\n/, '') }
}

function quote(v) {
  return `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`
}

function serialise(task) {
  const fm = [
    '---',
    `id: ${quote(task.id)}`,
    `subject: ${quote(task.subject || '')}`,
    `status: ${task.status}`,
    `blocks: [${task.blocks.map(quote).join(', ')}]`,
    `blockedBy: [${task.blockedBy.map(quote).join(', ')}]`,
    `phase: ${task.phase == null ? '' : task.phase}`,
    `updated: ${quote(task.updated)}`,
    '---',
    '',
  ].join('\n')
  const body = (task.description || '').replace(/\s+$/, '')
  return body ? `${fm}${body}\n` : fm
}

// One line, always. A newline in a subject would forge a frontmatter key.
function oneLine(v) {
  return String(v == null ? '' : v).replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// Same-directory temp + rename, so a reader never sees a half-written task and a
// crashed write leaves the previous version intact.
function writeAtomic(file, content) {
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, file)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {}
    throw err
  }
}

// --- the store ---------------------------------------------------------------

export function readTask(id, { root = process.cwd() } = {}) {
  const file = join(tasksDir(root), fileNameFor(id))
  if (!existsSync(file)) return null
  const { data, body } = parseFrontmatter(readFileSync(file, 'utf8'))
  const phase = data.phase == null || data.phase === '' ? null : Number(data.phase)
  return {
    id: data.id || String(id),
    subject: data.subject || '',
    status: normaliseStatus(data.status) || 'open',
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy : [],
    phase: Number.isFinite(phase) ? phase : null,
    updated: data.updated || '',
    description: body,
    file,
  }
}

/**
 * Create or update one task. Fields absent from `patch` keep their current value,
 * and the description is only replaced when the key is actually present.
 */
export function writeTask(id, patch = {}, { root = process.cwd() } = {}) {
  const taskId = oneLine(id)
  if (!taskId) throw new Error('task id is empty')
  const dir = tasksDir(root)
  mkdirSync(dir, { recursive: true })
  const prev = readTask(taskId, { root })

  let status = prev ? prev.status : 'open'
  if (patch.status != null) {
    const s = normaliseStatus(patch.status)
    if (!s) throw new Error(`unknown status "${patch.status}" (use ${STATUSES.join(', ')})`)
    status = s
  }
  let phase = prev ? prev.phase : null
  if (patch.phase != null && patch.phase !== '') {
    const n = Number(patch.phase)
    if (!Number.isFinite(n)) throw new Error(`phase must be a number, got "${patch.phase}"`)
    phase = n
  }

  const task = {
    id: taskId,
    subject: patch.subject != null ? oneLine(patch.subject) : prev ? prev.subject : '',
    status,
    blocks: patch.blocks != null ? patch.blocks.map(oneLine).filter(Boolean) : prev ? prev.blocks : [],
    blockedBy: patch.blockedBy != null ? patch.blockedBy.map(oneLine).filter(Boolean) : prev ? prev.blockedBy : [],
    phase,
    updated: stamp(),
    description:
      'description' in patch && patch.description != null
        ? String(patch.description)
        : prev
          ? prev.description
          : '',
  }
  const file = join(dir, fileNameFor(taskId))
  writeAtomic(file, serialise(task))
  return { ...task, file, created: !prev }
}

export function closeTask(id, { root = process.cwd() } = {}) {
  return writeTask(id, { status: 'closed' }, { root })
}

export function listTasks({ root = process.cwd(), status = 'all', phase = null } = {}) {
  const dir = tasksDir(root)
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const { data, body } = parseFrontmatter(readFileSync(join(dir, name), 'utf8'))
    if (!data.id) continue // not one of ours; skip rather than guess
    const p = data.phase == null || data.phase === '' ? null : Number(data.phase)
    const t = {
      id: data.id,
      subject: data.subject || '',
      status: normaliseStatus(data.status) || 'open',
      blocks: Array.isArray(data.blocks) ? data.blocks : [],
      blockedBy: Array.isArray(data.blockedBy) ? data.blockedBy : [],
      phase: Number.isFinite(p) ? p : null,
      updated: data.updated || '',
      description: body,
      file: join(dir, name),
    }
    if (status !== 'all' && t.status !== normaliseStatus(status)) continue
    if (phase != null && t.phase !== Number(phase)) continue
    out.push(t)
  }
  return out.sort((a, b) => {
    const ap = a.phase == null ? Infinity : a.phase
    const bp = b.phase == null ? Infinity : b.phase
    return ap - bp || a.id.localeCompare(b.id)
  })
}

// --- CLI ---------------------------------------------------------------------

function isMain() {
  const entry = process.argv[1] || ''
  return entry.endsWith('task-store.mjs')
}

// Indices consumed as a flag's VALUE. Without this, `write --root /tmp/p phase-1`
// reads "/tmp/p" as the task id, because it is the first bare word after the verb.
const consumed = new Set()

function flag(argv, name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const i = argv.indexOf(name)
  if (i < 0 || argv[i + 1] == null || argv[i + 1].startsWith('--')) return null
  consumed.add(i + 1)
  return argv[i + 1]
}

function short(t) {
  const mark = t.status === 'closed' ? 'x' : t.status === 'in_progress' ? '~' : ' '
  return `[${mark}] ${t.id}${t.phase != null ? ` (phase ${t.phase})` : ''}  ${t.subject}`
}

async function readStdin() {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  return raw
}

if (isMain()) {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  // Every flag is read BEFORE the positionals, so `consumed` is complete by the time
  // the verb and the id are picked out of what is left.
  const root = flag(argv, '--root') || process.cwd()
  const subjectArg = flag(argv, '--subject')
  const statusArg = flag(argv, '--status')
  const phaseArg = flag(argv, '--phase')
  const blocksArg = flag(argv, '--blocks')
  const blockedByArg = flag(argv, '--blocked-by')
  const descArg = flag(argv, '--description')
  const descFileArg = flag(argv, '--description-file')
  const positional = argv.filter((a, i) => !a.startsWith('-') && !consumed.has(i))
  const cmd = positional[0] || 'list'
  const id = positional[1] || null

  const done = (payload, text) => {
    if (json) console.log(JSON.stringify(payload, null, 2))
    else if (text) console.log(text)
    process.exit(0)
  }
  const fail = (msg) => {
    if (json) console.log(JSON.stringify({ ok: false, error: msg }, null, 2))
    else console.error(msg)
    process.exit(1)
  }

  try {
    if (cmd === 'list') {
      const tasks = listTasks({ root, status: statusArg || 'all', phase: phaseArg })
      done(
        { ok: true, dir: tasksDir(root), count: tasks.length, tasks },
        tasks.length ? tasks.map(short).join('\n') : `No tasks in ${tasksDir(root)}`,
      )
    } else if (cmd === 'read') {
      if (!id) fail('read needs a task id')
      const t = readTask(id, { root })
      if (!t) fail(`no task "${id}" in ${tasksDir(root)}`)
      done({ ok: true, task: t }, `${short(t)}\n\n${t.description}`.trimEnd())
    } else if (cmd === 'write') {
      if (!id) fail('write needs a task id')
      const patch = {}
      if (subjectArg != null) patch.subject = subjectArg
      if (statusArg != null) patch.status = statusArg
      if (phaseArg != null) patch.phase = phaseArg
      if (blocksArg != null) patch.blocks = blocksArg.split(',')
      if (blockedByArg != null) patch.blockedBy = blockedByArg.split(',')
      if (descArg != null) patch.description = descArg
      else if (descFileArg != null) patch.description = readFileSync(descFileArg, 'utf8')
      else if (argv.includes('--description-stdin')) patch.description = await readStdin()
      const t = writeTask(id, patch, { root })
      done({ ok: true, task: t }, `${t.created ? 'created' : 'updated'} ${t.file}`)
    } else if (cmd === 'close') {
      if (!id) fail('close needs a task id')
      if (!readTask(id, { root })) fail(`no task "${id}" in ${tasksDir(root)} (nothing to close)`)
      const t = closeTask(id, { root })
      done({ ok: true, task: t }, `closed ${t.id} -> ${t.file}`)
    } else {
      fail(`Unknown command "${cmd}". Use: list, read, write, close.`)
    }
  } catch (err) {
    fail(String(err && err.message ? err.message : err))
  }
}
