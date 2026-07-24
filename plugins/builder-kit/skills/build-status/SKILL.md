---
name: build-status
description: Report "where am I" on a build by reading the plan, the acceptance checklist, Beads and git — current phase, what is done, what is next, and any red gate. Use after a /clear or on a fresh session, or when the user asks where they are, what phase they are on, or what to do next.
allowed-tools: [Read, Bash, Grep, Glob]
---

# Build Status

Fast orientation across the on-disk state. Reads the plan, the checklist, Beads and git, then prints one status block: current phase, done, next, and any gate that is red. Read-only. It never advances a phase, closes an issue, edits a doc, or commits — those stay the human's call.

## When to use / when not

- **Use** after a `/clear`, at the start of a new session, or when asked "where am I / what phase / what's next / is anything blocking me".
- **Not** for doing the work: to plan a phase use implementation-plan, to build use the phase-start loop, to verify ACs use verify-acs. This only reports.

## Process

1. **Git orientation** — one read of the working tree:

   ```bash
   git branch --show-current
   git status --short
   git log --oneline -5
   ```
   Note the branch (is it a `feature/phase-N-*` branch or `main`?), whether the tree is dirty, and the last few commits.

2. **Beads (optional)** — the cross-session project memory and dependency graph. If you use Beads:

   ```bash
   bd status
   bd ready
   ```
   `bd status` shows open issues and which phase; `bd ready` shows what is unblocked next. Otherwise track the same state with native Tasks or a simple `docs/tasks.md` checklist. If `bd` is not found or errors, say so plainly and carry on with the file-based signals (do not guess a phase from silence).

3. **The plan** — read `docs/implementation-plan.md`. Find the phase that matches the current branch / Beads issue: its ordered steps, its acceptance criteria, and its definition of done.

4. **The checklist** — read `docs/prd/acceptance-checklist.md`. Count ticked `[x]` vs unticked `[ ]` ACs, and which belong to the current phase per the plan.

5. **Declared phase** — read the "Current phase" line in `CLAUDE.md`. Flag if it disagrees with Beads or the branch (a stale marker is a common trap).

6. **Recent decisions and checkpoints** (if present) — skim `docs/decisions.md` and the newest file in `docs/checkpoints/` for the latest confirmed choices and the last gate result. Skip silently if the paths do not exist.

7. **Red-gate scan** — check the things that block a clean phase boundary and call each out explicitly:
   - Full test suite last known state (run `npx vitest run` only if the user asks; otherwise report from the checkpoint / last commit, do not assume green).
   - Unticked ACs that the current phase was meant to deliver.
   - Uncommitted or unpushed work on the phase branch.
   - Beads issue for the phase still open when the phase looks done.

8. **Report** — print the status block in the shape under Output. If a red gate is open, name it and point to the skill that clears it; do not clear it here and do not advance.

## Rules

- Read-only. Never edit docs, close a Beads issue, commit, push, or switch branches. If action is needed, name it and stop.
- Do not infer "green" or "done" from absence of evidence. A missing checkpoint or an unreachable `bd` is an unknown, reported as unknown — a silently skipped probe looks identical to a real pass.
- On-disk state wins over memory: the plan, checklist, Beads and git are the source of truth, not chat history or the `CLAUDE.md` marker if they conflict. Surface the conflict rather than picking a side.
- The next-phase decision, the AC sign-off, and any commit stay the human's. This skill prompts; it does not decide.

## Output

No files written. Prints one status block to the conversation:

```
BUILD STATUS
Phase:      <N — name>   (branch: <branch>, Beads: <issue-id/state>)
Done:       <steps/ACs complete this phase; e.g. 4/6 steps, 7/9 ACs [x]>
Next:       <next unblocked step from bd ready + the plan>
Red gates:  <none | list: failing suite / unticked ACs / uncommitted work / open issue>
Notes:      <conflicts, e.g. CLAUDE.md says Phase 3 but branch is phase-2; last checkpoint result>
```
