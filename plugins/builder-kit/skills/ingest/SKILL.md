---
name: ingest
description: Bring an existing prototype (Lovable, v0, Bolt, Cursor, Claude Artifacts, or a repo) or a partial build INTO the workflow and continue it instead of restarting greenfield. Classify and scan the sources, tag every derived fact with a confidence model (Derivable, Confirmable, Gap, Anti-pattern) and cite its provenance, then hand off to the architect skill. Use when someone already has a prototype, a repo, a brief, or a brand and wants to continue rather than start from scratch.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, AskUserQuestion, Task]
---

# Ingest

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach); adapt tone and confirmation frequency, never fork the content, never skip a human gate.

The continue-state on-ramp. Most people who reach this workflow are not at a blank page. They already have a Lovable or v0 or Bolt prototype, a Cursor half-build, a Claude Artifact, a repo, a brief, or a brand guide. Restarting greenfield throws away real work and asks them the questions their prototype already answered. This skill reads what exists, derives what it honestly can, marks what it cannot, and lands the build at the architecture decision with the earlier stages filled in and confirmed, not re-asked. The prototype is the input; the workflow is what carries it forward.

## When to use / when not

- **Use** when the user is bringing an existing prototype, repo, brief, brand guide, screenshots, or a data sample, and wants to continue building rather than start from a blank idea. This is the alternative front door to `validate-idea`.
- **Not** for a genuinely blank idea with nothing built (that is `validate-idea` then `idea-pack`), and not for writing ADRs or code (later skills). This skill stops at the hand-off to `architect`.
- **Pairs with** `/jiffi-adopt`: that command does an offline, deterministic code-scan of a repo and writes stub artifacts with zero model calls. Run it first on a large repo to get the file heatmap and a real tech-stack ADR, then run this skill to confirm the derived facts and fill the intent a scanner cannot infer.

## Process

1. **Ask what they are bringing and where it is.** Use `AskUserQuestion`. The kinds are: a prototype (a single-file artifact or a full framework app), a code repo, a brief or PRD document, a brand guide, screenshots, or a data sample. Point them to drop the files into `docs/ingest/sources/` (create it if missing) so there is one known place to scan. If a repo is already on disk elsewhere, take its path. Do not start scanning until you know what you are looking at.

2. **Classify and scan with Read, Glob and Grep.** Heuristic, fast, offline in spirit (no network dependence for the scan itself). Look for: manifests (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml` and similar), the file tree and its shape, routes, schemas and data models, components, the prototype's markup and styles, and any brief or brand docs. On a single-file artifact, read the whole file. On a framework app, read the manifest and the route/component/schema surface, not every line. The goal is the shape of what exists, cited, not a full audit.

3. **Tag every derived fact with the confidence model, and cite its source.** Every fact you extract carries one tag and a provenance citation (the file and the line range it came from). A fact with no citation is not a derived fact, it is a guess, and it does not get recorded. The four tags:
   - **[D] Derivable** (high confidence). The source states it plainly: a palette read from a `BRAND` constant, routes read from the file tree, a component inventory read from the components directory. Auto-record as a Decision in `docs/decisions.md` **with** the citation (date, the fact, why it is derivable, the `file:lines` it came from). A [D] fact is one a second reader would extract the same way from the same lines.
   - **[C] Confirmable** (medium confidence). A reasonable read that could be wrong: a persona inferred from marketing copy, a workflow inferred from a screen order, an intent inferred from a feature. Ask with `AskUserQuestion`, one at a time: "From your prototype: X. Confirm or correct." Do NOT record it until the human confirms. When a confirm changes the fact, record what they said, not what you inferred. Borderline facts default to [C], never to [D]: if you are weighing whether something is derivable or merely likely, it is [C].
   - **[G] Gap** (not derivable). The prototype cannot answer it: success metrics, the business model, pricing, the buyer, the real out-of-scope line. Ingestion does not shortcut these. Ask them the way greenfield would, plainly, and record the answers. A prototype that looks finished still has gaps, and skipping them is how a build ships without knowing what success is.
   - **[A] Anti-pattern** (probably wrong). Something the prototype does that a shipping build should not: no auth, no persistence, a secret in the client bundle, a single 5000-line file, hardcoded data standing in for a backend. Flag it as a punch-list item in the Prototype Bible. Do NOT block on it and do NOT silently fix it. If the user dismisses a flagged item (they know, it is deliberate, it is out of scope for now), that dismissal is recorded as a Decision so the reasoning survives.

4. **Brief-stated decisions are intent, not commitment.** A choice written into a brief ("use AWS RDS", "it'll be React Native", "Stripe for payments") is the author's intent, not a settled decision. Show it alongside your recommendation and confirm it via an `AskUserQuestion` card before recording. Never auto-adopt a brief-stated tool or stack just because it is written down. The brief tells you what they were thinking; the card is where it becomes a decision. Record the confirmed choice (and, if they kept a choice you would have advised against, that they were shown the alternative).

5. **Write the derived artifacts into the normal docs/ paths.** Put what you derived where the rest of the workflow expects it: the idea pack at `docs/idea/idea-pack.md`, the PRD at `docs/prd/prd.md`, a tech-stack ADR under `docs/adr/`, and `docs/idea/validation.md`. Mark a **stub** anywhere real content could not be extracted, rather than inventing it to look complete. Mark `validation.md` as passed ONLY if the idea genuinely clears the four-gate floor (a real one-liner, a named workflow, a specific daily user, a clear picture of success); a prototype existing is not the same as the idea being validated. **Never overwrite a file the user has edited.** Before writing any artifact, check whether it already exists and differs from what you would generate; if so, write a dated snapshot beside it (for example `docs/idea/idea-pack.ingest-2026-07-26.md`) for the human to diff and merge, and leave their file untouched.

6. **Hold the re-architecture posture, recorded verbatim.** Recreate the prototype faithfully, and improve it along the way by applying correct principles, but if the builder does not want an improvement, build it as they designed it. Log every improvement as a Decision in `docs/decisions.md` BEFORE writing any code that acts on it, so the change is visible and reversible. If the builder overrides an improvement, append a new Decision that supersedes the earlier one (never edit the old row away); the override, and its reason, stays on the record.

7. **Write the Prototype Bible.** `docs/ingest/bible.md`, a compact summary (aim for roughly 1200 tokens) that later stages read as ground truth so they do not re-derive the prototype from scratch. It captures: the microcopy verbatim (exact button and heading and empty-state wording, not paraphrased), the domain vocabulary verbatim (the nouns the product uses for its own things), the persona, the visual fingerprint (the palette, the type feel, the density and shape the prototype has), and the anti-pattern punch list from step 3. Keep verbatim things verbatim: paraphrasing microcopy or renaming domain nouns is how the rebuild quietly drifts from what the user made. State in the Bible that it should be threaded back into every stage via the SessionStart re-ground, so downstream skills load it rather than re-reading the prototype.

8. **Write the Reception review, run the floor check, hand off to architect.** Write `docs/ingest/reception.md` with three sections, in the builder's plain language:
   - **What I have.** The derived and confirmed facts, grouped, each with its tag and citation, so the human sees exactly what was taken from their prototype.
   - **What I am missing.** The [G] gaps still open, and anything left as a stub, named plainly so nothing looks answered that is not.
   - **How I will rebuild.** The posture from step 6, the improvements logged as Decisions, and the anti-pattern punch list, so the human knows what will change and why before any code is written.

   Then run the **floor check**: an idea-pack, a PRD, and a design or tokens signal must all exist (real or honestly stubbed) before hand-off. If the floor is not met, say which artifact is missing and fill it (from the sources, or by asking) rather than proceeding on a hole. When the floor is met, hand off to the **`architect`** skill, not back to `validate-idea`: the point of ingestion is that the early stages are already derived, so the build resumes at the architecture decision.

   Before you rely on any [D] fact, run the **`review-ingest`** reviewer via the Task tool over the derived artifacts, `docs/decisions.md`, `docs/ingest/bible.md`, and the citations. It downgrades over-confident [D] facts to [C]. **Confirm it actually ran and returned a verdict**: a reviewer that silently failed to launch looks identical to a clean pass, and a wrong [D] fact looks identical to a right one until someone checks. Apply its downgrades before hand-off.

## Rules

- **Cite every derived fact.** A fact recorded without a `file:lines` citation is a guess, and a guess is not recorded. This is the whole safeguard: a wrong [D] fact is indistinguishable from a right one unless it traces to real lines.
- **Borderline defaults to [C], never [D].** If you are unsure whether something is derivable or merely likely, it is Confirmable, and it waits for the human.
- **Never overwrite a file the user edited.** Check first; write a dated snapshot for diffing instead. Their edits are ground truth, not raw material.
- **Never auto-adopt a brief-stated decision.** It is intent until a card confirms it, shown next to your recommendation.
- **Anti-patterns flag, they do not block.** Punch-list them; a dismissal becomes a Decision. Do not silently fix and do not refuse to continue.
- **Gaps are not shortcut.** [G] facts get the greenfield questions; a finished-looking prototype does not mean the idea is validated.
- **Run `review-ingest` and confirm it ran** before relying on the [D] facts. Apply its downgrades. A silently-failed reviewer is a false pass.
- **Ingestion does not skip a human gate.** Idea validation, the architecture decision, design and brand taste, and human code review stay the human's, exactly as in greenfield.

## Output

- `docs/ingest/sources/`: where the user drops the prototype, repo, brief, brand, screenshots, or data sample to be scanned.
- `docs/decisions.md`: appended with each [D] fact (cited), each confirmed brief-stated choice, each logged improvement, and each override (as a superseding row).
- `docs/idea/idea-pack.md`, `docs/prd/prd.md`, `docs/idea/validation.md`: the derived early-stage artifacts, stubs marked where content could not be extracted, `validation.md` passed only if the four-gate floor is genuinely met. A dated snapshot instead of an overwrite wherever the user has already edited the file.
- `docs/adr/`: a tech-stack ADR derived from the manifests and confirmed choices.
- `docs/ingest/bible.md`: the Prototype Bible (microcopy and domain vocabulary verbatim, persona, visual fingerprint, anti-pattern punch list), threaded via the SessionStart re-ground.
- `docs/ingest/reception.md`: the three-section review (What I have, What I am missing, How I will rebuild), followed by the floor check and the hand-off to `architect`.
