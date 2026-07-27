---
name: unstick
description: Diagnose a stalled build from the evidence already on disk (the kit's state, the last blocked action, and the failing gate row), then offer three named ways forward with their costs. Fires when a gate row has failed twice with no change between runs, when the same fix has been attempted twice, when one error has held the build for about fifteen minutes, or when a turn ended blocked with nothing on screen.
allowed-tools: [Read, Bash, Glob, Grep, AskUserQuestion, Skill]
---

# Unstick

Something is going in circles. This skill reads the evidence instead of guessing, names one cause, and puts three real options to the human. It fixes nothing on its own: the value is a correct diagnosis and a decision that is recorded, because the failure mode here is trying the same thing a third time with more confidence.

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach); adapt tone and confirmation frequency, never fork the content, never skip a human gate.

## When to use / when not

- Use when the build is repeating itself: a gate row failing twice with nothing changed between the runs, the same fix attempted twice, roughly fifteen minutes on one error with no movement, or a turn that ended with no visible output (a blocked action renders as nothing at all in the Claude Code panel of Claude Desktop).
- Not for a first failure. One red run is information, not a stall. Read the error and fix it.
- Not for putting files back to an earlier point, which is the `undo` step, and not for a status readout, which is the `status` step. Unstick is for deciding what to do when the obvious next move has already failed.

## Process

1. **Gather the evidence before forming any opinion.** Run each of these and keep the output; a missing source is a fact to report, not a reason to stop.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --json
   ```
   Where the kit thinks you are: stage, next command, progress, blockers. If the script is not present in this install, fall back to reading `.claude/builder-kit.json`, `docs/implementation-plan.md` and `docs/checkpoints/` yourself and say in the diagnosis that the state readout was unavailable.

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs" --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gate.mjs" --json
   ```
   The failing rows, with their evidence strings. These two are the difference between "the phase will not close" and "coverage is at 41 percent against a bar of 60".

   Then read `.claude/builder-kit/last-block.md` if it exists, newest entry last. Every builder-kit hook that blocks something writes there, and on Desktop that file is the only record the human can see.

2. **Name one cause, with the line of evidence that supports it.** One cause, quoted evidence, in the builder's own words rather than tool vocabulary. If the evidence supports two causes, say so and name the single cheapest command that would separate them, then run it. If it supports none, say that plainly: an invented cause is worse than an open question, because it sends the next twenty minutes in the wrong direction.

   The four shapes that cover most stalls, each with its tell:

   - **A gate failing on work an earlier phase did.** A coverage or criterion row that falls at phase four usually means phase three shipped a path nobody tested. Tell: the failing row names files the current phase never touched.
   - **The environment, not the code.** A criterion that passes on this machine and fails against the live address is usually configuration, a missing key, or a data-shape difference. Tell: identical code, different result by location.
   - **The phase was sized wrong.** A phase that will not close after two honest attempts is usually two phases. Tell: the definition of done has items that do not depend on each other.
   - **Something was blocked and it looked like a hang.** Tell: `last-block.md` has an entry newer than the stall, and the turn it belongs to produced no visible output.

3. **Put three options to the human with `AskUserQuestion`.** Always exactly three, always with the cost of each, with your recommendation flagged and the reason in one sentence. Never auto-answer, at any `assistanceMode`.

   1. **Fix the named cause and run the gate again.** Cheapest when the diagnosis is confident and the fix is bounded. Say what you would change and roughly how much.
   2. **Start this step again with a clean head.** Drop the current attempt, re-read the plan and the code as they now stand, and redo the step from the plan rather than from the conversation. This is the right move when the same fix has been tried twice: the context is carrying the wrong assumption, and a fresh read beats a third correction.
   3. **Change the shape.** Re-cut the phase into the two phases it turned out to be, or waive the failing row with a written reason. A waiver is a decision with a cost, so it gets a line in `docs/decisions.md` naming what is not proven and who accepted it. Never waive a hard stop, a security row, or a red test suite.

4. **Do what they chose, then re-run the gate that failed** and report its real output. Do not report the fix as done off the back of the edit; the gate's exit code is the claim, not your summary of it.

5. **Record the stall.** One row in `docs/evolve/friction-log.md`:

   ```
   | date | skill | step | what-broke | what-the-user-did |
   ```

   This is what makes a recurring stall visible to `jiffi-evolve` later, and a stall that repeats across projects is a defect in the kit, not in the builder.

## Rules

- **Diagnose from artefacts, never from memory of the conversation.** Cite the file or the command output you read this turn. If you did not read it this turn, go and read it.
- **One cause, or an honest "not yet determined" plus the command that settles it.** Never a list of five possibilities dressed as a diagnosis.
- **Exactly three options, each with its cost, decided by the human.** This skill never picks.
- **Never route around a block.** A hook blocked something for a reason. Quote the entry from `.claude/builder-kit/last-block.md` and address it. Retrying quietly, disabling the hook, or working around the check is the failure this skill exists to prevent.
- **Never re-run a red suite hoping for a different answer,** and never mark a phase done to get past a gate. The gate's exit code is the fact.
- **A waiver is written down or it did not happen.** Name what is unproven and who accepted it, in `docs/decisions.md`.
- Plain words to the builder: no git vocabulary, no tool names where a plain phrase does the job. "The last stretch of work has not been saved anywhere but this machine" beats naming a command.

## Output

- A diagnosis card in the reply: what is stuck, the one cause, the evidence line, and the three options.
- The chosen action carried out, followed by the real output of the gate that failed.
- One row appended to `docs/evolve/friction-log.md`.
- If the human waived a row: one line in `docs/decisions.md` naming what is not proven and who accepted it.
