#!/usr/bin/env node
// Mirror the live native Tasks list down to docs/tasks/, one markdown file per task.
//
// Why: native Tasks is a working set. It garbage-collects a finished list, so state
// held only there disappears at the exact moment a phase closes. This hook fires on
// TaskCreated and TaskCompleted (both carry task_id, task_subject and task_description)
// and writes the same shape to disk, so the record outlives the session.
//
// Direction of truth: native is authoritative while a session is live — this hook only
// ever runs during one, so it always writes native -> disk. Between sessions docs/tasks/
// is the record, and skills read it with scripts/task-store.mjs.
//
// This hook NEVER blocks. It has no opinion about whether work should proceed, so every
// path exits 0, including every failure path. A mirroring bug must not be able to stop a
// build.
//
// Register (hooks/hooks.json):
//   "TaskCreated":   [{ "hooks": [{ "type": "command",
//                       "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/task-mirror.mjs\"" }] }],
//   "TaskCompleted": [{ "hooks": [{ "type": "command",
//                       "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/task-mirror.mjs\"" }] }]

import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Import by URL, not by relative cwd: a hook runs from whatever directory the session
// is in. A load failure must not take the turn with it, hence the try.
let store = null
try {
  store = await import(new URL('../scripts/task-store.mjs', import.meta.url).href)
} catch {
  store = null
}

const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))) + sep

function projectRoot(explicit) {
  const env = typeof process.env.CLAUDE_PROJECT_DIR === 'string' ? process.env.CLAUDE_PROJECT_DIR.trim() : ''
  const given = typeof explicit === 'string' ? explicit.trim() : ''
  return env || given || process.cwd()
}

// Running the kit against its own directory is a dev invocation, not a project. Writing
// docs/tasks/ there would pollute the tree that gets published.
function insidePlugin(root) {
  const dir = resolve(root) + sep
  return dir === PLUGIN_ROOT || dir.startsWith(PLUGIN_ROOT)
}

// The phase number, only when the subject actually states one. A task with no phase in
// its name gets no phase — guessing one would put work under the wrong gate.
function phaseFrom(subject) {
  const m = /\bphase\s*[-–—:]?\s*(\d{1,3})\b/i.exec(String(subject || ''))
  return m ? Number(m[1]) : null
}

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  try {
    if (!store || typeof store.writeTask !== 'function') process.exit(0)
    const input = JSON.parse(raw || '{}')
    const event = String(input.hook_event_name || input.event || '')
    if (event !== 'TaskCreated' && event !== 'TaskCompleted') process.exit(0)

    const id = typeof input.task_id === 'string' ? input.task_id.trim() : ''
    if (!id) process.exit(0) // nothing to key the file on

    const root = projectRoot(input.cwd)
    if (insidePlugin(root)) process.exit(0)
    // The marker jiffi-init writes. Outside a builder-kit project this hook is a
    // no-op rather than an uninvited docs/tasks/ folder in someone's repo.
    if (!existsSync(join(root, '.claude', 'builder-kit.json'))) process.exit(0)

    const prev = store.readTask(id, { root })
    const patch = {}

    const subject = typeof input.task_subject === 'string' ? input.task_subject.trim() : ''
    if (subject) patch.subject = subject

    // Only ever set a description we actually received. A completion event that arrives
    // without one must not blank a body someone wrote.
    const description = typeof input.task_description === 'string' ? input.task_description : ''
    if (description.trim()) patch.description = description

    const phase = phaseFrom(subject || (prev && prev.subject))
    if (phase != null) patch.phase = phase

    if (event === 'TaskCompleted') {
      patch.status = 'closed'
    } else if (!prev || prev.status !== 'closed') {
      patch.status = 'open'
    }
    // The else case is deliberate: a TaskCreated for an id already CLOSED on disk leaves
    // the close alone. Harnesses re-announce tasks, and silently un-closing a finished
    // phase is the exact state loss this store exists to prevent. Genuinely reopening one
    // is an explicit `task-store.mjs write <id> --status open`.

    store.writeTask(id, patch, { root })
    process.exit(0)
  } catch {
    process.exit(0) // mirroring is a side channel; it never decides anything
  }
})
