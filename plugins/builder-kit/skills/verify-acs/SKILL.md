---
name: verify-acs
description: Use after a phase's build and UI review are done, when the user asks to verify acceptance criteria, cross-check the checklist, or names the verify-acs skill, to produce real evidence for each AC this phase covers before any box is ticked. What counts as evidence branches on projectType in .claude/builder-kit.json (web = a passing vitest, a curl response, or a Playwright screenshot; ios = a passing xcodebuild test and a simulator screenshot; agent = the eval scenario transcript). Default web.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Task, AskUserQuestion]
---

# Verify Acceptance Criteria

Turns the acceptance checklist from an honour-system tick-box into an evidence ledger: every AC this phase covers gets a real artefact (a passing test, a captured request or command output, a screenshot, or an agent transcript) recorded on disk before its box is checked. No opinion-based ticks. What *counts* as evidence branches on the project type; the rule that a claim is never evidence does not.

## When to use / when not

- Use after the build and (for any surface work: web pages, iOS screens, agent behaviour) the UI review are done for a phase, once the phase's tests pass and coverage is at or above the project's bar (80 percent for the web stack). This is the verification stage of the workflow.
- Do not use to decide whether the work is good enough to ship, that is human code review and the deploy gate. This skill proves each AC is met; it does not approve the phase.
- Do not tick an AC you cannot back with an artefact. A missing artefact is a fail, not a pass (the one carve-out: a visual AC with its logic proven but ui-review's prerequisites not yet wired is `LOGIC-VERIFIED, visual pending`, which is still not a tick, see step 5).

## Process

1. **Read the project type.** Read `.claude/builder-kit.json` and take `projectType` (`web`, `ios`, or `agent`); default to `web` if the file, the key, or a valid value is absent. Announce which surface's evidence you are gathering. The steps below are shared; step 5 branches on the type.
2. **Scope the ACs, reconciled to the commits under review.** Read the two phase maps: `docs/implementation-plan.md` and the phase's tracked issue (if you use Beads: `bd show <id>`; otherwise the matching native Task or `docs/tasks.md` entry). They can disagree, so do not trust either on its own. Establish the git commit range for this phase (for example commits since the previous phase's `/checkpoint`, or the commits carrying this phase's marker, or the branch's commits since it diverged from the main branch) and read what actually changed: `git log --oneline <range>` and `git diff --name-only <range>`. The in-scope AC set is the two maps reconciled against that diff: an AC is in scope only if the commits under review actually touch its implementing code. If you cannot pin the range, or the two maps disagree, or the commits implement an AC neither map lists, or a mapped AC has no code in the range, STOP and confirm the reconciled AC list with the user via AskUserQuestion, showing the conflict. Never guess the scope, and never trust one map over the commits.
3. **Read the checklist.** Read `docs/prd/acceptance-checklist.md`. Work only the ACs in scope for this phase; leave the rest untouched.
4. **For each in-scope AC, locate the code.** Use Grep/Glob/Read to find the implementing code. If nothing implements it, mark it not met and move on, do not write the code here.
5. **Produce evidence, matched to the AC type and the project type.** Every AC gets exactly one artefact, captured, not asserted from reading. Code inspection alone never clears an AC: it can raise a concern, never retire one. Use the block for your `projectType`.

   **web (the default):**
   - **Logic / backend / data / events:** a passing test. Run the specific test, not the whole suite: `npx vitest run -t "AC-XXX"` (or the file). Capture the passing output.
   - **API / route behaviour:** a real request against the running dev server, on the port it actually started on rather than an assumed one. Read the port from the dev server's own startup output (Next and Nuxt default to 3000, SvelteKit and other Vite apps to 5173, and a project can override any of these in its dev script): `curl -i http://localhost:<port>/api/...`; capture status line and body.
   - **UI / visual / responsive:** a screenshot at the relevant viewport (1440 / 768 / 375), with the console clean. `ui-review` runs before this skill and captures these across light and dark, so cite the screenshot it already wrote under `docs/checkpoints/`; capture one via Playwright MCP only if that page was not covered. If ui-review's prerequisites are genuinely not wired yet (no runnable dev server, no Playwright MCP, or no design pages to compare against), do not hard-fail the AC on the missing screenshot: verify the logic behind it with a real artefact instead (a passing render/component test, or a `curl` of the route showing the expected markup) and record the AC as `LOGIC-VERIFIED, visual pending ui-review`. That is a degraded status, not a pass: it needs a captured logic artefact (never "the code looks right"), it does not tick the box, and it stays open until the prerequisites are wired and ui-review captures the screenshot. If those prerequisites *are* wired, a missing screenshot is still a fail.
   - **Integration (your third-party services: email, payments, auth):** a test asserting the outbound call fired with the right payload, or a captured log line, never "the code looks like it would".

   **ios:**
   - **Logic / model / data / business rules:** a passing XCTest, run for the single test not the whole scheme. Derive the scheme and simulator destination from the `testCommand` in `.claude/builder-kit.json` (the ios default is `xcodebuild test -scheme <App> -destination 'platform=iOS Simulator,name=iPhone 16'`), and add `-only-testing:` to target the one test:
     ```bash
     xcodebuild test -scheme <App> -destination 'platform=iOS Simulator,name=iPhone 16' \
       -only-testing:<TestTarget>/<TestClass>/<testMethod>
     ```
     Pick a destination your machine actually has (`xcrun simctl list devices available`, or `xcodebuild -scheme <App> -showdestinations`). Capture the `Test Succeeded` line and the test name.
   - **UI / screen / visual / interactive:** the built app running on a booted simulator, proven by a screenshot or a passing XCUITest. `ui-review`'s ios pass already boots a simulator, builds, installs, runs any XCUITest target, and captures each screen in light and dark across device sizes, so cite the screenshot or the XCUITest result it wrote under `docs/checkpoints/`. Capture one yourself only if that screen was not covered:
     ```bash
     xcrun simctl boot 'iPhone 16' || true          # boot one if none is; use a device you actually have
     xcodebuild -scheme <App> -destination 'platform=iOS Simulator,name=iPhone 16' build
     xcrun simctl install booted <path-to-the-built .app>   # from the build output under DerivedData
     xcrun simctl launch booted <bundle-id>
     xcrun simctl io booted screenshot docs/checkpoints/phase-<N>/AC-XXX.png
     ```
     then Read the PNG back to confirm it shows what the AC requires. Use the scheme and bundle id from the project; do not invent them. Driving the full boot / build / install sweep is `ui-review`'s job, so prefer running it for that screen over reproducing the sequence here.
   - **Networking / integration (the app's calls to a backend or an SDK):** an XCUITest or a unit test asserting the call fired and the response was handled, or a captured log line, never "the code looks like it would". A native app has no local dev server to curl; if the AC is really about a backend that is a separate web project, verify it there against that project's `projectType`.

   **agent:**
   - **Behaviour / tool-use / refusal / grounding:** the transcript of the agent run against the scenario that exercises this AC, checked against that scenario's own Pass criteria. The artefact is the full transcript: the input, every tool call with its arguments and result, and the final output. `ui-review`'s agent pass already runs the scenarios and records the transcripts, so cite the transcript it wrote under `docs/checkpoints/`; run the scenario yourself only if this AC's scenario was not covered, via the project's eval command (the `testCommand` in `.claude/builder-kit.json`, the agent default `npm run eval`, or the command the project's README defines). Save the transcript under `docs/checkpoints/phase-<N>/` and cite it.
   - **The honesty gate (this is the whole point of the skill):** the scaffolded eval harness is a stub until a model is wired. Out of the box `npm run eval` (`evals/run.mjs`) only lints the scenario files for structure and prints `PENDING` for the behavioural result, and `npm start` fails on purpose with a "wire a ModelClient" message. A green harness run therefore proves the scenarios are well formed, NOT that the agent behaved. A `PENDING` is not a pass. If no model is wired, the behavioural evidence does not exist yet: mark the AC not met (or PARTIAL, "eval not wired"), and do not tick it. Ticking a box off a PENDING run is exactly the "told a non-dev a check ran when it did not" failure this skill exists to stop.
   - **Deterministic logic (a pure tool like `add`, a parser, a formatter):** if the project ships a unit test for that unit, run that specific test and capture the pass, same bar as the other types. Do not invent a test runner the project does not have.
   - **Safety (prompt-injection resisted, a secret not leaked, an out-of-scope or destructive tool refused):** the transcript of the adversarial scenario showing the agent held. This is non-negotiable, and it needs a wired agent to be real: no transcript, not met.

   **Leaning on ui-review (all types).** `ui-review` runs before this skill and is what actually drives the surface: it captures the web screenshots, boots the simulator and screenshots the iOS screens, and runs the agent scenarios and records the transcripts. So the rendered-surface and behavioural evidence is produced there, and this skill *cites* those artefacts rather than driving the simulator or re-running the whole eval a second time. What this skill owns is the per-AC deterministic evidence ui-review does not produce (the single unit or logic test, the API request), the mapping of every in-scope AC to one artefact, and the ledger-and-tick discipline. If ui-review has not run for this phase, run it first.
6. **Record the ledger.** Write `docs/checkpoints/phase-<N>-acs.md`: one row per AC with status, evidence type, and the pointer to the artefact (test name, curl output, screenshot path, transcript path). This file is the audit trail.
7. **Tick only what is proven.** In `docs/prd/acceptance-checklist.md`, set `[x]` only for ACs with a passing artefact in the ledger. Leave `[ ]` for not-met and for `LOGIC-VERIFIED, visual pending`; annotate the partial and visual-pending ones inline with what is missing.
8. **Fresh-context second opinion.** Spawn the `ac-verifier` agent via Task to re-check the ticked ACs against their evidence with no memory of this session. If it disputes a tick, revert that box to unchecked and surface the disagreement, do not argue it down. The `ac-verifier` and `security-auditor` reviewers can only be spawned from the top-level session; if this skill is itself running inside a subagent (which cannot spawn them), record the verifier column as `cold pass pending` and have the operator run the cold pass from the top-level session, rather than skipping the gate.
9. **Report.** Print the table, one line per AC:
   - `PASS AC-XXX: <desc> - <evidence: test name / curl / screenshot path / transcript path>`
   - `FAIL AC-XXX: <desc> - not met because <reason>`
   - `PARTIAL AC-XXX: <desc> - needs <what is missing>`
   - `LOGIC-VERIFIED AC-XXX: <desc> - logic proven by <artefact>, visual pending until ui-review prerequisites are wired`
10. **Handle failures.** For any FAIL, PARTIAL, or `LOGIC-VERIFIED, visual pending` AC, STOP and report it to the user. Do not silently fix and re-tick; the fix is a build task (for a visual-pending AC, wire the ui-review prerequisites and capture the screenshot), and every AC for this phase must be PASS (verified by evidence) before the phase is considered done.

## Rules

- Evidence before tick. A checked box must trace to an artefact in `docs/checkpoints/phase-<N>-acs.md`. No artefact, no tick.
- Claim only evidence the project actually produced. A test you did not run, a screenshot ui-review did not capture, or an agent eval that reported `PENDING` because no model is wired, is not evidence. Where the artefact does not exist the AC is not met: do not tick it, and never describe a check that did not run as if it did. For a visual AC whose ui-review prerequisites are not wired, that unmet visual is recorded honestly as `LOGIC-VERIFIED, visual pending` (step 5), which also does not tick the box.
- Never edit an AC's wording or an out-of-scope box. The checklist and its AC numbering (US-001, AC-001.1) are frozen.
- The `ac-verifier` second opinion is a gate, not a formality: its dispute unchecks the box, and a `cold pass pending` (step 8) means the gate has not run yet, so the phase is not fully verified until it does from the top-level session.
- If you lean on `/goal` to hold the session (for example "every AC for this phase is PASS"), remember it is model-evaluated, not a mechanical pass/fail, so treat it as a strong prompt-level gate on top of the evidence ledger, not a substitute for it.
- This skill does not approve the phase or authorise deploy. Passing ACs are a precondition; the human review and deploy gates stay human.

## Output

- `docs/checkpoints/phase-<N>-acs.md`: the evidence ledger. One row per in-scope AC: `AC-XXX | PASS/FAIL/PARTIAL/LOGIC-VERIFIED | evidence type | pointer to the artefact (test name, curl snippet, screenshot path, transcript path) | verifier: confirmed/disputed/cold pass pending`.
- `docs/prd/acceptance-checklist.md`: in-scope boxes updated to `[x]` only where the ledger proves it; partials and `LOGIC-VERIFIED, visual pending` ACs annotated inline.
- Artefacts saved under `docs/checkpoints/phase-<N>/` and referenced from the ledger: web and iOS screenshots, and agent transcripts.
- A terminal report table of every in-scope AC with its status and evidence pointer.
