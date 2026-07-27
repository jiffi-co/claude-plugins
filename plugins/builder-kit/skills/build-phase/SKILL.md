---
name: build-phase
description: "Execute the mechanical span of one build phase in a forked context: cut the branch, scaffold the two gate manifests, verify the libraries, build the ordered steps one at a time with tests green before each commit, then close via phase-complete. Asks nothing and decides nothing a human owns; escalates instead, on one greppable line. Invoked by the build skill, which owns every gate."
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Agent, Skill]
context: fork
background: false
agent: general-purpose
---

# Build one phase (forked worker)

The span between the gates. You are running in a **forked subagent** with a fresh context window and no conversation history. That is deliberate: a clean context per phase is a property of this design, not a `/clear` anyone has to remember.

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

## You cannot ask, so do not try

AskUserQuestion does not exist here. It is stripped from every subagent in code, and no frontmatter setting brings it back. There is no human on the other end of this turn.

So: **never ask, never assume, escalate.** When you reach something a human owns, do not attempt it, do not work around it, and do not pick the option you think they would pick. End your turn with the escalation line and let the parent ask. One round trip costs a fresh fork. A wrong guess costs their trust, or their money.

Two channels reach a human from in here, and only two:

1. **A permission prompt.** `hooks/hard-stop.mjs` turns the destructive command shapes into a prompt in the main session. If one is denied, that is an answer. Report it and stop; do not reword the command.
2. **Your final line.** The four markers below. The parent greps for them.

## First: read the handoff

`.claude/builder-kit/phase-run.json` is authoritative. It carries `phase`, `mode`, `executionMode`, `spike`, `attempt` and `answers` (the hard stops the human already answered pre-flight). Build to those answers; never re-decide one.

If the file is missing or unreadable, do not guess the phase number. End with:

```
GATE-FAILED: handoff | .claude/builder-kit/phase-run.json is missing or unreadable | the parent forked without writing the handoff
```

Then read the rest of the state from disk, never from memory: `docs/implementation-plan.md` (this phase's section), `docs/prd/acceptance-checklist.md` (the ACs this phase owns), `AGENTS.md` (file ownership), `docs/interfaces.md` (integration points), and the task store (`docs/tasks/`, read it with `scripts/task-store.mjs list --status open`). Use Grep and Glob to find the code the phase touches rather than reading whole files.

## The four markers

End your turn with exactly ONE of these, on its own line, as the last line of your output. No marker means the parent treats the run as failed.

```
PHASE-DONE: <N> | <what now works for the user> | <next phase number, or "plan exhausted">
HARD-STOP: <id> | <action> | <why it stops> | <what you need from the human>
GATE-FAILED: <criterion> | <evidence, both attempts, verbatim> | <suspected cause>
SPIKE-DONE: <N> | <branch> | <what was learned> | <promote or discard, and why>
```

`<id>` is one of the six in `.claude/rules/autonomy.md`: H-PAY, H-LEGAL, H-DESTROY, H-DEPLOY, H-PROVISION, H-SHIP. Cite the id that fits; never invent one.

## Process

1. **Cut the branch** from an up-to-date `main`. Never build on `main`.
   ```bash
   git switch main && git pull --ff-only
   git switch -c feature/phase-<N>-<short-slug>
   ```
   If `git pull` cannot fast-forward, do not force anything. `GATE-FAILED: branch | <the git output> | main and origin/main have diverged`.

2. **Scaffold BOTH gate manifests.** The build gate and the close gate are separate files, and the split is what stops the close failing by construction on its first run. Write `docs/checkpoints/phase-<N>.json` with the checks that hold DURING the build:
   ```json
   { "checks": [
     { "id": "tests", "label": "Tests pass", "kind": "mechanical", "type": "test-command", "expectExit": 0 }
   ] }
   ```
   And `docs/checkpoints/phase-<N>-close.json` with those plus the acceptance-criteria check, which can only pass AFTER the evidence pass has ticked the boxes:
   ```json
   { "closed": false,
     "checks": [
       { "id": "tests", "label": "Tests pass", "kind": "mechanical", "type": "test-command", "expectExit": 0 },
       { "id": "acs", "label": "Phase <N> ACs ticked", "kind": "mechanical", "type": "checklist-done", "path": "docs/prd/acceptance-checklist.md", "match": "AC-00[1-4]" }
     ] }
   ```
   **`"closed": false` is load-bearing.** This one file is both the close gate and the close record: `scripts/state.mjs` counts a phase as closed when this file exists UNLESS it says `"closed": false`. Scaffolding it without that key marks the phase closed the moment the fork starts. `phase-complete` flips it to `true` once every check has passed, and that flip is what the parent reads as proof the phase actually advanced.

   ALWAYS scope the AC check to THIS phase's criteria with `match`. An unscoped `checklist-done` on a non-final phase fails demanding the WHOLE checklist ticked. A phase usually owns several stories, so `match` is normally a multi-group regex, not a single prefix.

   For the rows a manifest cannot express (coverage, `npm audit`, committed-and-pushed, the UI review artefact), take them from the shipped gate rather than hand-writing them:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" --emit-checks
   ```
   Those belong in the CLOSE manifest: they describe a finished phase, not a mid-build one.

   If this phase ships a browser bundle (web only), add a no-secret check to BOTH, scoped to the CLIENT bundle (`.next/static` for Next, `dist/assets` for Vite), never the whole build directory, which false-positives on server-only trace files:
   ```json
   { "id": "no-client-secret", "label": "No secret in the client bundle", "kind": "mechanical", "type": "command", "cmd": "! grep -RniE 'sk-[A-Za-z0-9]{16,}|AI_KEY' .next/static", "expectExit": 0 }
   ```

3. **Pre-flight consistency check.** Before any code:
   - Prerequisite phases are closed, per the plan and the task store. If one is not, `GATE-FAILED: prerequisites | <which phase is open> | the plan's ordering was not followed`.
   - Every library this phase uses: check its **current** API with Context7 and note anything deprecated or moved. Verify, do not recall. Stale API recall is the dominant build bug.
   - Any drift you find between the plan, the ADRs and the code goes in your final summary. Do not silently build to the plan when the code says otherwise.
   - If the phase needs a database and none is standing, run the `bootstrap` skill first rather than improvising a stack.

4. **Build the ordered steps, one at a time.** For each step:
   - State the step and the approach, then implement just that step.
   - Run the relevant tests after each meaningful change.
   - On green, commit that increment: `git commit -m "phase <N>: <step>"`. Stage explicit paths, never `git add -A`.
   - Then the next step. Do not implement the whole phase in one pass; that is the failure mode this design exists to prevent.

5. **When stuck**, after **two failed correction attempts on the same problem**, stop. Do not keep patching. You cannot `/clear` from in here and you do not need to: end the turn with `GATE-FAILED: <step> | <both attempts, verbatim> | <your hypothesis>`. The parent re-forks you with a fresh context, which is exactly the reset the old instruction was asking a human to do by hand.

6. **Close the phase.** Invoke the `phase-complete` skill and tell it plainly: *you are running inside the forked worker, AskUserQuestion is unavailable, escalate instead of asking.* It runs the gates, the migration-currency check, the AC evidence pass, the ticks, the write-back and the commit. If it trips the circuit breaker, pass its escalation up unchanged as your `GATE-FAILED:` line. Do not soften it and do not answer it yourself.

7. **Return.** One-paragraph summary (what was built, what proves it, any drift), then the marker line last.

## The spike lane

Only when the handoff says `"spike": true`. Some steps are learning, not building: an unfamiliar library, a risky architecture bet, a UI shape you need to see before you trust it.

- Cut it on `spike/phase-<N>-<slug>`, never on the feature branch. The name is the label.
- Relaxed ceremony inside the lane: skip the per-step tests-green rule and the gate. Commit with `spike:` prefixes, or not at all. Move fast, learn the thing.
- **The code does not count.** It ticks no AC, merges into no feature branch, and reaches `main` under no circumstances.
- You do not decide its fate. End with `SPIKE-DONE:` and your recommendation. The parent asks the human. If they promote it, the next fork rebuilds it to ceremony on the feature branch, with tests, satisfying the ACs. A spike is a reference to reimplement, never a diff to cherry-pick.

## Rules

- Never ask. Escalate on one line and end the turn.
- Never answer a hard stop yourself, in any mode, however obvious it looks. The registry does not bend for confidence.
- The handoff file and the docs on disk are the state. There is no chat history here to fall back on.
- Tests green before every commit. Explicit paths only, never `git add -A`, because other agents may be working in this tree.
- Never commit to `main`, never force-push, never rewrite history.
- Do not tell anyone to `/clear`. You are the clean context.
- One phase per invocation. Do not start the next one, even if the plan looks obvious, and even in auto mode. The boundary belongs to the parent.

## Output

- A `feature/phase-<N>-<slug>` branch with one commit per step, each after a green test run.
- `docs/checkpoints/phase-<N>.json` and `docs/checkpoints/phase-<N>-close.json`.
- Everything `phase-complete` writes: ticked ACs, an advanced "Current phase", the write-back, the commit and push.
- One marker line, last.
