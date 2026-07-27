#!/usr/bin/env node
// Where am I? One answer, derived from artefacts ON DISK.
//
// Every hook and every skill that needs to know the current step calls getState()
// instead of re-deriving it from prose, from chat history, or from a "Current
// phase" line somebody forgot to bump. Chat is not evidence. A file is.
//
// The contract, and the reason this file exists at all:
//   - getState() NEVER throws. Every path returns the documented shape.
//   - Unreadable input degrades to a named error code, never to a wrong answer.
//   - Absence of evidence is reported as absence, never inferred as done.
//
// Usage:
//   node state.mjs                  human block for the current directory
//   node state.mjs --json           the same state as JSON
//   node state.mjs <root> [--json]  against another directory
//   node state.mjs --explain        the shape and the stage table, for a reader
//
// Exit code: 0 when a state was produced (blockers do NOT change it — this is a
// report, not a gate), 1 only when the root could not be read at all.
//
// As a module:
//   import { getState, formatState, SPINE, ERROR_CODES } from '<plugin>/scripts/state.mjs'
//
// THE SHAPE (every key is always present, on every path):
//   {
//     ok:        boolean            false only on a root-level read failure
//     error:     null | { code, message, path }        codes in ERROR_CODES
//     root:      string             absolute path the state was read from
//     isBuilderKitProject: boolean  false is a STAGE ("unscaffolded"), not an error
//     stage:     string             one of SPINE[].id, or 'unknown' when ok is false
//     stageLabel:string             human name for that stage
//     nextCommand: string           one copyable /builder-kit: command
//     progress:  { done, total }    spine steps proven complete, out of SPINE.length
//     blockers:  [ { id, severity, message, fix } ]    severity: 'block' | 'warn'
//     step:      { number, total }  1-based position on the kit spine
//     phases:    { total, done, current, list:[{ n, name, closed, verified, marker }] }
//     guide:     null | { step, of, key, slug, title, url, source }
//     door:      'greenfield' | 'existing'             which front door was taken
//     projectType: string | null    from .claude/builder-kit.json
//     branch:    string | null      read from .git/HEAD, no subprocess
//     notes:     string[]           observations that are not blockers
//   }

import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = resolve(HERE, '..')

// The only three ways a state read fails outright. Anything else is a stage.
export const ERROR_CODES = {
  ROOT_NOT_FOUND: 'ROOT_NOT_FOUND',
  ROOT_NOT_A_DIRECTORY: 'ROOT_NOT_A_DIRECTORY',
  ROOT_UNREADABLE: 'ROOT_UNREADABLE',
}

// ---------------------------------------------------------------------------
// Filesystem, defensively. Nothing below throws.
// ---------------------------------------------------------------------------

function statSafe(p) {
  try {
    return statSync(p)
  } catch {
    return null
  }
}

// "Exists" means a non-empty regular file. A zero-byte docs/prd/prd.md is a
// touched placeholder, not a PRD, and calling that stage done would march the
// builder past the one gate that mattered.
function fileSafe(p) {
  const s = statSafe(p)
  return Boolean(s && s.isFile() && s.size > 0)
}

function readSafe(p) {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return null
  }
}

// A file made of placeholders is not evidence that a stage ran. `/jiffi-adopt` writes
// docs/idea/idea-pack.md and docs/prd/prd.md as shells whose first line says STUB and
// whose every section reads `[G] Gap.` — a scanner can see WHAT the code is, never WHY.
// Counting those as done advanced an adopting builder two steps and straight past the
// PRD approval gate, and the skills that would have stopped to ask never fired, because
// their artefact already existed. Absence of content is reported as absence.
//
// Two independent tells, either is enough:
//   - the document's TITLE declares it a stub, which is what the kit's own stubs do
//     (`# PRD (STUB, written by /jiffi-adopt)`, first line, every time),
//   - or three or more sections are still unfilled gap markers, which is what a
//     half-answered document looks like whoever wrote it.
// Both are deliberately narrow. Matching "STUB" anywhere in the opening paragraph
// would fail a real PRD that says "we will STUB the payment path this phase", and
// telling someone their finished document does not count is the worse error of the
// two: it is the kit calling their work absent. A document with one or two gaps left
// is a working draft, not a stub, and it counts.
function isStubBody(body) {
  if (typeof body !== 'string' || !body) return false
  const first = body.split('\n').find((l) => l.trim())
  if (first && /^#{1,6}\s/.test(first.trim()) && /\bSTUB\b/.test(first)) return true
  // Constructed per call rather than hoisted: a shared /g regex is stateful under
  // .test(), and the next person to reach for this constant should not have to know that.
  return (body.match(/^[ \t]*(>[ \t]*)?\[G\]/gm) || []).length >= 3
}

// A stage's proof: a non-empty regular file that is not a placeholder. Returns the
// body too, so a caller that also needs to report WHY does not re-read the file.
function proofSafe(p) {
  if (!fileSafe(p)) return false
  return !isStubBody(readSafe(p))
}

function stubbedFile(p) {
  return fileSafe(p) && isStubBody(readSafe(p))
}

function listSafe(d) {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}

// Free text read off disk that ends up inside the printed block. A newline in one
// of these would break the block's shape, and the block is what a hook injects at
// session start, so a hand-edited file must not be able to forge a line in it.
function line(v, max = 300) {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function readJsonSafe(p) {
  if (!fileSafe(p)) return { value: null, present: false, invalid: false }
  const body = readSafe(p)
  if (body == null) return { value: null, present: true, invalid: true }
  try {
    const value = JSON.parse(body)
    if (value === null || typeof value !== 'object') return { value: null, present: true, invalid: true }
    return { value, present: true, invalid: false }
  } catch {
    return { value: null, present: true, invalid: true }
  }
}

// ---------------------------------------------------------------------------
// Command names. The directory name is the invocation key, so it is a published
// contract (PRINCIPLES.md) — and two of these are mid-rename. Resolve against
// what THIS plugin build actually ships rather than hardcoding either side, so
// state.mjs can never print a command that resolves to nothing.
// D2: jiffi-init -> start.  Wave 4: phase-start -> build.
// ---------------------------------------------------------------------------

function pluginHasEntry(name) {
  return fileSafe(join(PLUGIN_ROOT, 'skills', name, 'SKILL.md')) || fileSafe(join(PLUGIN_ROOT, 'commands', `${name}.md`))
}

function entry(preferred, fallback) {
  return `/builder-kit:${pluginHasEntry(preferred) ? preferred : fallback}`
}

// ---------------------------------------------------------------------------
// The spine. Ten steps, in order. `done` is the artefact that PROVES the step
// finished; the current stage is the first one whose proof is absent. Terminal
// step 10 is never "done" — you do not finish operating a live product.
// ---------------------------------------------------------------------------

export const SPINE = [
  {
    id: 'scaffold',
    label: 'Scaffold the project',
    proves: '.claude/builder-kit.json',
    done: (c) => c.has.config,
    command: () => entry('start', 'jiffi-init'),
  },
  {
    id: 'ground-idea',
    label: 'Ground the idea',
    proves: 'docs/idea/validation.md, or a docs/ingest/ scan for an existing prototype',
    done: (c) => c.has.validation || c.has.ingest,
    command: (c) => (c.door === 'existing' ? '/builder-kit:ingest' : '/builder-kit:validate-idea'),
  },
  {
    id: 'idea-pack',
    label: 'Write the Idea Pack',
    proves: 'docs/idea/idea-pack.md',
    done: (c) => c.has.ideaPack,
    command: (c) => (c.door === 'existing' ? '/builder-kit:ingest' : '/builder-kit:idea-pack'),
  },
  {
    id: 'prd',
    label: 'Write the PRD',
    proves: 'docs/prd/prd.md',
    done: (c) => c.has.prd,
    command: () => '/builder-kit:prd',
  },
  {
    id: 'architecture',
    label: 'Decide the architecture',
    proves: 'an ADR in docs/adr/',
    done: (c) => c.adrs.length > 0,
    command: () => '/builder-kit:architect',
  },
  {
    id: 'design-system',
    label: 'Lock the design system',
    proves: 'docs/design-system/MASTER.md',
    done: (c) => c.has.designMaster,
    command: () => '/builder-kit:design-system',
  },
  {
    id: 'plan',
    label: 'Plan the phases',
    proves: 'docs/implementation-plan.md',
    done: (c) => c.has.plan,
    command: () => '/builder-kit:implementation-plan',
  },
  {
    id: 'build',
    label: 'Build the phases',
    proves: 'every phase in the plan closed under docs/checkpoints/',
    done: (c) => c.phases.total > 0 && c.phases.done >= c.phases.total,
    // `--phase <N>` is the build skill's documented argument, and phase-start (now
    // its deprecated alias) forwards whatever it is given, so one form serves both.
    command: (c) => (c.phases.current == null ? entry('build', 'phase-start') : `${entry('build', 'phase-start')} --phase ${c.phases.current}`),
  },
  {
    id: 'ship',
    label: 'Ship it',
    proves: 'docs/deployment.md',
    done: (c) => c.has.deployment,
    command: () => '/builder-kit:ship',
  },
  {
    id: 'operate',
    label: 'Operate and iterate',
    proves: 'nothing — a live product is never finished',
    done: () => false,
    command: () => '/builder-kit:iterate',
  },
]

// ---------------------------------------------------------------------------
// The shaping guide page proves FOUR artefacts and the spine gates on three.
// `/builder-kit:wireframe` and `/builder-kit:brand` are blocks on that page with
// no spine step of their own, so a reader who ran the first block and stopped was
// told "step 5 of 8" while two blocks were still sitting above them. Nothing on
// disk noticed: the state machine had no knowledge of either artefact, so skipping
// both and writing the later documents by hand advanced cleanly to the build with
// no complaint, and the design system then invented a look nobody had picked.
//
// These are deliberately NOT spine steps. They do not gate the kit; they hold the
// GUIDE page open until that page's own blocks have run, and they name the one
// that is missing. An agent build has no screens, so the agent track's page
// carries no wireframe block and neither does this table for that project type.
// ---------------------------------------------------------------------------

const SHAPE_ARTEFACTS = [
  {
    key: 'wireframes',
    rel: 'docs/wireframes/README.md',
    command: '/builder-kit:wireframe',
    consequence: 'The shapes were never approved, so the taste gets spent on a layout nobody signed off.',
    // The wireframe skill writes this index on BOTH its paths, the drawn one and
    // the advanced escape hatch, which records the reason for skipping in the same
    // file. So a reasoned skip satisfies this and an unrecorded one does not.
    appliesTo: (projectType) => String(projectType || '').toLowerCase() !== 'agent',
  },
  {
    key: 'brand',
    rel: 'docs/brand/brand.md',
    command: '/builder-kit:brand',
    consequence: 'Nobody picked a look, so the design system picks one on your behalf.',
    // The brand skill's own rule: do not proceed to design-system until this file
    // exists and the direction is chosen. Its five pickers are not proof on their
    // own, so a half-answered brand does not count.
    appliesTo: () => true,
  },
]

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

// Which front door was taken. Wave 3.4 writes `entryPoint` to the config before
// anything else is scaffolded; older projects have no such field, so fall back
// to the artefacts and then to the documented default.
function resolveDoor(config, hasIngest) {
  const raw = String((config && (config.entryPoint || config.entry_point)) || '').toLowerCase()
  if (raw) {
    if (/exist|prototype|repo|adopt|ingest|brownfield|migrat/.test(raw)) return { door: 'existing', source: 'config' }
    if (/idea|greenfield|new|nothing|scratch|blank/.test(raw)) return { door: 'greenfield', source: 'config' }
  }
  if (hasIngest) return { door: 'existing', source: 'artefact' }
  return { door: 'greenfield', source: 'default' }
}

// An ADR, by either shipped naming convention (architect writes ADR-<n>-<slug>.md,
// ops writes NNNN-*.md). README.md is the index, not a decision.
function findAdrs(root) {
  const dir = join(root, 'docs', 'adr')
  if (!statSafe(dir)) return []
  return listSafe(dir)
    .filter((f) => /\.md$/i.test(f) && !/^readme\.md$/i.test(f) && !/^\.?gitkeep$/i.test(f))
    .filter((f) => /^adr[-_]/i.test(f) || /^\d{3,4}[-_]/.test(f))
    .filter((f) => fileSafe(join(dir, f)))
    .sort()
}

// The branch, without spawning git. A worktree's .git is a file pointing at the
// real gitdir, so follow it rather than reporting "no branch" in a worktree.
function gitBranch(root) {
  const dotGit = join(root, '.git')
  const s = statSafe(dotGit)
  if (!s) return null
  let gitDir = dotGit
  if (s.isFile()) {
    const pointer = readSafe(dotGit)
    const m = pointer && pointer.match(/^gitdir:\s*(.+)$/m)
    if (!m) return null
    const target = m[1].trim()
    gitDir = isAbsolute(target) ? target : resolve(root, target)
  }
  const head = readSafe(join(gitDir, 'HEAD'))
  if (!head) return null
  const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/m)
  if (ref) return ref[1].trim()
  const sha = head.trim()
  return /^[0-9a-f]{7,40}$/i.test(sha) ? `detached@${sha.slice(0, 7)}` : null
}

// Phases come from the plan's headings, the same `### Phase <N>: <name>` block
// the implementation-plan skill writes. A phase is COMPLETE when an artefact on
// disk says so, in this precedence:
//   1. docs/checkpoints/phase-<N>-close.json  the Wave 4 close record (authoritative)
//   2. docs/checkpoints/phase-<N>-acs.md      the verify-acs evidence ledger
// docs/checkpoints/phase-<N>.json is deliberately NOT a completion marker: the
// implementation-plan skill writes it at PLANNING time, so counting it would
// report an untouched project as fully built.
function parsePhases(root, planBody, planPresent) {
  const empty = { total: 0, done: 0, current: null, list: [], parsed: false }
  if (!planPresent) return empty
  if (planBody == null) return { ...empty, parsed: false }

  const seen = new Set()
  const list = []
  const re = /^[ \t]{0,3}#{1,6}[ \t]*Phase[ \t]+(\d+)[ \t]*[:–—-]?[ \t]*(.*)$/gim
  let m
  while ((m = re.exec(planBody)) !== null) {
    const n = Number(m[1])
    if (!Number.isFinite(n) || seen.has(n)) continue
    seen.add(n)
    list.push({ n, name: (m[2] || '').trim() })
  }
  list.sort((a, b) => a.n - b.n)

  const checkpoints = join(root, 'docs', 'checkpoints')
  for (const p of list) {
    const closeFile = join(checkpoints, `phase-${p.n}-close.json`)
    let closed = fileSafe(closeFile)
    if (closed) {
      // An explicit `"closed": false` is honoured; anything else counts the file
      // itself as the close record.
      const parsed = readJsonSafe(closeFile)
      if (!parsed.invalid && parsed.value && parsed.value.closed === false) closed = false
    }
    const verified = fileSafe(join(checkpoints, `phase-${p.n}-acs.md`))
    p.closed = closed
    p.verified = verified
    p.marker = closed ? `docs/checkpoints/phase-${p.n}-close.json` : verified ? `docs/checkpoints/phase-${p.n}-acs.md` : null
  }

  const done = list.filter((p) => p.closed || p.verified).length
  const first = list.find((p) => !p.closed && !p.verified)
  return { total: list.length, done, current: first ? first.n : null, list, parsed: true }
}

// The guide map is 7A's artefact and this file only ever CONSUMES it. Two copies
// in two repos is the drift this exercise exists to remove, so nothing here
// writes, patches or defaults it: when it is absent the kit spine answers alone.
function loadGuideMap(root) {
  const candidates = [
    process.env.BUILDER_KIT_GUIDE_MAP,
    join(root, 'docs', 'guides', 'guide-map.json'),
    join(PLUGIN_ROOT, 'guide-map.json'),
    join(PLUGIN_ROOT, 'scripts', 'guide-map.json'),
  ].filter(Boolean)
  for (const p of candidates) {
    if (!fileSafe(p)) continue
    const parsed = readJsonSafe(p)
    if (parsed.invalid) return { rows: [], steps: 0, source: p, invalid: true }
    const v = parsed.value
    // The hub's copy is `{ note, version, steps: 8, tracks: [...], pages: [...] }`
    // — note that `steps` is a COUNT there, not the array. Accept a bare array and
    // the other plausible container keys too, so this keeps working if 7A reshapes it.
    const rows = Array.isArray(v)
      ? v
      : [v && v.pages, v && v.guides, v && v.rows, v && v.steps].find((x) => Array.isArray(x)) || null
    if (!rows) return { rows: [], steps: 0, source: p, invalid: true }
    // How many STEPS the spine has, which is not how many rows the file has: the
    // hub map carries eight numbered steps plus two unnumbered reference pages.
    const declared = typeof (v && v.steps) === 'number' && v.steps > 0 ? v.steps : null
    const clean = rows.filter((r) => r && typeof r === 'object')
    const numbered = clean.filter((r) => typeof r.step === 'number').length
    return { rows: clean, steps: declared || numbered || clean.length, source: p, invalid: false }
  }
  return { rows: [], steps: 0, source: null, invalid: false }
}

// Which guide page serves which spine stage. An explicit table because the generic
// matching below is too loose against the real map: three different steps carry
// `/builder-kit:build`, so matching on the command alone lands the reader on
// "Shape it" while they are mid-phase. A key that 7A later renames falls through
// to the generic matcher and then to null — never to a confidently wrong page.
const GUIDE_KEYS = {
  scaffold: 'start-your-project',
  'ground-idea': 'shape-it',
  'idea-pack': 'shape-it',
  prd: 'shape-it',
  architecture: 'decide-and-plan',
  'design-system': 'decide-and-plan',
  plan: 'decide-and-plan',
  build: 'build-and-ship-your-first-slice',
  ship: 'build-and-ship-your-first-slice',
  operate: 'keep-going',
}

// Map the current spine stage onto a guide page: the table first, then the loose
// fallbacks, then null. It returns null rather than guessing, because a confident
// wrong page number is worse than no page number.
function matchGuide(map, stage, nextCommand, ctx) {
  if (!map.rows.length) return null
  const skill = String(nextCommand || '')
    .replace(/^\/builder-kit:/, '')
    .split(/\s+/)[0]
  const rows = map.rows
  // Phase 1 is the page that teaches shipping a first slice; from phase 2 on the
  // reader is running the plan, which is a different page and a different tier.
  let want = GUIDE_KEYS[stage.id]
  if (stage.id === 'build' && ctx.phases.current != null && ctx.phases.current > 1) want = 'run-the-plan'
  // The spine has moved on and the reader has not. Hold them on the page whose own
  // blocks are still open rather than printing a step number they never reached.
  if (ctx.shapeOpen) want = 'shape-it'
  const byName = (k) => rows.find((r) => String(r.key || '').toLowerCase() === k)
  const row =
    (want ? byName(want) : null) ||
    byName(stage.id) ||
    (skill ? rows.find((r) => typeof r.command === 'string' && r.command.includes(skill)) : null) ||
    rows.find((r) => String(r.slug || '').toLowerCase().includes(stage.id)) ||
    null
  if (!row) return null
  const of = map.steps || rows.length
  return {
    step: typeof row.step === 'number' ? row.step : null,
    of,
    key: line(row.key, 80),
    slug: line(row.slug, 120),
    title: line(row.title, 200),
    url: line(row.url, 300),
    source: map.source,
  }
}

// The phase CLAUDE.md claims to be on, or null. Deliberately strict: it accepts a
// number sitting right after the label ("Current phase: 2") or one the word "Phase"
// introduces ("Ready to build — Phase 1"), and nothing else. A loose match here
// reads "Complete -- All 6 phases built" as phase 6 and fires a stale-marker
// warning at a project that is finished. Missing a real marker costs one warning;
// inventing one sends the builder to the wrong step.
function declaredPhase(claudeMd) {
  if (!claudeMd) return null
  const lineWithLabel = claudeMd.split('\n').find((l) => /current phase/i.test(l))
  if (!lineWithLabel) return null
  const after = lineWithLabel.slice(lineWithLabel.toLowerCase().indexOf('current phase') + 'current phase'.length)
  const direct = after.match(/^[\s:*\-–—]*(\d+)\b/)
  if (direct) return Number(direct[1])
  const named = after.match(/\bphase\s+(\d+)\b/i)
  return named ? Number(named[1]) : null
}

// The newest thing a hook blocked. Claude Desktop renders nothing when a hook
// blocks (#66555), so an unread block looks exactly like a hang, which makes it
// the one piece of history worth surfacing on every status read.
function lastBlock(root) {
  const rel = '.claude/builder-kit/last-block.md'
  const p = join(root, '.claude', 'builder-kit', 'last-block.md')
  if (!fileSafe(p)) return null
  const body = readSafe(p)
  if (body == null) return { rel, reason: null }
  const hits = [...body.matchAll(/^\*\*Blocked:\*\*\s*(.+)$/gm)]
  return { rel, reason: hits.length ? line(hits[hits.length - 1][1]) : null }
}

// ---------------------------------------------------------------------------
// getState
// ---------------------------------------------------------------------------

function failed(root, code, message) {
  return {
    ok: false,
    error: { code, message, path: root },
    root,
    isBuilderKitProject: false,
    stage: 'unknown',
    stageLabel: 'Unknown',
    nextCommand: entry('setup', 'jiffi-doctor'),
    progress: { done: 0, total: SPINE.length },
    blockers: [{ id: code, severity: 'block', message, fix: 'Point the kit at a directory it can read, then run the command again.' }],
    step: { number: 0, total: SPINE.length },
    phases: { total: 0, done: 0, current: null, list: [], parsed: false },
    guide: null,
    door: 'greenfield',
    projectType: null,
    branch: null,
    notes: [],
  }
}

/**
 * Read the project's state from disk.
 *
 * @param {string} [root] project directory. Defaults to CLAUDE_PROJECT_DIR, then cwd.
 * @returns {object} the shape documented at the top of this file. Never throws.
 */
export function getState(root) {
  let dir
  try {
    dir = resolve(root || process.env.CLAUDE_PROJECT_DIR || process.cwd())
  } catch {
    return failed(String(root || ''), ERROR_CODES.ROOT_NOT_FOUND, 'Could not resolve a project directory.')
  }

  try {
    const s = statSafe(dir)
    if (!s) return failed(dir, ERROR_CODES.ROOT_NOT_FOUND, `No such directory: ${dir}`)
    if (!s.isDirectory()) return failed(dir, ERROR_CODES.ROOT_NOT_A_DIRECTORY, `Not a directory: ${dir}`)
    try {
      readdirSync(dir)
    } catch (e) {
      return failed(dir, ERROR_CODES.ROOT_UNREADABLE, `Cannot read ${dir}: ${(e && e.code) || 'unknown error'}`)
    }

    const P = (...parts) => join(dir, ...parts)
    const cfg = readJsonSafe(P('.claude', 'builder-kit.json'))
    // The four narrative artefacts are proved rather than merely counted, because they
    // are the four a scanner can stub. The ingest scan is counted with fileSafe on
    // purpose: it is a machine-written report of what IS there, so it is complete the
    // moment it exists and has no gaps to fill.
    const has = {
      config: cfg.present && !cfg.invalid,
      validation: proofSafe(P('docs', 'idea', 'validation.md')),
      ideaPack: proofSafe(P('docs', 'idea', 'idea-pack.md')),
      prd: proofSafe(P('docs', 'prd', 'prd.md')),
      checklist: fileSafe(P('docs', 'prd', 'acceptance-checklist.md')),
      designMaster: proofSafe(P('docs', 'design-system', 'MASTER.md')),
      plan: fileSafe(P('docs', 'implementation-plan.md')),
      deployment: fileSafe(P('docs', 'deployment.md')),
      ingest: fileSafe(P('docs', 'ingest', 'reception.md')) || fileSafe(P('docs', 'ingest', 'scan-report.md')),
      // The two shaping blocks the spine does not gate on (SHAPE_ARTEFACTS), plus
      // the page-spec index, which is the same hole one page later.
      wireframes: proofSafe(P('docs', 'wireframes', 'README.md')),
      brand: proofSafe(P('docs', 'brand', 'brand.md')),
      pageSpecs: proofSafe(P('docs', 'design-system', 'pages', 'README.md')),
    }
    // Named separately so the reason a step is still open can be SAID, not just acted
    // on. "docs/prd/prd.md is a stub" and "docs/prd/prd.md is missing" send a builder
    // to two different places.
    const stubs = [
      ['docs/idea/idea-pack.md', '/builder-kit:ingest (or /builder-kit:idea-pack)'],
      ['docs/prd/prd.md', '/builder-kit:prd'],
      ['docs/design-system/MASTER.md', '/builder-kit:design-system'],
    ]
      .filter(([rel]) => stubbedFile(P(...rel.split('/'))))
      .map(([rel, fill]) => ({ rel, fill }))

    const config = cfg.value || {}
    const projectType = typeof config.projectType === 'string' ? config.projectType : null
    const { door, source: doorSource } = resolveDoor(config, has.ingest)
    const adrs = findAdrs(dir)
    const planBody = has.plan ? readSafe(P('docs', 'implementation-plan.md')) : null
    const phases = parsePhases(dir, planBody, has.plan)

    const ctx = { has, adrs, phases, door }

    // The current stage is the FIRST step whose proof is missing. A later proof
    // appearing early (a hand-written deployment.md, say) does not skip the gap.
    let index = SPINE.findIndex((st) => !st.done(ctx))
    if (index === -1) index = SPINE.length - 1
    const stage = SPINE[index]

    // Which blocks of the shaping page have not run. Only evaluated once the PRD is
    // real, because both skills refuse to run before it, and an absence nobody could
    // have filled yet is not a skip.
    const shapeGaps = has.prd ? SHAPE_ARTEFACTS.filter((a) => a.appliesTo(projectType) && !has[a.key]) : []
    // Worth stopping for while the design system is not yet locked: THAT skill reads
    // docs/brand/ and styles the approved shapes, so until MASTER.md exists the
    // missing work still feeds something downstream. Once it exists the moment has
    // passed, and the gap drops to a note rather than nagging forever about work
    // that can no longer land anywhere.
    const shapeOpen = shapeGaps.length > 0 && (stage.id === 'architecture' || stage.id === 'design-system')
    ctx.shapeOpen = shapeOpen

    // The next command follows the reader, not the spine. Pointing at /architect here
    // is what marched people off the page: the catch-up in the build skill runs
    // whatever this names, so naming the next stage runs the next PAGE.
    const nextCommand = shapeOpen ? shapeGaps[0].command : stage.command(ctx)

    const map = loadGuideMap(dir)
    const guide = matchGuide(map, stage, nextCommand, ctx)

    const blockers = []
    const notes = []

    if (cfg.present && cfg.invalid) {
      blockers.push({
        id: 'CONFIG_INVALID',
        severity: 'block',
        message: '.claude/builder-kit.json is not valid JSON, so projectType, testCommand and entryPoint are all unreadable.',
        fix: 'Open .claude/builder-kit.json and fix the JSON, or delete it and re-run ' + entry('start', 'jiffi-init') + '.',
      })
    }

    for (const s of stubs) {
      blockers.push({
        id: 'ARTEFACT_IS_A_STUB',
        severity: 'warn',
        message: `${s.rel} exists but is still a placeholder, so the step it proves is not done.`,
        fix: `Run ${s.fill} to fill it. Do not treat the file's existence as the gate being passed.`,
      })
    }

    // A skipped shaping block is said out loud, either way. While it can still be
    // filled it is a blocker; after that it is a note, because a builder cannot be
    // asked to undo the design system to go back and pick a palette.
    for (const gap of shapeGaps) {
      if (shapeOpen) {
        blockers.push({
          id: 'SHAPE_STEP_SKIPPED',
          severity: 'warn',
          message: `${gap.rel} does not exist, so that block on the shaping page never ran. ${gap.consequence}`,
          fix: `Run ${gap.command}. It belongs before ${stage.command(ctx)}, which is the next page.`,
        })
      } else {
        notes.push(`${gap.rel} was never written, so ${gap.command} never ran`)
      }
    }

    // The same hole one page later: /builder-kit:page-specs is a block on the decide
    // and plan page with no spine step either. It runs AFTER the plan, which is
    // already inside the build stage, and nothing consults nextCommand there, so
    // this one is said rather than gated. Escalating it would stop a running build
    // loop over a document the loop does not read.
    if (has.plan && !has.pageSpecs) {
      notes.push('docs/design-system/pages/ has no index, so /builder-kit:page-specs never ran')
    }

    if (has.plan && planBody == null) {
      blockers.push({
        id: 'PLAN_UNREADABLE',
        severity: 'block',
        message: 'docs/implementation-plan.md exists but could not be read, so the phase count is unknown.',
        fix: 'Check the file permissions on docs/implementation-plan.md.',
      })
    } else if (has.plan && phases.total === 0) {
      blockers.push({
        id: 'PLAN_NO_PHASES',
        severity: 'block',
        message: 'docs/implementation-plan.md has no "### Phase <N>" headings, so no phase can be started or closed.',
        fix: 'Re-run /builder-kit:implementation-plan so every phase carries a numbered heading.',
      })
    }

    if (has.prd && !has.checklist) {
      blockers.push({
        id: 'CHECKLIST_MISSING',
        severity: 'warn',
        message: 'docs/prd/prd.md exists but docs/prd/acceptance-checklist.md does not, so nothing mechanical can verify a phase.',
        fix: 'Re-run /builder-kit:prd, which writes the flat checklist beside the PRD.',
      })
    }

    // Unticked acceptance criteria are the normal state mid-build and a hard stop
    // at the ship gate. Report the count either way, escalate only at the end.
    const checklistBody = has.checklist ? readSafe(P('docs', 'prd', 'acceptance-checklist.md')) : null
    const unticked = checklistBody ? (checklistBody.match(/^[ \t]*[-*][ \t]+\[[ \t]\]/gm) || []).length : 0
    if (unticked > 0) {
      if (stage.id === 'ship' || stage.id === 'operate') {
        blockers.push({
          id: 'ACS_UNTICKED',
          severity: 'block',
          message: `${unticked} acceptance criteri${unticked === 1 ? 'on is' : 'a are'} still unticked in docs/prd/acceptance-checklist.md.`,
          fix: 'Run /builder-kit:verify-acs and tick only what the evidence proves.',
        })
      } else {
        notes.push(`${unticked} acceptance criteri${unticked === 1 ? 'on' : 'a'} still unticked`)
      }
    }

    const block = lastBlock(dir)
    if (block) {
      blockers.push({
        id: 'LAST_BLOCK',
        severity: 'warn',
        message: `A builder-kit hook blocked something${block.reason ? `: ${block.reason}` : '.'}`,
        fix: `Read ${block.rel} and tell the user what it says. Delete the file once it is handled.`,
      })
    }

    // A stale "Current phase" marker is the classic trap: the file says 3, the
    // artefacts say 2, and everyone downstream trusts the file.
    const declared = declaredPhase(readSafe(P('CLAUDE.md')))
    if (declared != null && phases.current != null && declared !== phases.current) {
      blockers.push({
        id: 'PHASE_MARKER_STALE',
        severity: 'warn',
        message: `CLAUDE.md says phase ${declared}, the artefacts on disk say phase ${phases.current}. Disk wins.`,
        fix: 'Update the "Current phase" line in CLAUDE.md, or close the phase properly with /builder-kit:phase-complete.',
      })
    }

    // ingest is the documented continue-existing door; jiffi-adopt is the offline
    // repo scan that feeds it. Name the door as the next command and mention the
    // accelerator, rather than silently picking one of the two.
    if (door === 'existing' && !has.ingest && stage.id === 'ground-idea') {
      notes.push('an existing build: /builder-kit:jiffi-adopt scans the repo offline first, then hands to ingest')
    }
    if (map.invalid) notes.push(`guide map at ${map.source} could not be parsed, so guide step numbers are unavailable`)
    if (!has.config) notes.push('no .claude/builder-kit.json, so this is not a builder-kit project yet')
    if (doorSource === 'default') notes.push('no entryPoint recorded, assuming the greenfield door')

    return {
      ok: true,
      error: null,
      root: dir,
      isBuilderKitProject: has.config,
      stage: stage.id,
      stageLabel: stage.label,
      nextCommand,
      progress: { done: index, total: SPINE.length },
      blockers,
      step: { number: index + 1, total: SPINE.length },
      phases,
      guide,
      door,
      projectType,
      branch: gitBranch(dir),
      notes,
    }
  } catch (err) {
    // Belt and braces. Nothing above is supposed to be able to throw; if
    // something does, a named error beats a stack trace in a hook's stdout.
    return failed(dir, ERROR_CODES.ROOT_UNREADABLE, `Unexpected failure reading ${dir}: ${(err && err.message) || 'unknown error'}`)
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * The human block. Used by /builder-kit:status and by the SessionStart hook, so
 * the two can never describe the project differently.
 *
 * @param {object} state a value from getState()
 * @returns {string}
 */
export function formatState(state) {
  const L = []
  L.push('BUILDER-KIT STATUS')
  L.push(`Project:    ${state.root}`)

  if (!state.ok) {
    L.push(`Error:      ${state.error.code} — ${state.error.message}`)
    L.push(`Next:       ${state.nextCommand}`)
    return L.join('\n')
  }

  L.push(`Stage:      ${state.stage} — ${state.stageLabel}`)
  L.push(`Step:       ${state.step.number} of ${state.step.total}`)
  L.push(`Next:       ${state.nextCommand}`)

  const bits = [`${state.progress.done} of ${state.progress.total} steps proven`]
  if (state.phases.total > 0) bits.push(`phases ${state.phases.done} of ${state.phases.total} closed`)
  L.push(`Progress:   ${bits.join(' · ')}`)

  if (state.branch) L.push(`Branch:     ${state.branch}`)
  if (state.projectType) L.push(`Type:       ${state.projectType} (${state.door} door)`)

  if (state.guide) {
    const num = state.guide.step != null && state.guide.of ? `step ${state.guide.step} of ${state.guide.of}` : 'reference page'
    const where = state.guide.url || state.guide.slug
    L.push(`Guide:      ${num}${state.guide.title ? ` — ${state.guide.title}` : ''}${where ? ` (${where})` : ''}`)
  }

  if (!state.blockers.length) {
    L.push('Blockers:   none')
  } else {
    L.push('Blockers:')
    for (const b of state.blockers) {
      L.push(`  [${b.severity}] ${b.id} — ${b.message}`)
      if (b.fix) L.push(`            fix: ${b.fix}`)
    }
  }

  if (state.notes.length) L.push(`Notes:      ${state.notes.join('; ')}`)
  return L.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function explain() {
  const rows = SPINE.map((s, i) => `${String(i + 1).padStart(2)}. ${s.id.padEnd(14)} proven by: ${s.proves}`)
  return [
    'builder-kit state: the ten-step spine, read from disk.',
    '',
    ...rows,
    '',
    'The current stage is the first step whose proof is missing.',
    '',
    'Two shaping blocks have no spine step of their own, so they are checked separately.',
    'Skipping one holds the guide page open instead of advancing its step number:',
    ...SHAPE_ARTEFACTS.map((a) => `    ${a.rel.padEnd(27)} ${a.command}${a.appliesTo('agent') ? '' : ' (not on the agent track)'}`),
    '',
    `Error codes: ${Object.keys(ERROR_CODES).join(', ')}.`,
    'A non-builder-kit directory is NOT an error: it reports stage "scaffold" with isBuilderKitProject false.',
  ].join('\n')
}

function main(argv) {
  if (argv.includes('--explain')) {
    process.stdout.write(explain() + '\n')
    return 0
  }
  const json = argv.includes('--json')
  const rIdx = argv.indexOf('--root')
  // Either `--root <path>` or a bare positional. The value after `--root` is not
  // itself a candidate positional.
  const rootArg = rIdx !== -1 ? argv[rIdx + 1] : argv.find((a) => !a.startsWith('-'))
  const state = getState(rootArg)
  process.stdout.write((json ? JSON.stringify(state, null, 2) : formatState(state)) + '\n')
  return state.ok ? 0 : 1
}

/**
 * Compared through realpath on BOTH sides, which is the whole point.
 *
 * `import.meta.url` is already resolved, so on macOS it reads /private/var/...
 * while `process.argv[1]` carries what the caller typed, /var/... Those never
 * match, and the failure is silent: the script exits 0 and prints nothing, so
 * `/builder-kit:status` just says nothing at all. It bites anywhere a path
 * component is a symlink, which includes /tmp and /var on macOS and can include
 * the plugin cache directory itself.
 */
const invokedDirectly = (() => {
  try {
    if (!process.argv[1]) return false
    const self = realpathSync(fileURLToPath(import.meta.url))
    const invoked = realpathSync(process.argv[1])
    return self === invoked
  } catch {
    return false
  }
})()

if (invokedDirectly) process.exit(main(process.argv.slice(2)))
