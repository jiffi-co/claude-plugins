---
name: wireframe
description: Draw a low-fi wireframe per screen so the human approves the SHAPE before any taste is spent, with grey boxes, real labels and real microcopy, no colour and no brand, and a data-testid on every interactive element for later traceability. Page specs are used when they exist and are not required. Fires when docs/prd/prd.md names the screens and docs/wireframes/ is empty, before brand and design-system spend any taste on them.
allowed-tools: [Read, Write, Glob, AskUserQuestion, Skill]
---

# Wireframe

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

Prove the layout before you spend any taste on it. This skill draws a low-fi wireframe per screen, grey boxes with the real words in them, so the human approves the structure and flow while it is still cheap to change. No colour, no brand, no fonts. Those come next, in the design-system skill, and they are wasted effort if the shape is wrong. Every interactive element carries a `data-testid`, which becomes the traceability contract that verify-acs and ui-review lean on later.

Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach); adapt tone and confirmation frequency, never fork the content, never skip a human gate.

## When to use / when not

- Use once the PRD names the screens, and before the design-system skill runs, so the human signs off on the shape of each screen before any palette, type or brand decision is made. **Page specs are welcome, not required.** The guide runs this a step before `page-specs` does its work, so a precondition of "after page specs exist" is one this skill is routinely asked to break, and a precondition nobody can meet is worse than no precondition: it teaches readers to ignore the line. Step 1 already says what to do without them.
- Do not use before the PRD exists (there is nothing to wireframe yet), and do not add colour, brand or real fonts here; a wireframe that looks designed invites feedback on the paint instead of the structure, which is the opposite of the point.

## Process

1. Read the inputs so the wireframes match the agreed product: `docs/prd/prd.md` (screens, flows, key content), `docs/implementation-plan.md` if it exists (what ships in which phase), and the page specs if they exist (`docs/specs/` or wherever page-specs wrote them; use Glob to find them). If any screen has no spec, wireframe it from the PRD and record the assumption at the top of `docs/wireframes/README.md`. That is the normal case at this point in the guide, not a degraded one, so say it plainly rather than apologising for it.
2. **Advanced escape hatch.** If `experienceLevel` is `advanced`, offer to skip this stage with `AskUserQuestion`. Skipping is allowed only with a stated reason (for example the human is porting a known layout, or wireframes already exist). Record the reason at the top of `docs/wireframes/README.md` so the skipped stage is on the record, then hand to design-system. A beginner run does not offer the skip; the shape gate matters most for the least experienced builder.
3. List the screens to draw. Derive the set from the page specs and the PRD's flows. Confirm the list with the human before drawing (one short `AskUserQuestion`) so a missing or extra screen is caught before you write files, not after.
4. For each screen, write a self-contained low-fi HTML file to `docs/wireframes/<screen>.html` (shape below). Include `<meta charset="utf-8">` in the `<head>` so a file opened straight in a browser renders every character correctly (without it, non-ASCII characters in the real microcopy corrupt). One file per screen, named by the screen's route or spec id so a reviewer can map file to screen at a glance. Grey boxes only: greyscale fills, plain borders, system font, no imagery. Put the REAL labels and REAL microcopy in (the actual button text, the actual field labels, the actual empty-state and error copy from the specs), not lorem ipsum, because the words are part of the shape the human is approving.
5. Put a `data-testid` on every interactive element (every button, link, input, select, tab, toggle, menu). Use a stable, human-readable id that names the element and its screen, for example `data-testid="signup-email-input"` or `data-testid="dashboard-new-build-button"`. This is a contract: keep the ids stable, list them, and later stages reference the same ids. A non-interactive label does not need one. Because these ids mark the interactive elements, they are also the elements the accessibility parts of the contrast contract (step 6) apply to: each one must be keyboard-focusable with a visible focus ring.
6. Write `docs/wireframes/README.md`: an index linking every screen file, the flow order between screens, and a **data-testid contract** table (screen, element, testid) that lists every id you assigned. Note in it that verify-acs and ui-review read this contract to trace an acceptance criterion to the element that satisfies it, so the ids must not drift once the build starts.
7. **Present visually, do not describe, and hand them one clickable line.** End with the absolute `file://` URL of the index, built from the project's working directory, alone on its own line so the terminal renders it as a link:

   ```
   file:///Users/you/your-project/docs/wireframes/README.md
   ```

   One line, every time. It is the difference between "it wrote some files" and the builder looking at their own screens, and a path they have to reassemble by hand is a path most people never open. Say that opening the index walks the flow in order. Do not summarise the layout in prose and ask them to picture it; the whole method is that they approve by looking.
8. Capture approval or corrections with `AskUserQuestion`, one screen or one batch at a time so each answer is concrete. Apply corrections to the files and re-present until the human approves the shape. Approval here is a checkpoint on the structure, not the four human gates; the taste gate is design-system's, next.
9. Hand off to the design-system skill, which turns the approved shapes into a styled system. Note that the wireframes and their testid contract stay as the structural reference the styled screens are checked against.

## Rules

- Australian English. Plain, direct language. No filler.
- Low-fi only: greyscale, system font, no colour, no brand, no real imagery. If it looks designed, it is too finished for this stage.
- Real words, not placeholder text: the labels, button text, and microcopy come from the specs and are part of what the human approves.
- Every interactive element gets a stable, descriptive `data-testid`; the id set is a contract that verify-acs and ui-review depend on, so do not rename ids once the build starts.
- Each wireframe HTML file is self-contained (inline CSS, zero external dependencies) and declares `<meta charset="utf-8">` in its `<head>` so opening the file in a browser just works, offline, with nothing to install, and non-ASCII characters in the real microcopy render correctly rather than as mojibake.
- The contrast contract (the WCAG AA contract in the design-system skill, `skills/design-system/SKILL.md`) applies to any HTML this skill generates, including a greyscale wireframe. Being greyscale, a wireframe inherits the mode-agnostic parts of it rather than the full role-pair colour walk (palette work is the brand and design-system skills' job): the grey label text on its grey box must still clear 4.5:1 WCAG 2 AA in both light and dark (so do not settle for faint grey on a barely-different grey, and if the file styles a dark mode at all, check both), every interactive element carries a visible `:focus-visible` outline (do not remove the default without replacing it) and is reachable in a sensible tab order, and any motion reads `prefers-reduced-motion` and collapses to roughly 40ms. A wireframe has almost no colour and usually no motion, so this is a light check, but it is the same contract the styled screens are held to later, applied early.
- A skip is allowed only for an `advanced` run and only with a recorded reason; a beginner run always draws the wireframes.
- Do not proceed to design-system until the human has approved the shapes, or explicitly and reasoned-ly skipped.

## Output

- **One clickable line in the reply**: `file://` plus the absolute path to `docs/wireframes/README.md`, on its own line. Without it the files are written and unseen.
- `docs/wireframes/<screen>.html`, one self-contained low-fi file per screen with `<meta charset="utf-8">` in the `<head>`: grey boxes, real labels and microcopy, no colour or brand, a `data-testid` on every interactive element.
- `docs/wireframes/README.md`: the screen index and flow order, the **data-testid contract** table (screen, element, testid) that later stages read, and, if the stage was skipped, the recorded reason.
