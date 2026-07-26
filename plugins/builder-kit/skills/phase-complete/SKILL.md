---
name: phase-complete
description: Use when the build steps for a phase are finished and the user asks to close, wrap up, or complete a phase. Runs the deterministic checkpoint, checks any schema change ships a versioned, committed migration, verifies ACs with evidence, ticks the checklist, marks this phase's task done, writes learnings back to CLAUDE.md/rules/ADRs, then commits and suggests /clear. A gate that fails twice in a row trips a kill-criteria circuit breaker (halt and escalate, never a silent third retry).
allowed-tools: [Read, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Close a Build Phase

Turns "the code seems done" into a phase that is provably done: a deterministic gate has passed, any schema change carries a versioned, committed migration, every acceptance criterion has evidence, the checklist and Beads are updated, and the next phase starts smarter because this one's learnings are written back to disk. The compound write-back (step 7) is what makes each phase cheaper than the last.

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
   (or `/checkpoint <N>`). The script, not you, decides pass/fail. It resolves `docs/checkpoints/phase-<N>.json`, then `docs/checkpoints/checkpoint.json`, then the plugin default. If it exits **non-zero**, report the failing mechanical check verbatim, fix it, and re-run. Do not proceed past this step until it exits zero. A missing manifest is NOT a pass. If the SAME check fails a second consecutive time, do not re-run a third time. Trip the kill-criteria circuit breaker (see below) and escalate instead of looping.

3. **Did this phase change the persisted schema? Then it needs a versioned, committed migration.** Look at this phase's diff: a changed collection config, model, table, column, enum, or index all count. A schema change is not done until a migration for it lives in the project's migration system and git is tracking it. Skip this step only when the phase touched no schema, or the project has no migration tool.
   - **Read the project's migration tool; do not assume it.** Check `package.json` scripts and dependencies for what this project actually uses: Payload (`payload migrate:create`, `payload migrate:status`), Drizzle (`drizzle-kit generate`), Prisma (`prisma migrate dev`), Kysely, Knex, sqlx, TypeORM, Rails, or whatever is there.
   - **Match your tool's migration style; the only FAIL is DDL run outside the migration system.** The artefact that matters is a versioned, reviewed, reversible migration that git tracks. Schema-first tools (Drizzle, Prisma, Payload) DERIVE the migration from your schema, so run their generate command and do not hand-edit the output. Query-builder or hand-authored tools (Kysely, Knex, sqlx, a plain SQL migration runner) have you AUTHOR the migration by hand in their migration API, and that authored file IS the source of truth, not a smell. The real FAIL is ad-hoc DDL applied OUTSIDE the migration system: a manual `ALTER` on the prod database, or a hand-typed `.sql` run by hand with no migration record. That drifts from the schema, passes locally, and breaks in prod.
   - **Prove it is current, the way your tool supports it.** For schema-first tools, re-derive and confirm nothing new falls out. Some check offline from the migration files (Drizzle's `drizzle-kit generate` re-derives and emits nothing new); others compare against a database (Prisma's `migrate status` / `migrate diff` reads a live or shadow database, and errors like P1010 when none is reachable). For hand-authored tools there is no schema to diff against, so "current" means every schema change in this phase's diff has a matching committed migration and they run clean. If the tool emits a new migration or reports anything pending, the committed migrations do not match the schema and the gate FAILS. A clean run with nothing left is the pass. If the tool needs a database and none is reachable in the current environment, do not pass and do not hard-fail blindly: record `migration-currency check pending (needs a DB)` and re-run it where a database (a scratch or shadow DB is fine) is available before deploy.
   - **Prove it is committed.** The migration file must be tracked and staged for this phase's commit, not left untracked. Verify with `git status --porcelain <migrations dir>`.
   Dev auto-sync (Drizzle `push`, Payload's dev auto-migrate) is what hides this: the schema works on your machine and 500s in prod, because prod applies migrations and there is none. This gate catches it before deploy.

4. **Verify acceptance criteria with evidence.** Read `docs/prd/acceptance-checklist.md`. For each AC this phase covers (per `docs/implementation-plan.md`), state whether the code satisfies it AND the concrete evidence: a passing test name, a file path, or a command output. No evidence means it does not pass yet.
   - `PASS AC-XXX — <description>` because <evidence>
   - `FAIL AC-XXX — <description>` because <reason> → fix, re-run the gate, recheck.
   - The same AC that fails a second consecutive time trips the kill-criteria circuit breaker (see below): halt and escalate rather than fix-and-recheck a third time.

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

## The kill-criteria circuit breaker

A deterministic anti-doom-loop companion to the checkpoint gate. It governs every gate in this skill: the checkpoint (step 2), the migration-currency check (step 3), and each acceptance criterion (step 4). The rule is symmetrical to the gate itself, so fixing a red check cannot quietly turn into grinding on it forever.

**Fix once, re-run once. A gate that fails a SECOND time in a row halts, it does not retry a third time.** Looping on the same red check is how a phase burns a whole context window and closes worse than it opened. The circuit breaker turns that silent loop into a loud stop.

On the second consecutive failure of the SAME gate, do not try again. Emit a structured escalation:
- **Criterion.** The exact gate that failed: the checkpoint check name, the migration tool's verbatim output, or `AC-XXX`.
- **Evidence.** The verbatim failing output from BOTH attempts, not a paraphrase and not just the latest one. Two reds side by side are the signal.
- **Suspected cause.** Your best read of why, stated as a hypothesis, not asserted as fact.
- **Three options, for the human to choose:**
  1. **Pause.** Stop here. The phase stays open and hands back for a human look. This is the default when you cannot name a genuinely different next attempt.
  2. **Extend and retry with a CHANGED approach.** Allowed only if you can state what will be different next time (a different fix, a different tool, a different assumption). The same fix a third time is not a third attempt, it is the loop the breaker exists to stop.
  3. **Override with a logged rationale.** Accept the failing gate as a known limitation and proceed, recording why.

**An override is never silent.** It appends one dated entry to `docs/decisions.md` (which doubles as the kill-log, and which the SessionStart reground reads back), titled so it is greppable, for example `## <YYYY-MM-DD>: KILL-OVERRIDE: <criterion>`, with the criterion, the evidence, and the rationale for shipping past it. Stamp the date from `date +%Y-%m-%d`, never a remembered one. A gate waved through WITHOUT that row is not an override, it is a skipped gate, and a skipped gate is a FAIL.

**A pattern of overrides on one criterion is itself a signal, so surface it.** Before appending an override row, grep the log for the same criterion:
```bash
grep -i "KILL-OVERRIDE" docs/decisions.md
```
If this criterion has been overridden before, say so plainly and do NOT rubber-stamp a repeat. The same gate failing and being waved through across phases is not a one-off, it is a systemic gap that wants a real fix or an explicit design decision. Stop and prompt for an ADR (via the `create-adr` skill) rather than logging a third override on the same line.

**Name the kill criteria up front, in the phase and plan docs.** A gate can only trip the breaker if it was named first. When a phase or plan doc lists its checks, each should be a named threshold with an evidence definition, what counts as met (a passing test name, a command that exits zero, a measured number under a stated budget), not a vibe. An unnamed criterion cannot fail loudly, so it fails silently, which is exactly what this breaker exists to prevent.

## Rules

- The checkpoint gate (step 2) must exit zero before anything downstream. A mechanical failure is never softened or reinterpreted.
- A gate that fails twice in a row trips the circuit breaker: halt, escalate with the criterion, the evidence from both attempts, a suspected cause, and the three options (pause / extend-with-a-changed-approach / override-with-a-logged-rationale). Never a silent third retry. An override appends a dated `KILL-OVERRIDE` row to `docs/decisions.md`; a repeat override on the same criterion is surfaced and sent to an ADR, not rubber-stamped.
- A schema change ships with a committed migration that lives in the project's migration system and that the tool confirms is current: no fresh diff where the tool checks offline, "current" meaning every change in the phase's diff has a matching committed migration where the tool is hand-authored, a clean `status` where it needs a database, or a recorded `migration-currency check pending (needs a DB)` when no database is reachable yet. Ad-hoc DDL run outside the migration system (a manual `ALTER` on prod, a hand-typed `.sql` applied by hand), or no migration at all, is a FAIL, not a note; dev auto-sync hides it locally while prod has nothing to apply.
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
- `docs/decisions.md` (a dated `KILL-OVERRIDE` row) only if a gate was overridden at the circuit breaker.
- This phase's task marked done (if you use Beads: `bd close`; otherwise native Tasks or `docs/tasks.md`); a commit on the feature branch, pushed.
