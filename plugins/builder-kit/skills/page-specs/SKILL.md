---
name: page-specs
description: Write one buildable spec per page (layout, components, states, data, interactions, motion, and a named emotional target) into docs/design-system/pages/. Use after the implementation plan and design system exist, or when the user asks to spec the pages/screens or says /page-specs.
allowed-tools: [Read, Write, Edit, Glob, AskUserQuestion]
---

# Page Specs

Turn the page list from the implementation plan into a spec per page that the build phase can execute without guessing. Each spec names its emotional target and its empty, loading, and error states. Buildable, not decorative.

## When to use / when not

- Use when `docs/implementation-plan.md` and `docs/design-system/MASTER.md` both exist and you are about to spec the screens.
- Do not use before the design system exists (there are no components or tokens to reference) or before the plan exists (there is no page list). Stop and point the user at those steps first.

## Process

1. Read the inputs, all four:
   - `docs/implementation-plan.md` — the full page list and which phase each page belongs to.
   - `docs/prd/prd.md` — user stories (US numbers), functional requirements, and API contracts per page.
   - `docs/design-system/MASTER.md` — available components, colour tokens, typography, spacing, and the Motion & Animation patterns.
   - `docs/idea/idea-pack.md` and `AGENTS.md` — product personality (feeds emotional target) and file-ownership boundaries.
2. Extract the page list from the plan. Confirm it back to the user before writing a spec for each. If a page appears in the PRD but not the plan (or vice versa), flag the gap rather than inventing coverage.
3. Emotional target is a taste call, not a mechanical one. For each page, propose a one-line emotional target drawn from the idea pack's personality (e.g. "calm and in control", "fast and capable", "reassured this worked"). For first-impression surfaces (landing, signup, first run) present options and let the human pick with AskUserQuestion. Do not silently assign a tone to the pages that set the product's first impression.
4. If you have a UI/UX design skill available (e.g. UI/UX Pro Max or Impeccable — optional, not bundled with builder-kit), use it to help generate each spec from the design system's components and tokens; otherwise write the spec directly from MASTER.md. Either way, do not invent components the design system does not define.
5. Write one spec per page to `docs/design-system/pages/<page-name>.md` using the shape below. Every spec must state its empty, loading, and error states explicitly — a page without them is not done.
6. Write `docs/design-system/pages/README.md`: a table of every page, its phase, its emotional target, and its primary user stories.
7. Edit `docs/implementation-plan.md`: under each frontend phase's spawn context, add a pointer to that phase's page specs so build-phase teammates are sent to them.

## Page spec shape

Each `docs/design-system/pages/<page-name>.md` contains:

1. **Purpose** — one sentence; the US numbers it satisfies.
2. **Emotional target** — one line: how the user should feel here, and the one design move that carries it.
3. **Layout** — structure (header, sidebar, main, footer) with a short ASCII wireframe or grid description.
4. **Components used** — each design-system component and its config (e.g. "Primary button, full width", "Data table, sortable + paginated").
5. **States** — empty, loading, and error, each described concretely (skeleton pattern for loading, message + recovery for error, first-use copy for empty).
6. **Data sources** — API endpoints/data consumed, referencing the PRD API contracts.
7. **User interactions** — each action mapped to its outcome (e.g. "Click Save → POST /api/projects → success toast or inline error").
8. **Responsive behaviour** — what stacks, collapses, or hides at each breakpoint.
9. **Animation & Motion** — entrance stagger order, hover/focus/active states, scroll-triggered reveals, and state transitions, referencing the patterns in MASTER.md. Give concrete Motion props (`initial`, `animate`, `transition`, `whileHover`, `whileInView`) so the build has instructions, not adjectives. Animations are implemented with the `motion` package (install `motion`, not the legacy `framer-motion` alias) and must respect `prefers-reduced-motion`.
10. **Phase** — which implementation phase delivers this page.

## Rules

- Do not proceed until `docs/implementation-plan.md` and `docs/design-system/MASTER.md` exist.
- Only use components, tokens, and motion patterns that MASTER.md actually defines. If a page needs something the design system lacks, note it as a gap for the human, do not invent it.
- Every spec names an emotional target and its empty/loading/error states. No exceptions.
- The emotional target for first-impression pages is the human's call — prompt, present options, never auto-decide.
- Page names and phases must match the implementation plan exactly; do not spec pages the plan does not list.

## Output

- `docs/design-system/pages/<page-name>.md` — one per page, shape above.
- `docs/design-system/pages/README.md` — table: page · phase · emotional target · primary US numbers.
- `docs/implementation-plan.md` — edited so each frontend phase's spawn context points to its page specs.
