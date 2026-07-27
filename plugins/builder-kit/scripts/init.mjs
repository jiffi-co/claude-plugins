#!/usr/bin/env node
// Scaffold a Jiffi-workflow project with "forge new" discipline:
//   - refuse to scaffold into a NON-EMPTY new directory (never clobber),
//   - never overwrite an existing file in place (skip + report),
//   - copy templates from the plugin (one source of truth — no inline drift),
//   - post-flight verify every expected file/dir exists,
//   - roll back everything THIS run created if any step fails.
//
// Usage:
//   node init.mjs --entry-point <e> [project-name]  -> scaffolds ./<project-name> (must be new/empty)
//   node init.mjs --entry-point <e>                 -> scaffolds the current directory (non-destructive)
//   ... --repo create|skip                          -> also create the private GitHub backup
//   ... --cost-ceiling "<answer>"                   -> record the monthly spend ceiling
//
// --repo create is a CONSENT TOKEN, exactly like --entry-point. It is the answer to
// "should your work be backed up to a private GitHub repository?", which /builder-kit:start
// asks with AskUserQuestion before this runs. This script must never create an
// account-level resource on its own, so the flag has no default and its absence means
// "not asked": nothing is created and nothing is claimed. Do not add a default here,
// and do not pass `create` on the caller's behalf to save a question.
//
// --entry-point is REQUIRED and has no default. It is the answer to the one question
// /builder-kit:start asks before this script runs: nothing yet / an idea written down
// or in idea8 / an existing prototype, repo or app. The script cannot ask it itself
// (a script has no AskUserQuestion), and defaulting it would be the side door this
// exists to close, so a missing answer is a hard exit 2 rather than a guess.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync, spawnSync } from 'node:child_process'
import { getState } from './state.mjs'

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
// The entry point: where the builder is starting FROM. It records which stages arrive
// with material already in hand; it never removes a stage and never reorders them. The
// spine (idea -> PRD -> ADRs -> design -> plan -> build loop) is identical for all
// three, so nobody can skip a gate by arriving through a side door.
//
// `next` is NOT stored here. Four places used to print four different next steps at
// the same moment (this script, adopt.mjs, state.mjs and the guide page), which is
// three too many. state.mjs is the single source now and this script reads it back
// off disk after the scaffold, so the command it prints is the command the kit is
// actually waiting for. What stays here is the door's ACCELERATOR: the one command
// that arrives with material in hand, which state.mjs cannot know about.
const ENTRY_POINTS = {
  'nothing-yet': { prefilled: [], accelerator: null },
  idea: {
    prefilled: ['idea'],
    accelerator: '/builder-kit:jiffi-import-idea8 <export> pulls an idea8 brief straight in',
  },
  'existing-build': {
    prefilled: ['idea'],
    accelerator: '/builder-kit:jiffi-adopt scans the existing code offline first, then hand to ingest',
  },
}
// The words a human or a model is likely to hand back from the question.
const ENTRY_ALIASES = {
  'nothing-yet': 'nothing-yet',
  nothing: 'nothing-yet',
  none: 'nothing-yet',
  new: 'nothing-yet',
  scratch: 'nothing-yet',
  idea: 'idea',
  idea8: 'idea',
  written: 'idea',
  'existing-build': 'existing-build',
  existing: 'existing-build',
  prototype: 'existing-build',
  repo: 'existing-build',
  app: 'existing-build',
  codebase: 'existing-build',
}
const entryEq = argv.find((a) => a.startsWith('--entry-point='))
let entryRaw = entryEq ? entryEq.split('=').slice(1).join('=') : null
if (!entryEq) {
  const i = argv.indexOf('--entry-point')
  if (i >= 0 && argv[i + 1]) entryRaw = argv[i + 1]
}
const entryPoint = ENTRY_ALIASES[String(entryRaw || '').trim().toLowerCase()] || null
if (!entryPoint) {
  console.error(
    entryRaw
      ? `Unknown --entry-point "${entryRaw}". Use one of: ${Object.keys(ENTRY_POINTS).join(', ')}.`
      : 'Missing --entry-point. Nothing has been written.',
  )
  console.error('')
  console.error('Ask the builder this ONE question first, then pass the answer:')
  console.error('  "Where are you starting from?"')
  console.error('    nothing yet                        --entry-point nothing-yet')
  console.error('    an idea written down or in idea8   --entry-point idea')
  console.error('    an existing prototype, repo or app --entry-point existing-build')
  console.error('')
  console.error('Run /builder-kit:start, which asks it for you. All three run the same stages;')
  console.error('the answer only records which ones arrive with material already in hand.')
  process.exit(2)
}

// --repo: whether to create the private GitHub backup as part of the front door.
// It is the answer to a question /builder-kit:start asks, so like --entry-point it is
// never inferred. Absent means "not asked" and nothing is created; page 3's promise of
// a private remote is only kept when the answer arrives here as `create`.
const REPO_CHOICES = ['create', 'skip']
const flagValue = (flag) => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`))
  if (eq) return eq.slice(flag.length + 1)
  const i = argv.indexOf(flag)
  if (i < 0) return null
  const next = argv[i + 1]
  // `--cost-ceiling --repo skip` must not record "--repo" as the ceiling. A flag is
  // never another flag's value, and a missing value is missing, not the next token.
  return next !== undefined && !next.startsWith('--') ? next : null
}
const repoRaw = flagValue('--repo')
const repoChoice = repoRaw == null ? null : String(repoRaw).trim().toLowerCase()
if (repoChoice != null && !REPO_CHOICES.includes(repoChoice)) {
  console.error(`Unknown --repo "${repoRaw}". Use one of: ${REPO_CHOICES.join(', ')}.`)
  process.exit(1)
}
// The monthly spend ceiling. It is asked on the first page of every guide and, before
// this, it landed nowhere: two later skills (prd, architect) are told to read it back
// and had nothing to read. Recorded here, at the first write, so the read-backs are real.
const costCeiling = (() => {
  const v = flagValue('--cost-ceiling')
  const s = v == null ? '' : String(v).replace(/\s+/g, ' ').trim().slice(0, 200)
  return s || null
})()

// The value after a spaced flag is that flag's value, never the project name.
const valueIndices = new Set()
for (const flag of ['--type', '--entry-point', '--repo', '--cost-ceiling']) {
  if (argv.some((a) => a.startsWith(`${flag}=`))) continue
  const i = argv.indexOf(flag)
  if (i >= 0) valueIndices.add(i + 1)
}
const OVERLAY = join(HERE, '..', 'templates', 'overlays', projectType)

const name = argv.find((a, idx) => !a.startsWith('-') && !valueIndices.has(idx)) || null

// The one combination that is always wrong. Someone whose code already exists is
// standing IN their project, so a name here creates a brand new empty child directory
// beside the code it was meant to adopt — a full scaffold with nothing in it, exit 0,
// no warning. The script holds the one fact that makes this obviously wrong, so it
// refuses rather than doing it. (Exit 2, the same code as a missing answer: both mean
// "the question was not carried through properly", and both wrote nothing.)
if (name && entryPoint === 'existing-build') {
  console.error(`Refusing to scaffold into a new "${name}" directory.`)
  console.error('')
  console.error('You said you are starting from an existing prototype, repo or app, which means')
  console.error(`you are already standing in it. Creating ./${name} would put an empty scaffold`)
  console.error('BESIDE your code, not around it. Nothing has been written.')
  console.error('')
  console.error('Run it again from inside the project, with no name:')
  console.error(`  node init.mjs --entry-point existing-build --type ${projectType}`)
  console.error('')
  console.error('If you really did mean a fresh empty project, the entry point is nothing-yet.')
  process.exit(2)
}

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

// docs/tasks is the kit's task store: one markdown file per task, written by
// hooks/task-mirror.mjs and read by scripts/task-store.mjs. It is scaffolded empty so
// the skills that read it find a real empty store rather than a missing folder — "no
// open tasks" and "I could not look" must never be the same answer.
const DIRS = [
  'docs/idea', 'docs/prd', 'docs/adr', 'docs/design-system', 'docs/agents', 'docs/checkpoints', 'docs/tasks',
  '.claude/rules', '.claude/commands', '.claude/agents',
]
const EMPTY_DIRS = ['docs/idea', 'docs/prd', 'docs/adr', 'docs/design-system', 'docs/agents', 'docs/tasks', '.claude/commands', '.claude/agents']

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
const restores = [] // files this run REWROTE, with their original bytes, for rollback
function track(p) {
  created.push(p)
}
function ensureDir(abs) {
  if (!existsSync(abs)) {
    mkdirSync(abs, { recursive: true })
    track(abs)
  }
}

const report = { created: [], skipped: [], updated: [] }

// A recorded testCommand that does not exist is worse than no recorded command: the
// close gate and the Stop hook both read it as fact, so a project that never had a
// `test` script reports a green suite that never ran. When the reader brought their own
// package.json (or their own Xcode project), the per-type default is a guess, so it is
// only recorded when the script it names is actually there.
let testCommandNote = ''
let testCommandWhy = ''
let missingScripts = [] // [name, command] the overlay would have added but could not
function resolveTestCommand() {
  const wanted = {
    web: 'npm test',
    ios: `xcodebuild test -scheme ${projectName} -destination 'platform=iOS Simulator,name=iPhone 16'`,
    agent: 'npm run eval',
  }[projectType]
  const pkgPath = join(targetDir, 'package.json')
  if (projectType === 'web' || projectType === 'agent') {
    // No package.json yet means the scaffold or `bootstrap` will create one and wire
    // the script to match, which is the normal greenfield path.
    if (!existsSync(pkgPath)) return wanted
    const script = projectType === 'agent' ? 'eval' : 'test'
    let scripts = null
    try {
      scripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts
    } catch {
      testCommandWhy = 'package.json is already here but could not be parsed, so no test command was recorded'
      return null
    }
    if (scripts && typeof scripts[script] === 'string' && scripts[script].trim()) return wanted
    testCommandWhy = `package.json is already here and has no "${script}" script, so no test command was recorded (\`${wanted}\` would have been a guess)`
    return null
  }
  // ios: the scheme name is the project name, which only holds when this scaffold owns
  // the Xcode project. An existing one, named something else, makes the command a guess.
  const existingProject = existsSync(targetDir)
    ? readdirSync(targetDir).find((f) => f.endsWith('.xcodeproj') || f.endsWith('.xcworkspace'))
    : null
  if (existingProject && basename(existingProject).replace(/\.(xcodeproj|xcworkspace)$/, '') !== projectName) {
    testCommandWhy = `${existingProject} is already here, so scheme "${projectName}" would have been a guess and no test command was recorded`
    return null
  }
  return wanted
}

try {
  ensureDir(targetDir)

  // FIRST WRITE, before a single scaffold file or docs directory exists. The entry
  // point is the one thing this run cannot recover if the process dies halfway: every
  // other file is reproducible from the templates, but the answer to the question only
  // exists in the builder's head. Ordering is checked in scripts/test, by comparing the
  // config's mtime against every other file's, not by trusting this comment.
  //
  // experienceLevel + assistanceMode drive the dual-track coaching model: interactive
  // skills read these back to adapt tone and confirmation frequency WITHOUT forking
  // content or skipping a human gate. Defaults are the gentlest (beginner/coach); an
  // advanced builder flips them in .claude/builder-kit.json.
  //
  // testCommand records the resolved per-target suite so the tail skills and the Stop
  // hook branch deterministically. stopTestGate is opt-in (false by default): the Stop
  // hook runs THIS testCommand only when turned on, never a hardcoded "npm test".
  const cfgPath = join(targetDir, '.claude', 'builder-kit.json')
  ensureDir(dirname(cfgPath))
  const testCommand = resolveTestCommand()
  let cfg = {
    projectType,
    scaffoldedBy: 'jiffi-init',
    testCommand,
    stopTestGate: false,
    experienceLevel: 'beginner',
    assistanceMode: 'coach',
  }
  if (costCeiling) cfg.costCeiling = costCeiling
  let cfgExisted = false
  if (existsSync(cfgPath)) {
    // Scaffolding in place over a project that already has a config: merge, never
    // clobber. Everything already recorded there survives; only the entry point is
    // set, because the builder just answered the question.
    cfgExisted = true
    const original = readFileSync(cfgPath, 'utf8')
    restores.push([cfgPath, original])
    try {
      const parsed = JSON.parse(original)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed
    } catch {
      throw new Error(`${cfgPath} exists but is not valid JSON. Fix or remove it, then re-run.`)
    }
  }
  cfg.entryPoint = entryPoint
  // Which stages arrive with material already in hand. Not a skip list: every stage
  // still runs, these just do not start from a blank page.
  cfg.entryPointPrefilled = ENTRY_POINTS[entryPoint].prefilled
  // The ceiling was answered a moment ago, so it wins over a stale one on disk. Absent
  // means not asked, and whatever was already recorded stands.
  if (costCeiling) cfg.costCeiling = costCeiling
  // Warn about the value that was actually RECORDED, not the one this run computed. On
  // the merge path the existing config's testCommand survives untouched, and warning
  // there would tell a project with a perfectly good suite that it has none.
  if (cfg.testCommand == null) testCommandNote = testCommandWhy || 'no testCommand is recorded in .claude/builder-kit.json'
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`)
  if (!cfgExisted) {
    track(cfgPath)
    report.created.push('.claude/builder-kit.json')
  } else {
    report.updated.push(`.claude/builder-kit.json (entryPoint${costCeiling ? ', costCeiling' : ''})`)
  }

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

  // A skipped file is not always harmless. Skipping package.json (because the builder
  // brought their own) silently drops every script the overlay meant to add, and the
  // notes file the same overlay writes then tells the reader that `npm start` runs the
  // agent when it runs their old Express app. Never merge someone's package.json behind
  // their back; do say exactly what is missing and the one line that adds each.
  const overlayPkg = join(OVERLAY, 'package.json')
  const projectPkg = join(targetDir, 'package.json')
  if (report.skipped.includes('package.json') && existsSync(overlayPkg) && existsSync(projectPkg)) {
    try {
      const want = JSON.parse(readFileSync(overlayPkg, 'utf8').replaceAll('{{PROJECT_NAME}}', projectName)).scripts || {}
      const got = JSON.parse(readFileSync(projectPkg, 'utf8')).scripts || {}
      missingScripts = Object.entries(want)
        .filter(([k]) => typeof got[k] !== 'string' || !got[k].trim())
        .map(([k, v]) => [k, v])
    } catch {
      // An unparseable package.json is the builder's to fix, and it is already
      // visible everywhere else. Say nothing here rather than guessing at it.
    }
  }

  // Post-flight: every template target and every dir must now exist, and the entry
  // point must be readable back off disk. A config that did not survive the run is a
  // failed scaffold, not a warning.
  const missing = []
  for (const rel of templateFiles(TEMPLATES)) if (!existsSync(join(targetDir, rel))) missing.push(rel)
  for (const d of DIRS) if (!existsSync(join(targetDir, d))) missing.push(d + '/')
  if (missing.length) throw new Error(`post-flight verify failed, missing: ${missing.join(', ')}`)
  if (JSON.parse(readFileSync(cfgPath, 'utf8')).entryPoint !== entryPoint) {
    throw new Error(`post-flight verify failed: entryPoint not recorded in ${cfgPath}`)
  }

  // What THIS run put on disk, so a later reader of the tree can tell the kit's own
  // scaffold apart from the code the builder brought. /jiffi-adopt reads it and
  // excludes these paths from its repo summary; without it, adopting an existing
  // project reports the kit's eleven markdown files back as part of what you wrote.
  // Runtime state, not config: it keeps .claude/builder-kit.json lean and it is safe
  // to delete.
  const manifestPath = join(targetDir, '.claude', 'builder-kit', 'scaffold-manifest.json')
  try {
    mkdirSync(dirname(manifestPath), { recursive: true })
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        { by: 'jiffi-init', at: new Date().toISOString(), projectType, entryPoint, files: report.created.slice().sort() },
        null,
        2,
      )}\n`,
    )
  } catch {
    // A manifest that could not be written costs adopt some precision. It is not
    // worth rolling a good scaffold back over.
  }
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
    // Files this run rewrote go back to their original bytes first, then everything it
    // created is removed. The config merge is the only rewrite, and leaving a
    // half-merged config behind after a failed run would be worse than not running.
    for (const [p, original] of restores) {
      try {
        writeFileSync(p, original)
      } catch {}
    }
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

// The private backup, if the builder said yes to it. A local `git init` alone is not
// a backup: the close gate at the end of phase 1 checks that the work has left this
// machine, and until this ran there was no page and no command in the arc that
// created a remote. repo-create.mjs does the asking-free half (it refuses without
// --yes, and the consent arrived as `--repo create`) and reports in plain language
// when `gh` is missing or signed out, which is an ordinary Tuesday rather than a crash.
let repoNote = ''
let repoFix = ''
if (repoChoice === 'create') {
  // Say what is about to be created BEFORE creating it. This process cannot ask (a
  // script has no AskUserQuestion), so `--repo create` IS the consent, carried down
  // from the question /builder-kit:start put to the human. That makes the printed line
  // the only trace a reader has that an account-level resource was made in their name,
  // and a trace they can read after the fact is the least this owes them.
  console.log(`\ncreating a private GitHub repository "${basename(targetDir)}" from ${targetDir}...`)
  const r = spawnSync(process.execPath, [join(HERE, 'repo-create.mjs'), '--yes', '--root', targetDir], {
    cwd: targetDir,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const body = `${r.stdout || ''}${r.stderr || ''}`.trim()
  if (r.status === 0) {
    repoNote = body || 'github: private repository created'
  } else {
    repoNote = body || 'github: the backup could not be set up.'
    repoFix =
      'The project itself is fine and every local step works. When you have fixed the line above,\n' +
      `run this from inside ${name ? `./${name}` : 'the project'} to finish the backup:\n` +
      `  /builder-kit:start --repo create${projectType === 'web' ? '' : ` --type ${projectType}`}`
  }
} else if (repoChoice === 'skip') {
  repoNote = 'github: skipped, so this work only exists on this machine. The phase-1 close gate checks that it has been pushed; `/builder-kit:start --repo create` sets it up whenever you are ready.'
}

console.log(`\n✅ Scaffolded "${projectName}" (${projectType}) at ${targetDir}`)
console.log(`   created: ${report.created.length} file(s)/dir(s)`)
if (gitNote) console.log(`   ${gitNote}`)
if (report.updated.length) console.log(`   updated: ${report.updated.join(', ')}`)
if (report.skipped.length) console.log(`   skipped (already existed): ${report.skipped.join(', ')}`)
console.log('\nWhat you got:')
console.log('  CLAUDE.md + AGENTS.md      the project context + coordination contract (@AGENTS.md wired)')
console.log('  .claude/settings.json      deny-.env rule + the builder-kit marketplace/plugin registered')
console.log('  .claude/rules/security.md  the secret-hygiene rule')
console.log('  docs/{idea,prd,adr,...}    the workflow lives on disk here')
console.log('  docs/checkpoints/checkpoint.json  the per-project gate /checkpoint reads')
console.log(
  `  .claude/builder-kit.json   project type = ${projectType}, entry point = ${entryPoint}${costCeiling ? `, cost ceiling = ${costCeiling}` : ''}`,
)
if (repoNote) console.log(`\n${repoNote}`)
if (repoFix) console.log(`\n${repoFix}`)
if (missingScripts.length) {
  console.log(`\n⚠️  Your package.json was kept as it was, so the ${projectType} scaffold could not add its scripts.`)
  console.log('   Everything the notes file says about running and testing this project assumes these:')
  for (const [k, v] of missingScripts) console.log(`     npm pkg set scripts.${k}="${v}"`)
  console.log('   Nothing was merged into your package.json. Run the lines you want.')
}
if (testCommandNote) {
  console.log(`\n⚠️  No test command recorded: ${testCommandNote}.`)
  console.log('   Nothing downstream will pretend a suite passed. Name the real one with:')
  console.log('     node -e \'const f=".claude/builder-kit.json",j=JSON.parse(require("fs").readFileSync(f));j.testCommand="<your command>";require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\\n")\'')
}
if (!costCeiling) {
  console.log('\nNo monthly cost ceiling recorded. The PRD and the architecture step both read it')
  console.log('back, so they will ask you for it there instead.')
}
console.log('\nEvery entry point runs the same stages in the same order. Yours records which')
console.log('ones start from material you already have, so none of them is skipped.')

// One next step, read back off disk from the same state.mjs every hook and skill uses,
// so the scaffold, the status line and the guide page cannot name three different
// commands at the same moment. The accelerator, when the door has one, is an extra
// line rather than a competing answer.
const state = getState(targetDir)
console.log(`\nNext: ${state.nextCommand}`)
const accelerator = ENTRY_POINTS[entryPoint].accelerator
if (accelerator) console.log(`      (${accelerator})`)
process.exit(0)
