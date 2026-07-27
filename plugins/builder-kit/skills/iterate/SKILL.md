---
name: iterate
description: Add or change a feature on an already-shipped product by re-entering the loop at the right point (mini brief, PRD delta, an ADR only if a decision changes, delta phases, build, ship), reusing the docs already on disk. Fires when every phase in docs/implementation-plan.md is closed and shipped and new work arrives that the PRD does not cover.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion, Skill]
---

# Iterate on a Live Product

Keep building into a product that is already deployed, without re-running the whole spec chain. It grounds in the docs already on disk, scopes the feature, appends (never rewrites) the PRD and plan, then runs the same phased build and ship gates the first version went through.

## When to use / when not

- Use when every phase in `docs/implementation-plan.md` is closed and shipped, and new work arrives that the PRD does not cover.
- Do NOT use for the first build of a new product (that is the full idea-pack to plan chain), and do NOT use to rewrite the existing PRD. You append and supersede, you never renumber or overwrite what shipped.

## Process

1. **Ground in what exists, honestly (provenance).** Read the source of truth before proposing anything: `docs/idea/idea-pack.md`, `docs/prd/prd.md`, `docs/prd/acceptance-checklist.md`, every file in `docs/adr/`, `docs/implementation-plan.md`, `docs/decisions.md`, `CLAUDE.md` and `AGENTS.md`. Use Grep/Glob over the codebase to see what is actually wired, not what the docs claim. Then report a **have / haven't / will do** reception: what the product HAS today, what it HASN'T (gaps this feature meets or exposes), and what this feature WILL do. Do not overstate the current codebase; a promised behaviour the code lacks is a defect, not a feature.
2. **Validate the feature is worth building (HUMAN gate).** Present the reception from step 1 and ask (AskUserQuestion) whether this feature is in scope and worth doing now. This is the human's call; prompt, do not auto-answer it. If they say no, stop here.
3. **Route by scope. Ask, do not assume (AskUserQuestion).** Pick the re-entry point together:
   - **Tweak** (copy, a setting, a small fix): skip straight to a single build phase (step 7), no new brief.
   - **Feature** (new user-facing capability, no architecture change): brief → PRD delta → plan delta → build → ship (steps 4 to 9).
   - **Architecture-changing** (new dependency, data model change, a choice that contradicts an existing ADR): the full path including a new ADR (step 6 is required).
   State the route and why, then let the human confirm it.
4. **Write a scoped feature brief (a mini idea-pack).** Not a new idea pack. Write `docs/idea/features/<slug>.md`: the one-liner, the user stories this feature adds, in-scope vs out-of-scope, and a provenance note (which existing behaviour it touches or supersedes, drawn from step 1). Keep it short.
5. **PRD delta: append and supersede, never rewrite.** In `docs/prd/prd.md`, add a `## Feature: <name>` section. **Continue the existing numbering** (next free `US-0NN`, ACs as `AC-0NN.n`); never renumber shipped stories, the numbering scheme is preserved byte for byte. Add the new ACs to `docs/prd/acceptance-checklist.md` as unchecked. If the feature changes an existing behaviour, mark the old AC "superseded by AC-0NN" in place rather than deleting it, and record the supersession by invoking the decision-log habit into `docs/decisions.md`. Every new AC must be **agent-runnable** (a test, a build check, a request you can assert on). Show the delta and get the human's approval before anything downstream.
6. **ADR only if a decision actually changes (HUMAN's call).** If the route is architecture-changing, or step 5 surfaced a choice that contradicts an existing ADR, invoke the `create-adr` skill to write a NEW ADR (`Status: Accepted`, and `Supersedes ADR-<n>` where it overrides one). Do not silently rewrite the old ADR and do not invent a decision the feature does not require. Present options and let the human choose. If nothing decisional changed, skip this step and say so.
7. **Plan only the delta.** Invoke the `implementation-plan` skill in append mode: add the feature's phases to `docs/implementation-plan.md`, **continuing the phase numbering** after the last shipped phase. Each new phase carries its ACs, an execution mode with a reason, a definition of done, and a runnable verification field. Emit the per-phase `docs/checkpoints/phase-<N>.json` and one task per phase under `docs/tasks/`, prerequisites pointing at already-complete phases where the feature builds on them. Do not touch the shipped phases.
8. **Build the delta phases: same loop, same gates.** For each new phase, hand off to `phase-start` then `phase-complete`. The deterministic checkpoint, evidence-per-AC, `/clear` between phases, and the compound write-back all apply unchanged. Nothing about this being an iteration relaxes the gates.
9. **Ship: same review and deploy path.** When the feature's phases are green, run the ship flow: bundled `/code-review` and `/security-review` over the branch, open a PR with `gh pr create` (summary, the new AC numbers verified, test results, manual test steps), human review is mandatory, merge, deploy per `docs/deployment.md`, then post-deployment verification of the **new** ACs against production (Claude in Chrome or the Playwright MCP). CI/CD is already set up from v1, so `/install-github-app` is not repeated.

## Rules

- The three human gates hold: is-this-worth-building (step 2), any architecture decision (step 6), and human code review before merge (step 9). A skill prompts; it never auto-decides these.
- Append and supersede, never rewrite. Shipped US/AC/phase numbers are immutable; new work continues the sequence. A changed behaviour supersedes an old AC visibly and is logged in `docs/decisions.md`.
- Do not proceed past a gate until the human has approved: the reception (step 2), the PRD delta (step 5), and the ADR if one is needed (step 6).
- Every new AC is agent-runnable and every new phase carries a runnable verification field, exactly as first-build phases do.
- docs/, ADRs, the acceptance checklist and your phase tasks under `docs/tasks/` are the source of truth. Ground in the files, not in chat memory, and never overstate what the live code already does.

## Output

Additive edits at conventional paths (nothing shipped is overwritten):
- `docs/idea/features/<slug>.md`: the scoped feature brief.
- `docs/prd/prd.md`: a new `## Feature:` section. `docs/prd/acceptance-checklist.md`: new unchecked ACs, old ones marked superseded where changed.
- `docs/adr/ADR-<n>-<slug>.md` (plus index): only if a decision changed.
- `docs/implementation-plan.md`: appended feature phases. `docs/checkpoints/phase-<N>.json` and one task file per new phase under `docs/tasks/`.
- `docs/decisions.md`: supersession and choices logged. Then the standard build and ship artefacts (branch, commits, PR, deploy) via the phase and ship skills.
