#!/usr/bin/env node
/**
 * /jiffi-adopt, the offline code-scan fast path onto the workflow.
 *
 * Point it at an existing repo. It scans OFFLINE with zero model and zero network
 * calls: it reads manifests, walks the file tree, and asks git for a commit
 * heatmap. From what it can SEE it writes a real tech-stack ADR (every line traced
 * to a file), then leaves STUB idea-pack, PRD and design files, because a scanner
 * reads code, not intent. You then run the `ingest` skill to confirm the derived
 * [D] facts and fill the [G] gaps, and hand off to `architect`.
 *
 * Design rules (Forge's scanner discipline, ported):
 *   - graceful degradation: every scan phase try/catches and returns empty rather
 *     than throwing, so a weird repo still produces a partial, useful result;
 *   - SKIP_DIRS + a 256KB per-file cap keep the walk bounded and offline-fast;
 *   - dedupe by a canonical key (a stack item is recorded once);
 *   - NEVER overwrite: if a target already exists (a re-run), the fresh version is
 *     written into a dated snapshot dir under docs/ingest/snapshots/ for diffing.
 *
 * Usage:
 *   node adopt.mjs [dir]      -> scan [dir] (default: the current directory)
 *   node adopt.mjs [dir] --json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, resolve, relative, extname, basename, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { getState } from './state.mjs'

const MAX_FILE_BYTES = 256 * 1024
const MAX_FILES = 25000 // hard ceiling so a pathological tree can never hang the walk
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage',
  '.turbo', '.cache', 'vendor', 'target', '.venv', 'venv', '__pycache__',
  '.svelte-kit', 'Pods', '.gradle', 'DerivedData', '.expo', '.idea', '.vscode',
  'tmp', '.output', 'bin', 'obj',
])

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const dirArg = argv.find((a) => !a.startsWith('-')) || '.'
const scanRoot = resolve(process.cwd(), dirArg)
const OUT = process.cwd() // artifacts land in the project you run the command from
const TODAY = new Date().toISOString().slice(0, 10)
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

const fail = (m) => { console.error(m); process.exit(1) }
if (!existsSync(scanRoot)) fail(`Not found: ${scanRoot}. Point /jiffi-adopt at a directory to scan.`)
if (!statSync(scanRoot).isDirectory()) fail(`Not a directory: ${scanRoot}.`)

// A scan phase that throws must not sink the whole run. It logs, returns a safe
// empty shape, and the rest carries on. This is the graceful-degradation spine.
const safe = (label, fn, fallback) => {
  try {
    return fn()
  } catch (e) {
    warnings.push(`${label}: ${e.message}`)
    return fallback
  }
}
const warnings = []

function readCapped(abs) {
  try {
    if (statSync(abs).size > MAX_FILE_BYTES) return null
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// one bounded, SKIP_DIRS-aware walk collects every path signal in a single pass
// ---------------------------------------------------------------------------
const ROUTE_SEGMENTS = ['/app/', '/pages/', '/routes/', '/api/']
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.svelte'])
const MANIFEST_NAMES = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'Pipfile', 'go.mod',
  'Cargo.toml', 'Gemfile', 'composer.json', 'pom.xml', 'build.gradle',
  'build.gradle.kts', 'Package.swift', 'pubspec.yaml',
])
const LOCK_TO_PM = {
  'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'package-lock.json': 'npm',
  'bun.lockb': 'bun', 'Cargo.lock': 'cargo', 'poetry.lock': 'poetry',
  'Gemfile.lock': 'bundler', 'go.sum': 'go modules',
}

function isRouteFile(rel) {
  if (!CODE_EXTS.has(extname(rel))) return false
  const b = basename(rel)
  if (/^\+(page|server|layout|error)\b/.test(b)) return true // SvelteKit
  if (/^(page|route|layout)\.(t|j)sx?$/.test(b)) return true // Next app router
  return ROUTE_SEGMENTS.some((s) => rel.includes(s))
}
function isComponentFile(rel) {
  const ext = extname(rel)
  if (ext === '.vue' || ext === '.svelte') return true
  if ((ext === '.tsx' || ext === '.jsx') && rel.includes('/components/')) return true
  if ((ext === '.tsx' || ext === '.jsx') && /^[A-Z]/.test(basename(rel))) return true
  return false
}
function isSchemaFile(rel) {
  const b = basename(rel)
  const ext = extname(rel)
  if (ext === '.prisma' || ext === '.sql') return true
  if (b === 'schema.rb' || b === 'models.py') return true
  if (rel.includes('/migrations/') || rel.includes('/collections/')) return true
  return false
}

// Paths the builder-kit scaffold wrote into this very project moments ago. Counting
// them describes the KIT, not the code the builder brought: a seven-file prototype
// reported back as "32 files, 11 .md, 1 .ts", every one of the extras written by
// `/builder-kit:start` on its way in. init.mjs records exactly what it created, so
// this reads that rather than guessing at a name list that would drift.
// Only applies when adopting the directory the manifest describes; pointed at some
// other tree, there is nothing to exclude and nothing is excluded.
const scaffoldPaths = (() => {
  if (resolve(scanRoot) !== resolve(OUT)) return new Set()
  const p = join(OUT, '.claude', 'builder-kit', 'scaffold-manifest.json')
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'))
    const files = Array.isArray(m && m.files) ? m.files.filter((f) => typeof f === 'string') : []
    // The manifest and the config are the kit's too, and neither is in the file list.
    return new Set([...files, '.claude/builder-kit.json', '.claude/builder-kit/scaffold-manifest.json'])
  } catch {
    return new Set()
  }
})()

const tree = safe('tree scan', () => {
  const extCounts = {}
  const topLevel = []
  const manifests = {} // basename -> shallowest rel path
  const packageManagers = new Set()
  const routeFiles = []
  const componentFiles = []
  const schemaFiles = []
  const large = [] // [A] anti-pattern candidates (big single files)
  const dirRels = [] // every directory seen, kept or not; filtered after the walk
  const keptDirs = new Set() // directories that hold at least one file the builder wrote
  const topLevelDirs = new Set()
  let files = 0
  let dirs = 0
  let excluded = 0
  let truncated = false

  const keep = (rel) => {
    let i = rel.lastIndexOf('/')
    while (i > 0) {
      keptDirs.add(rel.slice(0, i))
      i = rel.lastIndexOf('/', i - 1)
    }
  }

  const manifestDepth = {} // basename -> the depth it was found at (shallowest wins)
  const walk = (abs, rel, depth) => {
    if (files >= MAX_FILES) { truncated = true; return }
    let entries
    try {
      entries = readdirSync(abs, { withFileTypes: true })
    } catch {
      return
    }
    // Process files BEFORE recursing into subdirs. A depth-first descent would
    // otherwise record a nested manifest (e.g. a package.json inside an early
    // subfolder) before the ROOT manifest, and the root is the one that defines
    // the project's stack. Files-first guarantees the shallowest manifest wins.
    const subdirs = []
    for (const e of entries) {
      if (files >= MAX_FILES) { truncated = true; return }
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        dirRels.push(childRel)
        if (depth === 0) topLevelDirs.add(childRel)
        subdirs.push([join(abs, e.name), childRel])
        continue
      }
      if (scaffoldPaths.has(childRel)) {
        excluded++
        continue
      }
      files++
      keep(childRel)
      if (depth === 0) topLevel.push(e.name)
      const ext = extname(e.name) || '(none)'
      extCounts[ext] = (extCounts[ext] || 0) + 1
      if (LOCK_TO_PM[e.name]) packageManagers.add(LOCK_TO_PM[e.name])
      if (MANIFEST_NAMES.has(e.name) && (manifestDepth[e.name] === undefined || depth < manifestDepth[e.name])) {
        manifests[e.name] = childRel
        manifestDepth[e.name] = depth
      }
      const slashed = `/${childRel}`
      if (isRouteFile(slashed)) routeFiles.push(childRel)
      if (isComponentFile(slashed)) componentFiles.push(childRel)
      if (isSchemaFile(slashed)) schemaFiles.push(childRel)
      // Cheap anti-pattern probe: an oversized single file, a candidate to split.
      if (CODE_EXTS.has(ext)) {
        try {
          const sz = statSync(join(abs, e.name)).size
          if (sz > 120 * 1024) large.push({ path: childRel, kb: Math.round(sz / 1024) })
        } catch {}
      }
    }
    for (const [childAbs, childRel] of subdirs) walk(childAbs, childRel, depth + 1)
  }
  walk(scanRoot, '', 0)

  // A directory counts when something the builder wrote lives under it. A `docs/adr/`
  // holding nothing but the scaffold's .gitkeep is the kit's, not theirs.
  dirs = dirRels.filter((d) => keptDirs.has(d)).length
  for (const d of topLevelDirs) if (keptDirs.has(d)) topLevel.push(`${d}/`)

  const topExts = Object.entries(extCounts).sort((a, b) => b[1] - a[1]).slice(0, 12)
  return {
    files, dirs, truncated, excluded,
    topLevel: topLevel.sort().slice(0, 40),
    topExts,
    manifests,
    packageManagers: [...packageManagers],
    routeFiles, componentFiles, schemaFiles,
    large: large.sort((a, b) => b.kb - a.kb).slice(0, 10),
  }
}, {
  files: 0, dirs: 0, truncated: false, excluded: 0, topLevel: [], topExts: [], manifests: {},
  packageManagers: [], routeFiles: [], componentFiles: [], schemaFiles: [], large: [],
})

// ---------------------------------------------------------------------------
// classify dependencies into a deduped tech stack. Canonical key = label
// lower-cased, so a package seen in deps and devDeps is recorded once.
// ---------------------------------------------------------------------------
const CLASSIFY = [
  [/^typescript$/, 'Language', 'TypeScript'],
  [/^next$/, 'Framework', 'Next.js'],
  [/^nuxt$/, 'Framework', 'Nuxt'],
  [/^@remix-run\//, 'Framework', 'Remix'],
  [/^@angular\/core$/, 'Framework', 'Angular'],
  [/^@sveltejs\/kit$/, 'Framework', 'SvelteKit'],
  [/^svelte$/, 'Framework', 'Svelte'],
  [/^vue$/, 'Framework', 'Vue'],
  [/^react$/, 'Framework', 'React'],
  [/^astro$/, 'Framework', 'Astro'],
  [/^express$/, 'Backend', 'Express'],
  [/^fastify$/, 'Backend', 'Fastify'],
  [/^koa$/, 'Backend', 'Koa'],
  [/^@nestjs\/core$/, 'Backend', 'NestJS'],
  [/^hono$/, 'Backend', 'Hono'],
  [/^payload$/, 'Backend', 'Payload CMS'],
  [/^prisma$|^@prisma\/client$/, 'Data access', 'Prisma'],
  [/^drizzle-orm$/, 'Data access', 'Drizzle ORM'],
  [/^typeorm$/, 'Data access', 'TypeORM'],
  [/^sequelize$/, 'Data access', 'Sequelize'],
  [/^mongoose$/, 'Data access', 'Mongoose'],
  [/^kysely$/, 'Data access', 'Kysely'],
  [/^pg$|^postgres$|^@neondatabase\/serverless$/, 'Database', 'PostgreSQL'],
  [/^mysql2?$|^@planetscale\/database$/, 'Database', 'MySQL'],
  [/^better-sqlite3$|^sqlite3$/, 'Database', 'SQLite'],
  [/^mongodb$/, 'Database', 'MongoDB'],
  [/^redis$|^ioredis$/, 'Database', 'Redis'],
  [/^tailwindcss$/, 'Styling', 'Tailwind CSS'],
  [/^styled-components$/, 'Styling', 'styled-components'],
  [/^@emotion\//, 'Styling', 'Emotion'],
  [/^sass$/, 'Styling', 'Sass'],
  [/^zustand$/, 'State', 'Zustand'],
  [/^redux$|^@reduxjs\/toolkit$/, 'State', 'Redux'],
  [/^jotai$/, 'State', 'Jotai'],
  [/^@tanstack\/react-query$/, 'State', 'TanStack Query'],
  [/^vitest$/, 'Testing', 'Vitest'],
  [/^jest$/, 'Testing', 'Jest'],
  [/^mocha$/, 'Testing', 'Mocha'],
  [/^@playwright\/test$|^playwright$/, 'Testing', 'Playwright'],
  [/^cypress$/, 'Testing', 'Cypress'],
  [/^vite$/, 'Build', 'Vite'],
  [/^webpack$/, 'Build', 'Webpack'],
  [/^esbuild$/, 'Build', 'esbuild'],
]

const stack = new Map() // key -> { category, label, source }
const recordTech = (category, label, source) => {
  const key = label.toLowerCase()
  if (!stack.has(key)) stack.set(key, { category, label, source })
}
const classifyDep = (name, source) => {
  for (const [re, category, label] of CLASSIFY) {
    if (re.test(name)) { recordTech(category, label, source); return }
  }
}

// ---------------------------------------------------------------------------
// manifest readers. Each is independently safe(); a broken manifest is skipped.
// ---------------------------------------------------------------------------
const M = tree.manifests
const readManifest = (name) => (M[name] ? readCapped(join(scanRoot, M[name])) : null)

safe('package.json', () => {
  const body = readManifest('package.json')
  if (!body) return
  const pkg = JSON.parse(body)
  const src = M['package.json']
  for (const d of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) classifyDep(d, src)
  if (pkg.packageManager && typeof pkg.packageManager === 'string') {
    const pm = pkg.packageManager.split('@')[0]
    if (pm && !tree.packageManagers.includes(pm)) tree.packageManagers.push(pm)
  }
}, undefined)

safe('requirements.txt', () => {
  const body = readManifest('requirements.txt')
  if (!body) return
  recordTech('Language', 'Python', M['requirements.txt'])
  for (const line of body.split('\n')) {
    const n = line.split(/[=<>!~\[ #]/)[0].trim().toLowerCase()
    if (n === 'django') recordTech('Framework', 'Django', M['requirements.txt'])
    if (n === 'flask') recordTech('Framework', 'Flask', M['requirements.txt'])
    if (n === 'fastapi') recordTech('Framework', 'FastAPI', M['requirements.txt'])
    if (n === 'sqlalchemy') recordTech('Data access', 'SQLAlchemy', M['requirements.txt'])
    if (n === 'psycopg2' || n === 'psycopg2-binary' || n === 'psycopg') recordTech('Database', 'PostgreSQL', M['requirements.txt'])
    if (n === 'pytest') recordTech('Testing', 'pytest', M['requirements.txt'])
  }
}, undefined)

safe('pyproject.toml', () => {
  const body = readManifest('pyproject.toml') || readManifest('Pipfile')
  if (!body) return
  const src = M['pyproject.toml'] || M['Pipfile']
  recordTech('Language', 'Python', src)
  if (/\bfastapi\b/i.test(body)) recordTech('Framework', 'FastAPI', src)
  if (/\bdjango\b/i.test(body)) recordTech('Framework', 'Django', src)
  if (/\bflask\b/i.test(body)) recordTech('Framework', 'Flask', src)
  if (/\bpytest\b/i.test(body)) recordTech('Testing', 'pytest', src)
}, undefined)

safe('go.mod', () => {
  const body = readManifest('go.mod')
  if (!body) return
  recordTech('Language', 'Go', M['go.mod'])
  if (/gin-gonic\/gin/.test(body)) recordTech('Framework', 'Gin', M['go.mod'])
  if (/labstack\/echo/.test(body)) recordTech('Framework', 'Echo', M['go.mod'])
  if (/lib\/pq|jackc\/pgx/.test(body)) recordTech('Database', 'PostgreSQL', M['go.mod'])
}, undefined)

safe('Cargo.toml', () => {
  const body = readManifest('Cargo.toml')
  if (!body) return
  recordTech('Language', 'Rust', M['Cargo.toml'])
  if (/\baxum\b/.test(body)) recordTech('Framework', 'Axum', M['Cargo.toml'])
  if (/\bactix-web\b/.test(body)) recordTech('Framework', 'Actix Web', M['Cargo.toml'])
  if (/\bsqlx\b/.test(body)) recordTech('Data access', 'SQLx', M['Cargo.toml'])
}, undefined)

safe('Gemfile', () => {
  const body = readManifest('Gemfile')
  if (!body) return
  recordTech('Language', 'Ruby', M['Gemfile'])
  if (/gem ['"]rails['"]/.test(body)) recordTech('Framework', 'Ruby on Rails', M['Gemfile'])
  if (/gem ['"]sinatra['"]/.test(body)) recordTech('Framework', 'Sinatra', M['Gemfile'])
}, undefined)

safe('composer.json', () => {
  const body = readManifest('composer.json')
  if (!body) return
  recordTech('Language', 'PHP', M['composer.json'])
  const dep = JSON.parse(body).require || {}
  if (Object.keys(dep).some((k) => k.startsWith('laravel/'))) recordTech('Framework', 'Laravel', M['composer.json'])
  if (Object.keys(dep).some((k) => k.startsWith('symfony/'))) recordTech('Framework', 'Symfony', M['composer.json'])
}, undefined)

safe('jvm/other manifests', () => {
  if (M['pom.xml']) recordTech('Build', 'Maven', M['pom.xml'])
  if (M['build.gradle'] || M['build.gradle.kts']) recordTech('Build', 'Gradle', M['build.gradle'] || M['build.gradle.kts'])
  if (M['Package.swift']) recordTech('Language', 'Swift', M['Package.swift'])
  if (M['pubspec.yaml']) recordTech('Framework', 'Flutter/Dart', M['pubspec.yaml'])
}, undefined)

// ---------------------------------------------------------------------------
// git 200-commit file heatmap (offline, local only; git may be absent)
// ---------------------------------------------------------------------------
const heatmap = safe('git heatmap', () => {
  const r = spawnSync('git', ['-C', scanRoot, 'log', '--name-only', '--pretty=format:', '-n', '200'], {
    encoding: 'utf8', timeout: 20000,
  })
  if (r.status !== 0 || !r.stdout) return []
  const counts = {}
  for (const raw of r.stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const top = line.split('/')[0]
    if (SKIP_DIRS.has(top)) continue
    counts[line] = (counts[line] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15)
}, [])

// ---------------------------------------------------------------------------
// assemble derived facts + anti-pattern punch list
// ---------------------------------------------------------------------------
const techByCat = {}
for (const { category, label, source } of stack.values()) {
  ;(techByCat[category] ||= []).push({ label, source })
}
const CAT_ORDER = ['Language', 'Framework', 'Backend', 'Data access', 'Database', 'Styling', 'State', 'Testing', 'Build']

const antiPatterns = []
if (existsSync(join(scanRoot, '.env')) && !existsSync(join(scanRoot, '.env.example'))) {
  antiPatterns.push('A committed `.env` at the repo root with no `.env.example`. Confirm no live secret is tracked, and add `.env` to `.gitignore`.')
}
for (const f of tree.large) antiPatterns.push(`Large single file \`${f.path}\` (~${f.kb}KB), a candidate to split.`)
if (tree.schemaFiles.length === 0) antiPatterns.push('No schema or migration files detected. If this app persists data, its data model may live only in code (or nowhere), worth confirming.')

// ---------------------------------------------------------------------------
// writers. NEVER overwrite: an existing target routes to a dated snapshot dir.
// ---------------------------------------------------------------------------
const written = []
const snapshotted = []
function writeSafe(rel, content) {
  const primary = join(OUT, rel)
  if (existsSync(primary)) {
    const snap = join(OUT, 'docs/ingest/snapshots', STAMP, rel)
    mkdirSync(dirname(snap), { recursive: true })
    writeFileSync(snap, content)
    snapshotted.push({ rel, snapshot: relative(OUT, snap) })
    return
  }
  mkdirSync(dirname(primary), { recursive: true })
  writeFileSync(primary, content)
  written.push(rel)
}

const bullets = (arr, empty) => (arr.length ? arr.map((x) => `- ${x}`).join('\n') : `- ${empty}`)
const stackLines = CAT_ORDER
  .filter((c) => techByCat[c])
  .map((c) => `- ${c}: ${techByCat[c].map((t) => t.label).join(', ')}`)
  .join('\n') || '- (no stack detected from manifests, this repo may use a toolchain the scanner does not read yet)'

const evidenceRows = []
for (const c of CAT_ORDER) {
  for (const t of techByCat[c] || []) evidenceRows.push(`| ${t.label} | ${c} | \`${t.source}\` |`)
}

// --- the REAL tech-stack ADR ---------------------------------------------------
const adr = `# ADR-0001: Tech stack (derived by /jiffi-adopt)

**Status:** Proposed (offline scan, confirm before you rely on it)
**Date:** ${TODAY}

## Context
This ADR was written by \`/jiffi-adopt\`, an offline heuristic scan of \`${relative(OUT, scanRoot) || '.'}\`. It read the manifests and the file tree and asked git for a commit heatmap. It did not run the code and did not ask the model, so every line here is a DERIVED [D] fact traced to a file in the Evidence table. High confidence is not proof: run the \`ingest\` skill and the \`review-ingest\` agent to confirm each one before you build on it.

Repo shape: ${tree.files} files, ${tree.dirs} directories scanned${tree.excluded ? `, excluding the ${tree.excluded} file(s) the builder-kit scaffold wrote` : ''}${tree.truncated ? ` (walk hit the ${MAX_FILES}-file ceiling, this is a partial view)` : ''}. Package manager: ${tree.packageManagers.length ? tree.packageManagers.join(', ') : 'not detected'}.

## Decision (the stack the scan found)
${stackLines}

Detected surface: ${tree.routeFiles.length} route file(s), ${tree.componentFiles.length} component file(s), ${tree.schemaFiles.length} schema/migration file(s).

## Evidence
Each row traces a claim to the file it came from. A claim with no source is not a [D] fact.

| Item | Category | Source |
|---|---|---|
${evidenceRows.join('\n') || '| (none) | | |'}

## Alternatives
Not applicable. This ADR RECORDS the stack an existing repo already runs, it does not choose one. When you deliberately change a choice here, do not edit this record: supersede it with a new ADR via the \`create-adr\` skill, so the history of why stays intact.

## Consequences
- These are [D] derivable facts: high confidence, still unconfirmed. The \`ingest\` skill records them as decisions in \`docs/decisions.md\` only after you confirm each, and \`review-ingest\` flags any that were over-confident and should have been [C].
- What the scan could NOT see (why the stack was chosen, the data model's intent, who the product is for, what success means) is a [G] gap. Those are left as stubs in \`docs/idea/\`, \`docs/prd/\` and \`docs/design-system/\` for you to fill.
- The anti-pattern punch list (a [A] flag, not a blocker) lives in \`docs/ingest/scan-report.md\`.
`

// --- the scan report (the D/C/G/A + heatmap + punch list) ---------------------
const report = `# Adopt scan report

Written by \`/jiffi-adopt\` on ${TODAY} from an offline scan of \`${relative(OUT, scanRoot) || '.'}\`. No model, no network. This is the raw material the \`ingest\` skill reads to confirm the derivable facts and fill the gaps.

## The confidence model
Every fact a scan produces is tagged. The scanner only ever produces [D] and [A] on its own; [C] and [G] are for a human (via the \`ingest\` skill) to resolve.

- [D] Derivable: read straight from a manifest or the tree, traced to a file. See \`docs/adr/ADR-0001-tech-stack.md\`.
- [C] Confirmable: inferred, medium confidence. A scanner does not assert these; the \`ingest\` skill asks you one at a time.
- [G] Gap: not in the code at all (intent, users, metrics, the business model). Left as stubs to fill.
- [A] Anti-pattern: probably wrong, flagged not blocked. Punch list below. Dismissing one becomes a decision.

## [D] Derived stack
${stackLines}

## Detected surface
- Routes (${tree.routeFiles.length}): ${tree.routeFiles.slice(0, 15).map((f) => `\`${f}\``).join(', ') || '(none detected)'}${tree.routeFiles.length > 15 ? ', ...' : ''}
- Components (${tree.componentFiles.length}): ${tree.componentFiles.slice(0, 15).map((f) => `\`${f}\``).join(', ') || '(none detected)'}${tree.componentFiles.length > 15 ? ', ...' : ''}
- Schemas/migrations (${tree.schemaFiles.length}): ${tree.schemaFiles.slice(0, 15).map((f) => `\`${f}\``).join(', ') || '(none detected)'}${tree.schemaFiles.length > 15 ? ', ...' : ''}

## Tree summary
- Files: ${tree.files}, directories: ${tree.dirs}${tree.truncated ? ` (truncated at ${MAX_FILES})` : ''}
${tree.excluded ? `- Excluded: ${tree.excluded} file(s) written by the builder-kit scaffold itself, so these counts describe what you brought, not what the kit added\n` : ''}
- Top-level entries: ${tree.topLevel.map((e) => `\`${e}\``).join(', ') || '(none)'}
- File types: ${tree.topExts.map(([e, n]) => `${e} (${n})`).join(', ') || '(none)'}

## Git commit heatmap (last 200 commits)
The files that change most often, a cheap proxy for where the real work lives.

${heatmap.length ? heatmap.map(([f, n]) => `- \`${f}\` (${n} commits)`).join('\n') : '- (git history unavailable, git may not be installed or this is not a repo)'}

## [A] Anti-pattern punch list
Flagged, not blocking. Confirm or dismiss each during \`ingest\`.

${bullets(antiPatterns, 'None the scanner could see. That is not proof the repo is clean, only that these cheap heuristics found nothing.')}

${warnings.length ? `## Scan warnings\nPhases that degraded gracefully rather than failing the run.\n\n${warnings.map((w) => `- ${w}`).join('\n')}\n` : ''}## Next
Run \`/builder-kit:ingest\` to confirm the [D] facts, answer the [C] questions and fill the [G] gaps, then \`/builder-kit:architect\`.
`

// --- STUB idea-pack / prd / design (a scanner cannot infer intent) ------------
const stubIdea = `# Idea Pack (STUB, written by /jiffi-adopt)

> A scanner reads code, not minds. Every section below is a [G] gap: the repo does
> not state why it exists, who it is for, or what success looks like. Fill these by
> running the \`ingest\` skill (it asks one question at a time) or by hand. Do not
> pass this to \`review-idea-pack\` until the gaps are real content.

## One-liner
[G] Gap. What does this product do, for whom, in one sentence?

## Problem
[G] Gap. The specific pain, who feels it, and how they cope today.

## Target users
[G] Gap. Narrow. Name the primary user (and the buyer, if different).

## User stories
[G] Gap. 5 to 12, in "As a ... I want ... so that ..." form.

## Scope
[G] Gap. What v1 does, as concrete bullets. (Detected surface for reference: ${tree.routeFiles.length} routes, ${tree.componentFiles.length} components, in \`docs/ingest/scan-report.md\`.)

## Explicitly out of scope
[G] Gap. What it deliberately does NOT do yet.

## Success metrics
[G] Gap. Measurable. Not "users love it".

## Risks and unknowns
[G] Gap. The assumptions that sink it if wrong.

## Competitive landscape
[G] Gap. The two or three closest alternatives and why this differs.

## Open questions
[G] Gap. The real undecided things.
`

const stubPrd = `# PRD (STUB, written by /jiffi-adopt)

> This is a derived shell, not a PRD. \`/jiffi-adopt\` can see WHAT the code is, never
> WHY. Every [G] below is yours to fill via the \`ingest\` skill or by hand, before
> \`architect\` reads it. The one grounded section is the detected surface, a [D] fact.

## Goal
[G] Gap. What outcome does this product exist to produce?

## Detected surface ([D], from the scan)
- Routes: ${tree.routeFiles.length}
- Components: ${tree.componentFiles.length}
- Schemas/migrations: ${tree.schemaFiles.length}
- Stack: see \`docs/adr/ADR-0001-tech-stack.md\`

## Functional requirements
[G] Gap. What the product must do, derived from the goal (not from the file tree).

## Non-functional requirements
[G] Gap. Performance, security, accessibility, availability targets.

## Acceptance criteria
[G] Gap. Testable statements, one per requirement.

## Out of scope
[G] Gap.
`

const stubDesign = `# Design system notes (STUB, written by /jiffi-adopt)

> A scanner can spot a styling TOOL, never a design INTENT (the palette, the type,
> the feel). ${techByCat['Styling'] ? `Detected styling: ${techByCat['Styling'].map((t) => t.label).join(', ')} ([D]).` : 'No styling tool detected ([D]).'} Everything below is a [G] gap.
> Run the \`brand\` skill to choose a brand by looking, then \`design-system\` to turn
> it into tokens and a living \`docs/design-system/design-guide.html\`.

## Brand / tone
[G] Gap.

## Palette
[G] Gap. Choose by looking (the N10 rule): candidates rendered as HTML swatches with AA contrast, never a hex list.

## Typography
[G] Gap.

## Tokens
[G] Gap.
`

// ---------------------------------------------------------------------------
// write everything (never overwriting) + scaffold docs/ingest/sources/
// ---------------------------------------------------------------------------
writeSafe('docs/adr/ADR-0001-tech-stack.md', adr)
writeSafe('docs/ingest/scan-report.md', report)
writeSafe('docs/idea/idea-pack.md', stubIdea)
writeSafe('docs/prd/prd.md', stubPrd)
writeSafe('docs/design-system/design-notes.md', stubDesign)

const sourcesKeep = join(OUT, 'docs/ingest/sources/.gitkeep')
if (!existsSync(sourcesKeep)) {
  mkdirSync(dirname(sourcesKeep), { recursive: true })
  writeFileSync(sourcesKeep, '')
  written.push('docs/ingest/sources/.gitkeep')
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

// One next step, read back off disk AFTER the writes, from the same state.mjs the
// status line and the session re-ground use. This script used to print its own answer,
// init.mjs printed a second, state.mjs a third and the guide page a fourth, all at the
// same moment and none of them agreeing. The stubs this run just wrote do not count as
// proof, so what comes back is the step still genuinely open.
const nextStep = getState(OUT).nextCommand

if (asJson) {
  console.log(JSON.stringify({
    scanRoot: relative(OUT, scanRoot) || '.',
    date: TODAY,
    tree: {
      files: tree.files, dirs: tree.dirs, excluded: tree.excluded, truncated: tree.truncated,
      packageManagers: tree.packageManagers,
      routes: tree.routeFiles.length, components: tree.componentFiles.length, schemas: tree.schemaFiles.length,
      topExts: tree.topExts,
    },
    stack: [...stack.values()],
    heatmap,
    antiPatterns,
    warnings,
    written,
    snapshotted,
    next: nextStep,
  }, null, 2))
  process.exit(0)
}

console.log(`\n/jiffi-adopt scanned ${relative(OUT, scanRoot) || '.'} offline (no model, no network).`)
console.log(`  ${tree.files} files, ${tree.dirs} dirs${tree.excluded ? ` (${tree.excluded} builder-kit scaffold file(s) excluded)` : ''}${tree.truncated ? ` (truncated at ${MAX_FILES})` : ''}`)
console.log(`  stack: ${[...stack.values()].map((t) => t.label).join(', ') || '(none detected)'}`)
console.log(`  surface: ${tree.routeFiles.length} routes, ${tree.componentFiles.length} components, ${tree.schemaFiles.length} schemas`)
if (antiPatterns.length) console.log(`  [A] ${antiPatterns.length} anti-pattern flag(s), see the scan report`)
if (warnings.length) console.log(`  ${warnings.length} scan phase(s) degraded gracefully, see the scan report`)

if (written.length) {
  console.log('\nWrote:')
  for (const w of written) console.log(`  + ${w}`)
}
if (snapshotted.length) {
  console.log('\nDid NOT overwrite (a re-run), wrote fresh copies to snapshots for diffing:')
  for (const s of snapshotted) console.log(`  ~ ${s.rel}  ->  ${s.snapshot}`)
}

console.log('\nThe ADR is REAL (traced to files). The idea-pack, PRD and design files are STUBS: a scanner cannot infer intent.')
console.log('A stub does not count as a step done: the kit still reads those stages as open until the gaps are filled.')
console.log(`Next: ${nextStep}`)
console.log('      it confirms the derived facts, fills the gaps one question at a time, then hands to /builder-kit:architect')
process.exit(0)
