---
name: design-system
description: Interview the human for taste (mood, personality, brand), then write docs/design-system/MASTER.md plus a dual-mode token scaffold (light, dark, semantic, provider, toggle, FOUC). Use after the ADRs are accepted and the user asks to create the design system, or says /design-system.
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
5. Generate the system with the design skills, grounded in the answers. Load `ui-ux-pro-max` for the palette, font pairing, component styles and spacing scale; load `impeccable:frontend-design` for creative direction on hero, landing and first-impression surfaces. If the CLI is wanted, run `npm install -g ui-ux-pro-max-cli && uipro init --ai claude`.
6. Write `docs/design-system/MASTER.md` (shape below). It MUST include the full **Design Principles** section (Nielsen's 10 heuristics and the UX Laws) and the **Motion & Animation** section. Motion patterns are implemented with the `motion` package (install `motion`, not the legacy `framer-motion` alias); CSS-only for trivial hovers.
7. Note the **dual-mode theme scaffold** in MASTER.md: light tokens, dark tokens, a semantic layer over both, a theme provider, a toggle, and an inline FOUC-prevention script that sets the theme before paint. Write every generated token value as an explicitly marked placeholder, e.g. `--color-primary: PLACEHOLDER; /* replace before Part 6 */`. These markers MUST be replaced with real values before the build phase (Part 6); a `/checkpoint` assertion fails while any survive.
8. Report back: the file written, the taste decisions captured, and a one-line reminder that placeholders must be resolved before Part 6.

## Rules

- Taste (mood, personality, brand, colour, type, density) is a human decision. Interview with `AskUserQuestion`; never pick it for them.
- Existing branding is authoritative. Extract and confirm before extending; flag any conflict with the PRD's needs and recommend a resolution rather than silently overriding.
- The token scaffold must match the styling ADR and use dual-mode (light, dark, semantic) by default.
- Ships with placeholder token values by design; those placeholders are a gate, not the finished theme, and must be gone before Part 6.
- Do not proceed to page specs until MASTER.md exists and is complete.

## Output

`docs/design-system/MASTER.md`, containing at minimum:

- **Overview and personality** (the taste answers, made concrete).
- **Colour tokens** (light and dark) and the **semantic layer** mapping them to roles.
- **Typography** (families, scale, weights, line heights) and **spacing/density** scale.
- **Components** (buttons, inputs, cards, nav, etc.) with states.
- **Design Principles** (Nielsen's 10 heuristics + UX Laws, applied to components, page specs, motion and interactions).
- **Motion & Animation** (library, patterns with timing/easing, anti-patterns, `prefers-reduced-motion`, per-component motion props).
- **Theme scaffold note** (light, dark, semantic, provider, toggle, FOUC script) with placeholder markers flagged for replacement before Part 6.
