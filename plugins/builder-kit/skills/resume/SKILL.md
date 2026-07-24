---
name: resume
description: Use at the start of a fresh or confused session, after /clear or auto-compaction, or when the user says "resume", "where were we", "pick up where we left off", or an agent has lost the thread and needs re-grounding from disk.
allowed-tools: [Read, Bash, Glob, AskUserQuestion]
---

# Resume: Re-ground From Disk

Rebuilds the working state from files, not chat memory. Reads the decision log, ADR index, plan, acceptance checklist, Beads and git, then reports where things stand and what comes next. Disk is the source of truth; chat history is not.

## When to use / when not

- Use: opening a fresh session, after `/clear`, after auto-compaction, when the user asks "where were we", or when an agent is confused, contradicting itself, or producing worse output than earlier.
- Do not use: mid-task when context is healthy and you already know the state. This is recovery, not a status ritual for every message. The SessionStart re-grounding hook already does a lighter version on every launch; this is the deeper, on-demand pass.

## Process

1. Read the project context, in this order, skipping any that do not exist:
   ```bash
   cat CLAUDE.md 2>/dev/null | head -c 4000
   cat docs/decisions.md 2>/dev/null
   cat docs/adr/README.md 2>/dev/null
   cat docs/implementation-plan.md 2>/dev/null | head -c 6000
   ls docs/checkpoints/ 2>/dev/null && cat docs/checkpoints/*.md 2>/dev/null | tail -c 4000
   ```
   Use Read for anything you need in full. `docs/decisions.md` and the ADRs tell you what has already been decided; do not relitigate them.
2. Read live task state. Beads first, native Tasks or `docs/tasks.md` as the fallback if `bd` errors:
   ```bash
   bd status 2>/dev/null && bd list --status open 2>/dev/null
   ```
   If `bd` fails, check `docs/tasks.md` and note Beads is down (see the troubleshooting skill for recovery).
3. Read git state to see what is actually on disk versus committed:
   ```bash
   git branch --show-current
   git log --oneline -10
   git status --short
   ```
4. Reconcile: match the current branch and last commits against the implementation plan phases and the open Beads issues. Identify the current phase, the last completed step, and any uncommitted work.
5. Report a short standing summary to the user: current phase and step, what is committed, what is uncommitted, open tasks, and the single next action. Do not start building yet.
6. STOP and confirm before acting. If the reconstructed state is ambiguous (branch and plan disagree, uncommitted work of unclear origin), ask with AskUserQuestion rather than guessing which state is real. Resuming the wrong phase corrupts the plan.

## The retry-then-whoami ladder (for a confused agent)

When an agent is stuck, contradicting itself, or repeating a mistake, escalate in this order. Do not jump straight to the nuclear option, and do not stay past step 3.

1. **Retry once, constrained.** Give one very specific instruction naming the file and the exact change. Not "keep trying".
2. **Whoami.** If still wrong, stop and re-ground from disk: run this skill's Process above so the agent re-establishes what it is building, which phase it is in, and which decisions are already locked. Confusion is almost always a context problem, not a reasoning one.
3. **Two failed corrections means /clear.** If two attempts on the same issue fail, the approach is wrong and more context will not help. `/clear` (or `/exit` then relaunch), then rewrite the prompt with what you learned. Do NOT paste the failed error messages back in; they bias the next attempt toward the same broken path.

Other triggers to `/clear` and resume fresh rather than debug: more than ~15 minutes on one error with no movement, output quality degrading mid-session, or `/context` above ~60% (a house-rule ceiling, not a product limit).

## Rules

- Read-only re-grounding. This skill reconstructs and reports state; it never edits code, closes Beads issues, or commits. Acting is a separate, confirmed step.
- Decisions on disk are settled. `docs/decisions.md` and `docs/adr/` are the record. Do not reopen a locked architecture or design decision during a resume; surface it to the human if it genuinely needs revisiting.
- Never fabricate state. If a file is missing or a command errors, say so plainly. A silent failed probe looks identical to a real negative, so confirm each read actually ran.
- Ambiguity stops you. When branch, plan and tasks disagree, ask the human which state is real before proceeding.
- Before a deliberate `/clear`, commit whatever works so nothing on disk is lost: `git add <your files> && git commit -m "wip: saving progress before fresh session"`. Never `git add -A` when other agents may have in-flight work.

## Output

No files written. Produces a spoken standing report to the user:

```
Phase: <N> — <phase name>   Step: <last completed> → <next>
Branch: <branch>   Committed: <last commit>   Uncommitted: <files or "none">
Open tasks: <bd/tasks summary>
Locked decisions relevant here: <from decisions.md / ADR index>
Next action: <single concrete step, awaiting your go-ahead>
```
