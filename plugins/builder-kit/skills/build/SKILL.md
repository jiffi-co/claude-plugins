---
name: build
description: "Drive the build loop from the plan on disk. Picks step or auto mode, pre-flights each phase against the hard-stop registry, invokes the forked build-phase worker, verifies the phase actually advanced, then stops or continues. Owns every human gate the worker cannot reach: execution mode, brief approval, spike promote-or-discard, the circuit breaker and every hard stop. Fires when docs/implementation-plan.md holds an unstarted phase whose prerequisites are closed."
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Agent, Skill]
---

# Build

The loop. It runs the plan, phase after phase, and it stops in the right places.

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

**This skill runs INLINE and it owns every question.** The mechanical span of a phase runs in `build-phase`, a forked worker with its own fresh context window. A fork cannot ask a human anything: AskUserQuestion is stripped from every subagent in code, with no frontmatter escape. So a gate inside the fork does not prompt, it dies silently. That is the whole reason the build is split in two, and it is the one rule that must never be softened: **if it asks, it lives here.**

## When to use / when not

- **Use** at any point from the idea onwards. This is the one command the guide pages put on the page, so it must answer wherever the reader actually is: it reads the stage off disk and runs the stage that is genuinely next, whether that is validating the idea or building phase 4.
- **Not** to close a single phase by hand (that is `phase-complete`, which the worker already calls).
- `phase-start` is the deprecated name for this skill and forwards here.

**It never refuses for being early.** "Run `implementation-plan` first" was the old answer, and it was wrong in the one place it mattered: the guide page that carries this command sends the reader here before the plan exists, by design. Routing to the current stage is the behaviour; refusing was the bug.

## Arguments

- `--mode step` / `--mode auto` sets `buildMode` in `.claude/builder-kit.json` and remembers it.
- `--phase <N>` runs one named phase instead of the next unclosed one.
- `--spike` runs the next phase's first unknown step in the spike lane (see below).

## Two modes, one worker

`buildMode` lives in `.claude/builder-kit.json` and is asked ONCE, on the first build in a project:

| Mode | What it does at a phase boundary |
|---|---|
| `step` | Prints the tick and the next action, then ENDS THE TURN. The human starts the next phase. |
| `auto` | Continues straight into the next phase without being asked again. |

Both modes run the identical forked worker and stop at the identical gates. The only difference is the loop condition at the boundary. Auto bypasses confirmations, never gates.

**The reconciliation rule, and it is not optional: `assistanceMode` never crosses a phase boundary, only `buildMode: auto` does.** `assistanceMode` (coach / execute / auto) tunes how often the agent re-confirms small in-scope steps WITHIN a phase. It has no bearing on whether the loop continues to the next phase. Someone who set `assistanceMode: auto` months ago must not inherit an unattended eight-phase run they never asked for. If `buildMode` is absent from the config, ask; never infer it from `assistanceMode`, and never infer it from `experienceLevel`.

Write the defaults alongside it the first time: `"buildMode": "step" | "auto"`, `"autoStopOnRedTests": true`, `"autoMaxPhases": 4`.

## The loop

```
loop:
  s = state()
  if s.stage != 'build'        -> run that stage's skill INLINE, then re-read state.
                                  STOP at the first guide-page boundary (below).
  preflight(s.phases.current)  -> scan the plan against hard-stops.json and ask NOW,
                                  in the parent, in BOTH modes
  before = s.phases.done
  r = build-phase(s.phases.current)               // forked, blocking
  if r has "HARD-STOP:"        -> AskUserQuestion, record the answer, re-invoke; continue
  if r has "GATE-FAILED:"      -> report and BREAK, in BOTH modes
  if r has "SPIKE-DONE:"       -> promote-or-discard gate, then continue
  if state().phases.done == before -> report and BREAK         // nothing advanced
  tick(phase)
  if mode == 'step'            -> print the tick and the next action, END TURN
  if mode == 'auto'            -> continue
```

### 1. State

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --json
```

One call, one answer, derived from artefacts on disk. Read `stage`, `nextCommand`, `phases` and `blockers`. Do not re-derive any of it from prose or from chat history, and do not keep a second copy of the spine here: the stage table lives in `state.mjs` (`--explain` prints it) and duplicating it is the drift this wave exists to remove.

- `ok` is `false`: report `error.code` and `error.message` and stop. A state that could not be read is not a state that says "carry on".
- `stage` is not `build`: catch up, one guide page at a time. The rule is in its own section below, because getting it wrong runs four stages in one turn.
- `stage` is `build` but the app shell does not run (no `package.json`, no `.xcodeproj`, or the recorded `testCommand` cannot execute): run `bootstrap` first.
- `phases.current` is the next phase to run. `phases.current == null` with `phases.done == phases.total` means the plan is exhausted; say so and stop.
- Any `blockers` with severity `block` are reported before anything else and stop the loop.

### 1a. Catching up, and where the catch-up STOPS

When `stage` is not `build`, run the skill `nextCommand` names, INLINE, then re-read `state.mjs --json` and decide whether to carry on. **The catch-up has a boundary, and the boundary is the guide page.**

Take `guide.key` from the state you read at the very start of this invocation. That is the page the reader is standing on. After each stage skill finishes:

- the new `guide.key` is the SAME: carry on to the next stage. Those stages are what that page is about, and stopping mid-page would leave the reader holding half a step.
- the new `guide.key` is DIFFERENT: **stop**. Print which stages just closed, the artefacts that prove it, and the single next command. The reader continues from the page that command belongs to.
- `guide` is null on either read (no guide map in reach): stop after ONE stage skill. Without the map there is no boundary to compute, and one stage per invocation is the answer that can never carry someone past a gate.
- the stage did not change after its skill ran: **break** and say which artefact is still missing. A stage skill that produced nothing will produce nothing on the second run either.

Why this is not optional. On the current map, `shape-it` covers ground-idea, idea-pack and PRD; `decide-and-plan` covers architecture, design-system and the plan. Without the boundary, a reader on the shaping page who runs this command gets the architecture, the design system AND the implementation plan in the same turn, so the plan is written before the design system exists and every block below on their page fires out of order or not at all. The stage table is `state.mjs`'s (`--explain` prints it) and the page mapping is `guide-map.json`'s. Do not keep a second copy of either here.

This applies in **both** modes. `--mode auto` is about phase boundaries inside the build stage; it has never meant "run the whole spine unattended", and a reader who asked for an unattended build of a plan that does not exist yet did not ask for their architecture to be decided while they were not looking.

### 2. Pre-flight the phase against the hard-stop registry

Before the fork exists, while questions still work:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/hard-stop.mjs" --scan docs/implementation-plan.md --phase <N>
```

- Exit 0 with `matches: []` means this phase trips no stop. Say so in one line and carry on.
- Exit 0 with matches means ask, once per stop id, with AskUserQuestion, using the `question` and `options` the registry supplies. Auto mode does NOT skip this and does NOT auto-answer it.
- **Exit non-zero means the pre-flight did not run.** That is not a pass. Report it and ask the human whether to proceed unscreened. A probe that silently fails looks identical to a real negative.

Record every answer into the handoff file (step 3) so the worker builds to the decision instead of re-deciding it.

### 3. Write the handoff, then fork

The worker gets a fresh context window and no conversation history, so anything it needs must be on disk. Write `.claude/builder-kit/phase-run.json` before every invocation. This file is authoritative for the worker:

```json
{
  "phase": 2,
  "mode": "step",
  "executionMode": "solo",
  "spike": false,
  "attempt": 1,
  "answers": [
    { "stopId": "H-PROVISION", "question": "...", "answer": "Local only: stay on local Postgres this phase." }
  ]
}
```

Then invoke the `build-phase` skill (`/builder-kit:build-phase`) and wait for it. It is `background: false`, so the result comes back in this turn.

### 4. Read the worker's return, do not paraphrase it

The worker ends its turn with exactly one of these lines. Grep for the marker rather than reading the prose around it:

| Marker | What the parent does |
|---|---|
| `PHASE-DONE: <N> \| <what it proves> \| <next phase or "plan exhausted">` | Verify, tick, then step or continue. |
| `HARD-STOP: <id> \| <action> \| <why> \| <what you need from the human>` | AskUserQuestion using the registry's text for that id, append the answer to `answers`, bump `attempt`, re-invoke the worker. Auto mode never auto-answers this. **The SAME id twice in a row stops the run**: the answer did not unblock it, and a third fork will return the same line. Report both escalations and hand back. |
| `GATE-FAILED: <criterion> \| <evidence> \| <suspected cause>` | Report it verbatim and BREAK the loop, in both modes. Then offer the circuit breaker's three options (below). |
| `SPIKE-DONE: <N> \| <branch> \| <what was learned> \| <recommendation>` | Run the promote-or-discard gate (below). |

If the return carries no marker at all, treat it as a failure, not a pass. Say what came back and stop.

### 5. Verify the tick against disk, then print it

The worker's word is a claim. The proof is on disk, so re-run `state.mjs --json` and compare it against the reading you took before the fork:

- `phases.done` went up by one, and the phase you just ran is `closed` in `phases.list`. That flag comes from `docs/checkpoints/phase-<N>-close.json` flipping to `"closed": true`, which only `phase-complete` does and only after every mechanical check passed.
- The phase's ACs are `[x]` in `docs/prd/acceptance-checklist.md`.
- `git log --oneline -3` shows the phase's commits.

**If `phases.done` did not move, break.** A loop that continues when nothing moved is the loop that never ends. This comparison, not the phase counter, is what guarantees termination.

Then print the tick, and keep it short and human: which phase closed, what it proves (the user-visible thing that now works), how many phases remain, and the single next action.

### 6. Step or continue

- `step`: print the tick and the next action, then END THE TURN. Do not start the next phase.
- `auto`: continue, unless any hard bound below has tripped.

## Hard bounds. Auto mode must terminate

Check all of these before every continue. Any one of them ends the run:

1. The plan is exhausted (no unclosed phase left).
2. Any gate failed (`GATE-FAILED:`).
3. Any hard stop fired (`HARD-STOP:`, or a denied permission prompt).
4. `autoStopOnRedTests` is true (the default) and the suite is red.
5. `autoMaxPhases` phases have run in this turn (default 4). It is a bound, not a target: it exists so a mis-parsed plan cannot loop forever.
6. `phases.done` did not move after a phase ran (step 5).
7. The same `HARD-STOP:` id came back twice in a row, or the stage did not change after its stage skill ran (step 1). Both mean the last round trip achieved nothing.

Bounds 6 and 7 are the ones that actually guarantee termination: every iteration must move something on disk, or the loop ends. The counter in bound 5 is a backstop for a mis-parsed plan, not the guarantee.

Auto never auto-answers a hard stop and never retries past a red suite. When a bound trips, say which one, in plain words, and print how to resume.

## The four human gates, all owned here

1. **Execution mode.** Ask once per run, not per phase (AskUserQuestion): **Solo**, **Sub-agents** (background, good for a focused scoped task that reports back), or **Agent Team** (experimental, opt-in via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). If the plan marks two phases parallelisable, offer worktrees instead, which is the only parallelism that works here: only one instance of a forked skill runs at a time, so two phases means two worktrees and two sessions, never two forks.
   ```bash
   git worktree add ../<project>-phase-<N> feature/phase-<N>-<slug>
   ```
2. **Brief approval.** Present the phase brief before any code: what is being built (user stories plus AC numbers), the ordered steps, the definition of done, and any drift found between plan, ADRs and code. In `step` mode ask per phase. In `auto` mode present the whole run's briefs together at the start and take one approval for the run, so the human has still approved every phase before it builds.
3. **Spike promote-or-discard.** On `SPIKE-DONE:`, ask (AskUserQuestion):
   - **Discard** (the default posture): delete the spike branch, keep only what was learned as one line in `docs/evolve/friction-log.md` or a Decision. Nothing merges.
   - **Promote:** the spike does not fold in as-is. It is rebuilt to ceremony on `feature/phase-<N>-<slug>`, with tests, satisfying the ACs, passing the gate. Treat the spike as a reference to reimplement, never a diff to cherry-pick.
4. **The circuit breaker.** On `GATE-FAILED:`, present the criterion, the evidence from both attempts verbatim, the suspected cause, and the three options: **pause**, **extend and retry with a CHANGED approach** (only if you can name what will be different), or **override with a logged rationale** (which appends a dated `KILL-OVERRIDE` row to `docs/decisions.md`). Never a silent third retry. The full rule lives in `phase-complete`.

## Rules

- If it asks, it lives here. Never move an AskUserQuestion into `build-phase`; it will be stripped and the gate will vanish without a trace.
- The catch-up stops at a guide-page boundary, in both modes. Never run past the page the reader is standing on.
- The pre-flight runs in both modes, on every phase, and a non-zero exit is a failed check, not a clean one.
- `assistanceMode` never crosses a phase boundary. Only `buildMode: auto` does.
- `phases.done` from `state.mjs` is the proof a phase closed. The worker's summary is a claim.
- Never commit to `main`. Every phase lives on `feature/phase-<N>-<slug>`.
- One phase per fork. The fresh context window per phase is the point, and it is what replaces the `/clear` ritual between phases.
- A denied permission prompt is a stop, not an obstacle. Do not reword the command and try again.

## Output

- No documents of its own. `.claude/builder-kit/phase-run.json` is runtime state, rewritten every invocation.
- `.claude/builder-kit.json` gains `buildMode`, `autoStopOnRedTests` and `autoMaxPhases` on the first run.
- Per phase: a branch, commits, ticked ACs, an advanced "Current phase" marker, and one printed tick. All written by the worker and by `phase-complete`, verified here.
