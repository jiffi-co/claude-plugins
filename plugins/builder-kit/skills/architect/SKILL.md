---
name: architect
description: Turn an approved PRD into an architecture by presenting stack and structural options with trade-offs, letting the human choose, then recording the choices as ADRs. Use after the PRD is approved, or when the user asks to plan the architecture, choose the stack, or names the architect skill.
allowed-tools: [Read, Write, Edit, Glob, AskUserQuestion, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs]
---

# Architect

Turn the approved PRD into recorded technical decisions: present real options with trade-offs, let the human choose, then hand ADR writing to the `create-adr` skill. The output is a set of accepted ADRs the build phase can trust, not a decision Claude made on its own.

## When to use / when not

- **Use** once `docs/prd/prd.md` is approved and before any code or implementation plan exists.
- **Not** for writing the ADR files themselves (that is the `create-adr` skill), the implementation plan (`plan`), or the design system (`design-system`). This skill stops at the decision.

## Process

1. **Check the gate.** Read `docs/prd/prd.md`. If it is missing or not yet approved, stop and point the user at the `prd` step. Also read `AGENTS.md` (the placeholder coordination template) and `docs/idea/idea-pack.md` for product context. Read these from disk every time. The SessionStart re-ground that normally loads your PRD, idea pack and ADRs back into context only fires in an interactive session, so in a batch or subagent run nothing is preloaded and you must read `docs/prd/` and `docs/idea/` yourself before proposing anything.
2. **Read the ground, if any.** Greenfield (no `/src`): skip. Brownfield: `Glob` and read the existing `/src` layout before proposing a project structure, so the recommendation fits what is already there.
3. **Verify, do not recall.** For every candidate library or framework, confirm it exists and check its current API with Context7 (`resolve-library-id` then `query-docs`). If Context7 cannot confirm something, say so explicitly rather than guessing.
4. **Screen the PRD's proposed tools.** The PRD is an input, not the last word on tooling. Re-verify every tool it names against the retired-tools list (NextAuth v5, Tailwind v3 config files, Vercel Postgres, styled-components, `runtime = 'edge'`) and against Context7. If the PRD proposes a retired tool (for example NextAuth v5, which never shipped stable), do not carry it through: override it with the current equivalent, tell the user you overrode it, and record the override and its reason in an ADR so the choice is traceable rather than silent.
5. **Present options per decision area.** For each area the PRD actually needs, give 2 to 3 real options with honest pros and cons, then a recommendation. Cover the core stack: frontend framework, backend framework, database, ORM/data access, hosting/deployment, testing, styling, state management, authentication, API style, and project structure. Skip core areas the product does not need; do not invent decisions.
   - Current sensible web defaults to recommend **from** (not mandate): Next.js 16.2 App Router on Node 22+, Tailwind v4 (CSS-first `@theme`), Better Auth (Clerk as the managed option), managed PostgreSQL (Neon via the Vercel Marketplace is one option), Vitest + Playwright, Motion for animation. **Nuxt (Vue) and SvelteKit are the worked alternatives; the same applies to any framework the human picks.** (The database driver and pooling shape are a separate decision, see the connection-pooling judgement area below, not something to fold into the database default.) Do not offer retired tools (NextAuth v5, Tailwind v3 config files, Vercel Postgres, styled-components, `runtime = 'edge'`).
   - For **project structure**, map directories to teammate roles (API, DB, frontend, shared), isolate shared code in one owned directory, and route integration through explicit interfaces so no two teammates routinely edit the same file.
   - **Also cover the judgement areas a non-developer does not know to ask for.** A PRD written by a non-developer will not list these, but any app that ships needs them, so push for a decision on each and record each as its own ADR (or grouped sensibly):
     - **Security and authorisation (the trust boundary).** The authorisation model (who may read or change whose data, enforced on the server on every request, never "the button is hidden"), where secrets live (server environment only, never in the client bundle, and never behind a build-time public-env prefix, which ships the value to the client by design: whatever prefix your framework exposes, for example Next's `NEXT_PUBLIC_`, Nuxt's `NUXT_PUBLIC_` (or `runtimeConfig.public`), SvelteKit's `PUBLIC_`, Vite's `VITE_`), that every external input is validated before it reaches a query or a path, and the abuse posture. This is the ADR the `security-auditor` reviewer (run via the Task/subagent tool) holds the built code against.
     - **Environment separation.** Dev, staging and production as separate environments with separate databases and separate secrets. Never let one default connection string (a bare `DATABASE_URL`) serve every environment; select the environment with an explicit variable (an `APP_ENV`, say) and record where each connection string lives. (Relying on `NODE_ENV=production` is one such trap: on a serverless setup it can silently point a local build at the live database, so this is not optional.)
     - **Observability and error tracking.** Error and crash tracking (a Sentry-class service) plus structured logging, decided now so they are wired at first ship rather than discovered after the first silent 500.
     - **Cost and abuse control.** A spend alert on the hosting and database accounts, and rate limiting on any write or expensive endpoint, enforced at the framework or app layer or at a reverse proxy or host firewall (a platform WAF such as Vercel's or Cloudflare's is one option). A public endpoint is a public bill.
     - **Data migration, backup and rollback.** A migration tool with reviewed, reversible migrations, no destructive change without a backup first, and point-in-time recovery confirmed on (know your retention window).
     - **Database connection pooling.** This follows the deploy model. Serverless functions plus a SQL database exhausts the connection limit under load, because each invocation opens its own connection: fix it with a pooled connection string or a serverless driver (`@neondatabase/serverless` for Neon is one). A long-lived server instead wants a bounded connection pool, fronted by PgBouncer or an equivalent. Note that serverless HTTP drivers cannot hold an interactive `FOR UPDATE` row-lock transaction, so a workload that needs one wants the pooled-server shape. Decide up front and record it in the database or hosting ADR.
     - **An accessibility target.** The level you are building to (WCAG AA is the sensible default). This flows straight into the design system and is a real compliance exposure if skipped.
6. **STOP. The human decides.** This is a judgement call, not Claude's. Use `AskUserQuestion`, one question per decision area, with the presented options as the choices and your recommendation flagged. Never auto-answer. Record exactly what they pick.
   - **Running non-interactively:** `AskUserQuestion` needs an interactive session. In a batch or subagent run there is no one to answer it, so take the decisions from the input you were given and never invent a choice to get unblocked. If a decision area has no answer in that input, present the options and stop rather than picking the stack yourself.
7. **Hand off to ADRs.** Invoke the `create-adr` skill (the create-adr step) with the confirmed decisions. It writes `docs/adr/ADR-<n>-<slug>.md` per decision (status Accepted, alternatives, consequences, the PRD requirement each serves), a dedicated project-structure ADR documenting the `/src` layout and team file ownership, and `docs/adr/README.md`. Do not write ADR files yourself.
8. **Log and propagate.** Append the confirmed choices to `docs/decisions.md` (date, decision, why, supersedes), then update the coordination files so downstream steps read accurate context:
   - `CLAUDE.md`: fill the Tech Stack section with chosen tools and versions; set current phase to "Planning — implementation plan next".
   - `AGENTS.md`: fill Architecture Rules and Code Standards from the decisions; make the File Ownership table match the project-structure ADR.
9. **Hold the line.** Do not start the `plan` or `design-system` step until the ADRs are accepted.

## Rules

- **Gate:** `docs/prd/prd.md` must exist and be approved before this skill runs.
- **The decision is the human's.** Present options and a recommendation, then `AskUserQuestion`. Never pick the stack for them.
- **Verify current APIs with Context7;** state plainly when a fact cannot be confirmed. Never reintroduce a retired tool.
- **Only decisions the PRD needs,** plus the judgement areas from Process step 5 that any shipping app requires (security and authorisation, environments, observability, cost and abuse control, data migration and backup, connection pooling, accessibility). No speculative architecture beyond those.
- **A project-structure ADR is mandatory:** it is the boundary contract teammates reference.
- ADR files are written by `create-adr`, not here. Do not proceed to planning until they are Accepted.

## Output

- `docs/adr/ADR-<n>-<slug>.md` and `docs/adr/README.md` — written by the delegated `create-adr` skill.
- `docs/decisions.md` — appended with each confirmed decision.
- `CLAUDE.md` and `AGENTS.md` — Tech Stack, Architecture Rules, Code Standards, and File Ownership updated to match the accepted decisions.
