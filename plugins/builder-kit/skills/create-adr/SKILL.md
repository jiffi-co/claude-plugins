---
name: create-adr
description: Produce one Architecture Decision Record per significant technical choice (framework, database, ORM, styling, auth, hosting) and per cross-cutting decision a non-developer would miss (security boundary, environment separation, observability, cost and abuse control, data migration and backup, connection pooling, accessibility target), each with alternatives and consequences, plus an ADR index. Use after the PRD is approved, or when the user asks to record an architecture decision or generate ADRs.
allowed-tools: [Read, Write, Edit, Glob, mcp__context7__resolve-library-id, mcp__context7__query-docs]
---

# Jiffi ADRs

Record each major technical decision as an ADR so future-you (and future-Claude) can see why, and so the choice does not get silently re-litigated. Write ADRs to `docs/adr/ADR-<n>-<slug>.md` and an index to `docs/adr/README.md`.

## Process

1. Read the PRD. Identify the decisions that actually need making: every core-stack area the PRD needs, plus the cross-cutting decisions listed below (a non-technical PRD will not name them, but any real product still needs them). Do not invent speculative tech the product has no use for.
2. For each, present 2 to 3 real options with honest trade-offs, verify the libraries exist and their current APIs (use a docs tool such as Context7), and recommend one — but let the human choose.
3. Write an ADR for each chosen decision.

## Decision areas

**Core stack** (include only those the PRD needs): Frontend framework · Backend framework · Database · ORM/data access · Styling/CSS · State management · Authentication · API style · Hosting/deployment · Testing framework · Project structure.

**Cross-cutting decisions a non-developer does not know to ask for** (raise each unless it genuinely does not apply to this product). A non-technical PRD will not name these, so do not wait for it to. They separate an app that works in a demo from one that survives its first real week, and each serves a real product need (a deployed app that takes traffic and stores data), so name that need in the ADR. Record each as its own ADR, or group sensibly.

- **Security and authorisation trust boundary.** Who may read or change whose data (the authorisation model, enforced on the server on every request, never a hidden button); where secrets live (server side only, never shipped in the client bundle or app binary, and never behind a build-time public-env prefix, which ships the value to the client by design: whatever prefix your framework exposes, for example Next's `NEXT_PUBLIC_`, Nuxt's `NUXT_PUBLIC_` (or `runtimeConfig.public`), SvelteKit's `PUBLIC_`, Vite's `VITE_`); every external input validated before it reaches a query or a filesystem path; and the abuse posture. The `security-auditor` reviewer agent (run via the Task tool) checks the built code against this ADR, so it is the contract the code is held to.
- **Environment separation.** Dev, staging and production as separate environments with separate databases and separate secrets. Never let one default connection string (a bare `DATABASE_URL`) serve every environment; select the environment with an explicit variable (an `APP_ENV`, say) and record where each connection string lives. Relying on `NODE_ENV=production` is one such trap: on a serverless stack it can silently point a local build at the live database, so this is the expensive one to get wrong.
- **Observability.** Error and crash tracking (a Sentry-class service) and structured logging, decided now so they are wired at first ship instead of discovered after the first silent 500.
- **Cost and abuse control.** A spend alert on the hosting and database accounts, and rate limiting on any write or expensive endpoint, enforced at the framework or app layer or at a reverse proxy or host firewall (a platform WAF such as Vercel's or Cloudflare's is one option). A public endpoint is a public bill.
- **Data migration, backup and rollback.** A migration tool, migrations reviewed and reversible, no destructive change without a backup first, and point-in-time recovery confirmed on with a known retention window.
- **Connection pooling.** This follows the deploy model. If the stack pairs serverless functions with a SQL database, each invocation opens its own connection and hits the connection limit under load: fix it with a pooled connection string or a serverless driver (`@neondatabase/serverless` for Neon is one). A long-lived server instead wants a bounded connection pool, fronted by PgBouncer or an equivalent. Note that serverless HTTP drivers cannot hold an interactive `FOR UPDATE` row-lock transaction, so a workload that needs one wants the pooled-server shape. Decide now and record it in the database or hosting ADR.
- **Accessibility target.** The level you build to (WCAG AA is the sensible default), recorded so it flows into the design system and can be scored against the built pages later.

## ADR format

```
# ADR-<n>: <decision title>

**Status:** Accepted
**Date:** <date>

## Context
Why this decision is needed, referencing the PRD requirement that drives it.

## Decision
What was chosen.

## Consequences
Positive, negative, and neutral results of the choice.

## Alternatives considered
Each rejected option and the specific reason it was rejected.
```

## Rules

- Prefer the simplest option that meets the PRD; do not default to the most powerful.
- Every ADR names the PRD requirement, or the product-wide need, it serves.
- Keep the versions and API details current — verify, do not recall.
- Do not start the implementation plan until the ADRs are accepted.
