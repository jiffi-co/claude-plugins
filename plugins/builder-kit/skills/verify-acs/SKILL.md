---
name: verify-acs
description: Use after a phase's build and UI review are done, when the user asks to verify acceptance criteria, cross-check the checklist, or says /verify-acs, to produce evidence for each AC this phase covers before any box is ticked.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Task, AskUserQuestion]
---

# Verify Acceptance Criteria

Turns the acceptance checklist from an honour-system tick-box into an evidence ledger: every AC this phase covers gets a real artifact (a passing test, a curl response, a screenshot) recorded on disk before its box is checked. No opinion-based ticks.

## When to use / when not

- Use after the build and (for frontend work) the UI review are done for a phase, once tests pass and coverage is at or above 80 percent. This is the verification stage of the workflow.
- Do not use to decide whether the work is good enough to ship, that is human code review and the deploy gate. This skill proves each AC is met; it does not approve the phase.
- Do not tick an AC you cannot back with an artifact. A missing artifact is a fail, not a pass.

## Process

1. **Scope the ACs.** Read `docs/implementation-plan.md` and the phase's tracked issue (if you use Beads: `bd show <id>`; otherwise the matching native Task or `docs/tasks.md` entry) to find which user stories and ACs this phase is meant to satisfy. If the mapping is ambiguous, STOP and confirm the AC list with the user via AskUserQuestion, never guess the scope.
2. **Read the checklist.** Read `docs/prd/acceptance-checklist.md`. Work only the ACs in scope for this phase; leave the rest untouched.
3. **For each in-scope AC, locate the code.** Use Grep/Glob/Read to find the implementing code. If nothing implements it, mark it not met and move on, do not write the code here.
4. **Produce evidence, matched to the AC type.** Every AC gets exactly one artifact, captured, not asserted from reading:
   - **Logic / backend / data / events:** a passing test. Run the specific test, not the whole suite: `npx vitest run -t "AC-XXX"` (or the file). Capture the passing output.
   - **API / route behaviour:** a real request. `curl -i http://localhost:3000/api/...` against the running dev server; capture status line and body.
   - **UI / visual / responsive:** a screenshot via Playwright MCP at the relevant viewport (1440 / 768 / 375). Capture the console as clean while you are there.
   - **Integration (Klaviyo, Stripe, magic link):** a test asserting the outbound call fired with the right payload, or a captured log line, never "the code looks like it would".
5. **Record the ledger.** Write `docs/checkpoints/phase-<N>-acs.md`: one row per AC with status, evidence type, and the pointer to the artifact (test name, curl output, screenshot path). This file is the audit trail.
6. **Tick only what is proven.** In `docs/prd/acceptance-checklist.md`, set `[x]` only for ACs with a passing artifact in the ledger. Leave `[ ]` for not-met; annotate partial ones inline with what is missing.
7. **Fresh-context second opinion.** Spawn the `ac-verifier` agent via Task to re-check the ticked ACs against their evidence with no memory of this session. If it disputes a tick, revert that box to unchecked and surface the disagreement, do not argue it down.
8. **Report.** Print the table, one line per AC:
   - `PASS AC-XXX: <desc> - <evidence: test name / curl / screenshot path>`
   - `FAIL AC-XXX: <desc> - not met because <reason>`
   - `PARTIAL AC-XXX: <desc> - needs <what is missing>`
9. **Handle failures.** For any FAIL or PARTIAL, STOP and report them to the user. Do not silently fix and re-tick; the fix is a build task, and every AC for this phase must be PASS (verified by evidence) before the phase is considered done.

## Rules

- Evidence before tick. A checked box must trace to an artifact in `docs/checkpoints/phase-<N>-acs.md`. No artifact, no tick.
- Never edit an AC's wording or an out-of-scope box. The checklist and its AC numbering (US-001, AC-001.1) are frozen.
- The `ac-verifier` second opinion is a gate, not a formality: its dispute unchecks the box.
- If you lean on `/goal` to hold the session (for example "every AC for this phase is PASS"), remember it is model-evaluated, not a mechanical pass/fail, so treat it as a strong prompt-level gate on top of the evidence ledger, not a substitute for it.
- This skill does not approve the phase or authorise deploy. Passing ACs are a precondition; the human review and deploy gates stay human.

## Output

- `docs/checkpoints/phase-<N>-acs.md`: the evidence ledger. One row per in-scope AC: `AC-XXX | PASS/FAIL/PARTIAL | evidence type | pointer to artifact (test name, curl snippet, screenshot path) | verifier: confirmed/disputed`.
- `docs/prd/acceptance-checklist.md`: in-scope boxes updated to `[x]` only where the ledger proves it; partials annotated inline.
- Screenshots saved under `docs/checkpoints/phase-<N>/` and referenced from the ledger.
- A terminal report table of every in-scope AC with its status and evidence pointer.