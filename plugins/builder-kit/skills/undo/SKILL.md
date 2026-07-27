---
name: undo
description: Put the project's files back to a point where everything worked, choosing from the automatic snapshots the kit takes as work happens, and taking a fresh snapshot first so the undo itself can be undone. Fires when a change made things worse, when a deploy broke what was working, or when the last stretch of work needs to go.
allowed-tools: [Read, Bash, AskUserQuestion]
---

# Undo

Put the files back to the last point where everything worked. The kit snapshots the project as work happens, so there is almost always a point to return to, and this skill is how a builder reaches it without learning any of the machinery underneath.

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach); adapt tone and confirmation frequency, never fork the content, never skip a human gate.

## The mechanism, and its one honest limit

Snapshots live on a shadow reference, `refs/worktree/builder-kit/autosave`, written by the kit's autosave hook. It is per worktree by design, it never touches the builder's own history, branches, index or working tree, and it holds untracked files as well as tracked ones. Restoring from it puts back **files the snapshot contains**. A file created after that snapshot is not in it, so restoring cannot remove it, and this skill must never quietly delete one to make the result look tidier. Say the limit out loud, list the extra files, and let the human decide about each.

## When to use / when not

- Use when the current state is worse than an earlier one: a change broke something that worked, an edit went the wrong way, or a deploy needs the last good version back before anyone tries to fix forward.
- Not for a failure that has not been diagnosed yet. Undo discards work; understand what broke first (the `unstick` step) unless the priority is getting a live product working again, in which case restore first and diagnose after.
- Not for removing something already published or deployed. That is a separate decision with its own hard stop.

## Process

1. **Check the ground before offering anything.**

   ```bash
   git rev-parse --is-inside-work-tree
   git rev-parse --verify --quiet refs/worktree/builder-kit/autosave
   ```

   No repository, or no snapshot reference, means there is nothing to restore from. Say exactly that: snapshots begin at the first file change after the kit is set up, so a project that has just been created has none yet. **Do not improvise a substitute.** Discarding the current work to reach the last saved point is a destructive irreversible action (`H-DESTROY` in `.claude/rules/autonomy.md`): it only ever happens on the human's explicit yes, after you have listed exactly which files it would change.

2. **Take a fresh snapshot first, so the undo is itself undoable.** Run the kit's autosave hook the way its own file documents (it reads a hook payload on stdin), then prove it worked by checking the reference moved:

   ```bash
   git rev-parse refs/worktree/builder-kit/autosave
   ```

   Compare against the value from step 1. If the reference did not move, or the hook is not present in this install, do not restore over unsaved work silently. List every file that would be overwritten and get an explicit yes for that list first.

3. **Offer the restore points in the builder's terms, not as identifiers.** Read the chain, newest first:

   ```bash
   git log -n 20 --format="%H%x09%cr%x09%s" refs/worktree/builder-kit/autosave
   ```

   For each candidate, work out what actually differs from now:

   ```bash
   git diff --name-only <snapshot> -- .
   ```

   Present each point as when it was ("about forty minutes ago") and what changes if they pick it ("puts back three files, including the sign-up page"). A builder chooses by consequence, never by an identifier.

4. **Ask which point, and how much.** One `AskUserQuestion`: the point to return to, and whether to put back everything or only the named files. Include "none of these, leave it alone" as a real option. Never auto-answer, at any `assistanceMode`.

5. **Restore only what they chose.**

   ```bash
   git restore --source=<snapshot> -- <paths>
   ```

   Paths, or `.` for everything in the snapshot. This writes files and nothing else.

   **Never** `git reset`, `git checkout` of a branch, `git clean`, `git stash drop`, a branch delete, a rewritten history or a force push. None of them are needed to put files back, all of them can lose work that is not in a snapshot, and each is a hard stop rather than a step this skill takes.

6. **Deal with the files created since, explicitly.** Compare the current listing against the snapshot's and name anything that exists now and did not then. Ask about each (keep, or remove) and only act on a yes. Removing a file the human did not name is the one way this skill can lose real work.

7. **Prove the result rather than claiming it.** Run the project's own test command (`testCommand` in `.claude/builder-kit.json`, falling back to `npm test`) and report its real output. Then say plainly what state the project is in: which files were put back, to when, and what was left alone.

8. **Record it.** One row in `docs/evolve/friction-log.md` (`| date | skill | step | what-broke | what-the-user-did |`). A build that needs undoing repeatedly at the same step is telling you something about that step.

## Rules

- **Files only.** This skill restores file contents. It never moves, deletes or rewrites history, never changes which branch is checked out, and never pushes anything anywhere.
- **Snapshot before restore, every time.** If a fresh snapshot cannot be taken, the human sees the exact list of files at risk and says yes before anything is overwritten.
- **Nothing is deleted without a specific yes for that file.** A file that exists now and not in the snapshot stays unless the human says otherwise.
- **Choices are described by consequence,** not by identifiers, timestamps in machine format, or any git vocabulary. The builder does not need to know what a commit is, and this skill is the reason they do not.
- **Never claim the restore worked without evidence from this turn.** Show the test output or the file listing you just read.
- Destructive irreversible actions and the production surface are hard stops (`H-DESTROY`, `H-DEPLOY`). No `assistanceMode` removes them.

## Output

- The chosen files restored to the chosen point, and a plain statement of what changed and what did not.
- The project's own test command run afterwards, with its real output quoted.
- One row appended to `docs/evolve/friction-log.md`.
