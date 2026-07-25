#!/usr/bin/env node
// Deterministic phase gate. Runs a manifest of checks against files and commands
// on disk and lets the MECHANICAL checks' real exit codes decide pass/fail. This
// is the anti-self-grading spine: a slash command is a prompt and "the command
// reports pass/fail" means the model reports, generously. This script does not.
//
// Usage:
//   node checkpoint.mjs [phase] [--manifest <path>] [--json]
//
// Manifest resolution order (first that exists):
//   1) --manifest <path>
//   2) docs/checkpoints/phase-<phase>.json   (when a phase arg is given)
//   3) docs/checkpoints/checkpoint.json
//   4) <plugin>/scripts/checkpoint-manifest.json   (the shipped default)
//
// Each check: { id, label, kind: "mechanical" | "semantic", type, ...args,
//               phases?: number[], optional?: boolean }
// Types:
//   command          { cmd, expectExit?=0 }          run in a shell, compare exit code
//   test-command     { expectExit?=0 }                run the project's test command from .claude/builder-kit.json (fallback npm test), compare exit code
//   file-exists      { path }                          the file exists and is non-empty
//   grep-min         { path, pattern, min?=1, flags?="" }  >= min regex matches in the file
//   heading          { path, text }                    a markdown heading line contains text
//   checklist-done   { path, section? }                no unticked "[ ]" remain (optionally within a heading section)
//   advisory         { note }                          semantic only — printed, never gates
//
// Mechanical checks decide the exit code (any fail => exit 1). Semantic checks are
// advisory by name and never affect the exit code. `optional: true` downgrades a
// mechanical fail to a warning.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const json = args.includes('--json')
const mIdx = args.indexOf('--manifest')
const manifestArg = mIdx !== -1 ? args[mIdx + 1] : null
const phaseArg = args.find((a) => /^\d+$/.test(a)) || null
const phase = phaseArg ? Number(phaseArg) : null

function resolveManifest() {
  const candidates = [
    manifestArg,
    phase != null ? `docs/checkpoints/phase-${phase}.json` : null,
    'docs/checkpoints/checkpoint.json',
    join(HERE, 'checkpoint-manifest.json'),
  ].filter(Boolean)
  return candidates.find((p) => existsSync(p)) || null
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

// Resolve the project's test command from .claude/builder-kit.json (relative to
// cwd, like every manifest path). jiffi-init writes a per-type testCommand there
// (web: npm test, ios: xcodebuild test, agent: npm run eval), so a green "tests
// pass" check means the REAL per-type suite ran, not a hardcoded npm test. A
// missing/invalid config, or an unset testCommand, falls back to npm test, the
// same fallback the Stop hook (stop-test-gate.mjs) and doctor use.
function resolveTestCommand() {
  const body = readFileSafe('.claude/builder-kit.json')
  if (body == null) return { cmd: 'npm test', source: 'fallback (no .claude/builder-kit.json)' }
  try {
    const cfg = JSON.parse(body)
    const tc = cfg && cfg.testCommand
    if (typeof tc === 'string' && tc.trim()) return { cmd: tc, source: '.claude/builder-kit.json' }
    return { cmd: 'npm test', source: 'fallback (no testCommand in .claude/builder-kit.json)' }
  } catch {
    return { cmd: 'npm test', source: 'fallback (.claude/builder-kit.json is not valid JSON)' }
  }
}

function runCheck(c) {
  try {
    switch (c.type) {
      case 'command': {
        const r = spawnSync(c.cmd, { shell: true, encoding: 'utf8', timeout: 600000 })
        const code = r.status == null ? 1 : r.status
        const want = c.expectExit ?? 0
        const evidence = `exit ${code} (expected ${want})${r.error ? ` — ${r.error.message}` : ''}`
        return { pass: code === want, evidence }
      }
      case 'test-command': {
        // Resolve the per-type test command from config, then run it with the
        // exact same exit-code semantics as `command` (delegate, don't duplicate).
        // A suite that cannot run (e.g. exit 127) FAILS the gate. Unlike the Stop
        // hook it never fails open, because a green checkpoint must mean the real
        // suite passed. The evidence names what ran so the gate is auditable.
        const { cmd, source } = resolveTestCommand()
        const res = runCheck({ ...c, type: 'command', cmd })
        return { pass: res.pass, evidence: `\`${cmd}\` [${source}] — ${res.evidence}` }
      }
      case 'file-exists': {
        const ok = existsSync(c.path) && statSync(c.path).size > 0
        return { pass: ok, evidence: ok ? `present (${statSync(c.path).size} bytes)` : 'missing or empty' }
      }
      case 'grep-min': {
        const body = readFileSafe(c.path)
        if (body == null) return { pass: false, evidence: `file not found: ${c.path}` }
        const re = new RegExp(c.pattern, 'g' + (c.flags || ''))
        const n = (body.match(re) || []).length
        const min = c.min ?? 1
        return { pass: n >= min, evidence: `${n} match(es), need >= ${min}` }
      }
      case 'heading': {
        const body = readFileSafe(c.path)
        if (body == null) return { pass: false, evidence: `file not found: ${c.path}` }
        const ok = body.split('\n').some((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(String(c.text).toLowerCase()))
        return { pass: ok, evidence: ok ? `heading contains "${c.text}"` : `no heading contains "${c.text}"` }
      }
      case 'checklist-done': {
        const body = readFileSafe(c.path)
        if (body == null) return { pass: false, evidence: `file not found: ${c.path}` }
        let scope = body
        if (c.section) {
          const lines = body.split('\n')
          const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && l.toLowerCase().includes(String(c.section).toLowerCase()))
          if (start === -1) return { pass: false, evidence: `section "${c.section}" not found` }
          const rest = lines.slice(start + 1)
          const end = rest.findIndex((l) => /^#{1,6}\s/.test(l))
          scope = (end === -1 ? rest : rest.slice(0, end)).join('\n')
        }
        // `match` scopes the check to only the checklist lines matching a regex —
        // e.g. match:"AC-001" gates just this phase's criteria, so an early phase
        // does not fail on later phases' still-unticked ACs. Without it, ALL items
        // must be ticked (correct for the final, whole-project checkpoint).
        if (c.match) {
          const re = new RegExp(c.match)
          scope = scope.split('\n').filter((l) => re.test(l)).join('\n')
        }
        const open = (scope.match(/^\s*[-*]\s+\[ \]/gm) || []).length
        const done = (scope.match(/^\s*[-*]\s+\[x\]/gim) || []).length
        return { pass: open === 0 && done > 0, evidence: `${done} ticked, ${open} unticked${c.match ? ` (matching /${c.match}/)` : ''}` }
      }
      case 'advisory':
        return { pass: null, evidence: c.note || 'review manually' }
      default:
        return { pass: false, evidence: `unknown check type: ${c.type}` }
    }
  } catch (e) {
    return { pass: false, evidence: `check errored: ${e.message}` }
  }
}

const manifestPath = resolveManifest()
if (!manifestPath) {
  const msg = 'No checkpoint manifest found. Nothing could be verified mechanically — this is NOT a pass. Create docs/checkpoints/checkpoint.json (or run /jiffi-init which scaffolds one).'
  if (json) console.log(JSON.stringify({ verified: false, reason: 'no-manifest', checks: [] }, null, 2))
  else console.log('⚠️  ' + msg)
  process.exit(0)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
} catch (e) {
  console.error(`Manifest ${manifestPath} is not valid JSON: ${e.message}`)
  process.exit(1)
}
const checks = (Array.isArray(manifest) ? manifest : manifest.checks || []).filter(
  (c) => !c.phases || phase == null || c.phases.includes(phase),
)

const rows = []
let mechFail = 0
let mechWarn = 0
for (const c of checks) {
  const res = runCheck(c)
  const kind = c.kind === 'semantic' || c.type === 'advisory' ? 'semantic' : 'mechanical'
  let status
  if (res.pass === null) status = 'review'
  else if (res.pass) status = 'pass'
  else if (c.optional) {
    status = 'warn'
    if (kind === 'mechanical') mechWarn++
  } else {
    status = 'fail'
    if (kind === 'mechanical') mechFail++
  }
  rows.push({ id: c.id, label: c.label || c.id, kind, status, evidence: res.evidence })
}

if (json) {
  console.log(JSON.stringify({ verified: mechFail === 0, manifest: manifestPath, phase, mechFail, mechWarn, checks: rows }, null, 2))
  process.exit(mechFail === 0 ? 0 : 1)
}

const icon = { pass: '✅', fail: '❌', warn: '⚠️ ', review: '👀' }
console.log(`\nCheckpoint${phase != null ? ` — phase ${phase}` : ''}  (${manifestPath})\n`)
console.log('  ' + 'Check'.padEnd(34) + 'Kind'.padEnd(11) + 'Result'.padEnd(8) + 'Evidence')
console.log('  ' + '-'.repeat(88))
for (const r of rows) {
  console.log('  ' + String(r.label).slice(0, 33).padEnd(34) + r.kind.padEnd(11) + (icon[r.status] || '') + '  ' + String(r.status).padEnd(8) + r.evidence)
}
console.log('')
if (mechFail === 0) {
  const semantic = rows.filter((r) => r.kind === 'semantic').length
  console.log(`✅ All mechanical checks passed${mechWarn ? ` (${mechWarn} optional warning${mechWarn > 1 ? 's' : ''})` : ''}. ${semantic ? `${semantic} semantic check(s) are ADVISORY — a human/agent still judges those.` : ''}`)
  console.log('   Mechanical pass is necessary, not sufficient: it proves the checks ran, not that the work is good.')
  process.exit(0)
} else {
  const first = rows.find((r) => r.status === 'fail' && r.kind === 'mechanical')
  console.log(`❌ ${mechFail} mechanical check(s) failed. Fix this first: "${first.label}" — ${first.evidence}`)
  console.log('   Do NOT mark the phase done. A mechanical failure is not a matter of opinion.')
  process.exit(1)
}
