---
name: phase-start
description: Start one build phase by cutting the feature/phase-N branch, loading the phase from the implementation plan with its ACs and live Beads state, running a pre-flight consistency check, then driving the build one step at a time. Use when the user says "start phase N", "build the next phase", or /phase-start.
allowed-tools: [Read, Edit, Bash, Grep, Glob, AskUserQuestion, Task]
---

# Phase Start

The load-bearing middle of the build. This gets one phase onto its own branch with fresh, verified context, then works it step by step until the phase's steps are done. Closing the phase out (full suite, AC sign-off, push, `bd close`) is the separate `phase-complete` skill.

## When to use / when not

- **Use** at the start of any build phase, once ADRs are accepted and `docs/implementation-plan.md` exists.
- **Not** for closing a phase (use `phase-complete`), and not before the plan exists (run `plan` first).

## Process

1. **Fresh context.** Confirm we are starting clean. If the window is already loaded from prior work, tell the user to `/clear` first. A phase begins on a clean context, no exceptions.
2. **Load live state**, do not trust memory. If you use Beads:
   ```bash
   bd status          # where the project is, which issues are open
   bd ready           # the issues unblocked and ready to work now
   ```
   Otherwise track the same state with native Tasks or a simple `docs/tasks.md` checklist. Read `docs/implementation-plan.md` (the matching phase section), `docs/prd/acceptance-checklist.md` (the ACs this phase owns), `AGENTS.md` (file ownership) and `docs/interfaces.md` (integration points). Use Grep/Glob to locate existing code the phase touches rather than reading whole files.
3. **Cut the branch** from an up-to-date `main`, never build on `main`:
   ```bash
   git switch main && git pull
   git switch -c feature/phase-<N>-<short-slug>
   ```
4. **Scaffold this phase's gate** at `docs/checkpoints/phase-<N>.json` so `/checkpoint <N>` verifies only THIS phase, not future phases' still-unticked criteria. Scope the acceptance-criteria check to this phase's ACs with `match` (the AC prefix for the phase, e.g. `AC-002`):
   ```json
   { "checks": [
     { "id": "tests", "label": "Tests pass", "kind": "mechanical", "type": "command", "cmd": "npm test --silent", "expectExit": 0 },
     { "id": "acs", "label": "Phase <N> ACs ticked", "kind": "mechanical", "type": "checklist-done", "path": "docs/prd/acceptance-checklist.md", "match": "AC-00<N>" }
   ] }
   ```
5. **Pre-flight consistency check.** Before any code, verify and report:
   - Prerequisite phases are complete (per the plan and, if you use Beads, `bd status`).
   - Every library this phase uses. Check its **current** API with Context7 and flag anything deprecated or moved. Verify, do not recall.
   - First build phase only: if the ADRs specify a database, stand up the local dev DB, wire `.env` from `.env.example`, run initial migrations, and confirm the connection before building against it.
   - Present a phase brief: what is being built (user stories plus AC numbers), the ordered steps, the definition of done, and any drift you found between plan, ADRs and code.
5. **Choose execution mode, ask do not assume** (AskUserQuestion): **Solo**, **Sub-agents** (background by default, good for a focused scoped task that reports back), or **Agent Team** (experimental, opt-in via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). Two independent phases can run in parallel git worktrees instead, so offer that when the plan marks phases parallelisable:
   ```bash
   git worktree add ../<project>-phase-<N> feature/phase-<N>-<slug>
   ```
6. **Gate: wait for the human's go-ahead** on the brief and the mode before writing code.
7. **Drive the loop, one step at a time.** For each ordered step:
   - State the step and the approach, then implement just that step.
   - Run the relevant tests after each meaningful change.
   - When they pass green, commit that increment (`git commit -m "phase <N>: <step>"`).
   - Move to the next step. Do not paste all steps at once.
8. **When stuck** on one problem after **two failed correction attempts**, stop. Do not keep patching a full context. Tell the user to `/clear`, then restart the step with a sharper, more constrained prompt. If your Claude Code has a `/debug` skill, reach for it on a bug that needs tracing back through the call stack (otherwise trace it inline), `/rewind` to undo a bad turn (conversation and code), and `gh run view --log-failed` on a CI failure.
9. When all the phase's steps are done and tests are green, hand off to **`phase-complete`** for the closeout.

## Rules

- Never commit to `main`. Every phase lives on `feature/phase-<N>-<slug>`, and you commit only after tests go green.
- One step at a time. Handing the agent the whole phase at once is the failure mode this skill exists to prevent.
- Verify library APIs with Context7 before planning code. Stale API recall is the dominant build bug.
- The execution-mode choice and the go-ahead on the brief are the human's calls. Prompt, never auto-decide.
- Load state from the on-disk plan and your tracker (if you use Beads: `bd status` / `bd ready`; otherwise native Tasks or `docs/tasks.md`), never from chat history.
- Between phases, `/clear` is non-negotiable. Within a phase, after two dead-end corrections, `/clear` and rewrite.

## Output

- A new branch `feature/phase-<N>-<slug>` off `main`.
- Incremental commits on that branch, each after a green test run.
- No document writes of its own. Updates to `docs/prd/acceptance-checklist.md`, `CLAUDE.md` and `bd close` happen in `phase-complete`.
