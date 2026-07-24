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

const rows = []
for (const c of CHECKS) {
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
  console.log(JSON.stringify({ ready: coreFail === 0, platform: platform(), coreFail, checks: rows }, null, 2))
  process.exit(coreFail === 0 ? 0 : 1)
}

const icon = { ok: '✅', warn: '⚠️ ', fail: '❌' }
const order = { core: 0, recommended: 1, optional: 2, project: 3 }
rows.sort((a, b) => order[a.tier] - order[b.tier])
console.log('\nbuilder-kit doctor — setup health (read-only)\n')
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
