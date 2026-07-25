#!/usr/bin/env node
// Stop hook: a deterministic, per-target test gate. OFF by default. It runs when a
// TURN ends, so forcing tests on every turn would be brutal. Turn it on per project
// by setting "stopTestGate": true in .claude/builder-kit.json; it then runs the
// "testCommand" recorded there (web: npm test, ios: xcodebuild, agent: npm run eval),
// never a hardcoded default. When that command exits non-zero the hook BLOCKS the
// turn (exit 2), so a phase cannot be called done with a red suite.
//
// No-op (exit 0, never blocks) when there is no config, when the gate is off, or when
// testCommand is absent. It also fails OPEN when the command cannot even start (tool
// not found, or an npm test script that does not exist yet): a check that could not
// run is not a failing suite, and reporting "red" there would block a beginner who
// has not written any tests. The one thing it must never do is claim a pass for a
// check that never ran, which is why the absent-command case no-ops instead of
// guessing "npm test".
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}')
    if (input.stop_hook_active) process.exit(0) // never loop on our own block
    if (!existsSync('.claude/builder-kit.json')) process.exit(0) // not a builder-kit project
    const cfg = JSON.parse(readFileSync('.claude/builder-kit.json', 'utf8'))
    if (!cfg.stopTestGate) process.exit(0) // the gate is opt-in and off by default

    const TYPES = ['web', 'ios', 'agent']
    const projectType = TYPES.includes(cfg.projectType) ? cfg.projectType : 'web'
    // Run exactly the command the config records, never a hardcoded default. Absent
    // or blank means there is nothing to gate, so no-op rather than false-block:
    // guessing "npm test" here would run the wrong tool on an ios or agent project
    // (or no tool at all) and report a pass that never happened.
    const cmd = typeof cfg.testCommand === 'string' ? cfg.testCommand.trim() : ''
    if (!cmd) process.exit(0)

    // web's default is `npm test`. If the command is npm-test-shaped but the project
    // has no test script yet, there is nothing to run, so fail open rather than block
    // someone who has not written tests. ios runs xcodebuild and agent runs
    // `npm run eval` (which ships its own script), so neither is npm-test-shaped and
    // neither reaches this branch.
    if (/^npm\s+(run\s+)?test\b/.test(cmd)) {
      try {
        const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
        if (!pkg.scripts || !pkg.scripts.test) process.exit(0)
      } catch {
        process.exit(0) // no package.json, nothing to run
      }
    }

    const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 600000 })
    // Fail OPEN when the command could not RUN: a spawn error, a timeout, or shell
    // exit 127 (command not found, e.g. xcodebuild off a Mac). Only a genuine
    // non-zero result from a command that actually ran blocks the turn.
    if (r.error || r.status === 127 || r.status == null) process.exit(0)
    if (r.status !== 0) {
      process.stderr.write(
        `Stop blocked by the builder-kit test gate: the ${projectType} test command (\`${cmd}\`) exited ${r.status}. ` +
          `Do not call this phase done with a red suite. Fix the failures, or set "stopTestGate": false in .claude/builder-kit.json.\n`,
      )
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail open, never block a build because the gate itself errored
  }
})
