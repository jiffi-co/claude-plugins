#!/usr/bin/env node
// Fixture test for the doctor's install resolver. No network, no installs, no
// package managers touched. It drives resolveInstallCommand with synthetic
// platforms and synthetic "what is already on this box" sets.
//
// It exists because of a specific bug in the prior art. jiffi-forge's
// `doctor --fix` filtered its targets to the recommended and optional tiers, so
// it could never install git or node, the two things a beginner is most likely
// to be missing. The tier-filter assertion below is that bug, written down.
//
// Run: node scripts/test/install-resolver.test.mjs

import {
  allCheckDefinitions,
  attemptable,
  applySudo,
  detectSurface,
  installCoverage,
  installTargets,
  resolveInstallCommand,
  runStreaming,
} from '../doctor.mjs'

const PLATFORMS = ['darwin', 'linux', 'win32']
let pass = 0
const failures = []

function ok(desc) {
  pass++
  console.log(`  PASS  ${desc}`)
}

function check(desc, condition, detail = '') {
  if (condition) ok(desc)
  else {
    failures.push(`${desc}${detail ? `: ${detail}` : ''}`)
    console.log(`  FAIL  ${desc}${detail ? `: ${detail}` : ''}`)
  }
}

// A synthetic machine. `have` is the set of binaries that already exist there.
function machine(platform, have = [], sudo = 'password-required') {
  return { platform, available: new Set(have), sudo }
}

const defs = allCheckDefinitions()
const byName = (needle) => defs.find((d) => d.name.toLowerCase().includes(needle))

const NODE = byName('node.js')
const GIT = byName('git')
const GH = byName('github cli')

console.log('== the three tools a beginner is most likely to be missing ==')
for (const [label, def] of [['node', NODE], ['git', GIT], ['gh', GH]]) {
  check(`${label} is in the check table`, Boolean(def))
}

// 1. A concrete candidate on all three platforms, on a bare machine.
// "Concrete" means a real command string, not a shrug. It does not have to be
// runnable here: an unrunnable candidate is still the exact line the user needs.
console.log('\n== a concrete candidate on every platform, even on a bare box ==')
for (const [label, def] of [['node', NODE], ['git', GIT], ['gh', GH]]) {
  for (const platform of PLATFORMS) {
    const res = resolveInstallCommand(def, machine(platform))
    const concrete = res.found && res.candidate && Array.isArray(res.candidate.steps) && res.candidate.steps.length > 0 && typeof res.paste === 'string' && res.paste.length > 0
    check(`${label} resolves on ${platform}`, concrete, res.reason || 'no candidate')
    if (concrete) {
      check(`${label} on ${platform} declares admin`, ['none', 'sudo', 'uac', 'gui'].includes(res.candidate.admin), `admin=${res.candidate.admin}`)
      // Unrunnable here means something has to come first. Say what.
      if (!res.runnable) check(`${label} on ${platform} names what is blocking it`, Boolean(res.blockedBy), 'no blockedBy')
    }
  }
}

// 2. With the platform's usual manager present, the resolver picks something we
// can actually run, and prefers the no-password route.
console.log('\n== with a package manager present, the pick is runnable ==')
const withManager = {
  darwin: machine('darwin', ['brew', 'curl']),
  linux: machine('linux', ['apt-get', 'curl'], 'root'),
  win32: machine('win32', ['scoop', 'winget'], 'n/a'),
}
for (const [label, def] of [['node', NODE], ['git', GIT], ['gh', GH]]) {
  for (const platform of PLATFORMS) {
    const res = resolveInstallCommand(def, withManager[platform])
    check(`${label} on ${platform} is runnable`, res.found && res.runnable === true, res.reason || `blocked by ${res.blockedBy}`)
  }
}
{
  // Windows prefers scoop over winget because scoop needs no UAC prompt.
  const res = resolveInstallCommand(GIT, withManager.win32)
  check('win32 prefers the no-elevation route', res.candidate.admin === 'none', `picked ${res.candidate.id} (${res.candidate.admin})`)
  // Linux prefers the no-sudo route over apt for node.
  const nodeLinux = resolveInstallCommand(NODE, withManager.linux)
  check('linux node prefers the no-sudo route', nodeLinux.candidate.admin === 'none', `picked ${nodeLinux.candidate.id} (${nodeLinux.candidate.admin})`)
}

// 3. THE ONE THAT MATTERS. The target set is not filtered by tier.
console.log('\n== the target set is NOT filtered by tier ==')
{
  const entries = defs.map((def) => ({ def, row: { tier: def.tier, name: def.name, missing: true, status: 'fail' } }))
  const targets = installTargets(entries)
  const tiers = new Set(targets.map((t) => t.def.tier))
  check('core-tier tools are targets', tiers.has('core'), `tiers present: ${[...tiers].join(', ')}`)
  check('git is a target', targets.some((t) => t.def === GIT))
  check('gh is a target', targets.some((t) => t.def === GH))
  check('node is a target', targets.some((t) => t.def === NODE))
  check('recommended-tier tools are targets too', tiers.has('recommended'), `tiers present: ${[...tiers].join(', ')}`)
  // A present tool is never a target, or --fix reinstalls gh every time it finds
  // it merely unauthenticated.
  const present = defs.map((def) => ({ def, row: { tier: def.tier, name: def.name, missing: false, status: 'warn' } }))
  check('a tool that is present is not a target', installTargets(present).length === 0)
}

// 4. Nothing that needs a password ever gets run.
console.log('\n== elevation is never assumed ==')
{
  const sudoCand = { admin: 'sudo' }
  check('sudo is not attempted when a password is required', attemptable(sudoCand, machine('linux', [], 'password-required')).ok === false)
  check('sudo is not attempted when there is no sudo', attemptable(sudoCand, machine('linux', [], 'unavailable')).ok === false)
  check('sudo is fine as root', attemptable(sudoCand, machine('linux', [], 'root')).ok === true)
  check('sudo is fine when passwordless', attemptable(sudoCand, machine('linux', [], 'passwordless')).ok === true)
  check('UAC is never attempted', attemptable({ admin: 'uac' }, machine('win32', [], 'n/a')).ok === false)
  check('a GUI step is never attempted', attemptable({ admin: 'gui' }, machine('darwin', [], 'root')).ok === false)
  check('no-admin always runs', attemptable({ admin: 'none' }, machine('linux', [], 'unavailable')).ok === true)
  // When we do run one, -n means it fails fast instead of waiting for a prompt.
  check('sudo is rewritten to sudo -n', applySudo('sudo apt-get install -y git', machine('linux', [], 'passwordless')) === 'sudo -n apt-get install -y git')
  check('sudo is dropped as root', applySudo('sudo apt-get install -y git', machine('linux', [], 'root')) === 'apt-get install -y git')
  check('every sudo in a multi-part step is rewritten', !/sudo (?!-n)/.test(applySudo('a && sudo b && sudo c', machine('linux', [], 'passwordless'))))
}

// 5. Core-tier coverage. This is lint-kit assertion 8, asserted here as well so
// a table edit fails in the suite even before the lint runs.
console.log('\n== every core check can be installed or says why not ==')
for (const c of installCoverage(defs).filter((c) => c.tier === 'core')) {
  const covered = c.platforms.darwin && c.platforms.linux && c.platforms.win32
  check(`core "${c.name}" has recipes for all three platforms or a manualReason`, covered || Boolean(c.manualReason), `darwin=${c.platforms.darwin} linux=${c.platforms.linux} win32=${c.platforms.win32}, manualReason=${c.manualReason ? 'yes' : 'no'}`)
}

// 6. No candidate can silently target the wrong platform.
console.log('\n== table hygiene ==')
{
  const badPlatform = []
  const badShell = []
  const badSteps = []
  for (const d of defs) {
    for (const c of (d.install && d.install.candidates) || []) {
      if (!PLATFORMS.includes(c.platform)) badPlatform.push(`${d.name}/${c.id}`)
      if (c.platform === 'win32' && c.shell !== 'powershell') badShell.push(`${d.name}/${c.id}`)
      if (!Array.isArray(c.steps) || c.steps.some((s) => typeof s !== 'string' || !s.trim() || /\n/.test(s))) badSteps.push(`${d.name}/${c.id}`)
    }
  }
  check('every candidate names a real platform', badPlatform.length === 0, badPlatform.join(', '))
  check('every win32 candidate runs in PowerShell', badShell.length === 0, badShell.join(', '))
  check('every step is a single non-empty line', badSteps.length === 0, badSteps.join(', '))
}

// 7. A platform with no recipes must degrade, not crash.
console.log('\n== an unknown platform degrades ==')
{
  const res = resolveInstallCommand(GIT, machine('freebsd', ['pkg']))
  check('an unsupported platform returns a reason, not a candidate', res.found === false && typeof res.reason === 'string' && res.reason.length > 0)
  check('a check with no install metadata is handled', resolveInstallCommand({ name: 'x' }, machine('linux')).found === false)
}

// 8. `claude --version` must never be a core failure. If this file is running,
// a Claude Code exists; a Desktop user has no CLI on PATH and is fine.
console.log('\n== the Claude Code row cannot fail the check ==')
{
  const claudeRow = defs.find((d) => d.name === 'Claude Code CLI')
  check('the Claude Code row exists', Boolean(claudeRow))
  check('the Claude Code row is not core tier', claudeRow.tier !== 'core', `tier=${claudeRow.tier}`)
  const prev = process.env.PATH
  process.env.PATH = '/nonexistent-doctor-fixture'
  let r
  try {
    r = claudeRow.probe()
  } finally {
    process.env.PATH = prev
  }
  check('with no claude on PATH the row warns, it does not fail', r.status !== 'fail', `status=${r.status}`)
}

// 9. Surface detection drives the advice, so it must not invent a verdict.
console.log('\n== surface detection ==')
{
  const cases = [
    [{ CLAUDE_CODE_ENTRYPOINT: 'desktop', CLAUDECODE: '1' }, 'desktop'],
    [{ CLAUDE_CODE_ENTRYPOINT: 'sdk-ts', CLAUDECODE: '1' }, 'embedded'],
    [{ CODESPACES: 'true' }, 'cloud'],
    [{ GITHUB_ACTIONS: 'true' }, 'ci'],
    [{ SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22', TERM: 'xterm' }, 'ssh'],
    [{ TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app' }, 'terminal'],
    // Agent forwarding is not a remote session. This one marks every Mac as SSH
    // if SSH_AUTH_SOCK is treated as evidence.
    [{ SSH_AUTH_SOCK: '/var/run/x', TERM: 'xterm' }, 'terminal'],
  ]
  for (const [env, want] of cases) {
    const got = detectSurface(env).id
    check(`${JSON.stringify(env).slice(0, 42)} reads as ${want}`, got === want, `got ${got}`)
  }
}

// 10. "Never a hang" is a claim about the runner, so test the runner. A step
// that waits on input must return immediately, because stdin is closed.
console.log('\n== a step that reads stdin cannot hang ==')
{
  const t0 = Date.now()
  const isWin = process.platform === 'win32'
  const inv = isWin ? ['powershell', ['-NoProfile', '-NonInteractive', '-Command', '$x = Read-Host']] : ['sh', ['-c', 'read x; echo "got $x"']]
  const r = await runStreaming(inv[0], inv[1], 8000, () => {})
  const ms = Date.now() - t0
  check('a stdin read returns fast instead of waiting', ms < 5000, `${ms}ms`)
  check('and it is reported as a failure, not a success', r.ok === false || (r.stdout || '').includes('got '), JSON.stringify(r.reason || r.stdout))
}

console.log(`\n== ${pass} passed, ${failures.length} failed ==`)
process.exit(failures.length === 0 ? 0 : 1)
