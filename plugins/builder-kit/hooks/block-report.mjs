// builder-kit block visibility.
//
// Both blocking hooks (secret-scan, stop-test-gate) call reportBlock() immediately
// before their exit-2 path. It does two things: it writes the block to a file a
// human can open, and it returns the stderr string the hook prints for the model.
//
// Why the file has to exist: in the Claude Code panel of Claude Desktop a blocked
// turn renders NOTHING (anthropics/claude-code#66555, corroborated by #73525 and
// #78266). The hook fires, the block takes effect, and the user sees a turn that
// went quiet. Without a written record, and an instruction telling the model to
// read it out, a block is indistinguishable from a hang, and the reasonable
// conclusion is that the kit is broken.
//
// The contract, and the reason this is its own file: reportBlock NEVER throws and
// NEVER exits. The caller owns its exit code. Every filesystem step is best-effort
// and the returned message does not depend on any of them succeeding, so a
// reporting failure can never turn a block into a pass, or a pass into a block.

import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// The path quoted in every message. Relative, because that is how a user will type it.
export const BLOCK_LOG_REL = '.claude/builder-kit/last-block.md'

// Bound the file so `cat` stays useful. Entries are a few hundred bytes; a long
// session against a red suite would otherwise write hundreds of them.
const MAX_BYTES = 64 * 1024

const HEADER =
  '# builder-kit: blocked actions\n\n' +
  'Written by a builder-kit hook every time it blocks something, newest last. Safe to delete.\n'

// This file lives at <plugin>/hooks/block-report.mjs, so the plugin root is one up.
const PLUGIN_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url))) + sep

// Coerce to a single line. Callers interpolate values the model chose (a file path,
// a test command), and a newline in one of those would break the entry's shape and
// let a crafted path forge a `##` heading in the log.
function str(v) {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v)
  return s.replace(/\s*[\r\n]+\s*/g, ' ').trim()
}

// A local stamp with its UTC offset. Deliberately not toISOString(): a builder in
// Melbourne reading "T04:32Z" against a 14:32 clock assumes the entry is stale.
function stamp(d = new Date()) {
  const p = (n) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const time = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  return `${date} ${time} ${off < 0 ? '-' : '+'}${p(off / 60)}:${p(off % 60)}`
}

function sizeOf(file) {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

// Where the log goes. The harness's project dir is authoritative; an explicit root
// (the hook payload's cwd) is the next best signal; the working directory is last.
export function projectRoot(explicit) {
  return str(process.env.CLAUDE_PROJECT_DIR) || str(explicit) || process.cwd()
}

// The plugin's own directory is not a project. Running the kit against itself is a
// test or a dev invocation, and writing a log there pollutes the tree that gets
// published to the marketplace.
function insidePlugin(root) {
  const dir = resolve(root) + sep
  return dir === PLUGIN_ROOT || dir.startsWith(PLUGIN_ROOT)
}

/**
 * Record a deliberate block and build the message the hook should print.
 *
 * @param {object} o
 * @param {string} o.hook    which hook blocked, e.g. 'secret-scan'
 * @param {string} [o.stopId] a rule id the block cites, e.g. 'C-SEC'. Omit when the
 *                            block is a project gate rather than a registry stop.
 * @param {string} o.reason  what was blocked and why, one or two sentences
 * @param {string} [o.remedy] what the model or the user should do instead
 * @param {string} [o.root]  project root override (hooks pass the payload's cwd)
 * @returns {string} the stderr text to write. Never throws.
 */
export function reportBlock({ hook, stopId, reason, remedy, root } = {}) {
  let name = 'builder-kit'
  let id = ''
  let why = 'A builder-kit hook blocked this action.'
  let fix = ''
  let record = ''

  try {
    name = str(hook) || name
    id = str(stopId)
    why = str(reason) || why
    fix = str(remedy)

    const dir = projectRoot(root)
    if (insidePlugin(dir)) {
      record = `Not recorded to \`${BLOCK_LOG_REL}\`: this ran inside the plugin directory, not a project.`
    } else {
      const logDir = resolve(dir, '.claude', 'builder-kit')
      const file = resolve(logDir, 'last-block.md')
      mkdirSync(logDir, { recursive: true })
      const when = stamp()
      let prefix = ''
      if (!existsSync(file)) {
        prefix = HEADER
      } else if (sizeOf(file) > MAX_BYTES) {
        writeFileSync(file, `${HEADER}\nEarlier entries trimmed on ${when}.\n`, 'utf8')
      }
      const entry =
        `\n## ${name}${id ? ` (${id})` : ''} at ${when}\n\n` +
        `**Blocked:** ${why}\n` +
        (fix ? `\n**What to do:** ${fix}\n` : '')
      appendFileSync(file, prefix + entry, 'utf8')
      record = `Recorded at \`${BLOCK_LOG_REL}\`.`
    }
  } catch {
    // Best-effort by design. Say so rather than pointing the model at a file that
    // may not be there: a message that claims a record it does not have is the
    // failure mode this whole file exists to stop.
    record = `Could not write \`${BLOCK_LOG_REL}\`, so this message is the only record of the block.`
  }

  const wrote = record.startsWith('Recorded')
  const out = [`BLOCKED by builder-kit (${name}${id ? ` / ${id}` : ''}).`, '', why]
  if (fix) out.push('', fix)
  out.push('', record, '')
  out.push(
    'Do not retry this quietly and do not route around it. In your reply, tell the user ' +
      'what was blocked and why' +
      (wrote ? `, quoting the newest entry in \`${BLOCK_LOG_REL}\`` : '') +
      '. In the Claude Code panel of Claude Desktop a blocked turn renders nothing at all, ' +
      'so unless you say it the user sees a hang rather than a block.',
  )
  return out.join('\n') + '\n'
}
