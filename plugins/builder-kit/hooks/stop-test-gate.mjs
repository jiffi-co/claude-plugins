#!/usr/bin/env node
// Stop hook: a deterministic test gate. OFF by default — this runs when a TURN
// ends, so forcing tests on every turn would be brutal. Enable it per-project in
// .claude/builder-kit.json ({ "stopTestGate": true, "testCommand": "npm test" }),
// typically during an active build phase. When on, it runs the tests and BLOCKS
// the turn ending (exit 2) if they fail, so a phase cannot be called done with a
// red suite. Fails OPEN on any error (missing config, command not found, etc.).
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}')
    if (input.stop_hook_active) process.exit(0) // never loop on our own block
    if (!existsSync('.claude/builder-kit.json')) process.exit(0)
    const cfg = JSON.parse(readFileSync('.claude/builder-kit.json', 'utf8'))
    if (!cfg.stopTestGate) process.exit(0)
    const cmd = cfg.testCommand || 'npm test'
    const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 600000 })
    if (r.status !== 0) {
      process.stderr.write(
        `Stop blocked by the builder-kit test gate: \`${cmd}\` exited ${r.status == null ? '?' : r.status}. ` +
          `Do not call this phase done with a red suite — fix the failing tests, or turn the gate off in .claude/builder-kit.json.\n`,
      )
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail open
  }
})
