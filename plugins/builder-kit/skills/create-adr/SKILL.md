---
name: create-adr
description: Produce one Architecture Decision Record per significant technical choice (framework, database, ORM, styling, auth, hosting) with alternatives and consequences, plus an ADR index. Use after the PRD is approved, or when the user asks to record an architecture decision or generate ADRs.
allowed-tools: [Read, Write, Edit, Glob, mcp__context7__resolve-library-id, mcp__context7__query-docs]
---

# Jiffi ADRs

Record each major technical decision as an ADR so future-you (and future-Claude) can see why, and so the choice does not get silently re-litigated. Write ADRs to `docs/adr/ADR-<n>-<slug>.md` and an index to `docs/adr/README.md`.

## Process

1. Read the PRD. Identify the decisions that actually need making for this product (do not invent decisions the PRD does not require).
2. For each, present 2 to 3 real options with honest trade-offs, verify the libraries exist and their current APIs (use a docs tool such as Context7), and recommend one — but let the human choose.
3. Write an ADR for each chosen decision.

## Decision areas (include only those the PRD needs)

Frontend framework · Backend framework · Database · ORM/data access · Styling/CSS · State management · Authentication · API style · Hosting/deployment · Testing framework · Project structure.

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
- Every ADR names the PRD requirement it serves.
- Keep the versions and API details current — verify, do not recall.
- Do not start the implementation plan until the ADRs are accepted.
