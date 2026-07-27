#!/usr/bin/env node
// The four gate rows checkpoint.mjs cannot express, each decided by an exit code
// or a number read off disk. Two are new (coverage, npm audit) and two replace
// advisory self-grades that the model used to answer for itself:
//
//   coverage   run the project's coverage command, then read the report it wrote
//              and compare the percentage against a bar. A red suite fails here
//              first: an unmeasured project is not a covered one.
//   audit      npm audit --audit-level=high. The exit code is the verdict.
//   committed  git status --porcelain empty AND git log @{u}..HEAD empty.
//              Replaces "confirm the phase branch is committed and pushed".
//   ui-review  the review artefact exists and is non-empty.
//              Replaces "run the ui-review skill before ticking".
//
// Why this is a script and not a paragraph: "run coverage and check it is high
// enough" asks the model to grade its own work, and a model grades generously.
// Anything here can fail, and a failure is not a matter of opinion.
//
// Usage:
//   node gate.mjs                     every row, table output
//   node gate.mjs coverage            one row (ids: coverage, audit, committed, ui-review)
//   node gate.mjs --json              machine-readable
//   node gate.mjs coverage --min 80   tighten the coverage bar for this run
//   node gate.mjs ui-review 3         phase 3's review artefact
//   node gate.mjs --emit-checks       manifest rows to paste into docs/checkpoints/*.json
//
// Config, all optional, from .claude/builder-kit.json:
//   { "gate": { "coverageCommand": "npm run test:coverage",
//               "coverageMin": 60,
//               "coverageSummary": "coverage/coverage-summary.json",
//               "auditLevel": "high",
//               "uiReviewPath": "docs/checkpoints/ui-review-1.md" } }
//
// Exit: 0 nothing failed (skips do not fail), 1 at least one row failed,
//       2 the gate could not run at all (bad arguments).
//
// A skip means the project genuinely does not have that capability yet (no
// coverage command, no lockfile, no git repo). It is printed, never hidden, and
// it never turns into a pass. A row that CAN run but cannot reach the registry
// fails rather than skipping: nothing was proven, and a manifest that wants to
// tolerate that marks the row "optional": true, which is checkpoint.mjs's job.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const IDS = ['coverage', 'audit', 'committed', 'ui-review']

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const emit = argv.includes('--emit-checks')

function flag(name) {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : null
}

const minArg = flag('--min')
// A bare number is a phase, the way checkpoint.mjs reads one. Skip the value that
// belongs to --min, or `--min 80` silently becomes "phase 80" and the ui-review
// row starts hunting for docs/checkpoints/ui-review-80.md.
const bareNumber = argv.find((a, i) => /^\d+$/.test(a) && argv[i - 1] !== '--min' && argv[i - 1] !== '--phase')
const phaseArg = flag('--phase') || bareNumber || null
const selected = argv.filter((a) => IDS.includes(a))

const bad = argv.filter(
  (a, i) =>
    a.startsWith('-') &&
    !['--json', '--emit-checks', '--absolute', '--min', '--phase'].includes(a) &&
    argv[i - 1] !== '--min' &&
    argv[i - 1] !== '--phase',
)
if (bad.length) {
  console.error(`Unknown option(s): ${bad.join(', ')}. Rows: ${IDS.join(', ')}.`)
  process.exit(2)
}
if (argv.includes('--min') && (minArg == null || !/^\d+(\.\d+)?$/.test(minArg))) {
  console.error(`--min wants a number, got "${minArg == null ? '' : minArg}".`)
  process.exit(2)
}
if (argv.includes('--phase') && (phaseArg == null || !/^\d+$/.test(phaseArg))) {
  console.error(`--phase wants a number, got "${phaseArg == null ? '' : phaseArg}".`)
  process.exit(2)
}

// --- small helpers ----------------------------------------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

const cfg = readJson('.claude/builder-kit.json') || {}
const gateCfg = (cfg && typeof cfg.gate === 'object' && cfg.gate) || {}

// A config file that exists and does not parse is the dangerous case: every bar
// silently reverts to a default while the author believes theirs is in force, so
// a 90% bar quietly becomes 60%. Announce it above the table and in the JSON,
// where it is visible whatever the rows do, including when they all skip.
const configError = existsSync('.claude/builder-kit.json') && readJson('.claude/builder-kit.json') == null
  ? '.claude/builder-kit.json is not valid JSON, so gate defaults are in force'
  : null

// Run in a shell, like checkpoint.mjs's `command` type, so a configured command
// can carry pipes and flags. 10 minutes matches checkpoint.mjs's ceiling.
function sh(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 600000, maxBuffer: 32 * 1024 * 1024 })
  return { code: r.status == null ? 1 : r.status, out: r.stdout || '', err: r.stderr || '', error: r.error }
}

// git goes through argv, never a shell string: `@{u}` is brace-expansion bait in
// some shells and a path with a space would break the quoting.
function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8', timeout: 60000 })
  return {
    code: r.status == null ? 1 : r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    missing: Boolean(r.error && r.error.code === 'ENOENT'),
  }
}

const pass = (evidence) => ({ status: 'pass', evidence })
const fail = (evidence) => ({ status: 'fail', evidence })
const skip = (evidence) => ({ status: 'skip', evidence })

// --- coverage ---------------------------------------------------------------

// The command, in order of authority: what the project configured, then a
// coverage script it already has. Never invented: guessing `npm test --
// --coverage` produces a confusing failure on a project that never set coverage up.
function coverageCommand() {
  if (typeof gateCfg.coverageCommand === 'string' && gateCfg.coverageCommand.trim()) {
    return { cmd: gateCfg.coverageCommand.trim(), source: '.claude/builder-kit.json' }
  }
  const pkg = readJson('package.json')
  const scripts = (pkg && pkg.scripts) || {}
  for (const name of ['test:coverage', 'coverage']) {
    if (typeof scripts[name] === 'string') return { cmd: `npm run ${name}`, source: `package.json scripts.${name}` }
  }
  return { cmd: null, source: null }
}

// Two report shapes, both istanbul's. coverage-summary.json is the one to want
// (it carries real line coverage); coverage-final.json is computed from the
// statement map, which is close but not the same number, so the evidence says so.
function coverageReport() {
  const summaryPath = gateCfg.coverageSummary || 'coverage/coverage-summary.json'
  const summary = readJson(summaryPath)
  if (summary && summary.total && summary.total.lines && typeof summary.total.lines.pct === 'number') {
    return { pct: summary.total.lines.pct, metric: 'lines', from: summaryPath }
  }
  const final = readJson('coverage/coverage-final.json')
  if (final && !Array.isArray(final) && typeof final === 'object') {
    let total = 0
    let covered = 0
    for (const file of Object.values(final)) {
      const s = file && file.s
      if (!s || typeof s !== 'object') continue
      for (const hits of Object.values(s)) {
        total++
        if (hits > 0) covered++
      }
    }
    if (total > 0) {
      return { pct: Math.round((covered / total) * 10000) / 100, metric: 'statements', from: 'coverage/coverage-final.json' }
    }
  }
  return null
}

function checkCoverage() {
  const { cmd, source } = coverageCommand()
  if (!cmd) {
    return skip('no coverage command: set gate.coverageCommand in .claude/builder-kit.json, or add a test:coverage script')
  }
  const min = Number(minArg != null ? minArg : gateCfg.coverageMin != null ? gateCfg.coverageMin : 60)
  const startedAt = Date.now()
  const run = sh(cmd)
  if (run.code !== 0) {
    const why = run.error ? `, ${run.error.message}` : ''
    return fail(`\`${cmd}\` [${source}] exited ${run.code}${why}. The suite is red, so coverage is unmeasured`)
  }
  const report = coverageReport()
  if (!report) {
    return fail(
      `\`${cmd}\` passed but wrote no readable report. Add a json-summary reporter (vitest: coverage.reporter ["text","json-summary"]) or set gate.coverageSummary`,
    )
  }
  // A report older than this run is a leftover from a previous one. Reading it
  // would let any command that touches nothing (a stub, a no-op script) inherit
  // yesterday's number, which is self-grading wearing a filename.
  const writtenAt = statSync(report.from).mtimeMs
  if (writtenAt < startedAt) {
    return fail(`${report.from} predates this run, so \`${cmd}\` did not produce it. The number on disk proves nothing`)
  }
  const verdict = `${report.metric} ${report.pct}% vs bar ${min}% (${report.from})`
  return report.pct >= min ? pass(verdict) : fail(verdict)
}

// --- npm audit --------------------------------------------------------------

function checkAudit() {
  if (!existsSync('package.json')) return skip('no package.json, so there is nothing to audit')
  const lock = ['package-lock.json', 'npm-shrinkwrap.json'].find((f) => existsSync(f))
  if (!lock) {
    const other = ['yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'].find((f) => existsSync(f))
    return skip(
      other
        ? `npm audit needs an npm lockfile and this project uses ${other}; run that tool's own audit`
        : 'no lockfile, so npm audit has no dependency tree to check',
    )
  }
  // Checked against npm's own set rather than passed through. A typo would make
  // npm error in a way that reads like a network problem, and this value reaches
  // a shell, so an unrecognised string is refused rather than interpolated.
  const LEVELS = ['info', 'low', 'moderate', 'high', 'critical']
  const wanted = typeof gateCfg.auditLevel === 'string' ? gateCfg.auditLevel.trim() : 'high'
  if (!LEVELS.includes(wanted)) {
    return fail(`gate.auditLevel is "${wanted}", which is not one of ${LEVELS.join(', ')}`)
  }
  const level = wanted
  const run = sh(`npm audit --json --audit-level=${level}`)
  const data = (() => {
    try {
      return JSON.parse(run.out)
    } catch {
      return null
    }
  })()
  if (data && data.error) {
    const msg = data.error.summary || data.error.code || 'npm audit could not complete'
    return fail(`npm audit could not run (${String(msg).split('\n')[0]}). Nothing was proven`)
  }
  if (!data) {
    const first = (run.err || run.out).split('\n').find((l) => l.trim()) || 'no output'
    return run.code === 0 ? pass(`npm audit --audit-level=${level} exited 0`) : fail(`npm audit exited ${run.code}: ${first.slice(0, 160)}`)
  }
  const v = (data.metadata && data.metadata.vulnerabilities) || {}
  const counts = ['critical', 'high', 'moderate', 'low']
    .filter((k) => v[k])
    .map((k) => `${v[k]} ${k}`)
    .join(', ')
  const summary = counts || 'no advisories'
  return run.code === 0 ? pass(`--audit-level=${level}: ${summary}`) : fail(`--audit-level=${level}: ${summary}`)
}

// --- committed --------------------------------------------------------------

// The advisory this replaces read "confirm the phase branch is committed and
// pushed - nothing here forces it". Now something does. Both halves matter: a
// clean tree with unpushed commits is still work that exists on one machine.
function checkCommitted() {
  const inRepo = git('rev-parse', '--is-inside-work-tree')
  // "git is not installed" and "this is not a repository" are different facts and
  // the remedies are nothing alike. Do not print the second when it is the first.
  if (inRepo.missing) return fail('git is not installed, so nothing about saved work can be checked')
  if (inRepo.code !== 0) {
    return skip('not a git repository, so there is nothing to commit to')
  }
  const dirty = git('status', '--porcelain')
  if (dirty.code !== 0) return fail(`git status failed: ${dirty.err.split('\n')[0] || 'unknown error'}`)
  if (dirty.out) {
    const lines = dirty.out.split('\n')
    const sample = lines.slice(0, 3).map((l) => l.trim()).join(', ')
    return fail(`${lines.length} uncommitted change(s): ${sample}${lines.length > 3 ? ', ...' : ''}`)
  }
  if (git('rev-parse', '--verify', 'HEAD').code !== 0) return fail('no commits yet, so nothing is saved')
  const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  if (upstream.code !== 0) {
    return fail('this branch has no upstream, so the work has never left this machine')
  }
  const ahead = git('log', '--oneline', '@{u}..HEAD')
  if (ahead.code !== 0) return fail(`could not compare against ${upstream.out}: ${ahead.err.split('\n')[0] || 'unknown error'}`)
  if (ahead.out) {
    const n = ahead.out.split('\n').length
    return fail(`${n} commit(s) not yet on ${upstream.out}`)
  }
  return pass(`tree clean and level with ${upstream.out}`)
}

// --- ui-review --------------------------------------------------------------

// The ui-review skill writes docs/checkpoints/ui-review-<phase>.md. With a phase
// this pins that exact file; without one, any review artefact counts.
function uiReviewPath() {
  if (typeof gateCfg.uiReviewPath === 'string' && gateCfg.uiReviewPath.trim()) return gateCfg.uiReviewPath.trim()
  if (phaseArg != null) return `docs/checkpoints/ui-review-${phaseArg}.md`
  const dir = 'docs/checkpoints'
  if (!existsSync(dir)) return null
  // Newest by modification time, not alphabetical: sorting strings puts
  // ui-review-9.md after ui-review-10.md and names the wrong file as evidence.
  const found = readdirSync(dir)
    .filter((f) => /^ui-review.*\.md$/.test(f))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  return found.length ? found[found.length - 1] : null
}

function checkUiReview() {
  const path = uiReviewPath()
  if (!path) return fail('no ui-review artefact under docs/checkpoints/. Run the ui-review skill, or set gate.uiReviewPath')
  if (!existsSync(path)) return fail(`missing: ${path}. Run the ui-review skill for this phase`)
  // A directory reports a non-zero size, so "exists and is non-empty" would pass
  // on one. The artefact is a file or it is not there.
  const stat = statSync(path)
  if (!stat.isFile()) return fail(`${path} is not a file, so there is no review to read`)
  if (stat.size === 0) return fail(`${path} is empty, so no review is recorded`)
  const when = stat.mtime.toISOString().slice(0, 16).replace('T', ' ')
  return pass(`${path} (${stat.size} bytes, written ${when})`)
}

// --- run --------------------------------------------------------------------

const ROWS = [
  { id: 'coverage', label: 'Coverage meets the bar', run: checkCoverage },
  { id: 'audit', label: 'No high dependency advisory', run: checkAudit },
  { id: 'committed', label: 'Work committed and pushed', run: checkCommitted },
  { id: 'ui-review', label: 'UI review artefact exists', run: checkUiReview },
]

// The rows as checkpoint.mjs manifest entries. Mechanical, not semantic: that is
// the entire point of this file.
//
// The path is the {{PLUGIN_SCRIPTS}} token, which checkpoint.mjs expands to its own
// directory, and NOT an absolute path resolved here. A manifest is read from the
// project's cwd, which knows nothing about where the plugin lives, but an absolute
// path baked in at scaffold time carries the plugin VERSION and stops resolving at
// the next update — the same failure lint-kit assertion 5 exists to catch in Bash
// rules. `--absolute` is the escape hatch for a runner that is not checkpoint.mjs;
// it fails loudly (file not found, exit 1) rather than silently passing.
if (emit) {
  const self = resolve(HERE, 'gate.mjs')
  const base = argv.includes('--absolute') ? `"${self}"` : '"{{PLUGIN_SCRIPTS}}/gate.mjs"'
  const checks = ROWS.map((r) => ({
    id: r.id,
    label: r.label,
    kind: 'mechanical',
    type: 'command',
    cmd: `node ${base} ${r.id}`,
    expectExit: 0,
  }))
  console.log(JSON.stringify({ checks }, null, 2))
  process.exit(0)
}

const rows = (selected.length ? ROWS.filter((r) => selected.includes(r.id)) : ROWS).map((r) => {
  let res
  try {
    res = r.run()
  } catch (e) {
    res = fail(`check errored: ${e.message}`)
  }
  return { id: r.id, label: r.label, ...res }
})

const failed = rows.filter((r) => r.status === 'fail')
const skipped = rows.filter((r) => r.status === 'skip')

if (asJson) {
  console.log(JSON.stringify({ verified: failed.length === 0, configError, phase: phaseArg ? Number(phaseArg) : null, failed: failed.length, skipped: skipped.length, checks: rows }, null, 2))
  process.exit(failed.length === 0 ? 0 : 1)
}

const icon = { pass: '✅', fail: '❌', skip: '➖' }
if (configError) console.log(`\n⚠️  ${configError}`)
console.log(`\nGate${phaseArg != null ? ` (phase ${phaseArg})` : ''}\n`)
console.log('  ' + 'Check'.padEnd(30) + 'Result'.padEnd(10) + 'Evidence')
console.log('  ' + '-'.repeat(88))
for (const r of rows) {
  console.log('  ' + String(r.label).slice(0, 29).padEnd(30) + (icon[r.status] || '') + '  ' + r.status.padEnd(6) + r.evidence)
}
console.log('')
if (failed.length === 0) {
  console.log(`✅ ${rows.length - skipped.length} row(s) passed${skipped.length ? `, ${skipped.length} skipped (printed above, and a skip is not a pass)` : ''}.`)
  process.exit(0)
}
console.log(`❌ ${failed.length} row(s) failed. Fix this first: "${failed[0].label}", ${failed[0].evidence}`)
console.log('   Do not tick the phase. These are exit codes and file contents, not opinions.')
process.exit(1)
