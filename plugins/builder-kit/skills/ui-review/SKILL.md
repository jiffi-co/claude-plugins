---
name: ui-review
description: Use when a build phase touched the user-facing surface and the user asks to review it, or names the ui-review skill, to take a rigorous second look at what was built against the spec. The surface branches on projectType in .claude/builder-kit.json. On web it drives real pixels with Playwright across light and dark themes; on ios it drives the app in a simulator (screenshots + XCUITest); on agent it runs its eval scenarios and reviews the transcripts. Also run once more before ship/deploy.
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
   - **web:** the pages and components this phase changed. Locate them by the project's frontend framework (read it from `docs/adr/` or `package.json`), not by assuming one layout: Next.js App Router keeps them under `src/app` and `src/components`; SvelteKit under `src/routes/**/+page.svelte` and `src/lib/components`; other frameworks use their own convention (Vue/Nuxt `pages`/`components`, Astro `src/pages`, and so on). Grep for whatever those dirs actually are, e.g. `git diff --name-only HEAD~1 | grep -E 'src/app|src/components' || true` for a Next.js project.
   - **ios:** `git diff --name-only HEAD~1 | grep -E '\.swift$' || true`, then narrow to the views/screens this phase changed.
   - **agent:** `git diff --name-only HEAD~1 | grep -E 'prompts|tools|agents?|eval' || true` (the prompts, tool definitions, graph, or scenarios this phase changed).
   - If nothing in your surface changed, stop and report "no review needed".
3. **Load the governing spec.**
   - **web / ios:** read `docs/design-system/MASTER.md` (palette, type, spacing, motion) and `docs/design-system/pages/` for each in-scope page or screen spec, including its **emotional target**. If `MASTER.md` is missing, stop: the design system must exist first.
   - **agent:** read the agent's behaviour spec (`docs/prd/prd.md` and any `docs/agents/` contract) and the eval scenarios the project defines. If there are no scenarios to run, stop: an agent build cannot be reviewed without them.
4. **Run the review for your surface.** Use the block for your `projectType` below.
5. **Write the report** at `docs/checkpoints/ui-review-[phase].md` (see Output), then hand back for the human review gate.

## Web browser pass (projectType: web, the default)

1. **Confirm the server.** Ensure the dev server is up (`npm run dev`); if not, start it and wait for the local URL.
2. **Capture both themes, three breakpoints.** For EACH in-scope page, using Playwright MCP: navigate, then screenshot at 1440 / 768 / 375 px in light mode AND dark mode (toggle theme via the app's control or `data-theme` on the root). Capture console messages and failed network requests per page.
3. **Score each page.** Against the spec and `MASTER.md`, check: colour/type/spacing tokens, hover + focus states, motion (ease-out, respects `prefers-reduced-motion`), loading/empty/error states, keyboard reachability, heading hierarchy, alt text, and INP-friendly response feedback. Log each finding as `[PAGE] [THEME] [SEVERITY] [CATEGORY] [ISSUE]`.
4. **Contrast is a hard fail.** For text and interactive elements in BOTH themes, verify >= 4.5:1 (>= 3:1 for large text and UI borders). Dark mode especially. Measure, do not eyeball:
   ```bash
   node -e "/* WCAG ratio from computed fg/bg */" # or read computed styles via browser_evaluate
   ```
   Any sub-threshold pair is CRITICAL and blocks completion until fixed.
5. **Emotional target check.** For each page, state its spec's emotional target in one line, then judge: does the built page actually land it? Flag pages that read flat or generic.
6. **Fix the mechanical failures.** Fix every CRITICAL and HIGH that is objective (broken layout, console errors, contrast, missing states, token drift, missing hover/focus). After each fix wait for hot reload, re-screenshot the affected page in both themes, and confirm no regression. If a fix touches a shared component, re-check every in-scope page that uses it.
7. **Surface taste, do not auto-decide.** Where a page fails the emotional target or feels generic but is technically compliant, STOP and ask the human with AskUserQuestion before applying any bold restyle (if you have the Impeccable skills installed, its bolder / distill / polish are handy here, but they are optional). Present the finding, one or two options, and the tradeoff. The design-taste call is theirs.

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
   xcrun simctl io booted screenshot <path>.png
   ```
   Read each screenshot back (the Read tool renders PNGs) to review it. Repeat the boot/install on a second device size (e.g. iPhone SE and a Pro Max) for the breakpoint spread.
4. **Score each screen.** Against the spec, `MASTER.md`, and Apple's Human Interface Guidelines as the platform floor: colour/type/spacing tokens, tap targets >= 44 pt, safe-area and notch/Dynamic Island insets, control states, motion (respects Reduce Motion), loading/empty/error states, VoiceOver labels and heading order, and Dynamic Type without truncation. Log each finding as `[SCREEN] [APPEARANCE] [SEVERITY] [CATEGORY] [ISSUE]`.
5. **Contrast is a hard fail.** Same threshold as web (>= 4.5:1, >= 3:1 for large text and UI borders), in BOTH appearances. Measure from the rendered pixels or the colour tokens, do not eyeball. Any sub-threshold pair is CRITICAL and blocks completion until fixed.
6. **Emotional target check.** For each screen, state its spec's emotional target in one line, then judge whether the built screen lands it. Flag screens that read flat or generic.
7. **Fix the mechanical failures.** Fix every CRITICAL and HIGH that is objective (clipped layout, missing safe-area handling, contrast, missing states, token drift, missing VoiceOver labels, Dynamic Type truncation). After each fix, rebuild and reinstall, re-screenshot the affected screen in both appearances, and confirm no regression. If a fix touches a shared view, re-check every in-scope screen that uses it.
8. **Surface taste, do not auto-decide.** Where a screen fails the emotional target but is technically compliant, STOP and ask the human with AskUserQuestion before any bold restyle (the swiftui-expert skill is handy here if it is installed, but optional). Present the finding, one or two options, and the tradeoff. The design-taste call is theirs.

## Agent eval pass (projectType: agent)

This is a behaviour review, not a visual one: there are no screenshots. The transcript is the evidence.

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
- Each surface has one hard fail that blocks a "pass": contrast below threshold in either theme/appearance (web, ios), or any safety failure (agent). Until it is resolved, the review is not "pass".
- Cover every state that matters: both light and dark for every in-scope page or screen (web, ios); every in-scope scenario (agent). A partial pass is incomplete.
- Per-phase scoping only: never expand beyond what this phase changed unless the human asks.
- Auto-fix objective mechanical failures only. Aesthetic restyles, behavioural retuning, and anything that shifts the design or agent direction are proposed via AskUserQuestion, never applied unilaterally.
- If a fix breaks something, revert it and try another approach rather than stacking changes.

## Output

`docs/checkpoints/ui-review-[phase].md`, containing:
- Date, phase, `projectType`, and the list of pages / screens / scenarios reviewed (with why each was in scope).
- Findings table: subject (page/screen/scenario), theme or appearance (web/ios), severity, category, issue, principle.
- Hard-fail results: contrast per page/screen per theme (web/ios, pass/fail with the measured ratio), or the safety verdict per scenario (agent).
- Target verdict: emotional target per page/screen (web/ios) or behaviour-and-voice verdict (agent): met / not met, with a note.
- For agent: the per-scenario scorecard across correctness / tool-use / safety / grounding.
- Fixes applied (before/after, one line each) and any taste or behaviour items deferred to the human.
- Remaining LOW items left unaddressed.
