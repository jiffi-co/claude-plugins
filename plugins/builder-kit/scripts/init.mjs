#!/usr/bin/env node
// Scaffold a Jiffi-workflow project with "forge new" discipline:
//   - refuse to scaffold into a NON-EMPTY new directory (never clobber),
//   - never overwrite an existing file in place (skip + report),
//   - copy templates from the plugin (one source of truth — no inline drift),
//   - post-flight verify every expected file/dir exists,
//   - roll back everything THIS run created if any step fails.
//
// Usage:
//   node init.mjs [project-name]     -> scaffolds ./<project-name> (must be new/empty)
//   node init.mjs                    -> scaffolds the current directory (non-destructive)

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, '..', 'templates', 'project')

// Project type selects the domain overlay. web is the shared base; ios and agent
// add their specifics on top. The tail skills (ship, ui-review, ci-setup, the
// reviewers) read this back from .claude/builder-kit.json to branch per target,
// so one workflow spans web / iOS / OpenClaw and any future target.
const TYPES = ['web', 'ios', 'agent']
const argv = process.argv.slice(2)
let projectType = 'web'
const typeEq = argv.find((a) => a.startsWith('--type='))
if (typeEq) projectType = typeEq.split('=')[1]
else {
  const i = argv.indexOf('--type')
  if (i >= 0 && argv[i + 1]) projectType = argv[i + 1]
}
if (!TYPES.includes(projectType)) {
  console.error(`Unknown --type "${projectType}". Use one of: ${TYPES.join(', ')}.`)
  process.exit(1)
}
// The value after a spaced "--type" is not the project name.
const typeValueIdx = !typeEq && argv.indexOf('--type') >= 0 ? argv.indexOf('--type') + 1 : -1
const OVERLAY = join(HERE, '..', 'templates', 'overlays', projectType)

const name = argv.find((a, idx) => !a.startsWith('-') && idx !== typeValueIdx) || null
const targetDir = name ? resolve(process.cwd(), name) : process.cwd()
const projectName = name || basename(targetDir)
const newProject = Boolean(name)

if (!existsSync(TEMPLATES)) {
  console.error(`Templates not found at ${TEMPLATES}. The plugin install may be incomplete.`)
  process.exit(1)
}
if (newProject && existsSync(targetDir) && readdirSync(targetDir).length > 0) {
  console.error(`Refusing to scaffold: ${targetDir} already exists and is not empty.`)
  console.error('Pick a new name, or run without a name inside an existing project to scaffold in place (non-destructive).')
  process.exit(1)
}

const DIRS = [
  'docs/idea', 'docs/prd', 'docs/adr', 'docs/design-system', 'docs/agents', 'docs/checkpoints',
  '.claude/rules', '.claude/commands', '.claude/agents',
]
const EMPTY_DIRS = ['docs/idea', 'docs/prd', 'docs/adr', 'docs/design-system', 'docs/agents', '.claude/commands', '.claude/agents']

function templateFiles(dir, base = '') {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...templateFiles(join(dir, e.name), rel))
    else out.push(rel)
  }
  return out
}

const created = [] // paths this run created, for rollback (files first, dirs after)
function track(p) {
  created.push(p)
}
function ensureDir(abs) {
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true })
    track(abs)
  }
}

const report = { created: [], skipped: [] }

try {
  ensureDir(targetDir)
  for (const d of DIRS) ensureDir(join(targetDir, d))

  for (const rel of templateFiles(TEMPLATES)) {
    const dest = join(targetDir, rel)
    if (existsSync(dest)) {
      report.skipped.push(rel)
      continue
    }
    const content = readFileSync(join(TEMPLATES, rel), 'utf8').replaceAll('{{PROJECT_NAME}}', projectName)
    ensureDir(dirname(dest))
    writeFileSync(dest, content)
    track(dest)
    report.created.push(rel)
  }

  for (const d of EMPTY_DIRS) {
    const keep = join(targetDir, d, '.gitkeep')
    if (!existsSync(keep) && readdirSync(join(targetDir, d)).length === 0) {
      writeFileSync(keep, '')
      track(keep)
      report.created.push(`${d}/.gitkeep`)
    }
  }

  // Domain overlay: type-specific files copied ON TOP of the shared base, same
  // non-destructive discipline. web has no overlay (the base is the shared spine);
  // ios/agent add their scaffold here.
  if (existsSync(OVERLAY)) {
    for (const rel of templateFiles(OVERLAY)) {
      const dest = join(targetDir, rel)
      if (existsSync(dest)) {
        report.skipped.push(rel)
        continue
      }
      const content = readFileSync(join(OVERLAY, rel), 'utf8').replaceAll('{{PROJECT_NAME}}', projectName)
      ensureDir(dirname(dest))
      writeFileSync(dest, content)
      track(dest)
      report.created.push(rel)
    }
  }

  // Record the project type + resolved per-target test command so the tail skills
  // (and the Stop hook) branch deterministically. stopTestGate is opt-in (false by
  // default): the Stop hook runs THIS testCommand only when turned on, never a
  // hardcoded "npm test". The iOS command gets the real project name, same as the
  // template {{PROJECT_NAME}} substitution above.
  const cfgPath = join(targetDir, '.claude', 'builder-kit.json')
  if (!existsSync(cfgPath)) {
    ensureDir(dirname(cfgPath))
    const testCommand = {
      web: 'npm test',
      ios: `xcodebuild test -scheme ${projectName} -destination 'platform=iOS Simulator,name=iPhone 16'`,
      agent: 'npm run eval',
    }[projectType]
    // experienceLevel + assistanceMode drive the dual-track coaching model:
    // interactive skills read these back to adapt tone and confirmation frequency
    // WITHOUT forking content or skipping a human gate. Defaults are the gentlest
    // (beginner/coach); an advanced builder flips them in .claude/builder-kit.json.
    const cfg = {
      projectType,
      scaffoldedBy: 'jiffi-init',
      testCommand,
      stopTestGate: false,
      experienceLevel: 'beginner',
      assistanceMode: 'coach',
    }
    writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
    track(cfgPath)
    report.created.push('.claude/builder-kit.json')
  }

  // Post-flight: every template target and every dir must now exist.
  const missing = []
  for (const rel of templateFiles(TEMPLATES)) if (!existsSync(join(targetDir, rel))) missing.push(rel)
  for (const d of DIRS) if (!existsSync(join(targetDir, d))) missing.push(d + '/')
  if (missing.length) throw new Error(`post-flight verify failed, missing: ${missing.join(', ')}`)
} catch (err) {
  console.error(`\nScaffold failed: ${err.message}`)
  console.error('Rolling back everything this run created...')
  if (newProject) {
    // A named new project got its own directory (the refuse-non-empty check
    // guaranteed it was new/empty), so the only clean rollback is to remove the
    // whole thing — including the intermediate parents mkdirSync created.
    try {
      rmSync(targetDir, { recursive: true, force: true })
    } catch {}
  } else {
    for (const p of created.reverse()) {
      try {
        if (existsSync(p)) {
          const isDir = statSync(p).isDirectory()
          if (isDir && readdirSync(p).length > 0) continue // never remove a dir that holds pre-existing files
          rmSync(p, { recursive: true, force: true })
        }
      } catch {}
    }
  }
  console.error('Rolled back. No partial scaffold left behind.')
  process.exit(1)
}

// Initialise git so the build loop (feature branches, commit-after-green, PRs)
// works from the very first phase. Skip if the folder is already in a repo.
let gitNote = ''
try {
  const alreadyRepo = existsSync(join(targetDir, '.git')) || (() => {
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: targetDir, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  })()
  if (!alreadyRepo) {
    execSync('git init -q -b main', { cwd: targetDir })
    execSync('git add -A', { cwd: targetDir })
    // Author the scaffold commit with a per-commit fallback identity (via -c, so
    // it never touches the user's own git config — their real commits use their
    // own name). This guarantees a `main` ref exists so phase-start can branch.
    execSync(
      'git -c user.name="builder-kit" -c user.email="scaffold@builder-kit.local" commit -q -m "chore: scaffold via jiffi-init" --no-verify',
      { cwd: targetDir },
    )
    gitNote = 'git: initialised (branch main, one scaffold commit)'
  }
} catch {
  gitNote = 'git: not initialised (git not found — install it, then `git init`)'
}

console.log(`\n✅ Scaffolded "${projectName}" (${projectType}) at ${targetDir}`)
console.log(`   created: ${report.created.length} file(s)/dir(s)`)
if (gitNote) console.log(`   ${gitNote}`)
if (report.skipped.length) console.log(`   skipped (already existed): ${report.skipped.join(', ')}`)
console.log('\nWhat you got:')
console.log('  CLAUDE.md + AGENTS.md      the project context + coordination contract (@AGENTS.md wired)')
console.log('  .claude/settings.json      deny-.env rule + the builder-kit marketplace/plugin registered')
console.log('  .claude/rules/security.md  the secret-hygiene rule')
console.log('  docs/{idea,prd,adr,...}    the workflow lives on disk here')
console.log('  docs/checkpoints/checkpoint.json  the per-project gate /checkpoint reads')
console.log(`  .claude/builder-kit.json   project type = ${projectType} (the tail skills branch on this)`)
console.log('\nNext: run /validate-idea to pressure-test the idea, then /idea-pack')
console.log('      (or /jiffi-import-idea8 <export> if you planned it in idea8 first).')
process.exit(0)
