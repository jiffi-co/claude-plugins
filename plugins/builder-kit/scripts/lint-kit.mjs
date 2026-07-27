#!/usr/bin/env node
// Kit self-lint. Nine assertions over the plugin's OWN source, checking the
// things `claude plugin validate` is happy to accept while they quietly break
// at runtime. READ-ONLY: it changes nothing, it reports and sets an exit code.
// Pure Node, no dependency, like every other script in this directory.
//
// Why each assertion exists (the failure it catches is invisible otherwise):
//   1  A skill is invoked as /builder-kit:<skill-DIRECTORY-name>. The frontmatter
//      `name` is only an alias. The two can drift and nothing anywhere errors.
//   2  The kit used to state the opposite of its own invocation model. Banned
//      strings hold that line so the claim cannot come back.
//   3  A tool named in allowed-tools that does not exist resolves to nothing.
//      `Task` was renamed `Agent`; a skill still naming `Task` has no tool.
//   4  `claude plugin validate` accepts `context: banana` without a murmur, so a
//      typo silently degrades a forked skill to inline. Only this catches it.
//   5  A quoted path never matches the argv-rejoin matcher, and a versioned
//      ${CLAUDE_PLUGIN_ROOT} re-prompts the user after every plugin update.
//   6  guide-map.json has two copies in two repos. Drift there is the exact
//      failure the guide work exists to remove, one level up.
//   7  A description that gates on what the user SAYS cannot fire from project
//      state, which is why the loop cannot self-chain.
//   8  A core doctor check with no install recipe is a dead end: the tool is
//      required, the reader is told it is missing, and nothing tells them how to
//      get it. Either every platform carries a candidate, or the entry says in
//      writing why a machine cannot do it (an Apple ID, a licence acceptance).
//   9  An unquoted frontmatter value containing ": " is not valid YAML, and the
//      loader's response is to drop EVERY frontmatter field and load the skill
//      with empty metadata. No name, no description, so it never fires. Three
//      skills shipped in this state and every hand-rolled parser here read them
//      as fine, because a hand-rolled parser splits on the FIRST colon and a
//      YAML parser does not.
//
// Usage: node scripts/lint-kit.mjs [--json]
// Exit:  0 all assertions pass or skip, 1 one or more failed.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_ROOT = dirname(HERE)

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')

// --- Maintained lists -------------------------------------------------------

// Tools that exist in the current CLI. Maintain this by hand: it is the whole
// point of assertion 3. Adding a name here is a claim that the tool is real.
const ALLOWED_TOOLS = new Set([
  'Agent',
  'AskUserQuestion',
  'Bash',
  'BashOutput',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'KillShell',
  'NotebookEdit',
  'Read',
  'Skill',
  'SlashCommand',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
])

// Names that LOOK right and are not. The reason is printed, so the fix is
// obvious from the lint output alone.
const RETIRED_TOOLS = new Map([
  ['Task', 'renamed to Agent; `Task` resolves to nothing'],
  ['MultiEdit', 'removed; use Edit'],
  ['Batch', 'removed'],
])

// Every skill that MUST run in a forked context. `build-phase` is the mechanical
// span of one phase: it exists precisely because AskUserQuestion is stripped from
// every subagent, so the inline parent (`build`) keeps the questions and the fork
// keeps the work. If `context: fork` were ever lost or mistyped here, the worker
// would quietly run inline, inherit the parent's context window, and the split
// would be decorative. Nothing else in the toolchain notices that.
const FORKED_SKILLS = ['build-phase']

// Where the two guide-map copies live. The hub copy is canonical; the plugin's
// is generated at publish. Neither exists yet (built by 7A).
const HUB_GUIDE_MAP = join('docs', 'guides', 'guide-map.json')
const PLUGIN_GUIDE_MAP = join('scripts', 'guide-map.json')

// Assertion 2's banned strings. Most are plain literals. "plain language" is
// only banned in the INVOCATION sense, because the kit also uses the phrase
// legitimately (coach mode explains a decision in plain language), so it is
// flagged only when invocation vocabulary sits within CONTEXT_WINDOW characters.
const CONTEXT_WINDOW = 120
const INVOCATION_CONTEXT = /invoke|invoking|invocation|slash|by naming|naming it|name it|type it/i

const BANNED = [
  { id: 'never with a slash', re: /\bnever with a slash\b/i },
  { id: 'six real slash', re: /\bsix real slash/i },
  { id: 'six commands', re: /\bsix commands\b/i },
  { id: 'Task tool', re: /\btask tool\b/i },
  { id: 'Task/subagent', re: /\btask\/subagent\b/i },
]

// --- Small helpers ----------------------------------------------------------

function rel(abs) {
  return relative(PLUGIN_ROOT, abs) || abs
}

function walk(dir, keep) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p, keep))
    else if (keep(entry.name, p)) out.push(p)
  }
  return out
}

// Split a comma list without breaking inside parentheses or brackets, so
// `Bash(git status:*, git diff:*), Read` yields two entries, not three.
function splitTopLevel(s) {
  const parts = []
  let depth = 0
  let buf = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    else if (ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(buf)
      buf = ''
      continue
    }
    buf += ch
  }
  parts.push(buf)
  return parts.map((p) => p.trim()).filter(Boolean)
}

// Frontmatter as {key: {value, line}}, where `line` is 1-indexed in the file and
// `value` folds any continuation lines in. Returns null when there is no
// frontmatter block (run.sh already fails that case separately).
function frontmatter(lines) {
  if (!lines.length || lines[0].trim() !== '---') return null
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i
      break
    }
  }
  if (end === -1) return null
  const keys = {}
  let current = null
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^([A-Za-z][\w-]*):\s?(.*)$/)
    if (m) {
      current = m[1]
      keys[current] = { value: m[2].trim(), line: i + 1 }
    } else if (current && lines[i].trim()) {
      keys[current].value += `\n${lines[i].trim()}`
    }
  }
  return keys
}

// A tool list in any of the three shapes the kit uses:
//   [Read, Glob]            inline YAML array (skills)
//   Bash(node:*), Read      bare comma list (commands, agents)
//   - Read\n- Glob          block YAML list
function parseToolList(raw) {
  const v = raw.trim()
  if (!v) return []
  if (v.startsWith('[')) {
    const inner = v.replace(/^\[/, '').replace(/\]\s*$/, '')
    return splitTopLevel(inner)
  }
  if (/^-\s/m.test(v)) {
    return v
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim())
      .filter(Boolean)
  }
  return splitTopLevel(v)
}

// Canonical JSON: sorted keys, so a formatting difference is not read as drift.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

// Up to `limit` differing paths between two parsed JSON values.
function jsonDiff(a, b, path = '$', limit = 5, out = []) {
  if (out.length >= limit) return out
  const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)
  if (!bothObjects) {
    if (canonical(a) !== canonical(b)) out.push(path)
    return out
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
  for (const k of keys) {
    if (out.length >= limit) break
    const child = Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`
    if (!(k in a)) out.push(`${child} (missing in hub copy)`)
    else if (!(k in b)) out.push(`${child} (missing in plugin copy)`)
    else jsonDiff(a[k], b[k], child, limit, out)
  }
  return out
}

// The hub checkout above the plugin, or null when the plugin is standing alone
// (a published marketplace clone has no hub around it).
function findHubRoot() {
  let dir = PLUGIN_ROOT
  for (let i = 0; i < 6; i++) {
    const next = dirname(dir)
    if (next === dir) break
    dir = next
    if (existsSync(join(dir, 'docs')) && existsSync(join(dir, 'package.json'))) {
      try {
        if (statSync(join(dir, 'docs')).isDirectory()) return dir
      } catch {
        /* fall through and keep walking */
      }
    }
  }
  return null
}

// --- File sets --------------------------------------------------------------

const SKILL_DIRS = existsSync(join(PLUGIN_ROOT, 'skills'))
  ? readdirSync(join(PLUGIN_ROOT, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
  : []

const SKILL_FILES = walk(join(PLUGIN_ROOT, 'skills'), (n) => n === 'SKILL.md')
const COMMAND_FILES = walk(join(PLUGIN_ROOT, 'commands'), (n) => n.endsWith('.md'))
const AGENT_FILES = walk(join(PLUGIN_ROOT, 'agents'), (n) => n.endsWith('.md'))
const README_FILES = walk(PLUGIN_ROOT, (n) => /^readme.*\.md$/i.test(n))

const readLines = (f) => readFileSync(f, 'utf8').split(/\r?\n/)

// --- The seven assertions ---------------------------------------------------

function assertNameMatchesDirectory() {
  const failures = []
  for (const dir of SKILL_DIRS) {
    const file = join(PLUGIN_ROOT, 'skills', dir, 'SKILL.md')
    if (!existsSync(file)) {
      failures.push({ file: `skills/${dir}`, line: 0, detail: 'no SKILL.md in the skill directory' })
      continue
    }
    const fm = frontmatter(readLines(file))
    if (!fm || !fm.name) {
      failures.push({ file: rel(file), line: 1, detail: 'no frontmatter `name`' })
      continue
    }
    const declared = fm.name.value.replace(/^["']|["']$/g, '').trim()
    if (declared !== dir) {
      failures.push({
        file: rel(file),
        line: fm.name.line,
        detail: `name "${declared}" does not match directory "${dir}"; the directory is the invocation key (/builder-kit:${dir})`,
      })
    }
  }
  return { failures, checked: `${SKILL_DIRS.length} skill directories` }
}

function assertNoBannedStrings() {
  const files = [...SKILL_FILES, ...COMMAND_FILES, ...README_FILES]
  const failures = []
  for (const file of files) {
    const lines = readLines(file)
    lines.forEach((line, i) => {
      for (const b of BANNED) {
        const m = line.match(b.re)
        if (m) failures.push({ file: rel(file), line: i + 1, detail: `banned string "${b.id}": ...${excerpt(line, m.index)}...` })
      }
      const at = plainLanguageInvocationHit(line)
      if (at !== -1) {
        failures.push({
          file: rel(file),
          line: i + 1,
          detail: `banned string "plain language" in the invocation sense: ...${excerpt(line, at)}...`,
        })
      }
    })
  }
  return { failures, checked: `${files.length} SKILL.md, command and README files` }
}

function plainLanguageInvocationHit(line) {
  const re = /plain language/gi
  let m
  while ((m = re.exec(line)) !== null) {
    const from = Math.max(0, m.index - CONTEXT_WINDOW)
    const to = Math.min(line.length, m.index + m[0].length + CONTEXT_WINDOW)
    if (INVOCATION_CONTEXT.test(line.slice(from, to))) return m.index
  }
  return -1
}

function excerpt(line, at, width = 70) {
  const from = Math.max(0, at - 10)
  return line.slice(from, from + width).trim()
}

// Every file that declares tools, with the key it uses. Skills and commands use
// `allowed-tools`; agents use `tools`. Same failure mode, so both are checked.
function toolDeclarations() {
  const out = []
  for (const file of [...SKILL_FILES, ...COMMAND_FILES]) {
    const fm = frontmatter(readLines(file))
    if (fm && fm['allowed-tools']) out.push({ file, key: 'allowed-tools', ...fm['allowed-tools'] })
  }
  for (const file of AGENT_FILES) {
    const fm = frontmatter(readLines(file))
    if (fm && fm.tools) out.push({ file, key: 'tools', ...fm.tools })
  }
  return out
}

function assertToolsExist() {
  const decls = toolDeclarations()
  const mcpServers = declaredMcpServers()
  const failures = []
  let entries = 0
  for (const d of decls) {
    for (const raw of parseToolList(d.value)) {
      entries++
      const base = raw.replace(/\(.*\)\s*$/s, '').trim()
      if (base.startsWith('mcp__')) {
        const parts = base.split('__')
        if (parts.length < 3 || !parts[1] || !parts[2]) {
          failures.push({ file: rel(d.file), line: d.line, detail: `"${base}" is not a valid mcp__<server>__<tool> name` })
        } else if (mcpServers && !mcpServers.has(parts[1])) {
          failures.push({
            file: rel(d.file),
            line: d.line,
            detail: `"${base}" names MCP server "${parts[1]}", which the plugin's .mcp.json does not ship`,
          })
        }
        continue
      }
      if (RETIRED_TOOLS.has(base)) {
        failures.push({ file: rel(d.file), line: d.line, detail: `"${base}" is not a tool in the current CLI (${RETIRED_TOOLS.get(base)})` })
        continue
      }
      if (!ALLOWED_TOOLS.has(base)) {
        failures.push({
          file: rel(d.file),
          line: d.line,
          detail: `"${base}" is not in the maintained allowlist; add it to ALLOWED_TOOLS if the tool is real`,
        })
      }
    }
  }
  return { failures, checked: `${entries} tool entries across ${decls.length} files` }
}

function declaredMcpServers() {
  const p = join(PLUGIN_ROOT, '.mcp.json')
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'))
    return new Set(Object.keys(parsed.mcpServers || {}))
  } catch {
    return null
  }
}

function assertForkedSkillsDeclareFork() {
  const failures = []
  for (const name of FORKED_SKILLS) {
    const file = join(PLUGIN_ROOT, 'skills', name, 'SKILL.md')
    if (!existsSync(file)) {
      failures.push({ file: `skills/${name}/SKILL.md`, line: 0, detail: 'listed in FORKED_SKILLS but the skill does not exist' })
      continue
    }
    // The literal string, anchored to its own frontmatter line. A bare substring
    // test is not enough: `context: forkk` CONTAINS "context: fork" and is
    // exactly the typo this assertion exists to catch.
    const fm = frontmatter(readLines(file))
    const declared = fm && fm.context ? fm.context.value.replace(/^["']|["']$/g, '').trim() : null
    if (declared !== 'fork') {
      failures.push({
        file: rel(file),
        line: fm && fm.context ? fm.context.line : 1,
        detail: declared === null
          ? 'listed in FORKED_SKILLS but has no `context:` key, so it runs inline'
          : `listed in FORKED_SKILLS but declares context: "${declared}", not the literal "fork" (an unrecognised value degrades silently to inline)`,
      })
    }
  }
  const checked = FORKED_SKILLS.length
    ? `${FORKED_SKILLS.length} forked skill(s): ${FORKED_SKILLS.join(', ')}`
    : '0 forked skills (FORKED_SKILLS is empty)'
  return { failures, checked }
}

// Assertion 8. Read from the doctor's own tables rather than parsing its source:
// a regex over the file would keep passing after a refactor moved the recipes,
// and this is the assertion that is supposed to notice exactly that.
//
// The import is at module scope so the assertion body stays synchronous like the
// other seven. A doctor that cannot be imported FAILS here, it does not skip: an
// unloadable doctor is a broken install, and "we could not look" must never read
// the same as "we looked and it was fine".
let doctorModule = null
let doctorImportError = null
try {
  doctorModule = await import(new URL('./doctor.mjs', import.meta.url).href)
} catch (e) {
  doctorImportError = e && e.message ? e.message : String(e)
}

function assertCoreChecksAreInstallable() {
  if (!doctorModule || typeof doctorModule.installCoverage !== 'function') {
    return {
      failures: [
        {
          file: 'scripts/doctor.mjs',
          line: 0,
          detail: doctorImportError
            ? `could not be imported, so no install recipe could be read: ${doctorImportError}`
            : 'does not export installCoverage(), so the core-tier install recipes cannot be checked',
        },
      ],
    }
  }
  const coverage = doctorModule.installCoverage()
  const core = coverage.filter((c) => c.tier === 'core')
  if (!core.length) {
    return { failures: [{ file: 'scripts/doctor.mjs', line: 0, detail: 'no core-tier checks at all; the tier was renamed or the table is empty' }] }
  }
  const failures = []
  for (const c of core) {
    const missing = ['darwin', 'linux', 'win32'].filter((p) => !c.platforms[p])
    if (!missing.length) continue
    if (typeof c.manualReason === 'string' && c.manualReason.trim()) continue
    failures.push({
      file: 'scripts/doctor.mjs',
      line: 0,
      detail: `core check "${c.name}" has no install candidate for ${missing.join(', ')} and no install.manualReason saying why a machine cannot do it`,
    })
  }
  const withReason = core.filter((c) => (c.manualReason || '').trim()).length
  return {
    failures,
    checked: `${core.length} core checks (${core.length - withReason} with recipes on all three platforms, ${withReason} with a written manualReason)`,
  }
}

function assertBashRulesAreMatchable() {
  const decls = toolDeclarations()
  const failures = []
  let rules = 0
  for (const d of decls) {
    for (const raw of parseToolList(d.value)) {
      const m = raw.match(/^Bash\((.*)\)$/s)
      if (!m) continue
      rules++
      const inner = m[1]
      if (/["']/.test(inner)) {
        failures.push({
          file: rel(d.file),
          line: d.line,
          detail: `Bash rule contains a quote character: ${raw}. A quoted path never matches the argv-rejoin matcher`,
        })
      }
      if (inner.includes('CLAUDE_PLUGIN_ROOT')) {
        failures.push({
          file: rel(d.file),
          line: d.line,
          detail: `Bash rule contains CLAUDE_PLUGIN_ROOT: ${raw}. The path is versioned, so it re-prompts after every plugin update`,
        })
      }
    }
  }
  return { failures, checked: `${rules} Bash rules` }
}

function assertGuideMapParity() {
  const hubRoot = findHubRoot()
  const pluginCopy = join(PLUGIN_ROOT, PLUGIN_GUIDE_MAP)
  const pluginExists = existsSync(pluginCopy)

  if (!hubRoot) {
    return {
      failures: [],
      skip: `no hub checkout above the plugin, so the canonical copy is unreachable (plugin copy ${pluginExists ? 'present' : 'absent'})`,
    }
  }

  const hubCopy = join(hubRoot, HUB_GUIDE_MAP)
  const hubExists = existsSync(hubCopy)

  if (!hubExists && !pluginExists) {
    return { failures: [], skip: `neither ${HUB_GUIDE_MAP} nor the plugin's ${PLUGIN_GUIDE_MAP} exists yet (7A builds them)` }
  }
  if (hubExists !== pluginExists) {
    const present = hubExists ? `${hubRoot}/${HUB_GUIDE_MAP}` : rel(pluginCopy)
    const missing = hubExists ? rel(pluginCopy) : `${hubRoot}/${HUB_GUIDE_MAP}`
    return { failures: [{ file: missing, line: 0, detail: `exists as ${present} but not here; the two copies must be generated together` }] }
  }

  let hub
  let plug
  try {
    hub = JSON.parse(readFileSync(hubCopy, 'utf8'))
  } catch (e) {
    return { failures: [{ file: `${hubRoot}/${HUB_GUIDE_MAP}`, line: 0, detail: `invalid JSON: ${e.message}` }] }
  }
  try {
    plug = JSON.parse(readFileSync(pluginCopy, 'utf8'))
  } catch (e) {
    return { failures: [{ file: rel(pluginCopy), line: 0, detail: `invalid JSON: ${e.message}` }] }
  }
  if (canonical(hub) !== canonical(plug)) {
    const paths = jsonDiff(plug, hub)
    return {
      failures: [{ file: rel(pluginCopy), line: 0, detail: `diverges from the canonical hub copy at: ${paths.join(', ')}` }],
    }
  }
  return { failures: [], checked: 'hub and plugin guide-map.json match' }
}

// Exactly the regex the plan measures against, no case-insensitive flag.
const USER_PHRASING = /\buser (says|asks|wants)\b/

function assertDescriptionsDoNotGateOnPhrasing() {
  const failures = []
  for (const file of SKILL_FILES) {
    const fm = frontmatter(readLines(file))
    if (!fm || !fm.description) continue
    const m = fm.description.value.match(USER_PHRASING)
    if (m) {
      failures.push({
        file: rel(file),
        line: fm.description.line,
        detail: `description gates on user phrasing ("${m[0]}"); it must gate on project state so the loop can self-chain`,
      })
    }
  }
  return { failures, checked: `${SKILL_FILES.length} skill descriptions` }
}

// Assertion 9. The narrow, high-value slice of "is this valid YAML": a plain
// (unquoted) scalar may not contain ": ". YAML reads the second colon as another
// mapping key and the whole block fails, at which point the loader keeps the file
// and throws the metadata away — the skill loads nameless and never fires.
//
// Deliberately narrow. This is not a YAML parser and does not pretend to be one;
// `claude plugin validate` is the real oracle and run.sh calls it when the CLI is
// there. This exists so the failure is caught with no CLI, in a plain Node script,
// on the one shape that has actually bitten.
function assertFrontmatterIsParseableYaml() {
  const files = [...SKILL_FILES, ...COMMAND_FILES, ...AGENT_FILES]
  const failures = []
  let values = 0
  for (const file of files) {
    const lines = readLines(file)
    if (!lines.length || lines[0].trim() !== '---') continue
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') break
      const m = lines[i].match(/^([A-Za-z][\w-]*):\s(.*)$/)
      if (!m) continue
      const value = m[2].trim()
      if (!value) continue
      values++
      // A quoted scalar or an inline collection is already safe.
      if (/^["'[{]/.test(value)) continue
      const at = value.search(/:\s/)
      if (at === -1) continue
      failures.push({
        file: rel(file),
        line: i + 1,
        detail:
          `\`${m[1]}\` is an unquoted YAML scalar containing ": " (...${value.slice(Math.max(0, at - 30), at + 25)}...). ` +
          'The frontmatter block fails to parse and the file loads with EVERY field dropped. Wrap the value in double quotes.',
      })
    }
  }
  return { failures, checked: `${values} frontmatter values across ${files.length} files` }
}

// --- Run --------------------------------------------------------------------

const ASSERTIONS = [
  { n: 1, name: 'skill frontmatter `name` equals its directory name', run: assertNameMatchesDirectory },
  { n: 2, name: 'no banned invocation-model strings in SKILL.md, commands or READMEs', run: assertNoBannedStrings },
  { n: 3, name: 'every declared tool exists in the current CLI', run: assertToolsExist },
  { n: 4, name: 'every FORKED_SKILLS entry contains the literal "context: fork"', run: assertForkedSkillsDeclareFork },
  { n: 5, name: 'no Bash rule carries a quote character or CLAUDE_PLUGIN_ROOT', run: assertBashRulesAreMatchable },
  { n: 6, name: 'hub and plugin guide-map.json are identical', run: assertGuideMapParity },
  { n: 7, name: 'no skill description gates on user phrasing', run: assertDescriptionsDoNotGateOnPhrasing },
  { n: 8, name: 'every core doctor check carries install candidates or a written manualReason', run: assertCoreChecksAreInstallable },
  { n: 9, name: 'no frontmatter value is unquoted YAML that will fail to parse', run: assertFrontmatterIsParseableYaml },
]

const results = ASSERTIONS.map((a) => {
  let r
  try {
    r = a.run()
  } catch (e) {
    r = { failures: [{ file: 'lint-kit.mjs', line: 0, detail: `assertion threw: ${e.message}` }] }
  }
  const status = r.failures.length ? 'fail' : r.skip ? 'skip' : 'pass'
  return { n: a.n, name: a.name, status, note: r.skip || r.checked || '', failures: r.failures }
})

const failed = results.filter((r) => r.status === 'fail')
const skipped = results.filter((r) => r.status === 'skip')
const passed = results.filter((r) => r.status === 'pass')

if (asJson) {
  console.log(JSON.stringify({ ok: failed.length === 0, passed: passed.length, failed: failed.length, skipped: skipped.length, results }, null, 2))
} else {
  console.log(`builder-kit lint: ${ASSERTIONS.length} assertions, plugin root ${resolve(PLUGIN_ROOT)}\n`)
  for (const r of results) {
    const label = r.status.toUpperCase().padEnd(4)
    console.log(`  ${label}  ${r.n}  ${r.name}`)
    if (r.note) console.log(`          ${r.note}`)
    for (const f of r.failures) {
      const where = f.line ? `${f.file}:${f.line}` : f.file
      console.log(`          ${where}  ${f.detail}`)
    }
  }
  const totalFailures = failed.reduce((n, r) => n + r.failures.length, 0)
  console.log(
    `\n  ${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped` +
      (totalFailures ? ` (${totalFailures} findings)` : ''),
  )
}

process.exit(failed.length ? 1 : 0)
