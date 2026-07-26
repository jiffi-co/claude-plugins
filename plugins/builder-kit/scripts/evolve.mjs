#!/usr/bin/env node
// SkillOpt engine, the deterministic half of /jiffi-evolve. The MODEL does the
// reflect + propose + currency check (it reads the clusters this prints, checks
// current tools via Context7/release-notes, and applies bounded SKILL.md edits).
// This script owns only the parts that must NOT be a judgement call: reading the
// friction-log, clustering it, running the held-out validation gate, and
// recording the changelog. Nothing here edits a skill or calls the model.
//
// Subcommands:
//   harvest   read docs/evolve/friction-log.md, cluster by skill + what-broke,
//             print the recurring frictions (most frequent first). Default.
//   gate      run the full test suite (scripts/test/run.sh, the 29 checks) AND a
//             quick self-check (every SKILL.md has balanced ``` fences). Both must
//             pass. This is SkillOpt's held-out validation (an edit is kept only
//             if this exits 0, rejected + logged otherwise).
//   log       append one dated row to docs/evolve/CHANGELOG.md recording an edit
//             that was applied or rejected. Flags: --skill --change --result
//             (applied|rejected) --reason.
//
// Common: --json prints machine-readable output. Paths are cwd-relative (the
// project), like every other builder-kit script; the plugin's own files are
// resolved from this script's location so the gate works from any cwd.
//
// Usage:
//   node evolve.mjs [harvest] [--json]
//   node evolve.mjs gate [--json]
//   node evolve.mjs log --skill <name> --change <text> --result applied|rejected [--reason <text>] [--json]

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(HERE)
const FRICTION_LOG = 'docs/evolve/friction-log.md'
const CHANGELOG = 'docs/evolve/CHANGELOG.md'

const argv = process.argv.slice(2)
const json = argv.includes('--json')
const sub = (argv.find((a) => !a.startsWith('--')) || 'harvest').toLowerCase()

// A named flag's value: --key value (returns null if absent, '' if the flag is
// present but has no following value).
function flag(name) {
  const i = argv.indexOf(name)
  if (i === -1) return null
  const next = argv[i + 1]
  return next && !next.startsWith('--') ? next : ''
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

function pluginVersion() {
  return (readFileSafe(join(PLUGIN_ROOT, 'VERSION')) || 'unknown').trim()
}

// --- harvest -------------------------------------------------------------

// Parse the friction-log markdown table. Rows look like:
//   | date | skill | step | what-broke | what-the-user-did |
// The header row and the |---|---| separator are skipped. A row with the wrong
// cell count is skipped, not guessed at (a malformed log should under-report,
// never mis-report). Returns [] when the log is missing or has no data rows.
function parseFrictionLog(body) {
  if (body == null) return []
  const rows = []
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line.startsWith('|')) continue
    // Split on unescaped pipes; drop the leading/trailing empty cells.
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length !== 5) continue
    const [date, skill, step, whatBroke, whatUserDid] = cells
    // Skip the header row and any separator row (----, :---:, etc.).
    if (/^-+:?$/.test(skill.replace(/:/g, '-')) || skill.toLowerCase() === 'skill') continue
    if (!skill) continue
    rows.push({ date, skill, step, whatBroke, whatUserDid })
  }
  return rows
}

// Cluster by skill + a normalised what-broke so recurring frictions surface. The
// normalisation is deliberately crude (lowercase, collapse whitespace, strip
// trailing punctuation). The model does the real semantic clustering from these
// buckets; this just groups the obvious repeats so nothing recurring is missed.
function clusterFrictions(rows) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.!?,;:]+$/, '').trim()
  const map = new Map()
  for (const r of rows) {
    const key = `${r.skill}␟${norm(r.whatBroke)}`
    if (!map.has(key)) {
      map.set(key, { skill: r.skill, whatBroke: r.whatBroke, count: 0, steps: new Set(), dates: [] })
    }
    const c = map.get(key)
    c.count++
    if (r.step) c.steps.add(r.step)
    if (r.date) c.dates.push(r.date)
  }
  return [...map.values()]
    .map((c) => ({ ...c, steps: [...c.steps] }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill))
}

function harvest() {
  const version = pluginVersion()
  const rows = parseFrictionLog(readFileSafe(FRICTION_LOG))
  const clusters = clusterFrictions(rows)

  if (json) {
    console.log(JSON.stringify({ version, log: FRICTION_LOG, totalRows: rows.length, clusters }, null, 2))
    return 0
  }

  console.log(`\nSkillOpt harvest  (plugin v${version})\n`)
  if (rows.length === 0) {
    console.log(`  No friction recorded yet (${FRICTION_LOG} is missing or empty).`)
    console.log('  Skills append a row here when a gate fails, a marked recommendation is')
    console.log('  overridden, or a manual workaround was needed. Nothing to reflect on today,')
    console.log('  but the currency check below is still worth running.')
    console.log('\n  Next: proceed to the CURRENCY CHECK step in /jiffi-evolve (Context7 + release notes).')
    return 0
  }

  console.log(`  ${rows.length} friction row(s), ${clusters.length} cluster(s). Most recurring first:\n`)
  console.log('  ' + 'Count'.padEnd(7) + 'Skill'.padEnd(20) + 'What broke (normalised group)')
  console.log('  ' + '-'.repeat(80))
  for (const c of clusters) {
    const where = c.steps.length ? `  [steps: ${c.steps.join(', ')}]` : ''
    console.log('  ' + String(c.count).padEnd(7) + String(c.skill).slice(0, 19).padEnd(20) + c.whatBroke.slice(0, 44) + where)
  }
  console.log('\n  These are BUCKETS, not conclusions. Back in /jiffi-evolve, read the rows,')
  console.log('  find the root cause per cluster, then propose bounded edits and validate each')
  console.log('  with `node evolve.mjs gate` before keeping it.')
  return 0
}

// --- gate ----------------------------------------------------------------

// The held-out validation. Two parts, both must pass:
//   1) the full test suite (scripts/test/run.sh, the 29 checks) still exits 0
//   2) a quick self-check: every skills/**/SKILL.md has balanced ``` fences
// An edit is kept only when this exits 0. This is the anti-drift spine: the model
// proposes, but a real command decides whether the edit survives.
function balancedFences() {
  const skillsDir = join(PLUGIN_ROOT, 'skills')
  const offenders = []
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name === 'SKILL.md') {
        const body = readFileSafe(p) || ''
        const fences = (body.match(/^```/gm) || []).length
        if (fences % 2 !== 0) offenders.push(p)
      }
    }
  }
  walk(skillsDir)
  return offenders
}

function gate() {
  const runSh = join(HERE, 'test', 'run.sh')
  let suitePass = false
  let suiteEvidence
  if (!existsSync(runSh)) {
    suiteEvidence = `test suite not found at ${runSh}`
  } else {
    const r = spawnSync('bash', [runSh], { encoding: 'utf8', timeout: 600000 })
    const code = r.status == null ? 1 : r.status
    suitePass = code === 0
    // Surface the suite's own tail (the "N passed, M failed" line) as evidence.
    const tail = (r.stdout || '').trim().split('\n').filter(Boolean).slice(-2).join(' | ')
    suiteEvidence = `exit ${code}${r.error ? `. ${r.error.message}` : ''}${tail ? `. ${tail}` : ''}`
  }

  const offenders = balancedFences()
  const fencePass = offenders.length === 0

  const pass = suitePass && fencePass
  if (json) {
    console.log(JSON.stringify({ pass, suite: { pass: suitePass, evidence: suiteEvidence }, selfCheck: { pass: fencePass, unbalancedFences: offenders.map((p) => p.replace(PLUGIN_ROOT + '/', '')) } }, null, 2))
    return pass ? 0 : 1
  }

  console.log('\nSkillOpt gate (held-out validation)\n')
  console.log(`  ${suitePass ? 'PASS' : 'FAIL'}  test suite (scripts/test/run.sh). ${suiteEvidence}`)
  console.log('  ' + (fencePass ? 'PASS' : 'FAIL') + '  self-check: balanced code fences in every SKILL.md')
  if (!fencePass) for (const p of offenders) console.log(`          unbalanced: ${p.replace(PLUGIN_ROOT + '/', '')}`)
  console.log('')
  if (pass) {
    console.log('  Gate PASSED. This edit may be kept. Record it with `node evolve.mjs log`.')
  } else {
    console.log('  Gate FAILED. Revert this edit, then record the rejection with')
    console.log('  `node evolve.mjs log --result rejected --reason "<why the gate failed>"`.')
  }
  return pass ? 0 : 1
}

// --- log -----------------------------------------------------------------

// Append one dated row to the changelog (create it with a header if absent). This
// is a pure record, it does not touch a skill. The row is written verbatim from
// the flags so the model owns the wording; the script owns only the format.
function log() {
  const skill = flag('--skill') || '(unspecified)'
  const change = flag('--change') || '(no description given)'
  const result = (flag('--result') || '').toLowerCase()
  const reason = flag('--reason') || ''
  const version = pluginVersion()

  if (result !== 'applied' && result !== 'rejected') {
    console.error('log requires --result applied|rejected (an edit either survived the gate or did not).')
    return 1
  }
  // Keep cells single-line so the markdown table stays intact.
  const clean = (s) => String(s).replace(/[\r\n|]+/g, ' ').trim()
  const date = new Date().toISOString().slice(0, 10)
  const row = `| ${date} | v${version} | ${clean(skill)} | ${clean(change)} | ${result} | ${clean(reason)} |\n`

  mkdirSync(dirname(CHANGELOG), { recursive: true })
  if (!existsSync(CHANGELOG) || statSync(CHANGELOG).size === 0) {
    const header =
      '# SkillOpt changelog\n\n' +
      'Every edit /jiffi-evolve proposed, and whether the held-out gate kept or rejected it.\n\n' +
      '| date | plugin | skill | change | result | reason |\n' +
      '|------|--------|-------|--------|--------|--------|\n'
    writeFileSync(CHANGELOG, header + row)
  } else {
    writeFileSync(CHANGELOG, readFileSync(CHANGELOG, 'utf8').replace(/\n*$/, '\n') + row)
  }

  if (json) console.log(JSON.stringify({ recorded: true, path: CHANGELOG, result, skill: clean(skill) }, null, 2))
  else console.log(`Recorded (${result}) in ${CHANGELOG}: ${clean(skill)}, ${clean(change)}`)
  return 0
}

// --- dispatch ------------------------------------------------------------

const handlers = { harvest, gate, log }
const handler = handlers[sub]
if (!handler) {
  console.error(`Unknown subcommand "${sub}". Use: harvest | gate | log.`)
  process.exit(1)
}
process.exit(handler())
