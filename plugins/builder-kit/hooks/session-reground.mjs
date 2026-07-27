#!/usr/bin/env node
// SessionStart: re-ground from disk.
//
// A fresh session and a /clear both start from nothing, and the reasonable thing
// for a model with no history to do is ask. This hook removes the question: it
// injects the project's real state — the step number, the next command, and any
// blocker — plus the head of the decision log, the ADR index and the plan.
//
// The step number comes from scripts/state.mjs, the same function /builder-kit:status
// calls, so a re-grounded session and a status read can never disagree. Everything
// is derived from artefacts on disk; nothing here trusts a transcript.
//
// Fails OPEN — prints nothing on any error and never blocks the session. It also
// stays silent in a directory that is not a project, so opening a shell in ~ does
// not get a status block it did not ask for.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Dynamic, so a missing or broken state.mjs degrades to the old doc-head summary
// rather than taking session start with it. Re-grounding is a convenience; it must
// never be the reason a session fails to open.
let getState = null
let formatState = null
try {
  ;({ getState, formatState } = await import('../scripts/state.mjs'))
} catch {
  getState = null
  formatState = null
}

function head(p, n) {
  try {
    return readFileSync(p, 'utf8').split('\n').slice(0, n).join('\n').trim()
  } catch {
    return null
  }
}

try {
  // The harness's project dir is authoritative; the working directory is the
  // fallback, which is what this hook used before and what a plain `claude` in a
  // project resolves to anyway.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()

  let stateBlock = null
  let isProject = false
  try {
    if (typeof getState === 'function' && typeof formatState === 'function') {
      const state = getState(root)
      // An unreadable root is a named error, not something to announce at session
      // start. Stay quiet and let the doc heads (if any) speak.
      if (state && state.ok) {
        isProject = Boolean(state.isBuilderKitProject)
        stateBlock = formatState(state)
      }
    }
  } catch {
    stateBlock = null
  }

  // Same root as the state read above. Resolving the docs relative to the working
  // directory while resolving the state from CLAUDE_PROJECT_DIR would let one
  // injection describe two different projects.
  const parts = []
  const d = head(join(root, 'docs/decisions.md'), 40)
  const a = head(join(root, 'docs/adr/README.md'), 30)
  const p = head(join(root, 'docs/implementation-plan.md'), 50)

  // Silence in a directory that is not a build. Without this, every session in a
  // home directory or an unrelated repo opens with a "you are at step 1" block.
  if (!isProject && !d && !a && !p) process.exit(0)

  if (stateBlock) {
    parts.push(
      '### Where this project is (read from disk by builder-kit)\n' +
        stateBlock +
        '\n\nThis is the current step. Do not re-derive it from the conversation, and do not ' +
        'run the next command without being asked. `/builder-kit:status` prints the same block on demand.',
    )
  }
  if (d) parts.push('### Decisions so far (docs/decisions.md)\n' + d)
  if (a) parts.push('### ADR index (docs/adr/README.md)\n' + a)
  if (p) parts.push('### Implementation plan (docs/implementation-plan.md)\n' + p)

  if (parts.length) {
    const ctx =
      'builder-kit re-grounding — this project keeps its state on disk. Before acting, work from the current state, decisions, ADRs and plan below (read the full files if you need detail):\n\n' +
      parts.join('\n\n')
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } }),
    )
  }
} catch {}
process.exit(0)
