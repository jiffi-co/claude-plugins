---
name: design-system
description: Interview the human for taste (mood, personality, brand), then write docs/design-system/MASTER.md plus a dual-mode token scaffold (light, dark, semantic, provider, toggle, FOUC). Use after the ADRs are accepted and the user asks to create the design system, or names the design-system skill.
allowed-tools: [Read, Write, Edit, Bash, Glob, AskUserQuestion, Skill]
---

# Design System

Turn the approved specs into a single source of visual truth at `docs/design-system/MASTER.md`, plus a dual-mode theme scaffold the build phase implements against. Taste is the human's call, so this skill interviews first and never defaults the look away.

## When to use / when not

- Use after the ADRs are accepted (the CSS approach, frontend framework and rendering strategy must be decided) and before page specs or any UI is built.
- Do not use before the PRD and ADRs exist, and do not silently invent a palette, personality or brand direction; that is the interview's job.

## Process

1. Read the inputs so the design fits the product: `CLAUDE.md`, `docs/prd/prd.md` (UI/UX requirements, key screens), `docs/idea/idea-pack.md` (personality, target users), and `docs/adr/` (chosen CSS approach, frontend framework, rendering strategy). Confirm the styling ADR, because the token scaffold must match it (Tailwind v4 uses CSS-first `@theme`, not a v3 config file).
2. Detect the branding path. If the user has brand assets (guidelines, an existing site, tone notes), take **Option B**; otherwise **Option A**. Ask which if unclear.
3. **Option B only: extract, then confirm.** Pull colours, type, spacing, component styles, radius, shadows, motion and personality from the assets. Present a summary split into **Extracted** (found), **Implied** (inferred), **Missing** (gaps the system still needs). This is the human's brand, so do not overwrite it.
4. **Interview for taste (HUMAN judgement, never auto-answer).** Use `AskUserQuestion`. Option A asks the full set; Option B asks only about the gaps from step 3. Cover:
   - Mood and personality (offer pairs to pick between, e.g. Friendly vs Professional, Minimal vs Feature-rich, Bold vs Understated).
   - Colour direction: colours drawn to or avoided; and confirm both light and dark are in scope (this skill scaffolds dual-mode by default).
   - Typography feel (geometric, humanist, or monospace/technical) and density (spacious vs compact).
   - Reference products they admire, to calibrate direction (not to copy).
   Stop and wait for answers. Do not proceed on assumptions.
   **Non-interactive runs.** When `AskUserQuestion` cannot reach a human (a background or automated run, a subagent with no interactive channel), do not hang on the interview and do not silently pretend a taste call was made. Generate from the safest defaults the inputs justify, emit every value as a `CANDIDATE` (step 7), and record each assumption in the Overview so the human can confirm or override before Part 6. Interactive is the default; this is the fallback.
5. Generate the system from the interview answers. This skill produces a complete, solid design system on its own, no external tooling required. Optionally, if you have the UI/UX Pro Max toolkit installed (a separate install, not bundled with builder-kit), you can lean on it for the palette, font pairing, component styles and spacing scale, and use `impeccable:frontend-design` for creative direction on hero, landing and first-impression surfaces. These are enhancements, not prerequisites.
6. Write `docs/design-system/MASTER.md` (shape below). It MUST include the full **Design Principles** section (Nielsen's 10 heuristics and the UX Laws) and the **Motion & Animation** section. Motion patterns follow the project's frontend framework (read it from `docs/adr/`): for the React family the `motion` package is the recommended default (install `motion`, not the legacy `framer-motion` alias, and its `initial`/`animate`/`exit` props are the worked example there); Vue/Nuxt uses its built-in `<Transition>`/`<TransitionGroup>` components plus `@vueuse/motion` (or `motion-v`); SvelteKit uses its built-in `transition:`/`animate:` directives and motion stores; other frameworks use whatever they treat as idiomatic. Recommend from these, do not mandate one framework's props onto another. CSS-only for trivial hovers everywhere.
7. Note the **dual-mode theme scaffold** in MASTER.md: light tokens, dark tokens, a semantic layer over both, a theme provider, a toggle, and an inline FOUC-prevention script that sets the theme before paint. Give every generated token a **concrete candidate value**, never the literal string `PLACEHOLDER`: a real hex derived from the interview answers (Option A) or the extracted brand (Option B), tagged for confirmation, e.g. `--color-primary: #4F46E5; /* CANDIDATE: confirm before Part 6 */`, whose white-on-primary pairing computes to 6.3:1 (AA pass). A bare `PLACEHOLDER` carries no hex, so the design system could not list its AA contrast pairings; a real candidate can, which is the point. An unconfirmed candidate is a value to confirm, not a blocker: nothing hard-fails on it, so the human confirms or swaps it in the design review before Part 6. A value the human explicitly gave (a confirmed brand colour, an exact colour named in the interview) is not a candidate and carries no tag.
8. Report back: the file written, the taste decisions captured, and a one-line reminder that candidate values (anything tagged `CANDIDATE`) are the human's to confirm before Part 6, with the count still unconfirmed.

## Rules

- Taste (mood, personality, brand, colour, type, density) is a human decision. Interview with `AskUserQuestion`; never pick it for them.
- Existing branding is authoritative. Extract and confirm before extending; flag any conflict with the PRD's needs and recommend a resolution rather than silently overriding.
- The token scaffold must match the styling ADR and use dual-mode (light, dark, semantic) by default.
- Ships with concrete candidate token values by design, each tagged `CANDIDATE` for the human to confirm before Part 6. A candidate is a prompt to confirm, not a blocker, and never the literal string `PLACEHOLDER` (a bare marker has no hex to verify).
- Do not proceed to page specs until MASTER.md exists and is complete.

## Output

`docs/design-system/MASTER.md`, containing at minimum:

- **Overview and personality** (the taste answers, made concrete).
- **Colour tokens** (light and dark) and the **semantic layer** mapping them to roles. For each text-on-surface and UI pairing, in both modes, list the **computed WCAG contrast ratio** and its AA verdict (body text >= 4.5:1; large text and UI components >= 3:1). Compute the ratio with the relative-luminance formula, do not eyeball it; a few lines of node run via Bash keep it deterministic. A candidate colour must pass AA before it ships as a candidate. If a confirmed brand pairing cannot reach AA, flag it and recommend an accessible adjustment rather than silently restyling the brand.
- **Typography** (families, scale, weights, line heights) and **spacing/density** scale.
- **Components** (buttons, inputs, cards, nav, etc.) with states.
- **Design Principles** (Nielsen's 10 heuristics + UX Laws, applied to components, page specs, motion and interactions).
- **Motion & Animation** (the framework's animation approach, patterns with timing/easing, anti-patterns, `prefers-reduced-motion`, per-component motion specs in that framework's idiom).
- **Theme scaffold note** (light, dark, semantic, provider, toggle, FOUC script) with every generated token given a concrete `CANDIDATE`-tagged value (real hex, AA-verified), flagged for the human to confirm before Part 6.
