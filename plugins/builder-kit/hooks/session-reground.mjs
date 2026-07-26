#!/usr/bin/env node
// SessionStart: re-ground from disk. Reads the decision log, ADR index and plan
// if present and injects a short summary, so a new session starts from the
// project's real state instead of a blank slate (the read half of the decision
// log). Fails OPEN — prints nothing on any error and never blocks the session.
import { readFileSync } from 'node:fs'
function head(p, n) {
  try {
    return readFileSync(p, 'utf8').split('\n').slice(0, n).join('\n').trim()
  } catch {
    return null
  }
}
try {
  const parts = []
  const d = head('docs/decisions.md', 40)
  const a = head('docs/adr/README.md', 30)
  const p = head('docs/implementation-plan.md', 50)
  if (d) parts.push('### Decisions so far (docs/decisions.md)\n' + d)
  if (a) parts.push('### ADR index (docs/adr/README.md)\n' + a)
  if (p) parts.push('### Implementation plan (docs/implementation-plan.md)\n' + p)
  if (parts.length) {
    const ctx =
      'builder-kit re-grounding — this project keeps its state on disk. Before acting, work from the current decisions, ADRs and plan below (read the full files if you need detail):\n\n' +
      parts.join('\n\n')
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } }),
    )
  }
} catch {}
process.exit(0)
