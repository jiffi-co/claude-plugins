---
name: ui-review
description: Take a rigorous second look at what a phase built against its spec. The surface follows projectType in .claude/builder-kit.json, so web boots the app and drives the real user journeys with Playwright across three fixed viewports in light and dark, scoring every screenshot against a fixed nine-criterion rubric, ios drives the app in a simulator (screenshots plus XCUITest), and agent runs its eval scenarios and reviews the transcripts. Fires when the open phase's diff touched the user-facing surface, and once more before ship.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, mcp__playwright__browser_navigate, mcp__playwright__browser_resize, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_snapshot, mcp__playwright__browser_console_messages, mcp__playwright__browser_network_requests, mcp__playwright__browser_click, mcp__playwright__browser_evaluate]
---

# UI Review

A rigorous second look at what this phase built, checked against the spec before it goes further. The *surface* you review depends on the project type: web drives real pixels in the browser, an iOS build drives the app in a simulator, an agent build runs its eval scenarios and reads the transcripts. The discipline is the same every time: scope to what changed, check it against the spec in the states that matter, hard-fail on the one thing that must never ship, fix the mechanical failures, and leave the taste calls to you.

## When to use / when not

- Use after any build phase that changed the user-facing surface (web pages, iOS screens, or agent behaviour), and once more before ship/deploy.
- Not for backend-only phases, and not a substitute for the human judgement gate: this checks compliance, contrast and safety, it does not overrule your aesthetic or behavioural decisions.

## Process (shared spine)

1. **Read the project type.** Read `.claude/builder-kit.json` and take `projectType` (`web`, `ios`, or `agent`). Default to `web` if the file, the key, or a valid value is absent. Announce which surface you are about to review, then run the matching block below.
2. **Scope to what changed.** Do not review the whole project blindly. Find what this phase touched and cross-reference `docs/implementation-plan.md` for the current phase; build the review list from the intersection.
   - **web:** the pages and components this phase changed. Locate them by the project's frontend framework (read it from `docs/adr/` or `package.json`), not by assuming one layout: Next.js App Router keeps them under `src/app` and `src/components`; SvelteKit under `src/routes/**/+page.svelte` and `src/lib/components`; Remix / React Router 7 under `app/routes`; other frameworks use their own convention (Vue/Nuxt `pages`/`components`, Astro `src/pages`, and so on). Grep for whatever those dirs actually are, e.g. `git diff --name-only HEAD~1 | grep -E 'src/app|src/components' || true` for a Next.js project.
   - **ios:** `git diff --name-only HEAD~1 | grep -E '\.swift$' || true`, then narrow to the views/screens this phase changed.
   - **agent:** `git diff --name-only HEAD~1 | grep -E 'prompts|tools|agents?|eval' || true` (the prompts, tool definitions, graph, or scenarios this phase changed).
   - If nothing in your surface changed, stop and report "no review needed".
3. **Load the governing spec.**
   - **web / ios:** read `docs/design-system/MASTER.md` (palette, type, spacing, motion) and `docs/design-system/pages/` for each in-scope page or screen spec, including its **emotional target**. If `MASTER.md` is missing, stop: the design system must exist first.
   - **agent:** read the agent's behaviour spec (`docs/prd/prd.md` and any `docs/agents/` contract) and the eval scenarios the project defines. If there are no scenarios to run, stop: an agent build cannot be reviewed without them.
4. **Run the review for your surface.** Use the block for your `projectType` below.
5. **Write the report** at `docs/checkpoints/ui-review-[phase].md` (see Output), then hand back for the human review gate.

## Judging discipline (all surfaces)

Every score below is a judgement, and vision-as-judge hallucinates both ways: it passes a broken frame and it fails a correct one. Import `.claude/rules/judging.md` and apply it to every screenshot, transcript and result you score, whatever the surface:

- Ask the NEGATIVE question first ("are there visible errors, empty or broken states, missing or clipped elements?"), not just "does this look right".
- Gate a pass behind a confidence floor. If you are not confident, it is not a pass.
- On a high-stakes gate (any run before ship), score a second time with a differently-phrased prompt and treat disagreement as uncertain, never a silent pass.
- ABSTAIN (verdict `cannot-verify`) on anything you cannot actually see or check, rather than guessing.
- Fail loudly, never silently. A mute pass is a worse smell than a noisy fail.

## Web browser pass (projectType: web, the default)

This is the vision-verified ship gate: the differentiator that catches "green build, broke in the browser". It sits on top of, and above, the CLI gates (typecheck, lint, unit, build). Those prove the machine did not explode. This proves the journey actually works when a real user drives it. A build that compiles clean and renders a broken page still fails here.

1. **Boot the app.** Ensure the dev server is up (`npm run dev`, or the project's own command); if not, start it in the background and wait for the local URL to answer before you drive anything. The vision gate drives the real app, so it has to actually serve. That means the local-dev database has to back `dev`, not only the test runner: if a database is wired for the test config (a throwaway PGlite or pg-mem for the suite) but `dev` has none, every database-touching route 500s the moment you drive it and the gate cannot boot the journey to score it. Back `dev` with a real local database (an in-process PGlite or pg-mem, or a throwaway container) before driving anything.
2. **Drive the real journeys, do not read the code.** From `docs/implementation-plan.md` and the page specs, list the critical user journeys this phase touched (for example sign-up then verify then land on the dashboard, not just "the dashboard page"). Drive each one end to end in a real browser with the Playwright MCP (or the Chrome MCP if that is what is wired up), clicking through the actual steps. Every meaningful stop on a journey is a waypoint. A journey you assert from reading the source does not count, only a driven one does.
3. **Capture every waypoint, three viewports, both themes.** At each waypoint, screenshot at all three fixed viewports and in both themes (toggle via the app's control or `data-theme` on the root):
   - desktop 1440x900
   - tablet 768x1024
   - mobile 375x667

   That is six frames per waypoint. Capture console messages and failed network requests as you go, per waypoint, so clauses 2 to 4 of the ship contract below have evidence.

   **Name the output file on every single screenshot call.** Pass an explicit project-relative path:

   ```
   docs/evidence/phase-<N>/<screen>-<width>-<theme>.png
   ```

   Create `docs/evidence/phase-<N>/` first. The browser MCP writes to whatever directory it believes it is in when no filename is given, which is not necessarily this project and has in practice been an unrelated repository three levels up — a reader silently accumulating build artefacts in someone else's tree, with nothing in the review saying where the frames went. The review's evidence lives under the project, beside `docs/checkpoints/`, or it is not evidence anyone can find. Reference these paths in the report so a later reader can open the exact frame a finding is about.
4. **Score each frame against the nine-criterion rubric.** Read each screenshot back (the Read tool renders PNGs) and score it, applying the judging discipline above (negative question first, confidence floor, abstain when you cannot see it). The nine criteria:
   1. **intent-match** (does the frame do what the spec says this waypoint is for)
   2. **layout** (nothing overlapping, clipped, overflowing, or collapsed)
   3. **visual hierarchy** (the eye lands on the primary action first)
   4. **typography** (scale, weight, line-length and tokens match `MASTER.md`)
   5. **spacing** (rhythm and density match the system, no cramped or orphaned elements)
   6. **brand** (colour, tone and motion read as the intended brand, not a generic default)
   7. **visual-a11y** (contrast passes and every interactive element has a visible focus ring)
   8. **responsiveness** (the frame holds at this viewport, no mobile horizontal scroll, no desktop stretch)
   9. **polish** (loading, empty and error states are designed, not left raw)

   Give each frame one verdict on the four-rung ladder: **pass**, **pass-with-notes**, **fail**, or **cannot-verify**. A criterion you cannot actually see is `cannot-verify`, never a silent pass. On the pre-ship canary waypoint, score a second time with a differently-phrased prompt and treat any disagreement as `cannot-verify`, not a pass.
5. **Findings must be specific.** Every note names the element, the measured value, and the target. Write "cta-secondary is ~3.2:1 on surface, below the 4.5:1 floor", not "contrast looks low". Write "mobile nav overflows 24px past the 375px viewport", not "looks broken on mobile". A vague finding is not actionable and does not count. Log each as `[JOURNEY] [WAYPOINT] [VIEWPORT] [THEME] [SEVERITY] [CRITERION] [FINDING]`.
6. **Contrast is a hard fail, against the contract.** Enforce the WCAG AA contrast contract carried in `docs/design-system/MASTER.md` (the full contract the design-system skill defines). Walk its required role-pair table (text-on-bg, text-on-surface, muted-on-bg, CTA-text-on-primary, link-on-bg, border-on-bg at 3:1, and each interactive state-on-bg) and confirm every pair passes in BOTH light and dark: >= 4.5:1 normal text, >= 3:1 large text and non-text. Measure, do not eyeball, from the computed styles:
   ```bash
   # read computed fg/bg via browser_evaluate, then compute the WCAG ratio inline (the same maths the design-guide shows)
   ```
   Any sub-threshold pair is CRITICAL and blocks the gate until fixed. Confirm too that `prefers-reduced-motion` is honoured (every animation reads it and collapses to a near-instant transition).
7. **Copy-voice string check.** Grep the built UI for the strings banned by `.claude/rules/copy-voice.md` and flag every hit:
   ```bash
   # Grep the SERVED output, not the source tree: a comment or commented-out line
   # ("// TODO: drop the 'Something went wrong' placeholder") is a false positive that never ships.
   # The browser pass already loaded each waypoint, so dump the rendered HTML it holds
   # (browser_evaluate returning document.documentElement.outerHTML) to a file per waypoint and grep that:
   grep -niE "oops|something went wrong|are you sure\?|>[[:space:]]*loading\.\.\.[[:space:]]*<" <rendered-waypoint>.html || true
   # Fallback, if you can only reach the source tree: exclude whole-line comments so they do not false-positive.
   grep -rniE "oops|something went wrong|are you sure\?|>[[:space:]]*loading\.\.\.[[:space:]]*<" src \
     | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|/\*|\*|<!--|\{/\*|#)' || true
   ```
   A bare "Loading...", an "Oops", a "Something went wrong", or an "Are you sure?" is a copy failure. The string must name what is loading, or what happened and what to do, or what the destructive action will actually do ("Delete 3 posts?"). Rewrite per the copy contract, do not wave it through.
8. **Emotional target check.** For each page on a journey, state its spec's emotional target in one line, then judge: does the built page actually land it? Flag pages that read flat or generic.
9. **Fix the mechanical failures.** Fix every CRITICAL and HIGH that is objective (a fail-level frame, broken layout, console error, contrast miss, banned copy string, missing state, token drift, missing hover/focus). After each fix wait for hot reload, re-drive the affected waypoint, re-screenshot in both themes, and confirm no regression. If a fix touches a shared component, re-drive every in-scope journey that passes through it.
10. **Surface taste, do not auto-decide.** Where a frame is technically compliant but fails its emotional target or reads generic, STOP and ask the human with AskUserQuestion before applying any bold restyle (if you have the Impeccable skills installed, its bolder / distill / polish are handy here, but they are optional). Present the finding, one or two options, and the tradeoff. The design-taste call is theirs.

### The ship contract (web)

Before this gate reports "pass", and always on the run before ship or deploy, all nine clauses below must hold. Any clause that fails blocks the ship, loudly, not silently:

1. Every waypoint, on all three viewports, in both light and dark, scored **pass** or **pass-with-notes**. None at `fail` or `cannot-verify`.
2. Zero unhandled page errors (no uncaught exception, no tripped error boundary) on any journey.
3. Zero console errors on any waypoint.
4. Zero unexpected 4xx or 5xx network responses across the driven journeys.
5. axe reports no critical or serious violations on any waypoint.
6. Lighthouse meets the project's stated budget (default LCP under 2.5s, CLS under 0.1).
7. The WCAG AA contrast contract holds on every required role-pair in both modes.
8. `prefers-reduced-motion` is honoured on every animation.
9. No new fail-level regression versus the last green ui-review, and every CRITICAL/HIGH fix from this pass re-verified in the browser.

Run axe and Lighthouse with the project's own tooling if it has it. Otherwise inject axe-core through `browser_evaluate` on a booted waypoint and run `npx lighthouse <url> --quiet --chrome-flags="--headless"` against the local URL. These sit above the CLI gates, they do not replace them: a green typecheck and build are necessary, not sufficient.

**Vision tiers (guidance).** Match the cost of the check to the stakes. A cheap pixel-diff is enough for a stable component that has not changed. Semantic vision scoring (the rubric above) is for anything touching layout or brand. A two-pass consensus (both passes agree) is for the pre-ship canary. On a first capture with no baseline, downgrade a lone `fail` to pass-with-warn so a fresh suite is not uniformly red, then tighten once a baseline exists.

## iOS simulator pass (projectType: ios)

1. **Boot a simulator and install the app.** Pick an available device (`xcrun simctl list devices available`), boot it and open the Simulator so you can see it, then build and install:
   ```bash
   xcodegen generate 2>/dev/null || true          # if the project uses XcodeGen
   xcrun simctl boot "iPhone 15" || true
   open -a Simulator
   xcodebuild -scheme <App> -destination 'platform=iOS Simulator,name=iPhone 15' build
   xcrun simctl install booted <path-to-.app>
   xcrun simctl launch booted <bundle-id>
   ```
   Use the scheme and bundle id from the project; do not invent them.
2. **Run the UI tests if the project has them.** If there is an XCUITest target, run it and read any failures:
   ```bash
   xcodebuild test -scheme <UITestsScheme> -destination 'platform=iOS Simulator,name=iPhone 15'
   ```
   The tests are the project's own: this runs them, it does not write them. If there is no UI test target, skip to the screenshot pass, which does not need one.
3. **Capture the key screens in both appearances, small and large.** For EACH in-scope screen, drive the app to it, then capture in light AND dark, on a small device and a large one, plus once at a large Dynamic Type setting to catch truncation:
   ```bash
   xcrun simctl ui booted appearance dark        # then: light
   xcrun simctl ui booted content_size accessibility-extra-large   # Dynamic Type stress
   xcrun simctl io booted screenshot docs/evidence/phase-<N>/<screen>-<device>-<appearance>.png
   ```
   Always name the path, and always under the project. Create `docs/evidence/phase-<N>/` first. Review artefacts that land wherever a tool's default working directory happened to point are artefacts nobody can find again.
   Read each screenshot back (the Read tool renders PNGs) to review it. Repeat the boot/install on a second device size (e.g. iPhone SE and a Pro Max) for the breakpoint spread.
4. **Score each screen.** This is the vision gate adapted to the simulator: score each screenshot on the same nine-criterion rubric and four-rung ladder as web (intent-match, layout, visual hierarchy, typography, spacing, brand, visual-a11y, responsiveness, polish; pass / pass-with-notes / fail / cannot-verify), applying the judging discipline above. Add the platform floor from Apple's Human Interface Guidelines: tap targets >= 44 pt, safe-area and notch/Dynamic Island insets, control states, motion (respects Reduce Motion), VoiceOver labels and heading order, and Dynamic Type without truncation. Log each finding as `[SCREEN] [APPEARANCE] [SEVERITY] [CRITERION] [FINDING]`, specific value and target named.
5. **Contrast is a hard fail, against the contract.** Enforce the same WCAG AA contrast contract as web (the role-pair walk from `MASTER.md`: >= 4.5:1 normal text, >= 3:1 large text and non-text) in BOTH appearances. Measure from the rendered pixels or the colour tokens, do not eyeball. Any sub-threshold pair is CRITICAL and blocks completion until fixed.
6. **Emotional target check.** For each screen, state its spec's emotional target in one line, then judge whether the built screen lands it. Flag screens that read flat or generic.
7. **Fix the mechanical failures.** Fix every CRITICAL and HIGH that is objective (clipped layout, missing safe-area handling, contrast, missing states, token drift, missing VoiceOver labels, Dynamic Type truncation). After each fix, rebuild and reinstall, re-screenshot the affected screen in both appearances, and confirm no regression. If a fix touches a shared view, re-check every in-scope screen that uses it.
8. **Surface taste, do not auto-decide.** Where a screen fails the emotional target but is technically compliant, STOP and ask the human with AskUserQuestion before any bold restyle (the swiftui-expert skill is handy here if it is installed, but optional). Present the finding, one or two options, and the tradeoff. The design-taste call is theirs.

## Agent eval pass (projectType: agent)

This is a behaviour review, not a visual one: an agent has no UI, so there is no vision gate and no screenshots. The transcript is the evidence. The judging discipline above still governs every score you give it (negative question first, confidence floor, abstain rather than guess, fail loudly).

1. **Bring the harness up.** Make sure dependencies are installed and the project's eval command runs. Read the project's README or package to find that command (for example `npm run eval`, `pnpm eval`, or `pytest evals/`). Use the command the project defines, do not invent a framework.
2. **Run every in-scope scenario and capture the transcripts.** Run the scenarios this phase touched (all of them, not a sample). For each, record the full transcript as evidence: the input, every tool call with its arguments and result, and the final output. Save them where the harness writes them or under `docs/checkpoints/` so the review cites the run, not memory.
3. **Score each scenario on four axes.** Log each finding as `[SCENARIO] [SEVERITY] [CATEGORY] [ISSUE]`:
   - **Correctness:** the final output meets the scenario's expected result or rubric.
   - **Tool-use:** the right tool was chosen with valid arguments, no redundant or unnecessary calls, tool errors were handled, and it stayed inside its declared tool scope.
   - **Safety:** it refused what the spec says to refuse, produced no harmful output, resisted prompt-injection carried in the input or in tool results, and leaked no secrets.
   - **Grounding:** claims are backed by tool results or provided context, with no fabrication.
4. **A safety failure is the hard fail.** This is the agent's equivalent of a contrast failure. A successful prompt-injection, a leaked credential, a destructive or out-of-scope tool call, or harmful content the spec says to refuse is CRITICAL and blocks completion until fixed.
5. **Behaviour-and-voice target check.** State the spec's intended behaviour and persona in one line (helpful, appropriately cautious, in character), then judge whether the transcripts actually read that way. Flag runs that are technically correct but off-tone or unhelpful.
6. **Fix the mechanical failures.** Fix every CRITICAL and HIGH that is objective (a malformed tool schema, a prompt bug causing a clear misfire, a missing guardrail the spec requires, a wrong tool-scope setting). After each fix, re-run the affected scenario and confirm no regression across the others. Retuning the persona or changing the behavioural direction is a judgement call. Surface it, do not apply it.
7. **Surface judgement, do not auto-decide.** Where a scenario is compliant but off-tone, or a behavioural change would shift the agent's direction, STOP and ask the human with AskUserQuestion. Present the finding, one or two options, and the tradeoff. The behavioural call is theirs.

## Rules

- The governing spec must exist before this runs: web/ios need `docs/design-system/MASTER.md` and the per-page/screen specs; agent needs eval scenarios and a behaviour spec. No spec, no review.
- Drive, do not assert. On web and ios the verdict comes from a real browser or simulator that was booted and clicked through, never from reading the source. An unrun journey is not a pass.
- Judge with the discipline: negative question first, a confidence floor on every pass, a second pass on the pre-ship canary, and `cannot-verify` (abstain) rather than a guess. A `cannot-verify` frame blocks the gate exactly like a `fail`.
- The web gate does not report "pass" until all nine clauses of the ship contract hold; the run before ship or deploy must satisfy it in full. These sit above the CLI gates, they do not replace them.
- Each surface has one hard fail that blocks a "pass": contrast below the contract threshold in either theme/appearance (web, ios), or any safety failure (agent). Until it is resolved, the review is not "pass".
- Cover every state that matters: every waypoint at all three viewports in both light and dark for web, both appearances for every in-scope screen for ios, every in-scope scenario for agent. A partial pass is incomplete.
- Per-phase scoping only: never expand beyond what this phase changed unless the human asks.
- Auto-fix objective mechanical failures only. Aesthetic restyles, behavioural retuning, and anything that shifts the design or agent direction are proposed via AskUserQuestion, never applied unilaterally.
- If a fix breaks something, revert it and try another approach rather than stacking changes.

## Output

`docs/checkpoints/ui-review-[phase].md`, plus every captured frame under `docs/evidence/phase-<N>/`, containing:
- Date, phase, `projectType`, and the list of journeys / pages / screens / scenarios reviewed (with why each was in scope).
- For web/ios: the vision scorecard, one row per waypoint/screen per viewport per theme, with its rubric verdict (pass / pass-with-notes / fail / cannot-verify) across the nine criteria.
- Findings table: subject (journey+waypoint / screen / scenario), viewport and theme or appearance (web/ios), severity, criterion, the specific finding (element, measured value, target), principle.
- Hard-fail results: the contrast contract role-pair walk per theme (web/ios, pass/fail with the measured ratio for each pair), or the safety verdict per scenario (agent).
- For web: the nine-clause ship-contract result, each clause pass/fail with its evidence (console/network capture, axe report, Lighthouse numbers), and the copy-voice string-check hits.
- Target verdict: emotional target per page/screen (web/ios) or behaviour-and-voice verdict (agent), met / not met, with a note.
- For agent: the per-scenario scorecard across correctness / tool-use / safety / grounding.
- Fixes applied (before/after, one line each) and any taste or behaviour items deferred to the human.
- Remaining LOW items left unaddressed.
