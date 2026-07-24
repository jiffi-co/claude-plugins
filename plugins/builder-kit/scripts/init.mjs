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

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, '..', 'templates', 'project')

const name = process.argv.slice(2).find((a) => !a.startsWith('-')) || null
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

  // Post-flight: every template target and every dir must now exist.
  const missing = []
  for (const rel of templateFiles(TEMPLATES)) if (!existsSync(join(targetDir, rel))) missing.push(rel)
  for (const d of DIRS) if (!existsSync(join(targetDir, d))) missing.push(d + '/')
  if (missing.length) throw new Error(`post-flight verify failed, missing: ${missing.join(', ')}`)
} catch (err) {
  console.error(`\nScaffold failed: ${err.message}`)
  console.error('Rolling back everything this run created...')
  for (const p of created.reverse()) {
    try {
      if (existsSync(p)) {
        const isDir = statSync(p).isDirectory()
        if (isDir && readdirSync(p).length > 0) continue // never remove a dir that now holds pre-existing files
        rmSync(p, { recursive: true, force: true })
      }
    } catch {}
  }
  console.error('Rolled back. No partial scaffold left behind.')
  process.exit(1)
}

console.log(`\n✅ Scaffolded "${projectName}" at ${targetDir}`)
console.log(`   created: ${report.created.length} file(s)/dir(s)`)
if (report.skipped.length) console.log(`   skipped (already existed): ${report.skipped.join(', ')}`)
console.log('\nWhat you got:')
console.log('  CLAUDE.md + AGENTS.md      the project context + coordination contract (@AGENTS.md wired)')
console.log('  .claude/settings.json      deny-.env rule + the builder-kit marketplace/plugin registered')
console.log('  .claude/rules/security.md  the secret-hygiene rule')
console.log('  docs/{idea,prd,adr,...}    the workflow lives on disk here')
console.log('  docs/checkpoints/checkpoint.json  the per-project gate /checkpoint reads')
console.log('\nNext: run /validate-idea to pressure-test the idea, then /idea-pack.')
process.exit(0)
