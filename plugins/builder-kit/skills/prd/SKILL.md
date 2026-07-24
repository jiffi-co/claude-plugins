---
name: prd
description: Turn an approved Idea Pack into a PRD with numbered, testable acceptance criteria, a data model, API contracts, and a phased delivery plan. Use after the Idea Pack is approved, or when the user asks for a PRD, spec, or acceptance criteria for a build.
allowed-tools: [Read, Write, AskUserQuestion]
---

# Jiffi PRD

Convert `docs/idea/idea-pack.md` into a specification an agent can build against and a test suite can verify. Write to `docs/prd/prd.md` and the acceptance checklist to `docs/prd/acceptance-checklist.md`.

## Process

1. Read the approved Idea Pack (`docs/idea/idea-pack.md`). If it is missing, run the idea-pack step first.
2. **Clarify before drafting.** Where the Idea Pack leaves a spec ambiguity that changes the acceptance criteria (an edge case, a data rule, a success threshold), ask the user with `AskUserQuestion` rather than guessing. Then draft the PRD sections below.
3. Derive **numbered, testable acceptance criteria** — each must be checkable by a test or a curl call, not a matter of opinion.
4. Propose a phased delivery plan where Phase 1 is the smallest shippable slice.
5. Show the user and revise before finalising.

## Sections

1. **Overview** — one paragraph, from the Idea Pack one-liner.
2. **User stories** — carried from the Idea Pack, each given an ID (US-001, …).
3. **Acceptance criteria** — numbered `AC-<US>.<n>` (e.g. AC-001.1). Each is a single, testable statement: given/when/then where useful. These become the acceptance checklist.
4. **Data model** — entities, key fields, relationships. Enough to design the schema.
5. **API contracts** — endpoints, methods, request/response shapes, status codes. Use a consistent success/error envelope.
6. **Non-functional requirements** — performance, security, accessibility, SEO where relevant, each as a checkable statement.
7. **Delivery plan** — 3 to 5 phases, each listing the ACs it delivers. Phase 1 = MVP.

## Rules

- Every acceptance criterion must be **agent-runnable**: a test, a build check, or a request you can make and assert on. If you cannot see how to test it, rewrite it until you can.
- Pair the human-readable checklist with the numbered ACs so `verify-acs` can tick them off one by one.
- Do not start architecture until the PRD is approved.
