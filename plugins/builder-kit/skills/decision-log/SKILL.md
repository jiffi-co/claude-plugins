---
name: decision-log
description: Append one dated entry to docs/decisions.md (date, decision, why, supersedes) so a settled choice lives on disk instead of in chat. Records a choice already made, never makes one. Fires the moment a choice is settled and neither docs/decisions.md nor docs/adr/ carries it yet.
allowed-tools: [Bash, Read, Edit, Write, AskUserQuestion]
---

# Decision log

Appends one short, greppable entry to `docs/decisions.md` (date, decision, why, supersedes) so a confirmed choice lives on disk, not in chat history. A SessionStart hook reads this file back at the top of every session, and a later `/checkpoint` asserts the file exists and has grown.

## When to use / when not

- Use when the human has already MADE a decision and wants it recorded: "log it", "log this decision", "add that to the decision log", or right after they confirm a choice (architecture, tool, naming, scope trade-off).
- Do not use to make or recommend the decision. That is the human's call, and other gates (architecture, design-system, PRD approval) own it. This skill only records a choice already made.
- Do not use for task tracking (that is `docs/tasks/`) or for ADRs (a full architectural decision belongs in `docs/adr/` via the create-adr skill; log a one-line pointer here if it helps).

## Process

1. Get today's date deterministically. Do not guess it:
   ```bash
   date +%Y-%m-%d
   ```
2. Identify the decision from the recent conversation. State back, in one plain sentence, the choice you are about to log.
3. Confirm the wording with the human before writing anything. Their words, not yours. Use AskUserQuestion to lock the three fields:
   - **Decision** (one line: what was chosen)
   - **Why** (one line: the reason it beat the alternative)
   - **Supersedes** (an earlier decision this replaces, or "none")
   If any field is unclear, ask rather than inventing it.
4. Ensure the log exists. If `docs/decisions.md` is absent, create it with a header (Step 6 shape). If `docs/` does not exist, `mkdir -p docs` first.
5. Append the new entry at the end of the file (append-only: never edit or delete a past entry). Newest entries go last so the file reads as a timeline.
6. Entry shape, kept short and greppable (one entry):
   ```markdown
   ## 2026-07-24: Better Auth for authentication
   - Decision: Use Better Auth 1.6.x for the auth layer.
   - Why: NextAuth v5 never shipped stable; Auth.js is patch-only.
   - Supersedes: none
   ```
   The file header (first-time creation only):
   ```markdown
   # Decision log

   Confirmed project decisions, newest last. Read at session start. Append-only.
   ```
7. Confirm to the human what was written and the file path. Do not commit unless asked.

## Rules

- The human owns the decision AND its wording. This skill records; it never decides, recommends, or reargues the choice.
- Only log a decision the human has confirmed this session. Never fabricate an entry.
- Append-only. Past entries are the record; do not rewrite or delete them. A reversal is a NEW entry whose "Supersedes" names the old one.
- One entry per invocation. Keep each line short and greppable (a reader should scan dates and decision titles in one pass).
- Always stamp the real date from `date`, never a remembered one.
- Do not commit to git as part of this skill.

## Output

- Writes/updates `docs/decisions.md` (creating it and `docs/` if needed).
- One appended `## <YYYY-MM-DD>: <title>` block with `Decision`, `Why`, `Supersedes` bullets, in the Step 6 shape.
