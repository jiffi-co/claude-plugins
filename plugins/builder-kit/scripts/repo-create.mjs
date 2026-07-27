#!/usr/bin/env node
// Creates the private GitHub repository the project is missing, and points the
// local repo at it. Without this, "your work is backed up to a private repo you
// own" has no mechanism behind it, and `ship` pushes at an `origin` that nothing
// ever created (`fatal: 'origin' does not appear to be a git repository`).
//
// Usage:
//   node repo-create.mjs [name] [--yes] [--no-push] [--json] [--root <dir>]
//
// It will NOT create anything without --yes. Creating an account-level resource
// behind someone's back is the one thing this script must never do, and the skill
// that calls it is the only thing in the kit that can ask a question (a forked
// subagent has no AskUserQuestion), so the question lives up there and the answer
// arrives here as --yes.
//
// Exit codes: 0 = the repo now has an origin, or a plan was printed.
//             1 = blocked, with a plain-language reason and the one command that
//                 unblocks it. Never a stack trace: `gh` missing or signed out is
//                 an ordinary Tuesday, not a crash.

import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const val = (f) => {
  const withEq = argv.find((a) => a.startsWith(`${f}=`))
  if (withEq) return withEq.slice(f.length + 1)
  const i = argv.indexOf(f)
  return i !== -1 ? argv[i + 1] : null
}

const JSON_OUT = has('--json')
const YES = has('--yes')
const NO_PUSH = has('--no-push')
const rootArg = val('--root')
const nameArg = argv.find((a, i) => !a.startsWith('-') && argv[i - 1] !== '--root')

let root = rootArg || process.cwd()

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  })
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    missing: !!(r.error && r.error.code === 'ENOENT'),
  }
}
const git = (args, opts) => run('git', args, opts)

function done(status, message, extra = {}) {
  if (JSON_OUT) process.stdout.write(`${JSON.stringify({ status, message, ...extra })}\n`)
  else console.log(message)
  process.exit(0)
}

function blocked(status, message, fix) {
  if (JSON_OUT) process.stdout.write(`${JSON.stringify({ status, message, fix })}\n`)
  else {
    console.error(`\n${message}`)
    if (fix) console.error(`\n${fix}`)
  }
  process.exit(1)
}

try {
  // ------------------------------------------------------------ the local repo
  const bare = git(['rev-parse', '--is-bare-repository'])
  if (bare.ok && bare.out === 'true') {
    blocked('bare', 'This folder is a bare git repository, so there is no project here to back up.', null)
  }
  const inside = git(['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || inside.out !== 'true') {
    blocked(
      'not-a-repo',
      `There is no git repository at ${root}, so there is nothing to connect to GitHub yet.`,
      'Run /builder-kit:setup first, or `git init -b main` if you are wiring an existing folder by hand.',
    )
  }
  root = git(['rev-parse', '--show-toplevel']).out || root

  // Already connected. Idempotent on purpose: this runs from a skill that may be
  // re-run, and re-running must be boring.
  const origin = git(['remote', 'get-url', 'origin'])
  if (origin.ok && origin.out) {
    done('exists', `Already backed up to ${origin.out}\nNothing to do.`, { remote: origin.out })
  }

  // ------------------------------------------------------------------- the name
  const raw = nameArg || basename(root)
  const name = raw
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, 100)
  if (!name) {
    blocked('bad-name', `"${raw}" cannot be used as a repository name.`, 'Pass one explicitly: node repo-create.mjs my-project --yes')
  }

  // Push needs a commit and a branch to push. init.mjs always makes a scaffold
  // commit, so this only bites a folder that was `git init`ed by hand.
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'])
  const branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const canPush = !NO_PUSH && head.ok && !!head.out && branch.ok && !!branch.out

  // --------------------------------------------------------------------- the gh
  const ghVersion = run('gh', ['--version'])
  if (!ghVersion.ok) {
    blocked(
      'gh-missing',
      ghVersion.missing
        ? 'The GitHub command line tool is not installed, so nothing can create the repository for you.'
        : `The GitHub command line tool did not run: ${ghVersion.err.split('\n')[0] || 'unknown error'}`,
      'Install it, then run this again:\n  macOS    brew install gh\n  Windows  winget install --id GitHub.cli\n  Linux    see https://github.com/cli/cli#installation',
    )
  }

  const auth = run('gh', ['auth', 'status'])
  if (!auth.ok) {
    blocked(
      'gh-signed-out',
      'You are not signed in to GitHub yet.',
      'Run this once, on this machine:\n  gh auth login\n\nIt opens a browser and asks you to confirm a code. After that, everything else is automatic.',
    )
  }

  // ------------------------------------------------------------------- the plan
  if (!YES) {
    const plan =
      `Ready to create a PRIVATE GitHub repository:\n` +
      `  name    ${name}\n` +
      `  from    ${root}\n` +
      `  remote  origin\n` +
      `  push    ${canPush ? `yes (branch ${branch.out})` : 'no (nothing committed yet)'}\n\n` +
      'Nothing has been created. Re-run with --yes to go ahead.'
    done('plan', plan, { name, root, willPush: canPush })
  }

  // ------------------------------------------------------------------- creation
  const args = ['repo', 'create', name, '--private', '--source', '.', '--remote', 'origin']
  if (canPush) args.push('--push')
  const created = run('gh', args)
  if (!created.ok) {
    const first = (created.err || created.out).split('\n').find((l) => l.trim()) || 'unknown error'
    // `gh repo create --push` can fail at the PUSH having already made the repo and set
    // the remote, so "nothing was changed locally" is a claim that has to be checked
    // rather than asserted. Telling someone nothing happened when a remote now exists is
    // how a retry turns into a confusing second failure.
    const after = git(['remote', 'get-url', 'origin'])
    const partial = after.ok && after.out
    blocked(
      'create-failed',
      `GitHub would not create the repository: ${first}`,
      first.toLowerCase().includes('already exists')
        ? `A repository called "${name}" already exists on your account. Either pick another name, or connect to the existing one:\n  git remote add origin <its url>`
        : partial
          ? `The remote WAS set to ${after.out}, so the repository exists and only the push failed. Finish it with:\n  git push -u origin ${branch.out || 'main'}`
          : 'Check `gh auth status` and try again. Nothing was changed locally.',
    )
  }

  // Verify rather than assume. gh has exited 0 in the past while leaving the
  // remote unset, and a silent half-success here is exactly the failure that
  // surfaces days later as a broken `ship`.
  const check = git(['remote', 'get-url', 'origin'])
  if (!check.ok || !check.out) {
    blocked(
      'remote-missing',
      'GitHub reported success but the local project is still not pointed at it.',
      'Connect it by hand with the URL from https://github.com/new, then run this again:\n  git remote add origin <url>',
    )
  }

  done(
    'created',
    `\n✅ Private repository created: ${check.out}\n` +
      (canPush ? '   Your work is pushed and backed up.\n' : '   Nothing has been pushed yet (no commits in this project).\n'),
    { remote: check.out, name, pushed: canPush },
  )
} catch (err) {
  blocked('error', `Could not set up the GitHub repository: ${(err && err.message) || 'unknown error'}`, 'Nothing was changed locally.')
}
