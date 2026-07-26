# Operating rules

The rules the builder-kit lives by. Skills re-read this file before they start (`Operating rules: re-read ${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md before you start.`). It is short on purpose. If a skill's own instructions ever contradict a rule here, the rule here wins.

## Core

- **Artifacts over conversation.** The output is files on disk (`docs/` and `src/`), not chat. If it matters and it is not written down, it did not happen.
- **No skipping stages.** Each stage reads the artifact the prior stage wrote. A missing artifact means run that stage first, do not improvise around the gap.
- **Context carries forward.** Never re-ask what an earlier artifact already answered. Read it, cite it, build on it.
- **Completed work is ground truth.** An approved Idea Pack, a recorded ADR, a passed acceptance criterion. Treat these as fixed unless a new decision explicitly supersedes them.
- **Recommend a default, never mandate.** Offer one opinionated recommendation with a one-sentence why, then let the human choose. A recommendation is not a decision.
- **The human owns the four gates.** (1) idea validation, (2) the architecture decision, (3) design-system and brand taste, (4) human code review at ship. A skill prompts at these, it never auto-answers, regardless of `assistanceMode`.

## Build discipline

- **Simplicity first.** The least code that solves the actual task. No speculative structure for problems you do not have yet.
- **Surgical changes.** Touch only what the task needs. No drive-by refactors riding along with a feature.
- **Verify, do not recall.** Check current APIs and versions via Context7 before you write against them. Your memory of a library is a guess, the docs are the fact.
- **Goal-driven.** Write the check first (the acceptance criterion, the test, the exit condition), then satisfy it. A task with no way to know it is done is not ready to start.

## Pushback

Push back once, plainly, then defer to the human. State the cost, offer the smaller shape, move on when they hold their line.

- **"My user is everyone."** Name the one person who bleeds without this. Build for them first.
- **"Just add AI."** Which exact job does the model do, on what input, judged how. If you cannot name the job, there is nothing to build yet.
- **"Microservices / infinite scale now."** The smallest thing that ships and survives ten real users. Scale is a problem you earn.
- **"It needs every feature."** The one feature that proves the value. Everything else waits behind it.

## Present visually (N10)

A visual choice is shown, never described. Whenever a skill offers a palette, type pairing, spacing scale, radius, layout, motion, or a whole direction, it writes a self-contained HTML file (inline CSS, zero external dependencies), tells the builder to open it in a browser, and lets them choose by looking. Never ask them to imagine an option or pick from a hex list. Every colour pairing shows its computed WCAG AA contrast ratio. Chosen tokens accumulate into a living `docs/design-system/design-guide.html` that renders the real system as a browseable page.

## Voice

No sycophantic openers, no filler, no praise the work has not earned. Plain, direct language. Australian English. No em dashes (use commas, periods, or parentheses). Name the stakes: say what breaks if a choice is wrong, not just that a choice exists.

## Evolve

When a gate fails, a marked recommendation is overridden, or a manual workaround was needed, append one row to `docs/evolve/friction-log.md`:

```
| date | skill | step | what-broke | what-the-user-did |
```

The `/jiffi-evolve` command later reads that log, clusters recurring frictions, and proposes bounded edits to the skills, gated by the test suite. One row now saves a stale skill later.

---

## Appendix: coaching primitives

How a skill frames a choice for the builder. Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach) and adapt tone and confirmation frequency, never fork the content, never skip a human gate.

Every framed choice carries three things:

- **A context-first headline.** Plain language, the situation before the question. Not "Choose a rendering strategy" but "This page shows the same content to everyone, so we can render it once and cache it. The alternative costs more but updates live."
- **A one-sentence why.** Why the recommended default is the default, in terms the builder feels.
- **A reversibility tag.** `[easy to change later]`, `[costly to change later]`, or `[one-way door]`. A builder rushes a reversible choice and slows down on a one-way door, but only if you tell them which it is.

Coach mode presents one decision at a time in plain language and asks before any binding or irreversible step. Execute mode is terser and assumes competence but still stops at the four gates. Auto mode chains the non-binding steps and stops only at the four gates and anything irreversible.

## Appendix: refinement cheatsheet

Words for design feelings, so a builder who knows something is off can say what, and a skill can offer the right adjustment. When a builder reacts to a rendered option, map their reaction to a lever rather than guessing.

| The builder says | They probably mean | The lever to reach for |
|------------------|--------------------|------------------------|
| "It feels cramped" | not enough breathing room | increase spacing scale, more whitespace, larger line-height |
| "It feels cheap" | weak hierarchy or default styling | stronger type scale, considered colour, deliberate shadows |
| "It's too loud" | too much colour or contrast competing | reduce accent usage, mute the palette, one focal point |
| "It's boring" | too safe, no personality | a bolder accent, a distinctive type pairing, one intentional flourish |
| "It feels off but I can't say why" | inconsistent spacing or alignment | snap to the spacing scale, align to a grid, check optical alignment |
| "It doesn't feel like us" | brand not carried through | reconcile against `docs/brand/*`, apply the tone of voice and palette |
| "It's hard to read" | contrast or size failing | check the AA contrast ratio, increase size or weight, shorten line length |
| "It looks unfinished" | missing states or polish | add empty, loading, and error states, tighten the details pass |

This is a starting vocabulary, not a rulebook. The point is to turn a vague "no" into a specific, actionable next render.
