---
name: brand
description: Pick the brand by looking at real options in a browser (tone of voice, palette, type pairing, imagery, whole direction) and record the choices under docs/brand/. Reconciles with any ingested brand guide and hands the result to design-system. Fires when docs/prd/prd.md is approved and docs/brand/ does not exist yet.
allowed-tools: [Read, Write, Bash, AskUserQuestion]
---

# Brand

Pick the brand by looking at it, not by imagining it. This skill runs the human through five ordered visual choices (tone, palette, type, imagery, whole direction) and records what they chose under `docs/brand/`, so the design-system skill starts from a real brand instead of inventing a look. Brand taste is one of the four human gates, so nothing here is auto-answered.

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach); adapt tone and confirmation frequency, never fork the content, never skip a human gate.

## When to use / when not

- Use after the PRD is approved (`docs/prd/prd.md` exists) and before the design-system skill turns a brand into tokens. Brand sits between the PRD and design-system.
- Do not use before the PRD exists, and do not silently default the look; picking the brand is this skill's whole job and it is a human gate.
- Advanced escape hatch (`experienceLevel: advanced`): a builder who already has a brand can bring it. Point them to drop the brand guide into `docs/brand/` (or `docs/ingest/sources/` if it came in through ingest), then skip straight to step 6 to record it and reconcile. Skipping records why in `docs/brand/brand.md`, so the record stays honest.

## Present-visually rule (N10)

**Every picker is handed over as one clickable line.** Each time you write one of the five HTML files, end that turn with its absolute `file://` URL alone on its own line, so the terminal renders it as a link and the builder is one click from their own brand:

```
file:///Users/you/your-project/docs/brand/palette.html
```

Run `pwd` if you need the absolute project path rather than guessing it. A relative path the builder has to reassemble is a file most people never open, and an unopened picker means the taste gate gets answered from prose, which is the exact failure this rule exists to stop.

Every one of the five choices below is shown, never described. For each step write a self-contained HTML file into `docs/brand/` (inline CSS only, zero external dependencies, no CDN, no web fonts unless embedded), tell the builder the exact path to open in a browser, and let them choose by looking. Never ask them to imagine a look or pick from a hex list or prose. Any HTML that shows a colour pairing must display the pairing's computed WCAG contrast ratio and its AA verdict, calculated in an inline `<script>` from the relative-luminance formula (so the number the builder sees on screen is real, not eyeballed). Before that HTML is written, verify the same numbers out of band with Bash: run the exact relative-luminance and contrast-ratio node maths the design-system contrast contract specifies (`skills/design-system/SKILL.md`, `luminance` / `ratio` / `pickTextOn`) over each candidate palette's role pairs, read the ratios off stdout, and only offer a palette whose every required pair passes. The out-of-band Bash check and the inline `<script>` compute the same formula, so the verdict on screen matches the one you verified.

**The contrast contract binds every candidate palette (Win 7).** This skill picks the colours the whole product inherits, so a palette that reads well as swatches but fails a real role pair poisons every screen downstream. Before a palette is offered as a candidate, it must pass the full role-pair contract in the design-system skill (`skills/design-system/SKILL.md`), not just the one hero pairing on the swatch: walk text-on-bg, text-on-surface, muted-on-bg, CTA-text-on-primary, link-on-bg, border-on-bg (3:1 for the non-text border) and each interactive state (hover, active, disabled-that-still-must-read) on its background, and it must pass in BOTH light and dark. Body text and equivalents need 4.5:1, large text and non-text UI need 3:1, at a 4.5:1 tolerance of about +/- 0.05. Pick the foreground per background (black or white, whichever computes higher against that token) rather than hardcoding white, since a token-derived surface can be light or dark. Do not offer a palette where any required pair fails in either mode: fix it before it is shown (nudge the token, or drop the palette), never present a failing pair and call the warning noise. The same inline script that prints the swatch ratio walks these pairs, so the verdict on screen is the real one. Any HTML this skill generates also inherits the mode-agnostic parts of the contract: every interactive element (a swatch a builder clicks, a mini-mock button) carries a visible `:focus-visible` outline, and any motion reads `prefers-reduced-motion` and collapses to roughly 40ms.

## Process

1. **Read the inputs.** Read `CLAUDE.md`, `docs/prd/prd.md` (product personality, key screens, target users), and `docs/idea/idea-pack.md` (who this is for, the tone the problem deserves). If the project came through the ingest skill, also read `docs/ingest/bible.md` (the visual fingerprint) and `docs/decisions.md` for any `[D]` brand facts, and note them as the starting point rather than a blank slate. Read `.claude/builder-kit.json` for `projectType` so imagery and directions suit web, ios or agent.
2. **Tone of voice.** Write `docs/brand/tone.html`: a four-axis spectrum (Formal to Casual, Serious to Playful, Matter-of-fact to Enthusiastic, Respectful to Irreverent) with the SAME real message from this product written at each end of every axis, so the builder reads the difference rather than guessing it. Draw the message from a real screen in the PRD (an empty state, an error, a welcome), never lorem ipsum. Tell them to open it, then use `AskUserQuestion` to capture a position on each axis. Record the chosen position and the winning copy samples in `docs/brand/tone-of-voice.md`.
3. **Palette.** Write `docs/brand/palette.html`: two or three candidate palettes rendered as swatches (primary, secondary, accent, neutrals, surface, text), each pairing shown with its computed WCAG contrast ratio and AA verdict via the inline script. Bias candidates toward the tone chosen in step 2. Before a palette goes on screen as a candidate, walk it through the full role-pair contract in both light and dark (the rule above): only palettes where every required pair passes are offered, and the html shows each pair's real ratio so the human can see it held. If biasing toward the tone leaves a palette with a failing pair, adjust the token until it passes or drop that palette, do not offer it faded or hope the warning is ignored. Tell them to open it, capture the pick with `AskUserQuestion`, and record the chosen palette in `docs/brand/palette.md`.
4. **Type pairing.** Write `docs/brand/type.html`: two or three heading-and-body font pairings rendered at real sizes with real product copy (a heading, a paragraph, a button label, a caption), so density and personality are visible. Prefer system or open fonts that the design-system skill can actually install; if a font is not web-safe, embed it in the HTML rather than link it. Capture the pick, record it in `docs/brand/type.md`.
5. **Imagery and illustration direction.** Write `docs/brand/imagery.html`: two or three directions (for example photographic, flat illustration, geometric or abstract, iconographic) shown as labelled placeholder blocks with a one-line rule for each (what belongs, what does not). For an agent project with no UI surface, keep this light or note it does not apply. Capture the pick, record it in `docs/brand/imagery.md`.
6. **Whole direction.** Write `docs/brand/directions.html`: two or three complete mini-mocks that combine the tone, palette, type and imagery already chosen into a small real screen from the PRD (a card, a header, a primary button, a line of body copy), so the builder judges the whole rather than the parts. Tell them to open it, capture the single winning direction with `AskUserQuestion`, and consolidate the five choices into `docs/brand/brand.md` (see Output).
7. **Reconcile with any ingested or supplied brand guide.** If a brand guide exists (from ingest, or brought in by an advanced builder), compare its stated colours, type, tone and imagery against the choices just made. Where they agree, note it. Where they conflict, surface every conflict with `AskUserQuestion` and let the human resolve it; never silently overwrite the guide and never silently override a fresh choice. Record how each conflict was resolved in `docs/brand/brand.md`.
8. **Hand off.** Report the files written and the five decisions captured, ending with the clickable line for the consolidated brand:

   ```
   file:///Users/you/your-project/docs/brand/brand.md
   ```

   Then tell the builder the next step is the design-system skill, which reads `docs/brand/brand.md` as its starting point and turns the brand into tokens. Do not turn the brand into tokens here; that is the design-system skill's job.

## Rules

- Every visual choice is shown in a browser, never described in prose or a hex list (the N10 rule above). Real product copy in every mock, never lorem ipsum.
- Brand taste is a human decision and one of the four gates. Interview with `AskUserQuestion`; never auto-answer a choice, and never skip the gate regardless of `assistanceMode`.
- **Non-interactive runs.** When `AskUserQuestion` cannot reach a human (a background or automated run, a subagent with no interactive channel), do not hang on the taste gate and do not silently pretend a choice was made. Record each of the five choices (tone, palette, type, imagery, whole direction) as the safest default the inputs justify, tag every one `confirm before design-system` in `docs/brand/brand.md`, and note in the same file that the taste gate is still open. The gate is deferred, not closed: the human confirms or overrides each default before the design-system skill consumes the brand. Interactive is the default; this is the fallback.
- Every colour pairing carries its computed WCAG contrast ratio and AA verdict, and every candidate palette passes the full role-pair contract (text-on-bg, text-on-surface, muted-on-bg, CTA-text-on-primary, link-on-bg, border-on-bg, each interactive state) in both light and dark before it ships as a candidate, per the design-system contrast contract. Never offer a palette that passes in one mode only, and never lean on opacity-faded text to fake a pass. If a brand colour the human insists on cannot reach AA, flag it and recommend an accessible adjustment rather than silently restyling their brand.
- An ingested or supplied brand guide is authoritative for what it states. Reconcile and surface conflicts, do not resolve them silently.
- Do not compute tokens, a semantic layer or a theme scaffold here; hand the chosen brand to the design-system skill.
- Do not proceed to design-system until `docs/brand/brand.md` exists and the direction is chosen.

## Output

**One clickable line per picker as it is written**, and one for `docs/brand/brand.md` at the hand-off: `file://` plus the absolute path, alone on its own line. A picker nobody opened is a taste gate answered from prose.

Under `docs/brand/`:

- `tone-of-voice.md`, `palette.md`, `type.md`, `imagery.md`: the four component choices, each recording what was chosen and why.
- `tone.html`, `palette.html`, `type.html`, `imagery.html`, `directions.html`: the self-contained pickers the builder opened to choose (kept so a later reviewer can see what was on the table).
- `brand.md`: the consolidated brand the design-system skill consumes. It contains the chosen tone position and winning copy samples, the chosen palette (with each pairing's AA-verified contrast ratio), the chosen type pairing, the chosen imagery direction, the winning whole direction, and a Reconciliation section listing any conflict with an ingested or supplied brand guide and how the human resolved it. If an advanced builder skipped the five steps to bring their own brand, record that here, name the source, and note which parts are stated versus inferred.
