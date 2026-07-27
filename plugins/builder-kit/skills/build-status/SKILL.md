---
name: build-status
description: Deprecated alias for /builder-kit:status, kept working so published guides and saved workflows do not break. Reports where a build stands by running the shipped scripts/state.mjs against the artefacts on disk — stage, step number, the next command, and any blocker. Read-only. Fires only when this older name is invoked directly; every new reference should name status instead.
allowed-tools: [Bash, Read]
---

# Build Status (deprecated alias)

**`/builder-kit:status` supersedes this.** Same answer, better name, one place it is maintained. This entry stays because the directory name is the invocation key, which makes it a published contract: guides, saved workflows and other people's notes already say `/builder-kit:build-status`, and renaming a published entry is the exact breaking change `PRINCIPLES.md` forbids. So it keeps working.

New references should say `/builder-kit:status`.

## When to use / when not

Do not reach for this deliberately. It exists to catch an older invocation. For the current entry, and the full documentation of what the block means, see `skills/status/SKILL.md`.

## Process

1. Run the same probe `status` runs. One Bash call:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"
   ```

2. Print the block verbatim: stage, step number, the next `/builder-kit:` command on its own line, progress, and every blocker with its fix line. Do not summarise it and do not soften a blocker.

3. Add one line at the end, once:

   > `/builder-kit:build-status` is now an alias. Use `/builder-kit:status` from here on.

4. Stop. This is a report. Do not run the next command, tick an acceptance criterion, close a phase, commit, or edit a document.

## Rules

- Read-only, exactly as `status` is.
- The script's answer wins over the conversation, over `CLAUDE.md`, and over memory.
- Absence of evidence is reported as absence, never as done.
- Behaviour must not drift from `status`. If the two ever disagree, `status` is correct and this file is the bug.
- The git branch and the phase counts come out of the state block. The task detail this skill used to gather lives in `/builder-kit:resume`, which reloads the working session rather than reporting the spine.

## Output

Writes nothing. Prints the state block, each blocker in plain language, the next command to type, and the one-line deprecation notice.
