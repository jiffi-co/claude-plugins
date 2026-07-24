---
name: ui-review
description: Use when a build phase touched frontend pages and the user asks to review the UI, or says /ui-review, to drive real pixels with Playwright MCP across light and dark themes against the design system. Also run once more before deploy.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, mcp__playwright__browser_navigate, mcp__playwright__browser_resize, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_snapshot, mcp__playwright__browser_console_messages, mcp__playwright__browser_network_requests, mcp__playwright__browser_click, mcp__playwright__browser_evaluate]
---

# UI Review

Drives the running app with Playwright MCP and checks every changed page against the design system in BOTH light and dark themes. Produces a scored report and fixes the mechanical failures. Dark-mode contrast is a hard fail. Taste calls stay yours.

## When to use / when not

- Use after any build phase that changed frontend pages, and once more before deploy.
- Not for backend-only phases, and not a substitute for the human design-taste gate: this checks compliance and contrast, it does not overrule your aesthetic decisions.

## Process

1. **Scope to what changed.** Do not review the whole app blindly. Find the pages this phase touched:
   ```bash
   git diff --name-only HEAD~1 | grep -E 'src/app|src/components' || true
   ```
   Cross-reference `docs/implementation-plan.md` for the current phase's pages. Build the review list from the intersection. If nothing frontend changed, stop and report "no UI review needed".
2. **Load the rules.** Read `docs/design-system/MASTER.md` (palette, type, spacing, motion) and `docs/design-system/pages/` for each in-scope page spec, including its **emotional target**. If `MASTER.md` is missing, stop: the design system must exist first.
3. **Confirm the server.** Ensure the dev server is up (`npm run dev`); if not, start it and wait for the local URL.
4. **Capture both themes, three breakpoints.** For EACH in-scope page, using Playwright MCP: navigate, then screenshot at 1440 / 768 / 375 px in light mode AND dark mode (toggle theme via the app's control or `data-theme` on the root). Capture console messages and failed network requests per page.
5. **Score each page.** Against the spec and `MASTER.md`, check: colour/type/spacing tokens, hover + focus states, motion (ease-out, respects `prefers-reduced-motion`), loading/empty/error states, keyboard reachability, heading hierarchy, alt text, and INP-friendly response feedback. Log each finding as `[PAGE] [THEME] [SEVERITY] [CATEGORY] [ISSUE]`.
6. **Contrast is a hard fail.** For text and interactive elements in BOTH themes, verify >= 4.5:1 (>= 3:1 for large text and UI borders). Dark mode especially. Measure, do not eyeball:
   ```bash
   node -e "/* WCAG ratio from computed fg/bg */" # or read computed styles via browser_evaluate
   ```
   Any sub-threshold pair is CRITICAL and blocks completion until fixed.
7. **Emotional target check.** For each page, state its spec's emotional target in one line, then judge: does the built page actually land it? Flag pages that read flat or generic.
8. **Fix the mechanical failures.** Fix every CRITICAL and HIGH that is objective (broken layout, console errors, contrast, missing states, token drift, missing hover/focus). After each fix wait for hot reload, re-screenshot the affected page in both themes, and confirm no regression. If a fix touches a shared component, re-check every in-scope page that uses it.
9. **Surface taste, do not auto-decide.** Where a page fails the emotional target or feels generic but is technically compliant, STOP and ask the human with AskUserQuestion before applying any bold restyle (if you have the Impeccable skills installed, its bolder / distill / polish are handy here, but they are optional). Present the finding, one or two options, and the tradeoff. The design-taste call is theirs.
10. **Write the report** at `docs/checkpoints/ui-review-[phase].md` (see Output), then hand back for the human review gate.

## Rules

- `docs/design-system/MASTER.md` and the per-page specs must exist before this runs.
- Contrast below threshold in either theme is a hard fail: the review is not "pass" until it is resolved.
- Both light and dark themes are captured for every in-scope page. A single-theme review is incomplete.
- Per-phase scoping only: never expand beyond the pages this phase changed unless the human asks.
- Auto-fix objective mechanical failures only. Aesthetic restyles and any change that alters the design direction are proposed via AskUserQuestion, never applied unilaterally.
- If a fix breaks something, revert it and try another approach rather than stacking changes.

## Output

`docs/checkpoints/ui-review-[phase].md`, containing:
- Date, phase, and the list of pages reviewed (with why each was in scope).
- Findings table: page, theme, severity, category, issue, principle.
- Contrast results per page per theme (pass/fail with the measured ratio).
- Emotional-target verdict per page (target, met / not met, note).
- Fixes applied (before/after, one line each) and any taste items deferred to the human.
- Remaining LOW items left unaddressed.
