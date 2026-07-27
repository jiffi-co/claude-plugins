---
description: Get this machine ready to build. Checks the toolchain and the live session, installs what it can without a password, and hands back one exact line for anything it will not install for you.
argument-hint: "[--dry-run]"
allowed-tools: Bash(node:*)
---

The user should not have to go hunting for tooling. Install what you can, and be exact about the rest.

## 1. Show the plan first

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --fix --dry-run
```

This installs nothing. It prints what is missing, what it would install, and what it will leave to the user.

No `--fast` here, deliberately. `--fast` skips the two live-session probes (the plugin loaded, the docs MCP answering), and those are exactly the rows the page promises are checked. Skipping them means the plan you approve is not the plan that was checked. It costs the dry run about half a minute, once.

Report the plan in a short list: what is already fine, what will be installed, what needs them. Then ask whether to go ahead, unless the user has already said to install.

If `$ARGUMENTS` contains `--dry-run`, stop here.

## 2. Do it

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --fix
```

One command, one approval. It runs the installers itself, streams their output, then re-checks every row.

It installs only what needs no password: uv, fnm, the Claude Code CLI, and anything Homebrew or Scoop can install when those already exist. Anything needing a password, an elevated PowerShell, or a click in a dialog is written to a bootstrap script instead. It never sits waiting on a password prompt.

## 3. Hand back the remainder

Read the closing sections of the output.

- `installed:` is done. Say so and move on.
- `failed:` carries the reason and the retry line. Give the user the retry line verbatim.
- `left for you:` is the part the fixer will not do. It ends with one line to paste. Print that line in a fence, exactly as the doctor printed it, and say to rerun `/builder-kit:setup` afterwards.

Do not paraphrase a command. Do not offer to run the bootstrap script yourself: it needs their password.

## What the rows mean

**CORE** is Node 22 or newer, git, and gh. A failure here stops the build loop.

**SESSION** is the live state the build loop depends on: the plugin loaded without errors, a docs MCP that answers a health check, a git identity set, gh scopes for repo and workflow, and whether this checkout is a linked worktree. Two of these block: the git identity, because every commit fails without it, and a plugin that is installed but failed to load, because none of the commands exist.

The Claude Code CLI row is not a blocker. If this is running, a Claude Code already exists. A Desktop user has no CLI on PATH and their setup is fine.

**RECOMMENDED** and **OPTIONAL** never block. **PROJECT** appears inside a project and reports the scaffold.

## Exit codes

A plain run exits non-zero when a blocking row fails. A `--fix` run exits non-zero only when something it attempted failed. Work it deliberately left to the user is reported, not counted as a failure, so `--fix` on a machine that still needs a password exits 0.

## Next

Once the core rows are green: `/builder-kit:start` to scaffold a project.
