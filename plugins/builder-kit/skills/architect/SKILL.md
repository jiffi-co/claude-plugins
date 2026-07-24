---
name: architect
description: Turn an approved PRD into an architecture by presenting stack and structural options with trade-offs, letting the human choose, then recording the choices as ADRs. Use after the PRD is approved, or when the user asks to plan the architecture, choose the stack, or says /architect.
allowed-tools: [Read, Write, Edit, Glob, AskUserQuestion, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs]
---

# Architect

Turn the approved PRD into recorded technical decisions: present real options with trade-offs, let the human choose, then hand ADR writing to the `create-adr` skill. The output is a set of accepted ADRs the build phase can trust, not a decision Claude made on its own.

## When to use / when not

- **Use** once `docs/prd/prd.md` is approved and before any code or implementation plan exists.
- **Not** for writing the ADR files themselves (that is the `create-adr` skill), the implementation plan (`plan`), or the design system (`design-system`). This skill stops at the decision.

## Process

1. **Check the gate.** Read `docs/prd/prd.md`. If it is missing or not yet approved, stop and point the user at the `prd` step. Also read `AGENTS.md` (the placeholder coordination template) and `docs/idea/idea-pack.md` for product context.
2. **Read the ground, if any.** Greenfield (no `/src`): skip. Brownfield: `Glob` and read the existing `/src` layout before proposing a project structure, so the recommendation fits what is already there.
3. **Verify, do not recall.** For every candidate library or framework, confirm it exists and check its current API with Context7 (`resolve-library-id` then `query-docs`). If Context7 cannot confirm something, say so explicitly rather than guessing.
4. **Present options per decision area.** For each area the PRD actually needs, give 2 to 3 real options with honest pros and cons, then a recommendation. Cover: frontend framework, backend framework, database, ORM/data access, hosting/deployment, testing, styling, state management, authentication, API style, and project structure. Skip areas the product does not need; do not invent decisions.
   - Current sensible web defaults to recommend **from** (not mandate): Next.js 16.2 App Router on Node 22+, Tailwind v4 (CSS-first `@theme`), Better Auth (Clerk as the managed option), Neon Postgres via the Vercel Marketplace with `@neondatabase/serverless`, Vitest + Playwright, Motion for animation. **SvelteKit is the worked alternative.** Do not offer retired tools (NextAuth v5, Tailwind v3 config files, Vercel Postgres, styled-components, `runtime = 'edge'`).
   - For **project structure**, map directories to teammate roles (API, DB, frontend, shared), isolate shared code in one owned directory, and route integration through explicit interfaces so no two teammates routinely edit the same file.
5. **STOP — the human decides.** This is a judgement call, not Claude's. Use `AskUserQuestion`, one question per decision area, with the presented options as the choices and your recommendation flagged. Never auto-answer. Record exactly what they pick.
6. **Hand off to ADRs.** Invoke the `create-adr` skill (the create-adr step) with the confirmed decisions. It writes `docs/adr/ADR-<n>-<slug>.md` per decision (status Accepted, alternatives, consequences, the PRD requirement each serves), a dedicated project-structure ADR documenting the `/src` layout and team file ownership, and `docs/adr/README.md`. Do not write ADR files yourself.
7. **Log and propagate.** Append the confirmed choices to `docs/decisions.md` (date, decision, why, supersedes), then update the coordination files so downstream steps read accurate context:
   - `CLAUDE.md`: fill the Tech Stack section with chosen tools and versions; set current phase to "Planning — implementation plan next".
   - `AGENTS.md`: fill Architecture Rules and Code Standards from the decisions; make the File Ownership table match the project-structure ADR.
8. **Hold the line.** Do not start the `plan` or `design-system` step until the ADRs are accepted.

## Rules

- **Gate:** `docs/prd/prd.md` must exist and be approved before this skill runs.
- **The decision is the human's.** Present options and a recommendation, then `AskUserQuestion`. Never pick the stack for them.
- **Verify current APIs with Context7;** state plainly when a fact cannot be confirmed. Never reintroduce a retired tool.
- **Only decisions the PRD needs** — no speculative architecture.
- **A project-structure ADR is mandatory:** it is the boundary contract teammates reference.
- ADR files are written by `create-adr`, not here. Do not proceed to planning until they are Accepted.

## Output

- `docs/adr/ADR-<n>-<slug>.md` and `docs/adr/README.md` — written by the delegated `create-adr` skill.
- `docs/decisions.md` — appended with each confirmed decision.
- `CLAUDE.md` and `AGENTS.md` — Tech Stack, Architecture Rules, Code Standards, and File Ownership updated to match the accepted decisions.
