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
//
// The one block it does make is recorded to .claude/builder-kit/last-block.md, because
// Claude Desktop renders nothing when a hook blocks and the user would otherwise see a
// hang. Only the deliberate block is reported; every fail-open path stays silent.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// Dynamic, like secret-scan's: a broken or missing reporter must not take the gate
// with it. Here the direction is milder (a load failure would fail open, which is
// this hook's default posture anyway) but the same rule applies. Reporting is a
// side channel and never decides the exit code.
let reportBlock = null
try {
  ;({ reportBlock } = await import('./block-report.mjs'))
} catch {
  reportBlock = null
}

// The try is load-bearing: this runs inside the hook's outer fail-open catch, so a
// reporter that throws would exit 0 and quietly drop a block the user asked for.
function deny(o) {
  try {
    if (typeof reportBlock === 'function') return reportBlock(o)
  } catch {
    // fall through to the message below
  }
  return (
    `${o.reason}\n\n${o.remedy}\n\nTell the user which tests failed. In the Claude Code panel ` +
    'of Claude Desktop a blocked turn renders nothing at all, so unless you say it they see a hang.\n'
  )
}

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
      // No stopId: this is a project gate, not one of the six hard stops in
      // .claude/rules/autonomy.md, and citing an id that does not exist is worse
      // than citing none.
      const reason =
        `Stopped by the builder-kit test gate: the ${projectType} test command ` +
        `(\`${cmd}\`) exited ${r.status}.`
      const remedy =
        'Do not call this phase done with a red suite. Fix the failing tests and finish the ' +
        'turn. If the gate is wrong for this project, set "stopTestGate": false in ' +
        '.claude/builder-kit.json.'
      process.stderr.write(deny({ hook: 'stop-test-gate', reason, remedy, root: input.cwd }))
      process.exit(2)
    }
    process.exit(0)
  } catch {
    process.exit(0) // fail open, never block a build because the gate itself errored
  }
})
