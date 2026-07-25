---
name: phase-complete
description: Use when the build steps for a phase are finished and the user asks to close, wrap up, or complete a phase. Runs the deterministic checkpoint, checks any schema change ships a generated migration, verifies ACs with evidence, ticks the checklist, marks this phase's task done, writes learnings back to CLAUDE.md/rules/ADRs, then commits and suggests /clear.
allowed-tools: [Read, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Close a Build Phase

Turns "the code seems done" into a phase that is provably done: a deterministic gate has passed, any schema change carries a generated migration, every acceptance criterion has evidence, the checklist and Beads are updated, and the next phase starts smarter because this one's learnings are written back to disk. The compound write-back (step 7) is what makes each phase cheaper than the last.

## When to use / when not

- Use when all implementation steps for the current phase are complete and you are ready to close it out.
- Do NOT use mid-phase, or to skip failing tests. A red gate means the phase is not done — fix, do not close.
- Do NOT self-grade. The pass/fail decision belongs to the checkpoint script, never to your own read of the code.

## Process

1. **Clean up any Agent Team.** If this phase ran teammates, confirm each is idle and its task complete. Leave no orphaned sessions.

2. **Run the deterministic checkpoint — do not self-grade.** Run the shipped gate for this phase:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs" <N>
   ```
   (or `/checkpoint <N>`). The script, not you, decides pass/fail. It resolves `docs/checkpoints/phase-<N>.json`, then `docs/checkpoints/checkpoint.json`, then the plugin default. If it exits **non-zero**, report the failing mechanical check verbatim, fix it, and re-run. Do not proceed past this step until it exits zero. A missing manifest is NOT a pass.

3. **Did this phase change the persisted schema? Then it needs a generated, committed migration.** Look at this phase's diff: a changed collection config, model, table, column, enum, or index all count. A schema change is not done until a migration for it exists that the migration tool produced and git is tracking. Skip this step only when the phase touched no schema, or the project has no migration tool.
   - **Read the project's migration tool; do not assume it.** Check `package.json` scripts and dependencies for what this project actually uses: Payload (`payload migrate:create`, `payload migrate:status`), Drizzle (`drizzle-kit generate`), Prisma (`prisma migrate dev`), Knex, TypeORM, Rails, or whatever is there.
   - **Generate it, never hand-write it.** Run the tool's generate command so the migration is derived from the schema. A `.sql` you typed by hand is a DDL mirror: it drifts from the real schema, passes locally, and breaks in prod.
   - **Prove it is current.** Run the tool once more (`generate`, or its `status`/`diff` equivalent). If it emits a new migration or reports anything pending, the committed migrations do not match the schema and the gate FAILS. A clean run with nothing left to generate is the pass.
   - **Prove it is committed.** The migration file must be tracked and staged for this phase's commit, not left untracked. Verify with `git status --porcelain <migrations dir>`.
   Dev auto-sync (Drizzle `push`, Payload's dev auto-migrate) is what hides this: the schema works on your machine and 500s in prod, because prod applies migrations and there is none. This gate catches it before deploy.

4. **Verify acceptance criteria with evidence.** Read `docs/prd/acceptance-checklist.md`. For each AC this phase covers (per `docs/implementation-plan.md`), state whether the code satisfies it AND the concrete evidence: a passing test name, a file path, or a command output. No evidence means it does not pass yet.
   - `PASS AC-XXX — <description>` because <evidence>
   - `FAIL AC-XXX — <description>` because <reason> → fix, re-run the gate, recheck.

5. **Tick the checklist and advance the phase pointer.** In `docs/prd/acceptance-checklist.md`, mark every evidenced AC `[x]`. In `CLAUDE.md`, set "Current phase" to the next phase (or "Complete" if this was the last).

6. **Mark this phase's task done.** If you use Beads: `bd close <issue-id>` for this phase's issue (note: `bd close`, not `bd complete`). Otherwise mark the task done in your native Tasks or in `docs/tasks.md`.

7. **COMPOUND. Write learnings back to disk before clearing context.** This is the step that makes the next phase smarter. Review what this phase taught you and record it where the NEXT session will actually read it:
   - **New invariants / gotchas / conventions** → append to `CLAUDE.md` or the relevant file in `rules/` (e.g. "this ORM needs X", "always run migrations before tests").
   - **A decision made mid-build that future-you will re-litigate** → STOP and ask whether it warrants an ADR (`docs/adr/`), then invoke the `create-adr` skill. Do not silently bury an architecture choice in a commit.
   - **A reusable pattern or a fact that changed** (a version bump, a deprecated API you worked around) → note it at its conventional path so it is not rediscovered next phase.
   Keep each entry one or two lines. If genuinely nothing was learned, say so — do not invent filler.

8. **Commit and push.** Only the files this phase touched (never `git add -A`, which sweeps up other agents' in-flight work). Include the write-back edits from step 7 so the learnings are committed.
   ```bash
   git add <specific paths> && git commit -m "feat: complete phase <N> — <short description>"
   git push -u origin <branch>
   ```

9. **Prepare the handoff, then suggest /clear.** Print: what was completed, any notes for the next phase, and what the next phase is plus its execution mode. Then tell the user to run `/clear` before starting it. A clean context window per phase is non-negotiable. Do not auto-clear; it is their call.

## Rules

- The checkpoint gate (step 2) must exit zero before anything downstream. A mechanical failure is never softened or reinterpreted.
- A schema change ships with a generated, committed migration the tool produces no fresh diff against. A hand-written DDL mirror, or no migration at all, is a FAIL, not a note; dev auto-sync hides it locally while prod has nothing to apply.
- An AC is only ticked with concrete evidence attached. "Looks done" is not evidence.
- The compound write-back (step 7) happens BEFORE `/clear`, because context cleared without it loses the learning.
- An architecture decision surfaced mid-build is the HUMAN's call to ADR-ify; prompt, do not auto-decide.
- Never `git add -A` or `git add .` while other agents may be active — stage explicit paths only.
- docs/, ADRs, the acceptance checklist and your task tracker (Beads if used, otherwise `docs/tasks.md`) are the source of truth. If it is not on disk, it did not happen.

## Output

Edits, not new files, at conventional paths:
- `docs/prd/acceptance-checklist.md` — this phase's ACs marked `[x]`.
- `CLAUDE.md` "Current phase" advanced; plus any new invariants appended (step 7).
- `rules/*` and/or `docs/adr/ADR-<n>-*.md`, for learnings and any new ADR (step 7).
- This phase's task marked done (if you use Beads: `bd close`; otherwise native Tasks or `docs/tasks.md`); a commit on the feature branch, pushed.
