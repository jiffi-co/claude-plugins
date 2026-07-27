---
name: design-system
description: Interview the human for taste (mood, personality, brand), then write docs/design-system/MASTER.md plus a dual-mode token scaffold (light, dark, semantic, provider, toggle, FOUC). Fires when docs/adr/ carries an accepted styling and framework decision, the wireframes and brand are settled, and docs/design-system/MASTER.md does not exist.
allowed-tools: [Read, Write, Edit, Bash, Glob, AskUserQuestion, Skill]
---

# Design System

Turn the approved specs into a single source of visual truth at `docs/design-system/MASTER.md`, plus a dual-mode theme scaffold the build phase implements against. Taste is the human's call, so this skill interviews first and never defaults the look away.

Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach); adapt tone and confirmation frequency, never fork the content, never skip a human gate. Design-system taste is the third of the four human gates, so it never bypasses regardless of mode.

**Present visually (N10).** Every visual choice in this skill (palette, type pairing, spacing scale, radius, shadow, motion, or a whole direction) is shown, not described. Write a self-contained HTML file (inline CSS, zero external dependencies) that renders the options side by side, tell the builder to open it in a browser, and let them choose by looking. Never ask them to imagine a look, and never ask them to pick from a hex list or a prose description. Every colour pairing you show renders its computed WCAG AA contrast ratio next to it (the maths in **Contrast contract** below). Accumulate the chosen tokens into the living `docs/design-system/design-guide.html` (step 8), which renders the real, decided system as a browseable page.

**Contrast is a contract, not a warning.** Every token-derived text/background pair in any HTML this skill writes (the N10 pickers, the design guide, and the tokens the build phase inherits) MUST pass WCAG 2 AA in BOTH light and dark. The full contract (inline luminance and ratio maths, the adaptive foreground picker, the required role-pair walk, the escape ladder, the anti-pattern list, and the motion collapse) lives in **Contrast contract (WCAG 2 AA)** below. `wireframe`, `brand` and `ui-review` reference the same contract, so it is the one source of truth for contrast across the kit.

**Coaching authoring standard.** Every framed choice you put to the human gets a context-first plain-language headline (what this decides, before any jargon), a one-sentence why (what turns on it), and a reversibility tag (easy to change later, or a one-way door). This holds for the interview questions and the visual pickers alike.

## When to use / when not

- Use after the ADRs are accepted (the CSS approach, frontend framework and rendering strategy must be decided) and before page specs or any UI is built.
- Do not use before the PRD and ADRs exist, and do not silently invent a palette, personality or brand direction; that is the interview's job.

## Process

1. Read the inputs so the design fits the product: `CLAUDE.md`, `docs/prd/prd.md` (UI/UX requirements, key screens), `docs/idea/idea-pack.md` (personality, target users), `docs/brand/` (the `brand` skill's output, if it ran) and `docs/adr/` (chosen CSS approach, frontend framework, rendering strategy). Confirm the styling ADR, because the token scaffold must match it (Tailwind v4 uses CSS-first `@theme`, not a v3 config file).
2. Detect the branding path. If `docs/brand/` exists (tone-of-voice, palette, type pairing, imagery direction, chosen direction), take **Option B** and treat that output as the decided starting point: the taste was already picked by looking in the `brand` skill, so do not re-interview it. Turn those choices into tokens, and interview only for what brand left open (component states, density, motion). If the user has brand assets instead (guidelines, an existing site, tone notes) but no `docs/brand/`, also take **Option B**. Otherwise **Option A**. Ask which if unclear.
3. **Option B only: extract, then confirm.** Pull colours, type, spacing, component styles, radius, shadows, motion and personality from the assets. Present a summary split into **Extracted** (found), **Implied** (inferred), **Missing** (gaps the system still needs). This is the human's brand, so do not overwrite it.
4. **Interview for taste (HUMAN judgement, never auto-answer).** Use `AskUserQuestion`. Option A asks the full set; Option B asks only about the gaps from step 3. Cover:
   - Mood and personality (offer pairs to pick between, e.g. Friendly vs Professional, Minimal vs Feature-rich, Bold vs Understated).
   - Colour direction: colours drawn to or avoided; and confirm both light and dark are in scope (this skill scaffolds dual-mode by default).
   - Typography feel (geometric, humanist, or monospace/technical) and density (spacious vs compact).
   - Reference products they admire, to calibrate direction (not to copy).
   For any choice that is visual (a palette, a type pairing, a spacing or radius scale, a whole direction), do not settle it in the `AskUserQuestion` text alone. Write a self-contained HTML file to `docs/design-system/choices/` (inline CSS, zero external dependencies) that renders the candidates side by side, each colour pairing showing its computed WCAG AA ratio, tell the builder to open it in a browser, and let them pick by looking (the N10 rule above). The question then just records which one they chose.
   Stop and wait for answers. Do not proceed on assumptions.
   **Non-interactive runs.** When `AskUserQuestion` cannot reach a human (a background or automated run, a subagent with no interactive channel), do not hang on the interview and do not silently pretend a taste call was made. Generate from the safest defaults the inputs justify, emit every value as a `CANDIDATE` (step 7), and record each assumption in the Overview so the human can confirm or override before Part 6. Interactive is the default; this is the fallback.
5. Generate the system from the interview answers. This skill produces a complete, solid design system on its own, no external tooling required. Optionally, if you have the UI/UX Pro Max toolkit installed (a separate install, not bundled with builder-kit), you can lean on it for the palette, font pairing, component styles and spacing scale, and use `impeccable:frontend-design` for creative direction on hero, landing and first-impression surfaces. These are enhancements, not prerequisites.
6. Write `docs/design-system/MASTER.md` (shape below). It MUST include the full **Design Principles** section (Nielsen's 10 heuristics and the UX Laws) and the **Motion & Animation** section. Motion patterns follow the project's frontend framework (read it from `docs/adr/`): for the React family the `motion` package is the recommended default (install `motion`, not the legacy `framer-motion` alias, and its `initial`/`animate`/`exit` props are the worked example there); Vue/Nuxt uses its built-in `<Transition>`/`<TransitionGroup>` components plus `@vueuse/motion` (or `motion-v`); SvelteKit uses its built-in `transition:`/`animate:` directives and motion stores; other frameworks use whatever they treat as idiomatic. Recommend from these, do not mandate one framework's props onto another. CSS-only for trivial hovers everywhere.
7. Note the **dual-mode theme scaffold** in MASTER.md: light tokens, dark tokens, a semantic layer over both, a theme provider, a toggle, and an inline FOUC-prevention script that sets the theme before paint. Give every generated token a **concrete candidate value**, never the literal string `PLACEHOLDER`: a real hex derived from the interview answers (Option A) or the extracted brand (Option B), tagged for confirmation, e.g. `--color-primary: #4F46E5; /* CANDIDATE: confirm before Part 6 */`, whose white-on-primary pairing computes to 6.3:1 (AA pass). A bare `PLACEHOLDER` carries no hex, so the design system could not list its AA contrast pairings; a real candidate can, which is the point. An unconfirmed candidate is a value to confirm, not a blocker: nothing hard-fails on it, so the human confirms or swaps it in the design review before Part 6. A value the human explicitly gave (a confirmed brand colour, an exact colour named in the interview) is not a candidate and carries no tag.
8. Emit the living design guide. Write (or append to, on a re-run) `docs/design-system/design-guide.html`: a self-contained page (inline CSS, zero external dependencies) that renders the decided system as something the builder browses, not reads. Show the real colour swatches in both light and dark with each pairing's computed WCAG AA ratio and verdict beside it, the type scale in the chosen families, the spacing and radius steps, and the component states. This is the visual counterpart to `MASTER.md` (the guide shows the system, the MASTER records it) and it is the accumulation point for every choice made through the N10 pickers. Regenerate it from `MASTER.md` so the two never drift.
9. Report back: the files written (`MASTER.md` and `design-guide.html`), the taste decisions captured, and a one-line reminder that candidate values (anything tagged `CANDIDATE`) are the human's to confirm before Part 6, with the count still unconfirmed.

## Contrast contract (WCAG 2 AA)

Contrast is the one visual property that is not taste. It is arithmetic, and it either passes or it does not. Every token-derived text/background pair in generated HTML must clear WCAG 2 AA (4.5:1 for normal text, 3.0:1 for large text, borders and non-text UI), in BOTH light and dark. No colour-picker library and no framework is needed, just the maths and the required-pairs walk below. This is a build gate the checkpoint and `ui-review` enforce, and it is why the seeded candidate tokens (step 7) can list their AA verdict rather than promise one.

**Compute the ratio inline, never eyeball it.** Contrast is deterministic, so run it deterministically. A few lines of node via Bash keep the design guide honest; hardcode nothing you have not computed this turn. The exact WCAG maths:

```js
// srgb hex -> relative luminance (WCAG 2.x)
function luminance(hex) {
  const n = hex.replace('#', '');
  const to = i => parseInt(n.slice(i, i + 2), 16) / 255;
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = [to(0), to(2), to(4)].map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// contrast ratio, lighter luminance over darker, order-independent
function ratio(a, b) {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
// adaptive foreground: pick black or white by whichever clears the bar on this bg,
// never hardcode #fff. Returns the winner and whether it actually passed.
function pickTextOn(bg, min = 4.5) {
  const onBlack = ratio(bg, '#000000');
  const onWhite = ratio(bg, '#ffffff');
  const fg = onWhite >= onBlack ? '#ffffff' : '#000000';
  return { fg, ratio: Math.max(onBlack, onWhite), passes: Math.max(onBlack, onWhite) >= min };
}
```

Run it over the real tokens (Bash), read the numbers off stdout, and write those numbers into the design guide. `pickTextOn(bg)` is how you choose foreground text on any surface (primary button, badge, banner): pick by luminance, then confirm the winner actually clears the threshold rather than assuming white does.

**The required role-pair walk.** Before writing any HTML, walk this table and self-check every row against the maths above, in BOTH modes. Suggestions are drawn only from the confirmed token set, never from a colour invented on the spot. All rows must pass in light AND dark; a pair that passes in one mode only is a failure, not a partial win.

| Role pair | Minimum | Notes |
|-----------|---------|-------|
| text-on-bg | 4.5:1 | Body copy on the page background. |
| text-on-surface | 4.5:1 | Body copy on cards, panels, raised surfaces. |
| muted-on-bg | 4.5:1 | Secondary/muted text still clears 4.5:1; muted is not an excuse to drop below AA. |
| CTA-text-on-primary | 4.5:1 | Foreground chosen via `pickTextOn(primary)`, not hardcoded white. |
| link-on-bg | 4.5:1 | And a non-colour affordance (underline) so colour is never the only signal. |
| border-on-bg | 3.0:1 | Non-text UI boundary; 3:1 is the bar. |
| each interactive state-on-bg | 4.5:1 text / 3.0:1 non-text | hover, focus, active, disabled, selected. A focus ring must clear 3:1 against what sits behind it. |

**The escape ladder.** Treat 4.5:1 with a tolerance of +/- 0.05, so a computed 4.47 rounds as a pass and a computed 4.44 does not. When a pair fails, try up to three auto-fixes drawn from confirmed tokens (swap the foreground via `pickTextOn`, darken/lighten the surface within the token ramp, or reach for the next confirmed step on the scale). After three failed auto-fixes on the same pair, stop and escape to the user with the pair, both computed ratios, and the tokens you tried, rather than shipping an unreadable surface or restyling the brand silently. A confirmed brand pairing that cannot reach AA is flagged with a recommended accessible adjustment, never overridden without a human call.

**Named anti-patterns (all banned).**
- Never hardcode `#fff` (or any fixed colour) as text over a token-derived background. Use `pickTextOn(bg)`, because the token that reads white today may be a pale surface tomorrow.
- Never fake muted text with opacity-faded `rgba(...)`. Alpha over a lighter background drops the effective ratio below AA; use a solid muted token that computes to 4.5:1.
- Never treat a contrast warning as noise. A sub-AA ratio is a fail to fix, not a lint to mute.
- Never ship a role pair that passes in one mode only. Both light and dark are in scope for every row.

**Motion collapse (`prefers-reduced-motion`).** Every animation in the generated system reads `prefers-reduced-motion` and collapses to roughly 40ms (an effectively instant transition, not a jarring cut) when reduced motion is turned on. This is not optional polish; it rides in the same contract because both are accessibility floors the build inherits from the tokens.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 40ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 40ms !important;
    scroll-behavior: auto !important;
  }
}
```

## Rules

- Taste (mood, personality, brand, colour, type, density) is a human decision. Interview with `AskUserQuestion`; never pick it for them.
- Present visually (N10): any visual choice is shown as a self-contained HTML file the builder opens in a browser, never described in prose or offered as a hex list. Every colour pairing shown carries its computed WCAG AA ratio.
- Contrast is a contract, not taste. Every token-derived text/background pair passes WCAG 2 AA (4.5:1 text, 3.0:1 large/non-text) in BOTH modes, computed with the inline maths, walked across the required role-pair table, escaped to the user after three failed auto-fixes. Honour the named anti-patterns and the `prefers-reduced-motion` collapse. See **Contrast contract (WCAG 2 AA)**.
- Coaching authoring standard: every framed choice gets a context-first plain-language headline, a one-sentence why, and a reversibility tag.
- The `brand` skill's output (`docs/brand/`) is the decided starting point when present. Consume it as chosen taste and turn it into tokens; do not re-interview what brand already settled.
- Existing branding is authoritative. Extract and confirm before extending; flag any conflict with the PRD's needs and recommend a resolution rather than silently overriding.
- The token scaffold must match the styling ADR and use dual-mode (light, dark, semantic) by default.
- Ships with concrete candidate token values by design, each tagged `CANDIDATE` for the human to confirm before Part 6. A candidate is a prompt to confirm, not a blocker, and never the literal string `PLACEHOLDER` (a bare marker has no hex to verify).
- Do not proceed to page specs until MASTER.md exists and is complete.

## Output

`docs/design-system/MASTER.md` (the record) and `docs/design-system/design-guide.html` (the living, browseable render of the decided system, regenerated from MASTER.md so the two never drift), plus the per-choice N10 picker files under `docs/design-system/choices/`.

`docs/design-system/MASTER.md` contains at minimum:

- **Overview and personality** (the taste answers, made concrete).
- **Colour tokens** (light and dark) and the **semantic layer** mapping them to roles. For every row of the required role-pair walk (see **Contrast contract (WCAG 2 AA)**), in both modes, list the **computed WCAG contrast ratio** and its AA verdict (body text >= 4.5:1; large text and non-text UI >= 3:1). Compute the ratio with the inline relative-luminance formula, do not eyeball it; a few lines of node run via Bash keep it deterministic. A candidate colour must pass AA before it ships as a candidate. If a confirmed brand pairing cannot reach AA, flag it and recommend an accessible adjustment rather than silently restyling the brand.
- **Typography** (families, scale, weights, line heights) and **spacing/density** scale.
- **Components** (buttons, inputs, cards, nav, etc.) with states.
- **Design Principles** (Nielsen's 10 heuristics + UX Laws, applied to components, page specs, motion and interactions).
- **Motion & Animation** (the framework's animation approach, patterns with timing/easing, anti-patterns, `prefers-reduced-motion`, per-component motion specs in that framework's idiom).
- **Theme scaffold note** (light, dark, semantic, provider, toggle, FOUC script) with every generated token given a concrete `CANDIDATE`-tagged value (real hex, AA-verified), flagged for the human to confirm before Part 6.
