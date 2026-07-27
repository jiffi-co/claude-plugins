#!/usr/bin/env node
// The in-flight layer of the hard-stop registry, plus the two support modes the
// registry needs to be trustworthy.
//
// WHY THIS EXISTS. A forked subagent cannot ask a human anything: AskUserQuestion
// is stripped from every subagent in code, with no frontmatter escape. So when the
// build loop's forked worker is about to do something irreversible, the ONLY channel
// that reaches a human is a permission prompt. This hook is that channel. It runs on
// PreToolUse with matcher Bash and returns permissionDecision "ask" for the command
// shapes in scripts/hard-stops.json, naming the stop id in the reason.
//
// It never BLOCKS. An "ask" hands the decision to the human where a block would just
// end the turn, and in the Claude Code panel of Claude Desktop a block renders nothing
// at all. Asking is also cheap enough to be the safe side of every ambiguous guard,
// which is why the guards below fail towards asking rather than towards allowing.
//
// THREE MODES:
//   (no args)                 PreToolUse hook. Reads the tool call on stdin.
//   --scan <file> [--phase N] Pre-flight. Matches the plan text against the registry
//                             and prints JSON for the inline parent (skills/build) to
//                             ask about BEFORE it forks. Exits 2 if the registry could
//                             not be read, so "no stops found" can never be confused
//                             with "the scan did not run".
//   --selftest                Every fixture must fire and every negative control must
//                             not. Exit 1 on a coverage failure, exit 2 on a registry
//                             that cannot be parsed or a pattern that cannot compile.
//
// Pure Node, no dependencies.

import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REGISTRY = join(HERE, '..', 'scripts', 'hard-stops.json')

// ---------------------------------------------------------------- registry ----

// Throws on anything malformed. Callers decide what a broken registry means: the
// hook allows the call through (a guard that cannot load must not brick every Bash
// call), the scan and the selftest both exit 2 and say so.
function loadRegistry(file = REGISTRY) {
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  if (!raw || !Array.isArray(raw.stops) || raw.stops.length === 0) {
    throw new Error('hard-stops.json has no stops[]')
  }
  const compile = (src, where) => {
    try {
      return new RegExp(src, 'i')
    } catch (e) {
      throw new Error(`bad pattern in ${where}: /${src}/ (${e.message})`)
    }
  }
  for (const stop of raw.stops) {
    if (!stop.id) throw new Error('a stop has no id')
    if (stop.preflight) {
      stop.preflight.compiled = (stop.preflight.patterns || []).map((p) =>
        compile(p, `${stop.id}.preflight`),
      )
      if (!stop.preflight.compiled.length) throw new Error(`${stop.id}.preflight has no patterns`)
    }
    if (stop.inflight) {
      for (const rule of stop.inflight.rules || []) {
        rule.compiled = (rule.patterns || []).map((p) =>
          compile(p, `${stop.id}.inflight.${rule.name}`),
        )
        if (!rule.compiled.length) throw new Error(`${stop.id}.inflight.${rule.name} has no patterns`)
      }
    }
  }
  return raw
}

// ------------------------------------------------------------------ guards ----

// A guard narrows a rule that would otherwise fire on safe, everyday work. Each one
// is named in the JSON so the exception is visible in the data, not buried here, and
// each one has its own fixtures in the selftest. Both guards fail towards asking.

// Build artefacts a project regenerates from source. Deleting these loses nothing,
// and asking about them every time is how a human learns to click through the
// prompts that matter. Anything else, including a path that walks out of the
// project or an unexpanded variable, asks.
// `.builder-kit-tmp` is the kit's own scratch directory: the `bootstrap` skill runs
// a framework's create command in there and copies the result out. It holds a fresh
// scaffold and nothing else, so it is regenerable by construction.
// A path INSIDE one of these counts too (`.next/cache` is as regenerable as
// `.next`), but never one that climbs back out: `node_modules/../../etc` is not a
// build artefact, and a prefix match without this check is a hole, not a shortcut.
const REGENERABLE =
  /^\.?\/?(node_modules|\.next|\.nuxt|\.output|\.svelte-kit|\.turbo|\.vercel|\.cache|\.parcel-cache|\.venv|\.builder-kit-tmp|dist|build|out|coverage|DerivedData)(\/[^\s]*)?$/

function regenerable(p) {
  const clean = p.replace(/^["']|["']$/g, '')
  if (clean.split('/').includes('..')) return false
  return REGENERABLE.test(clean)
}

function rmRfScope(seg) {
  // Guards run per SEGMENT (see segments() below), so there is one rm here.
  const at = seg.search(/(?:^|[\s;&|(/])rm\s/i)
  const tail = at === -1 ? seg : seg.slice(seg.toLowerCase().indexOf('rm ', at) + 3)
  const paths = tail.trim().split(/\s+/).filter((a) => a && !a.startsWith('-'))
  if (!paths.length) return true // `rm -rf $(...)`, or nothing parseable: ask
  return !paths.every(regenerable)
}

// `git reset --hard` is only destructive when there is something to destroy: a dirty
// working tree, or a target ref that is not HEAD (which throws commits away). On a
// clean tree resetting to HEAD is a no-op and asking about it is noise.
function gitResetHard(seg, ctx) {
  const after = seg.slice(seg.toLowerCase().indexOf('--hard') + 6)
  const ref = after.trim().split(/\s+/).filter((a) => a && !a.startsWith('-'))[0]
  if (ref && ref !== 'HEAD') return true
  return ctx.gitDirty()
}

const GUARDS = { 'rm-rf-scope': rmRfScope, 'git-reset-hard': gitResetHard }

// Probe the working tree. Anything unexpected (no git, an error, a lock) counts as
// dirty, because asking is the cheap side of the mistake.
function gitDirtyProbe(cwd) {
  try {
    const r = spawnSync('git', ['status', '--porcelain'], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 10000,
    })
    if (r.error || r.status !== 0) return true
    return String(r.stdout || '').trim().length > 0
  } catch {
    return true
  }
}

// ---------------------------------------------------------------- decision ----

// Split a command line into the commands it actually runs. EVERY segment is
// matched, because the dangerous half of a compound command is routinely followed
// by a harmless one: `rm -rf /etc && rm -rf node_modules` reads as safe if you only
// look at the last command, and `git reset --hard && git reset --hard HEAD~5` reads
// as safe if you only look at the first. Both were live holes before this existed.
function segments(cmd) {
  return cmd
    .split(/&&|\|\||[;&|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Match one Bash command against every inflight rule, segment by segment.
 * @returns {{id, title, why, reason, rule, segment}[]} every stop that fires, in registry order.
 */
function decideCommand(registry, cmd, ctx) {
  const hits = []
  if (!cmd) return hits
  const parts = segments(cmd)
  for (const stop of registry.stops) {
    if (!stop.inflight) continue
    let hit = null
    for (const seg of parts) {
      for (const rule of stop.inflight.rules || []) {
        if (!rule.compiled.some((re) => re.test(seg))) continue
        if (rule.guard) {
          const guard = GUARDS[rule.guard]
          // A named guard that does not exist is a registry bug. Ask rather than
          // silently allowing the shape the rule was written to catch.
          if (typeof guard === 'function' && !guard(seg, ctx)) continue
        }
        hit = { id: stop.id, title: stop.title, why: stop.why, reason: stop.inflight.reason, rule: rule.name, segment: seg }
        break
      }
      if (hit) break // one hit per stop is enough to ask
    }
    if (hit) hits.push(hit)
  }
  return hits
}

// Slice a plan file down to one phase's section, so a pre-flight for phase 2 does not
// ask about phase 7's deploy. Returns null when no heading for that phase is found,
// and the caller reports the wider scope rather than pretending it sliced.
function slicePhase(text, phase) {
  const lines = text.split(/\r?\n/)
  const head = new RegExp(`^\\s{0,3}#{1,6}\\s.*\\bphase\\s*[-:]?\\s*0*${phase}\\b`, 'i')
  const anyHead = /^\s{0,3}#{1,6}\s.*\bphase\s*[-:]?\s*\d+\b/i
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (head.test(lines[i])) {
      start = i
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (anyHead.test(lines[i]) && !head.test(lines[i])) {
      end = i
      break
    }
  }
  return { start, lines: lines.slice(start, end) }
}

function scanText(registry, lines, offset, file) {
  const out = []
  for (const stop of registry.stops) {
    if (!stop.preflight) continue
    let evidence = null
    for (let i = 0; i < lines.length && !evidence; i++) {
      for (const re of stop.preflight.compiled) {
        if (re.test(lines[i])) {
          evidence = { file, line: offset + i + 1, text: lines[i].trim().slice(0, 200) }
          break
        }
      }
    }
    if (evidence) {
      out.push({
        id: stop.id,
        title: stop.title,
        why: stop.why,
        header: stop.preflight.header,
        question: stop.preflight.question,
        options: stop.preflight.options || [],
        evidence,
      })
    }
  }
  return out
}

// -------------------------------------------------------------------- modes ----

function runScan(argv) {
  let registry
  try {
    registry = loadRegistry()
  } catch (e) {
    process.stderr.write(`hard-stop: cannot read the registry (${e.message}). The pre-flight did NOT run.\n`)
    process.exit(2)
  }
  // Walk the argv rather than filtering it. The subtle version of this (filter out
  // the value that follows --phase) drops the FILE when --phase is absent, because
  // indexOf returns -1 and argv[0] is the file.
  const files = []
  let phase = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--phase') {
      phase = argv[++i] || null
      continue
    }
    const eq = a.match(/^--phase=(.+)$/)
    if (eq) {
      phase = eq[1]
      continue
    }
    if (a.startsWith('--')) continue
    files.push(a)
  }
  if (phase != null && !/^\d+$/.test(phase)) {
    process.stderr.write(`hard-stop --scan: --phase wants a number, got "${phase}".\n`)
    process.exit(2)
  }
  if (!files.length) {
    process.stderr.write('hard-stop --scan needs at least one file to scan.\n')
    process.exit(2)
  }
  const matches = []
  const scanned = []
  let read = 0
  for (const f of files) {
    const path = resolve(f)
    let text = null
    try {
      if (existsSync(path)) text = readFileSync(path, 'utf8')
    } catch (e) {
      text = null
      scanned.push({ file: f, scope: `unreadable (${e.code || e.message})` })
      continue
    }
    if (text == null) {
      scanned.push({ file: f, scope: 'missing' })
      continue
    }
    read++
    let lines = text.split(/\r?\n/)
    let offset = 0
    let scope = 'whole-file'
    if (phase) {
      const slice = slicePhase(text, phase)
      if (slice) {
        lines = slice.lines
        offset = slice.start
        scope = `phase-${phase}`
      } else {
        scope = 'whole-file (no heading for that phase)'
      }
    }
    scanned.push({ file: f, scope, lines: lines.length })
    matches.push(...scanText(registry, lines, offset, f))
  }
  // Same stop matched in two files collapses to its first hit: one ask per stop.
  const seen = new Set()
  const unique = matches.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)))
  // Nothing readable means nothing was screened. Reporting that as an empty match
  // list would tell the parent "this phase trips no stop", which is a different
  // claim entirely and the exact way a silent probe failure becomes a false negative.
  const ok = read > 0
  process.stdout.write(`${JSON.stringify({ ok, scanned, matches: unique }, null, 2)}\n`)
  if (!ok) {
    process.stderr.write('hard-stop --scan: none of those files could be read. The pre-flight did NOT run.\n')
    process.exit(2)
  }
  process.exit(0)
}

function runSelftest() {
  let registry
  try {
    registry = loadRegistry()
  } catch (e) {
    process.stderr.write(`FAIL  registry: ${e.message}\n`)
    process.exit(2)
  }
  let pass = 0
  let fail = 0
  const ok = (m) => {
    console.log(`  PASS  ${m}`)
    pass++
  }
  const bad = (m) => {
    console.log(`  FAIL  ${m}`)
    fail++
  }
  // The selftest treats the working tree as CLEAN, which is the harder case: a
  // guard that only fires because the test machine happened to be dirty proves
  // nothing about the guard.
  const ctx = { gitDirty: () => false }

  for (const stop of registry.stops) {
    if (!stop.preflight) {
      bad(`${stop.id}: no preflight patterns (every stop must be askable before the fork)`)
      continue
    }
    const fx = stop.preflight.fixture
    if (!fx) {
      bad(`${stop.id}: preflight has no fixture`)
    } else if (scanText(registry, [fx], 0, 'fixture').some((m) => m.id === stop.id)) {
      ok(`${stop.id} preflight fires on its fixture`)
    } else {
      bad(`${stop.id} preflight did NOT fire on its fixture: ${fx}`)
    }
    for (const pos of stop.preflight.mustMatch || []) {
      if (scanText(registry, [pos], 0, 'fixture').some((m) => m.id === stop.id)) {
        ok(`${stop.id} preflight also fires on: ${pos}`)
      } else {
        bad(`${stop.id} preflight did NOT fire on: ${pos}`)
      }
    }
    for (const neg of stop.preflight.mustNotMatch || []) {
      if (scanText(registry, [neg], 0, 'fixture').some((m) => m.id === stop.id)) {
        bad(`${stop.id} preflight false-positives on: ${neg}`)
      } else {
        ok(`${stop.id} preflight stays quiet on its negative control`)
      }
    }
    for (const rule of (stop.inflight && stop.inflight.rules) || []) {
      if (rule.guard && typeof GUARDS[rule.guard] !== 'function') {
        bad(`${stop.id}/${rule.name}: names guard "${rule.guard}", which does not exist`)
      }
      const hit = (cmd) => decideCommand(registry, cmd, ctx).some((h) => h.id === stop.id)
      if (!rule.fixture) bad(`${stop.id}/${rule.name}: no fixture command`)
      else if (hit(rule.fixture)) ok(`${stop.id}/${rule.name} asks on: ${rule.fixture}`)
      else bad(`${stop.id}/${rule.name} did NOT ask on: ${rule.fixture}`)
      for (const pos of rule.mustMatch || []) {
        if (hit(pos)) ok(`${stop.id}/${rule.name} asks on: ${pos}`)
        else bad(`${stop.id}/${rule.name} did NOT ask on: ${pos}`)
      }
      for (const neg of rule.mustNotMatch || []) {
        if (hit(neg)) bad(`${stop.id}/${rule.name} false-positives on: ${neg}`)
        else ok(`${stop.id}/${rule.name} stays quiet on: ${neg}`)
      }
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}

function runHook() {
  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (c) => (raw += c))
  process.stdin.on('end', () => {
    try {
      const input = JSON.parse(raw || '{}')
      if (input.tool_name && input.tool_name !== 'Bash') process.exit(0)
      const cmd = String((input.tool_input && input.tool_input.command) || '')
      if (!cmd.trim()) process.exit(0)
      const registry = loadRegistry()
      const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd()
      let dirty = null
      const hits = decideCommand(registry, cmd, {
        gitDirty: () => (dirty === null ? (dirty = gitDirtyProbe(cwd)) : dirty),
      })
      if (!hits.length) process.exit(0)
      const ids = hits.map((h) => h.id).join(', ')
      const reason =
        `builder-kit hard stop ${ids}: ${hits[0].title}. ${hits[0].reason} ${hits[0].why}\n\n` +
        `Command: ${cmd.length > 300 ? `${cmd.slice(0, 300)}...` : cmd}\n\n` +
        'This stop is in .claude/rules/autonomy.md and no autonomy setting removes it. ' +
        'If you approve, the command runs as written. If you deny, do not route around it ' +
        'and do not retry a reworded version: report the stop to the user and let them decide.'
      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: reason,
          },
        })}\n`,
      )
      process.exit(0)
    } catch {
      // Fail open. This hook only ever ASKS, so a broken registry costs a prompt,
      // never a blocked build. --selftest is what keeps it honest before it ships.
      process.exit(0)
    }
  })
}

const argv = process.argv.slice(2)
if (argv.includes('--selftest')) runSelftest()
else if (argv.includes('--scan')) runScan(argv.filter((a) => a !== '--scan'))
else runHook()
