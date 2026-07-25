#!/usr/bin/env node
// Setup health check. READ-ONLY — it changes nothing (no --fix, deliberately, for
// a beginner audience). Tiered: CORE failures set a non-zero exit; recommended and
// optional are reported but never fail the check. `--json` gives support a paste-able
// artifact ("paste your doctor output"). Node-only, no external dependency.
//
// Usage: node doctor.mjs [--json] [--platform]

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { platform } from 'node:os'

const args = process.argv.slice(2)
const json = args.includes('--json')

function run(cmd, cmdArgs = []) {
  try {
    const r = spawnSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 20000 })
    if (r.error || r.status == null) return { ok: false, out: '' }
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() }
  } catch {
    return { ok: false, out: '' }
  }
}

function firstVersion(s) {
  const m = String(s).match(/v?(\d+\.\d+(\.\d+)?)/)
  return m ? m[1] : ''
}

// --- Project-type model -----------------------------------------------------
// A scaffolded project records its target in .claude/builder-kit.json, e.g.
//   { "projectType": "web" | "ios" | "agent", ... }
// The doctor runs the SHARED checks for every type, then appends the checks for
// that type's toolchain. A missing, unreadable, or unknown config falls back to
// "web" so existing (pre-type) projects behave exactly as before. The agent
// branch also reads two optional flat keys when present: "runtime" ("node" |
// "python") and "host" (the deploy-target CLI command, e.g. the agent host).
const KNOWN_TYPES = ['web', 'ios', 'agent']

function loadConfig() {
  const path = '.claude/builder-kit.json'
  if (!existsSync(path)) return { projectType: 'web', source: 'default (no .claude/builder-kit.json)', raw: {} }
  // The try wraps ONLY the read + parse, so a real bug elsewhere can never be
  // silently swallowed and disguised as an "invalid JSON" web fallback.
  let raw
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { projectType: 'web', source: '.claude/builder-kit.json (invalid JSON, treating as web)', raw: {} }
  }
  const declared = raw && raw.projectType
  const pt = String(declared || 'web').toLowerCase()
  if (!KNOWN_TYPES.includes(pt)) {
    return { projectType: 'web', source: `.claude/builder-kit.json (unknown projectType "${declared}", treating as web)`, raw: raw && typeof raw === 'object' ? raw : {} }
  }
  return { projectType: pt, source: '.claude/builder-kit.json', raw: raw && typeof raw === 'object' ? raw : {} }
}

function agentRuntime(raw) {
  const r = String((raw && raw.runtime) || 'node').toLowerCase()
  return /^(py|python|uv)/.test(r) ? 'python' : 'node'
}

function agentHost(raw) {
  const h = raw && raw.host
  return h ? String(h) : ''
}

function describeType(cfg) {
  if (cfg.projectType !== 'agent') return cfg.projectType
  const host = agentHost(cfg.raw)
  return `agent (runtime: ${agentRuntime(cfg.raw)}, host: ${host || 'not declared'})`
}

// Is a command on PATH? ENOENT means "not installed"; any other outcome (even a
// non-zero exit from an unsupported --version flag) means the binary is present.
function probeCmd(cmd) {
  try {
    const r = spawnSync(cmd, ['--version'], { encoding: 'utf8', timeout: 20000 })
    if (r.error) return { present: r.error.code !== 'ENOENT', version: '' }
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim()
    const v = firstVersion(out)
    return { present: true, version: r.status === 0 && v ? `v${v}` : 'present on PATH' }
  } catch {
    return { present: false, version: '' }
  }
}

// Per-type toolchain checks, appended to the shared CHECKS. Each has the same
// shape as a CHECKS entry, so the existing probe loop, tiering, and output
// handle them unchanged. Only core failures affect the ready verdict, so the web
// branch stays non-core (preserving the exact pre-type behaviour).
function typeChecks(cfg) {
  if (cfg.projectType === 'ios') return iosChecks()
  if (cfg.projectType === 'agent') return agentChecks(cfg.raw)
  return webChecks()
}

function webChecks() {
  return [
    {
      tier: 'recommended', name: 'Vercel CLI', fix: 'Install with `npm i -g vercel` (only needed to deploy via the ship skill).',
      probe() {
        const r = run('vercel', ['--version'])
        if (!r.ok) return { status: 'warn', found: 'not found', note: 'needed only to deploy (ship); local build and dev do not require it' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' }
      },
    },
  ]
}

function iosChecks() {
  const isMac = platform() === 'darwin'
  return [
    {
      tier: 'core', name: 'Xcode (xcodebuild)',
      fix: isMac ? 'Install Xcode from the App Store, run `xcode-select --install`, then open Xcode once to accept the licence.' : 'iOS builds require macOS with Xcode; this machine is not macOS.',
      probe() {
        if (!isMac) return { status: 'fail', found: 'not macOS', note: 'iOS builds require macOS + Xcode' }
        const r = run('xcodebuild', ['-version'])
        if (!r.ok) return { status: 'fail', found: 'not found', note: 'install Xcode and its Command Line Tools' }
        return { status: 'ok', found: (r.out.split('\n')[0] || 'present').trim() }
      },
    },
    {
      tier: 'core', name: 'Swift', fix: 'Ships with Xcode / Command Line Tools; install Xcode.',
      probe() {
        if (!isMac) return { status: 'fail', found: 'not macOS' }
        const r = run('swift', ['--version'])
        if (!r.ok) return { status: 'fail', found: 'not found' }
        const m = r.out.match(/Swift version (\d+\.\d+(\.\d+)?)/i)
        return { status: 'ok', found: m ? `v${m[1]}` : (r.out.split('\n')[0] || 'present').trim() }
      },
    },
    {
      tier: 'recommended', name: 'iOS Simulator', fix: 'Open Xcode, then Settings, then Components, and download a simulator runtime.',
      probe() {
        if (!isMac) return { status: 'warn', found: 'not macOS' }
        const r = run('xcrun', ['simctl', 'list', 'devices', 'available'])
        if (!r.ok) return { status: 'warn', found: 'simctl unavailable', note: 'run `xcrun simctl list devices` to check' }
        // Available device lines carry a UUID in parens; `available` already
        // filters out devices whose runtime is missing, so these are bootable.
        const devices = r.out.split('\n').filter((l) => /\([0-9A-Fa-f-]{36}\)/.test(l))
        if (devices.length === 0) return { status: 'warn', found: 'none installed', note: 'no bootable simulator; add one in Xcode' }
        const booted = devices.filter((l) => /\(Booted\)/.test(l)).length
        return { status: 'ok', found: `${devices.length} bootable${booted ? `, ${booted} booted` : ''}` }
      },
    },
    {
      tier: 'optional', name: 'fastlane', fix: 'Optional: `brew install fastlane` (used by ship for TestFlight / App Store upload).',
      probe() {
        const r = run('fastlane', ['--version'])
        if (!r.ok) return { status: 'warn', found: 'not found', note: 'optional; needed only for automated TestFlight / App Store upload' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' }
      },
    },
  ]
}

function agentChecks(raw) {
  const checks = []
  // Runtime. Node is already a shared CORE check (Claude Code and the plugin's
  // own scripts need it), so a Node agent adds no duplicate row. A Python agent
  // adds Python 3 as core and uv as recommended.
  if (agentRuntime(raw) === 'python') {
    checks.push({
      tier: 'core', name: 'Python 3 (agent runtime)', fix: 'Install Python 3.11+ (python.org, pyenv, or your package manager).',
      probe() {
        let r = run('python3', ['--version'])
        if (!r.ok) r = run('python', ['--version'])
        if (!r.ok) return { status: 'fail', found: 'not found' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : r.out.trim() }
      },
    })
    checks.push({
      tier: 'recommended', name: 'uv (Python runner)', fix: 'Install uv (astral.sh/uv), the runner the agent template uses; pip/venv also works.',
      probe() {
        const r = run('uv', ['--version'])
        if (!r.ok) return { status: 'warn', found: 'not found', note: 'recommended; pip/venv also works' }
        return { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' }
      },
    })
  }
  // Declared host CLI (the deploy target). Read from the optional "host" key.
  const host = agentHost(raw)
  if (host) {
    checks.push({
      tier: 'recommended', name: `Agent host CLI (${host})`, fix: `Install the '${host}' CLI (the deploy target); needed for the ship skill.`,
      probe() {
        const p = probeCmd(host)
        if (!p.present) return { status: 'warn', found: 'not found', note: `declared host "${host}" is not on PATH; needed to deploy` }
        return { status: 'ok', found: p.version }
      },
    })
  } else {
    checks.push({
      tier: 'recommended', name: 'Agent host CLI', fix: 'Add a "host" key to .claude/builder-kit.json (the deploy-target CLI command) so ship/deploy checks can run.',
      probe() {
        return { status: 'warn', found: 'not declared', note: 'set "host" in .claude/builder-kit.json to check the deploy target' }
      },
    })
  }
  return checks
}

// A check: { tier, name, probe(): {status:'ok'|'warn'|'fail', found, note}, fix }
const CHECKS = [
  {
    tier: 'core', name: 'Node.js (>= 22)', fix: 'Install Node 22 LTS+ from nodejs.org (or nvm/fnm/volta).',
    probe() {
      const r = run('node', ['--version'])
      const v = firstVersion(r.out)
      const major = Number(v.split('.')[0] || 0)
      if (!r.ok || !v) return { status: 'fail', found: 'not found' }
      // Below the floor is a CORE fail, not a warning — current stacks (Next.js 16,
      // Vite, etc.) need Node 22+, so "ready" would be a lie on Node 18/20.
      return { status: major >= 22 ? 'ok' : 'fail', found: `v${v}`, note: major >= 22 ? '' : 'below the Node 22 floor — upgrade before building' }
    },
  },
  {
    tier: 'core', name: 'Claude Code', fix: 'Install via the native installer (see code.claude.com); npm is the advanced fallback.',
    probe() {
      const r = run('claude', ['--version'])
      return r.ok ? { status: 'ok', found: r.out.split('\n')[0] } : { status: 'fail', found: 'not found' }
    },
  },
  {
    tier: 'core', name: 'git', fix: 'Install git (git-scm.com, Homebrew, WinGet, or your package manager).',
    probe() {
      const r = run('git', ['--version'])
      if (!r.ok) return { status: 'fail', found: 'not found' }
      const repo = run('git', ['rev-parse', '--is-inside-work-tree']).ok
      return { status: 'ok', found: r.out.replace('git version ', 'v'), note: repo ? 'inside a git repo' : 'not a git repo yet' }
    },
  },
  {
    tier: 'core', name: 'GitHub CLI (gh) + auth', fix: 'Install gh (cli.github.com) then `gh auth login`.',
    probe() {
      const r = run('gh', ['--version'])
      if (!r.ok) return { status: 'fail', found: 'not found' }
      const authed = run('gh', ['auth', 'status']).ok
      return { status: authed ? 'ok' : 'warn', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present', note: authed ? 'authenticated' : 'installed but NOT authenticated — run `gh auth login`' }
    },
  },
  {
    tier: 'recommended', name: 'Beads (bd)', fix: 'Install from gastownhall/beads, then `bd setup claude`. Complements native Tasks (Tasks in-session, Beads cross-session).',
    probe() {
      const r = run('bd', ['--version'])
      return r.ok ? { status: 'ok', found: firstVersion(r.out) ? `v${firstVersion(r.out)}` : 'present' } : { status: 'warn', found: 'not found', note: 'optional but recommended for cross-session tracking' }
    },
  },
  {
    tier: 'recommended', name: 'Docs MCP (Context7)', fix: 'builder-kit bundles Context7 in .mcp.json (auto-starts when the plugin is enabled). Enable the plugin and reload.',
    probe() {
      // Best-effort: look for a context7 reference in a project or user config.
      // HOME on unix, USERPROFILE on Windows.
      const home = process.env.HOME || process.env.USERPROFILE || ''
      const candidates = ['.mcp.json', home && `${home}/.claude.json`, home && `${home}/.claude/.mcp.json`].filter(Boolean)
      for (const p of candidates) {
        try {
          if (existsSync(p) && /context7/i.test(readFileSync(p, 'utf8'))) return { status: 'ok', found: `configured in ${p}` }
        } catch {}
      }
      return { status: 'warn', found: 'not detected', note: 'the plugin ships it; enable builder-kit + reload, or run /mcp to check' }
    },
  },
  {
    tier: 'optional', name: 'Node package runner (npx)', fix: 'Ships with Node; if missing, reinstall Node.',
    probe() {
      const r = run('npx', ['--version'])
      return r.ok ? { status: 'ok', found: `v${firstVersion(r.out)}` } : { status: 'warn', found: 'not found' }
    },
  },
]

// Project config checks — only meaningful inside a project.
const PROJECT = [
  { name: 'CLAUDE.md', path: 'CLAUDE.md', fix: 'Run /jiffi-init to scaffold it.' },
  { name: 'AGENTS.md', path: 'AGENTS.md', fix: 'Run /jiffi-init.' },
  { name: '.claude/settings.json (deny .env)', path: '.claude/settings.json', fix: 'Run /jiffi-init — it writes the deny-.env rule.', check: (b) => /"deny"\s*:\s*\[[^\]]*\.env/.test(b) || /(Read|Bash)\([^)]*\.env/.test(b) },
  { name: 'docs/prd/', path: 'docs/prd', fix: 'Run the prd skill.' },
  { name: 'docs/adr/', path: 'docs/adr', fix: 'Run the create-adr skill.' },
  { name: 'docs/implementation-plan.md', path: 'docs/implementation-plan.md', fix: 'Run the implementation-plan skill.' },
]

// Read the scaffolded project type now that all definitions are initialised,
// then run the shared checks plus the per-type toolchain checks for that type.
const config = loadConfig()

const rows = []
for (const c of CHECKS.concat(typeChecks(config))) {
  const r = c.probe()
  rows.push({ tier: c.tier, name: c.name, status: r.status, found: r.found || '', note: r.note || '', fix: r.status === 'ok' ? '' : c.fix })
}
const inProject = existsSync('docs') || existsSync('CLAUDE.md') || existsSync('.git')
if (inProject) {
  for (const p of PROJECT) {
    let status = 'warn'
    let found = 'missing'
    if (existsSync(p.path)) {
      if (p.check) {
        try {
          status = p.check(readFileSync(p.path, 'utf8')) ? 'ok' : 'warn'
          found = status === 'ok' ? 'present + rule set' : 'present but no .env deny rule'
        } catch {
          status = 'warn'
          found = 'present (unreadable)'
        }
      } else {
        status = 'ok'
        found = 'present'
      }
    }
    rows.push({ tier: 'project', name: p.name, status, found, note: '', fix: status === 'ok' ? '' : p.fix })
  }
}

const coreFail = rows.filter((r) => r.tier === 'core' && r.status === 'fail').length

if (json) {
  console.log(JSON.stringify({ ready: coreFail === 0, projectType: config.projectType, platform: platform(), coreFail, checks: rows }, null, 2))
  process.exit(coreFail === 0 ? 0 : 1)
}

const icon = { ok: '✅', warn: '⚠️ ', fail: '❌' }
const order = { core: 0, recommended: 1, optional: 2, project: 3 }
rows.sort((a, b) => order[a.tier] - order[b.tier])
console.log('\nbuilder-kit doctor — setup health (read-only)')
console.log(`  project type: ${describeType(config)}  (source: ${config.source})\n`)
let lastTier = ''
for (const r of rows) {
  if (r.tier !== lastTier) {
    console.log(`  ${r.tier.toUpperCase()}`)
    lastTier = r.tier
  }
  const detail = [r.found, r.note].filter(Boolean).join(' — ')
  console.log(`    ${icon[r.status] || ''} ${r.name.padEnd(30)} ${detail}${r.fix ? `\n         fix: ${r.fix}` : ''}`)
}
console.log('')
if (coreFail === 0) {
  const warns = rows.filter((r) => r.status === 'warn').length
  console.log(`✅ Core tooling ready to build.${warns ? ` ${warns} recommended/optional item(s) to look at above.` : ''}`)
  process.exit(0)
} else {
  const first = rows.find((r) => r.tier === 'core' && r.status === 'fail')
  console.log(`❌ Not ready: fix "${first.name}" first — ${first.fix}`)
  process.exit(1)
}
