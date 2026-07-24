---
name: idea-pack
description: Turn a raw product idea into a structured 10-section Idea Pack (problem, users, user stories, scope, risks) before any code. Use after /validate-idea, when the user wants to shape a new idea, or asks for an idea pack / product brief.
allowed-tools: [Read, Write, AskUserQuestion, Skill]
---

# Jiffi Idea Pack

Produce a build-ready Idea Pack that front-loads the thinking. Interview first, then draft; the human approves each section before moving on. Write the result to `docs/idea/idea-pack.md`.

## Process

1. **Check the gate.** Read `docs/idea/validation.md`. If it is missing or does not pass, run `/validate-idea` first — the Idea Pack builds on the validated one-liner, it does not replace it.
2. **Interview, then draft (do not one-shot).** Use `AskUserQuestion` to ask the hard questions BEFORE writing: who exactly is this for, the specific problem, why now, what success looks like, what is explicitly out of scope. Ask in small batches so each answer sharpens the next. Never invent answers; if the user is vague, push once for specifics, then record what they said.
3. Draft the ten sections below from their answers. Keep each tight and concrete.
4. Show the user the draft, section by section for a new idea or as a whole for a refinement, and revise on their feedback until they approve.

## The ten sections

1. **One-liner** — the product in a single sentence a stranger understands.
2. **Problem** — the specific pain, who feels it, and how they cope today.
3. **Target users** — the primary user and, if relevant, the buyer. Be narrow.
4. **User stories** — 5 to 12 stories in "As a … I want … so that …" form, ordered by importance.
5. **Scope** — what the first version does, as a short bullet list.
6. **Explicitly out of scope** — what it deliberately does NOT do yet.
7. **Success metrics** — how you will know it worked (measurable).
8. **Risks and unknowns** — the assumptions that would sink it if wrong.
9. **Competitive landscape** — the two or three closest alternatives and why yours differs.
10. **Open questions** — what still needs a decision before the PRD.

## Rules

- Australian English. Plain, direct language. No filler.
- Every claim about users or the market is a stated assumption unless the user gave you evidence.
- Do not proceed to the PRD until the user approves the Idea Pack. Approval is a human gate.

## Output

`docs/idea/idea-pack.md` (the ten sections above). Optionally, once approved, also emit `docs/idea/idea-pack.json` (the user stories as machine-readable objects) beside the human doc — the PRD and plan can read it, and the human markdown stays the source of truth.
