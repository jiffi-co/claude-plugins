#!/usr/bin/env node
// Shadow-ref autosave. Writes a snapshot of the working tree to a ref that only
// this plugin ever reads, so that work is recoverable without the user ever
// learning what a commit is.
//
// THE ONE INVARIANT: the user's branch, index and working tree are byte-identical
// before and after this script runs. It writes exactly two things — loose objects,
// and refs/worktree/builder-kit/autosave. Nothing else. No branch is created, no
// merge is completed, no index is written, no file is checked out.
//
// Plumbing (all of it verified against git 2.50 in the six scenarios below):
//   GIT_INDEX_FILE=<gitdir>/builder-kit/index.<pid>   never .git/index
//   git read-tree HEAD
//   git add -A -- . ':(exclude)…'                     deny list as pathspec, not gitignore
//   git write-tree
//   git commit-tree <tree> -p <prev snapshot or HEAD>
//   git update-ref <ref> <new> <old>                  compare-and-swap
//
// Recovery is `git restore --source=refs/worktree/builder-kit/autosave -- <path>`,
// which works for untracked files too, because the snapshot tree contains them.
//
// WHY refs/worktree/ AND NOT refs/: ordinary refs are shared across linked
// worktrees, so a second worktree silently clobbers the first one's snapshots.
// refs/worktree/* is per-worktree. Proven, not assumed.
//
// THE REFUTED DESIGN, so nobody rebuilds it: the obvious version branches with
// `git switch -c work/<date>` and commits with `git add -A && git commit`. Tested,
// it commits literal <<<<<<< HEAD markers and completes a merge behind the user's
// back, it crashes on `git switch -c` during a conflicted merge, and on a repo with
// no commits yet it leaves a state where `main` never comes into existence. Using
// explicit paths instead of `add -A` fixes none of those three. Do not go back.
//
// SEVEN REFUSALS, wired ahead of the happy path. Losing a snapshot is fine.
// Corrupting somebody's repository is not.
//   1 not a git repo   2 bare repo        3 no commits yet (unborn HEAD)
//   4 mid-rebase       5 conflicted merge 6 detached HEAD    7 index.lock held
// Plus two size/secret guards. Every one of them exits 0 quietly: a hook that
// makes noise on a repo state it does not like reads as a broken plugin.
//
// NEVER exits non-zero, never writes to stdout unless asked (--print), and never
// reads stdin. It takes its event from --event=<name>, not from the hook payload,
// because a hook that blocks on a stdin that never closes hangs the turn.
//
// Usage (hook):  node autosave.mjs --event=PostToolUse
//                node autosave.mjs --event=SessionEnd     (flush, skips the debounce)
// Usage (human): node autosave.mjs --print [--force] [--root <dir>]

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync, readdirSync, rmSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

const REF = 'refs/worktree/builder-kit/autosave'

// Paths that must never enter a snapshot, applied as git pathspec exclusions
// rather than as a gitignore file. This matters: a repo .gitignore containing
// `!.env` beats core.excludesFile (proven), but nothing beats a pathspec, and
// core.excludesFile would also override the user's own global excludes, which
// could pull MORE into the snapshot than their own `git status` shows.
//
// EVERY PATTERN STARTS WITH `*`, AND THAT IS NOT COSMETIC. An exclude pathspec
// that begins with a literal directory name counts as explicitly naming that
// directory, so `:(exclude).next/*` against a repo whose .gitignore contains
// `.next` makes the whole `git add` die with "the following paths are ignored by
// one of your .gitignore files", and every snapshot on that repo silently becomes
// a no-op. Found on a real Next.js repo, not in theory. The `*` prefix costs a
// slightly broader match (`app.env` as well as `.env`) and buys an add that works.
const DENY = [
  '*node_modules/*',
  '*.venv/*',
  '*__pycache__/*',
  '*.next/*',
  '*.env',
  '*.env.*',
  '*.pem',
  '*.p12',
  '*.pfx',
  '*id_rsa*',
  '*.keystore',
  '*.git-credentials',
  '*.DS_Store',
].map((p) => `:(exclude)${p}`)

// Second line of defence. If a path matching this ends up staged anyway (a
// pathspec typo, a case we did not think of), it is dropped from the temp index
// before the tree is written, and the drop is logged. Placeholder files are
// deliberately NOT denied, matching what secret-scan.mjs already allows through:
// a repo that tracks .env.example should keep it in its snapshots.
const DENY_RE =
  /(^|\/)(\.env(\.(?!(example|sample|template|dist)$)[A-Za-z0-9_.-]+)?|\.git-credentials|id_rsa[^/]*|[^/]*\.(pem|p12|pfx|keystore))$/i

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
const DEBOUNCE_MS = num(process.env.BUILDER_KIT_AUTOSAVE_DEBOUNCE_MS, 20000)
const MAX_SNAPSHOTS = num(process.env.BUILDER_KIT_AUTOSAVE_MAX, 200)
const KEEP_SNAPSHOTS = Math.max(1, Math.min(num(process.env.BUILDER_KIT_AUTOSAVE_KEEP, 100), MAX_SNAPSHOTS - 1))
// Untracked bytes above this and we stand down rather than pull a media library
// or an unignored build dir into the object store.
const BYTE_BUDGET = num(process.env.BUILDER_KIT_AUTOSAVE_MAX_BYTES, 100 * 1024 * 1024)
const FILE_BUDGET = num(process.env.BUILDER_KIT_AUTOSAVE_MAX_FILES, 20000)

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const withEq = argv.find((a) => a.startsWith(`${f}=`))
  if (withEq) return withEq.slice(f.length + 1)
  const i = argv.indexOf(f)
  return i !== -1 ? argv[i + 1] : null
}
const PRINT = has('--print')
const EVENT = val('--event') || 'manual'
// The flush events fire once per session or per milestone, so the debounce that
// protects a per-keystroke event would only lose the most valuable snapshot.
const FORCE = has('--force') || ['SessionEnd', 'PreCompact', 'TaskCompleted', 'Stop', 'SessionStart'].includes(EVENT)

let root = val('--root') || process.cwd()
let logPath = null

function sh(args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: opts.cwd || root,
    env: opts.env || process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  })
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    raw: r.stdout || '',
    err: (r.stderr || '').trim(),
  }
}

function log(line) {
  if (!logPath) return
  try {
    // A log that grows without bound is its own bug. Past the cap, start again.
    if (existsSync(logPath) && statSync(logPath).size > 256 * 1024) rmSync(logPath, { force: true })
    appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`)
  } catch {
    /* the log is a convenience, never a reason to fail */
  }
}

// Single exit point. status is one of: snapshot | skip | refuse.
function finish(status, reason, extra = {}) {
  log(`${status} event=${EVENT} ${reason}${extra.commit ? ` commit=${extra.commit}` : ''}`)
  if (PRINT) process.stdout.write(`${JSON.stringify({ status, reason, ref: REF, ...extra })}\n`)
  process.exit(0)
}

try {
  // ---------------------------------------------------------------- refusals
  // Order is deliberate: cheapest and most fundamental first, so that a
  // non-repo never runs a second git command.

  // 1. Not a git repo. Never `git init` a rescue repo — a nested repo inside
  //    another repo is a trap that takes weeks to notice.
  let inside = sh(['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok && process.env.CLAUDE_PROJECT_DIR && process.env.CLAUDE_PROJECT_DIR !== root) {
    // A hook can fire with a cwd that is not the project. Try the project dir once.
    root = process.env.CLAUDE_PROJECT_DIR
    inside = sh(['rev-parse', '--is-inside-work-tree'])
  }

  // 2. Bare repo. No working tree to snapshot, and `add` would be meaningless.
  //    Checked before the work-tree answer because a bare repo answers "false"
  //    to the question above and would otherwise be reported as "not a repo".
  const bare = sh(['rev-parse', '--is-bare-repository'])
  if (bare.ok && bare.out === 'true') finish('refuse', 'bare repository, there is no working tree to snapshot')
  if (!inside.ok || inside.out !== 'true') finish('refuse', 'not inside a git working tree')

  const top = sh(['rev-parse', '--show-toplevel'])
  if (!top.ok || !top.out) finish('refuse', 'could not resolve the repository root')
  root = top.out

  // --git-dir, not --git-common-dir: in a linked worktree the private dir is the
  // one that holds this worktree's HEAD, index, MERGE_HEAD and refs/worktree/*.
  const gd = sh(['rev-parse', '--absolute-git-dir'])
  if (!gd.ok || !gd.out) finish('refuse', 'could not resolve the git directory')
  const gitDir = gd.out
  const workDir = join(gitDir, 'builder-kit')
  try {
    mkdirSync(workDir, { recursive: true })
    logPath = join(workDir, 'autosave.log')
  } catch {
    logPath = null
  }

  const gitPath = (name) => {
    const p = sh(['rev-parse', '--git-path', name]).out
    if (!p) return null
    return isAbsolute(p) ? p : join(root, p)
  }

  // 3. No commits yet (unborn HEAD). A repo whose first commit does not exist is
  //    the state the refuted design corrupted, and it is one `git commit` away
  //    from being snapshot-able, so standing down costs almost nothing.
  const head = sh(['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (!head.ok || !head.out) finish('refuse', 'no commits yet (unborn HEAD), nothing to anchor a snapshot to')

  // 4. Mid-rebase. Both backends, both directory names. This is checked BEFORE
  //    the detached-HEAD test on purpose: a stopped rebase also detaches HEAD
  //    (verified), so testing detachment first would report every rebase as a
  //    detached head and hide the real reason. That conflation is precisely the
  //    bug that let the refuted prototype look like it handled rebase.
  for (const d of ['rebase-merge', 'rebase-apply']) {
    const p = gitPath(d)
    if (p && existsSync(p)) finish('refuse', `a rebase is in progress (${d} exists)`)
  }

  // 5. Conflicted merge, cherry-pick, revert or bisect in progress.
  for (const [file, label] of [
    ['MERGE_HEAD', 'a merge is in progress'],
    ['CHERRY_PICK_HEAD', 'a cherry-pick is in progress'],
    ['REVERT_HEAD', 'a revert is in progress'],
    ['BISECT_LOG', 'a bisect is in progress'],
  ]) {
    const p = gitPath(file)
    if (p && existsSync(p)) finish('refuse', `${label} (${file} exists)`)
  }

  // 6. Detached HEAD. The user is mid-something deliberate — inspecting an old
  //    commit, part-way through a bisect — and this is not the moment to be
  //    adding refs on their behalf.
  const sym = sh(['symbolic-ref', '--quiet', 'HEAD'])
  if (!sym.ok || !sym.out) finish('refuse', 'HEAD is detached')
  const branch = sym.out.replace(/^refs\/heads\//, '')

  // 7. Someone holds the index lock. Our temp index means we would not actually
  //    collide, but the lock says another git process is mid-write on this repo,
  //    and adding object writes underneath it is a gamble with no upside.
  const lock = gitPath('index.lock')
  if (lock && existsSync(lock)) finish('refuse', 'another git process holds index.lock')

  // -------------------------------------------------------------- debounce
  const stamp = join(workDir, 'autosave.stamp')
  if (!FORCE && existsSync(stamp)) {
    const age = Date.now() - statSync(stamp).mtimeMs
    if (age < DEBOUNCE_MS) finish('skip', `debounced, last snapshot ${Math.round(age / 1000)}s ago`)
  }

  // ------------------------------------------------------------ size guard
  // Cheap because it stops counting the moment it is over budget.
  const lsUntracked = sh(['ls-files', '-o', '--exclude-standard', '-z', '--', '.', ...DENY])
  if (lsUntracked.ok && lsUntracked.raw) {
    const files = lsUntracked.raw.split('\0').filter(Boolean)
    if (files.length > FILE_BUDGET) {
      finish('refuse', `${files.length} untracked files exceeds the ${FILE_BUDGET} file budget`)
    }
    let bytes = 0
    for (const f of files) {
      try {
        bytes += statSync(join(root, f)).size
      } catch {
        /* raced with a delete; it simply does not count */
      }
      if (bytes > BYTE_BUDGET) {
        finish('refuse', `untracked files exceed the ${Math.round(BYTE_BUDGET / 1024 / 1024)}MB budget`)
      }
    }
  }

  // ------------------------------------------------------------ happy path
  // Clear temp indexes abandoned by a killed run. Ours is per-pid so this can
  // never delete a live one belonging to a concurrent session.
  try {
    for (const f of readdirSync(workDir)) {
      if (!f.startsWith('index.')) continue
      const p = join(workDir, f)
      if (Date.now() - statSync(p).mtimeMs > 60 * 60 * 1000) rmSync(p, { force: true })
    }
  } catch {
    /* hygiene only */
  }

  const tmpIndex = join(workDir, `index.${process.pid}`)
  const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
  // commit-tree needs an identity. Give it one that is unmistakably the kit's,
  // and never write to the user's git config to get it. If they already have an
  // identity configured, theirs wins.
  const cfgEmail = sh(['config', '--get', 'user.email'])
  if (!cfgEmail.ok || !cfgEmail.out) {
    env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 'builder-kit autosave'
    env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 'autosave@builder-kit.local'
  }

  const cleanup = () => {
    try {
      rmSync(tmpIndex, { force: true })
      rmSync(`${tmpIndex}.lock`, { force: true })
    } catch {
      /* nothing depends on this */
    }
  }

  try {
    const rt = sh(['read-tree', 'HEAD'], { env })
    if (!rt.ok) {
      cleanup()
      finish('skip', `read-tree failed: ${rt.err.split('\n')[0] || 'unknown'}`)
    }

    const add = sh(['add', '-A', '--', '.', ...DENY], { env })
    if (!add.ok) {
      cleanup()
      finish('skip', `add failed: ${add.err.split('\n')[0] || 'unknown'}`)
    }

    // Verify the deny list actually held rather than trusting that it did. A
    // guard nobody checks looks identical to a guard that silently stopped working.
    const staged = sh(['diff', '--cached', '--name-only', 'HEAD'], { env })
    if (staged.ok && staged.out) {
      const leaked = staged.out.split('\n').filter((p) => DENY_RE.test(p))
      for (const p of leaked) {
        sh(['update-index', '--force-remove', '--', p], { env })
        log(`dropped ${p} from the snapshot: it matches the deny list`)
      }
    }

    const tree = sh(['write-tree'], { env })
    if (!tree.ok || !tree.out) {
      cleanup()
      finish('skip', `write-tree failed: ${tree.err.split('\n')[0] || 'unknown'}`)
    }

    const tipRef = sh(['rev-parse', '--verify', '--quiet', REF])
    const tip = tipRef.ok ? tipRef.out : ''
    // Identical tree means nothing to record. Without this the chain grows a
    // commit every time the model reads a file.
    if (tip) {
      const tipTree = sh(['rev-parse', '--verify', '--quiet', `${REF}^{tree}`])
      if (tipTree.ok && tipTree.out === tree.out) {
        cleanup()
        try {
          writeFileSync(stamp, new Date().toISOString())
        } catch {
          /* the stamp is a debounce hint, not state */
        }
        finish('skip', 'no change since the last snapshot')
      }
    }

    const iso = new Date().toISOString()
    const message =
      `autosave ${iso} on ${branch}\n\n` +
      'Snapshot written by builder-kit. Your branch, index and working tree were\n' +
      'not touched. To get a file back:\n' +
      `  git restore --source=${REF} -- <path>\n`
    const parent = tip || head.out
    const made = sh(['commit-tree', tree.out, '-p', parent, '-m', message], { env })
    if (!made.ok || !made.out) {
      cleanup()
      finish('skip', `commit-tree failed: ${made.err.split('\n')[0] || 'unknown'}`)
    }

    // Compare-and-swap. An empty old value means "this ref must not exist yet",
    // so a second session that beat us to it loses this snapshot rather than
    // overwriting theirs.
    const upd = sh(['update-ref', REF, made.out, tip])
    if (!upd.ok) {
      cleanup()
      finish('skip', 'another session updated the snapshot ref first')
    }

    try {
      writeFileSync(stamp, iso)
    } catch {
      /* debounce hint only */
    }
    cleanup()

    // Refs are gc roots, so an uncapped chain keeps every snapshot forever.
    // Trim by rebuilding the newest KEEP commits onto a fresh root; the ones
    // that fall off become unreachable and git reclaims them in its own time.
    // Anything that goes wrong here costs the trim, never the snapshot.
    try {
      const count = Number(sh(['rev-list', '--count', REF]).out)
      if (Number.isFinite(count) && count > MAX_SNAPSHOTS) {
        const keep = sh(['rev-list', '-n', String(KEEP_SNAPSHOTS), REF]).out.split('\n').filter(Boolean)
        let parentSha = null
        for (const sha of keep.reverse()) {
          const t = sh(['rev-parse', `${sha}^{tree}`])
          const m = sh(['log', '-1', '--format=%B', sha])
          if (!t.ok || !t.out) {
            parentSha = null
            break
          }
          const args = ['commit-tree', t.out]
          if (parentSha) args.push('-p', parentSha)
          args.push('-m', m.raw || 'autosave')
          const c = sh(args, { env })
          if (!c.ok || !c.out) {
            parentSha = null
            break
          }
          parentSha = c.out
        }
        if (parentSha && sh(['update-ref', REF, parentSha, made.out]).ok) {
          log(`trimmed the snapshot chain from ${count} to ${KEEP_SNAPSHOTS}`)
        }
      }
    } catch {
      /* the trim is housekeeping */
    }

    finish('snapshot', `saved ${branch}`, { commit: made.out })
  } catch (e) {
    cleanup()
    finish('skip', `unexpected: ${(e && e.message) || 'error'}`)
  }
} catch (e) {
  // The outermost net. An autosave that crashes a turn is worse than an autosave
  // that missed one.
  try {
    log(`skip event=${EVENT} unexpected: ${(e && e.message) || 'error'}`)
  } catch {
    /* nothing left to try */
  }
  if (PRINT) process.stdout.write(`${JSON.stringify({ status: 'skip', reason: 'unexpected error', ref: REF })}\n`)
  process.exit(0)
}
