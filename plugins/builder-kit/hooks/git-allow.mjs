#!/usr/bin/env node
// PreToolUse decision hook. Answers "allow" for the small set of Bash commands
// the build loop runs dozens of times a day, so the user is not asked to approve
// `git status` for the fortieth time. Everything else gets no answer at all,
// which leaves the normal permission flow exactly as it was.
//
// WHY A HOOK AND NOT AN allowed-tools / settings.json RULE: a plugin cannot ship
// permission rules (a plugin's own settings.json supports only `agent` and
// `subagentStatusLine`), and a path-baked rule such as
// Bash(node /Users/x/.claude/plugins/…/builder-kit/0.7.0/scripts/doctor.mjs:*)
// stops matching the moment the plugin version in that path changes, so every
// update silently re-prompts for everything. A hook that returns a decision has
// no path in it and survives the upgrade.
//
// THE DEFAULT IS "NO ANSWER", NOT "ALLOW". An allow decision bypasses the
// permission system outright, so the matcher is deliberately narrow and literal:
// - the command is split on &&, ||, ; and |, and EVERY segment must be in the set
// - a segment carrying a shell metacharacter that could smuggle a second command
//   (backtick, $, >, <, &, ;, |, backslash, newline) is never allowed
// - a segment carrying a destructive or guard-bypassing flag is never allowed,
//   which is why `git add -f` (stages ignored files, the classic way a key gets
//   committed), `git branch -D`, `git switch -f` and `git commit --no-verify`
//   all still prompt
// - git must be invoked as `git <subcommand>`, so -c, -C, --git-dir and friends
//   cannot be used to point the command at another repo or inject config
//
// Fails silent: any parse error, any unexpected payload, any exception at all
// exits 0 with no output. Failing this hook open means "ask the user", which is
// the state of the world without it.

const SAFE = [
  // The eight git verbs the loop actually needs. No push: that is network,
  // credentials and someone else's server, and it deserves a prompt.
  /^git\s+(status|diff|log|add|commit|switch|branch|restore)(\s|$)/,
  /^npm\s+test(\s|$)/,
  /^npm\s+run\s+build(\s|$)/,
  /^npm\s+ci(\s|$)/,
]

// Scripts, kept separate because they get the extra `..` check below.
const SAFE_NODE = [
  // the project's own scripts directory
  /^node\s+(\.\/)?scripts\/[A-Za-z0-9._-]+\.(mjs|cjs|js)(\s|$)/,
  // the plugin's scripts, at whatever version the path happens to carry today
  /^node\s+"?[^"'\s]*builder-kit[^"'\s]*\/scripts\/[A-Za-z0-9._-]+\.(mjs|cjs|js)"?(\s|$)/,
]

// After splitting on the shell operators, any of these left in a segment means
// the segment can still do something other than what it appears to do.
const SMUGGLE = /[`$><&;|\\]/

// Destructive, history-rewriting, or guard-bypassing. `--amend` is deliberately
// absent: it is local, and the shadow-ref autosave can recover from it. So is
// `-c`, because `git switch -c <branch>` is the loop's own branch command —
// config injection via a LEADING `git -c foo=bar …` is refused by the anchored
// `git <subcommand>` match above, not by this list.
// `--output` and `--edit` are here for a different reason to the rest: an allowed
// command that writes a file somewhere of its choosing (`git diff --output=~/.zshrc`)
// is a write primitive smuggled through a read verb, and one that opens $EDITOR
// hangs the turn on a vim nobody can see.
const DANGEROUS =
  /(^|\s)(-f|-d|-D|-e|--force|--force-with-lease|--hard|--delete|--no-verify|--exec|--edit|--output|--upload-pack|--receive-pack)(\s|=|$)/

// `git commit` with nothing to say opens an editor and waits forever. Accept the
// short-flag cluster forms too, because `git commit -am "…"` is what gets typed.
const COMMIT_HAS_MESSAGE = /(^|\s)(-[A-Za-z]*[mF]|--message|--file|--no-edit|--fixup|--squash)(\s|=|$)/

// Secret-shaped paths, named as an argument to ANY allowed verb. This exists
// because `git add .env` sits squarely inside the safe set above: secret-scan
// covers Write/Edit/MultiEdit and has no opinion about Bash, so an auto-allow here
// removes the one prompt a human would ever have seen before a key was staged.
// `git add -f` is already refused by DANGEROUS; this catches the case where the
// repo simply has no .gitignore, which is the default on a beginner's first repo.
// Placeholders are excluded, matching secret-scan: .env.example is a file people
// legitimately track.
const SECRET_PATH =
  /(^|[\s/"'=])\.?[^\s"']*(\.env(\.[A-Za-z0-9_-]+)?|\.pem|\.p12|\.pfx|\.keystore|id_rsa[^\s"']*|\.git-credentials)(["']|\s|$)/i
const PLACEHOLDER = /\.(example|sample|template|dist)(["']|\s|$)/i

// A bulk `git add` names no path, so the secret check above has nothing to read and
// what actually gets staged depends entirely on the repo's .gitignore. A project the
// kit scaffolded ignores .env; a repo brought in through `jiffi-adopt` may ignore
// nothing at all, and there `git add .` is how a key gets staged. This gets no answer,
// which simply restores the prompt. It costs the loop nothing: phase-complete already
// commits only the paths the phase touched and says never to `git add -A`.
function bulkAdd(seg) {
  const sub = (seg.match(/^git\s+([a-z-]+)/) || [])[1]
  if (sub !== 'add') return false
  const args = seg.split(/\s+/).slice(2)
  if (/(^|\s)(-[A-Za-z]*[Au]|--all|--update|--no-ignore-removal)(\s|=|$)/.test(seg)) return true
  const paths = args.filter((a) => !a.startsWith('-'))
  if (!paths.length) return true
  return paths.some((p) => ['.', './', '..', ':/', '*', '"*"'].includes(p))
}

function namesASecret(seg) {
  if (!SECRET_PATH.test(seg)) return false
  // Only the matched token decides, not the whole segment: `git add .env src/a.example`
  // must still be refused.
  return seg
    .split(/\s+/)
    .filter((tok) => SECRET_PATH.test(` ${tok}`))
    .some((tok) => !PLACEHOLDER.test(tok))
}

// Per-verb shapes that would sit there waiting for a human. `-p` is fine on log
// and diff (it is just a patch) and fatal on add, commit and restore (it is an
// interactive prompt on a stdin that does not exist).
function hangs(seg) {
  const sub = (seg.match(/^git\s+([a-z-]+)/) || [])[1]
  if (!sub) return false
  if (/^(add|commit|restore|switch)$/.test(sub) && /(^|\s)(-[A-Za-z]*p|--patch|-i|--interactive)(\s|=|$)/.test(seg)) return true
  if (sub === 'commit' && !COMMIT_HAS_MESSAGE.test(seg)) return true
  return false
}

function decide(command) {
  if (typeof command !== 'string') return null
  const cmd = command.trim()
  if (!cmd || cmd.length > 2000) return null
  if (/[\n\r]/.test(cmd)) return null

  const segments = cmd
    .split(/\s*(?:&&|\|\||;|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!segments.length) return null

  const matched = []
  for (const seg of segments) {
    if (SMUGGLE.test(seg)) return null
    if (DANGEROUS.test(seg)) return null
    if (namesASecret(seg)) return null
    if (bulkAdd(seg)) return null
    if (hangs(seg)) return null
    const isNode = SAFE_NODE.some((re) => re.test(seg))
    if (isNode) {
      if (seg.includes('..')) return null // no climbing out of the scripts directory
      matched.push(seg.split(/\s+/).slice(0, 2).join(' '))
      continue
    }
    const hit = SAFE.find((re) => re.test(seg))
    if (!hit) return null
    matched.push(seg.split(/\s+/).slice(0, 2).join(' '))
  }
  return matched
}

function respond(matched) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          `builder-kit: routine and recoverable (${matched.join(', ')}). ` +
          'Saving, inspecting and testing are the loop, and a snapshot of the working ' +
          'tree is kept on refs/worktree/builder-kit/autosave, so this is reversible.',
      },
    })}\n`,
  )
}

if (process.stdin.isTTY) process.exit(0) // nothing piped in, nothing to decide

let raw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (raw += c))
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw || '{}')
    if (input.tool_name && input.tool_name !== 'Bash') process.exit(0)
    const matched = decide((input.tool_input || {}).command)
    if (matched) respond(matched)
  } catch {
    /* say nothing, which means: ask the user, exactly as before */
  }
  process.exit(0)
})
