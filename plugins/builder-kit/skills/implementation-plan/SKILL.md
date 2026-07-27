---
name: implementation-plan
description: Turn the approved PRD and accepted ADRs into docs/implementation-plan.md, with phases that each carry the ACs they deliver, an execution mode, a definition of done, and a per-phase verification check Claude can run. Fires when docs/prd/prd.md and docs/adr/ both exist and docs/implementation-plan.md does not, and in append mode when a shipped product needs delta phases.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Implementation Plan

Produce the build blueprint an agent follows one phase at a time: `docs/implementation-plan.md`. This is the recovery document — if context is lost mid-build, `/checkpoint` and phase-start read this file to know where things stand. Every phase MUST carry a verification field: a check Claude can actually run, not an honour-system tick.

## When to use / when not

- Use once `docs/prd/prd.md` is approved and the ADRs in `docs/adr/` are accepted, and `docs/implementation-plan.md` does not exist yet.
- Do not use before the PRD or ADRs exist — run `prd` / `create-adr` first. Do not use to write code; this produces the plan only.

## Process

1. Read the source-of-truth files: `docs/prd/prd.md`, `docs/prd/acceptance-checklist.md`, every file in `docs/adr/`, `CLAUDE.md` and `AGENTS.md` if present. These, not chat, define the stack, ownership and the phased delivery already sketched in the PRD.
2. Take the PRD's delivery plan as the phase skeleton. Phase 1 is the **smallest shippable slice**: a thin end-to-end path that runs and is worth having on its own, not a foundation with nothing on top (non-negotiable 9 below). If the PRD's Phase 1 is not that, reshape it and say why.
3. For each phase, draft the block below. The steps must be concrete enough to execute one at a time without re-reading the PRD.

   ```
   ### Phase <N>: <name>
   Branch: feature/phase-<N>-<slug>
   Execution mode: Solo | Sub-agents | Agent Team   (see step 4)
   Prerequisites: <phases that must be done first — must form a valid chain, no cycles>
   Steps: 1. … 2. … (specific: files to create, in order)
   Files to create/modify: <every path; group by owner if Agent Team>
   Tests to write: <specific assertions, not "write tests">
   Acceptance criteria: <AC-… numbers from the checklist this phase delivers>
   Verification (a check Claude can run): <one concrete command or file assertion — see step 5>
   Non-negotiables: <the applicable lines from 'The nine non-negotiables', written in, not referenced>
   Definition of done: [ ] steps done [ ] tests pass [ ] ACs ticked [ ] human-reviewed [ ] committed to branch
   ```

   **Write the nine into each phase yourself.** They are not a checklist for the human to audit the plan against afterwards; that is the failure this skill exists to remove. A phase that does not touch a given area says so in one clause ("no persisted data change") rather than dropping the line.

4. Choose the execution mode per phase from the phase's shape, and state the one-line reason:
   - **Solo** — single-area or foundational setup.
   - **Sub-agents** — independent parallel tasks with no cross-talk. This is the default parallelism story (subagents run in the background); use worktrees when they need separate checkouts.
   - **Agent Team** — only when teammates must coordinate against a shared contract. Still experimental and opt-in (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); if chosen, list the team composition (roles and owned directories, matching the AGENTS.md table) and the spawn context each teammate needs.
5. Write the **verification field** so it is genuinely runnable. Phrase each as one of: a command (`npm test`, `npx tsc --noEmit`, a curl asserting a status), a file that must exist, or a regex/heading that must be present. This is the contract `/checkpoint` enforces — an advisory "looks done" is not acceptable.
6. Show the full plan to the user and revise before writing anything downstream. Before the user approves, suggest a fresh-context review with the `review-build-plan` agent (via the Agent tool) to catch phasing, prerequisite and verification gaps a fresh reader would spot. The plan is a work product; the human's review is the gate. Do not silently proceed to task files or checkpoint manifests.
7. After approval, emit the machine-readable siblings beside the human plan:
   - **Per-phase BUILD manifests** — for each phase, write `docs/checkpoints/phase-<N>.json` turning that phase's verification field into a mechanical check the shipped gate runs. Types available: `command`, `file-exists`, `grep-min`, `heading`, `checklist-done` (see `scripts/checkpoint-manifest.json` for the shape). Mark tightened checks `"kind": "mechanical"`. **No `checklist-done` row belongs in this file**: the acceptance criteria cannot be ticked before the phase has produced the evidence, so a build gate that demands them fails by construction on every first close and the only way through is to tick the boxes to go green.
   - **Per-phase CLOSE manifests, one per phase, written HERE** — copy `scripts/checkpoint-close-manifest.json` to `docs/checkpoints/phase-<N>-close.json`, set `"closed": false`, and scope its `acs-ticked` row to this phase's acceptance criteria with a `match` regex built from the AC numbers you just wrote into the phase block:

     ```json
     { "id": "acs-ticked", "label": "Acceptance criteria ticked", "kind": "mechanical",
       "type": "checklist-done", "path": "docs/prd/acceptance-checklist.md",
       "match": "\\b(AC-001\\.1|AC-001\\.2|AC-002\\.1)\\b" }
     ```

     List the AC ids explicitly, alternated and word-bounded. Do not compress them into a range or a prefix: `AC-001` as a prefix silently gates `AC-0010` too, and a slightly-wrong regex is a weaker gate that still prints green.

     **This file is written at plan time, by this skill, not left to the forked worker.** The worker scaffolds it only on the paths where a fork actually runs; anyone driving the loop inline — which is what the build skill prescribes for every gate, and the only option in a non-interactive session — found nothing there, and had to hand-author both the manifest and the AC regex. You already know every phase's AC list, which is exactly what makes the regex right. `"closed": false` is not decoration: `state.mjs` counts the file's existence as the close record unless that key says otherwise, so a copy without it marks the phase closed the moment the plan is written.
   - **Per-phase tasks** — one per phase in the kit's store, prerequisite phases first, parallelisable phases noted in both:
     ```bash
     node "${CLAUDE_PLUGIN_ROOT}/scripts/task-store.mjs" write phase-<N> \
       --subject "Phase <N> — <name>" --phase <N> --blocked-by phase-<N-1> \
       --description "<branch, mode, US/AC numbers, prereqs, definition of done>"
     node "${CLAUDE_PLUGIN_ROOT}/scripts/task-store.mjs" list   # show the user to verify ordering
     ```
     That writes one markdown file per task under `docs/tasks/`, so the plan survives a `/clear` and only conflicts when two people touch the same phase. Mirror them into native Tasks as you work: native is the live working set, `docs/tasks/` is the record that outlives the session.
8. Update `CLAUDE.md`: set current phase to "Ready to build — Phase 1" and point to `docs/implementation-plan.md`.

## The nine non-negotiables

Every phase carries these. Left alone, a plan phases *features* and quietly defers security, accessibility, performance and observability to a hardening phase that never ships. This skill writes them into each phase's block instead, so no phase is done until its own slice is safe, accessible, fast and observable. None of them needs a phase of its own; each is a line or two inside the phases that already exist.

1. **Security, per phase.** Any phase touching auth, secrets, payments or user data carries a security check in its verification field, named concretely enough for the `security-auditor` reviewer to enforce. Not a final audit.
2. **Accessibility and performance, per UI phase.** Every phase that ships a screen carries its own empty, loading and error states, a keyboard and screen-reader pass (WCAG AA: focus order, labels, contrast), and the project's performance budget if one was set.
3. **Observability.** The first phase that reaches a real environment wires error and crash reporting and a way to read logs. Later phases keep it wired. It is not done until a deliberate error has been seen arriving (the `ops` step owns that proof).
4. **Secrets and environment config, up front.** Each phase names the environment variables it needs and how they differ between environments, rather than discovering a missing key at deploy time. Production secrets live in the host's secret store, never in a committed file.
5. **Data migrations and rollback.** Any phase changing the persisted data model carries a forward migration, a tested rollback (or a documented "irreversible, back up first"), and must not assume an empty database. A phase that ships to production and then changes the schema two phases later can destroy live data without one. Write "irreversible" only when it is true: the build loop's pre-flight scans this plan text for that word and for "cannot be undone", and stops to ask the human before the phase forks. That is the point — a phase that collapses duplicate rows should stop — but a phase with no persisted data change says so in a clause and does not inherit the wording.
6. **Cost and abuse control.** Anything with a public endpoint or a paid dependency carries rate limiting and a spend alert, named in the phase that introduces the surface. A public endpoint is a public bill.
7. **Incremental rollout safety.** When phases reach production one at a time, unbuilt later work sits behind a feature flag, an unlinked route, or a limited cohort, so production only ever exposes finished slices. The phase names what it lands behind.
8. **The integration gate after parallel work.** After any phases run in parallel, an integration step merges them, regenerates derived artefacts exactly once (generated types, lockfiles, snapshots are shared even when feature files are not), and re-runs the full suite before the next phase.
9. **Phase 1 stands alone as a small working product.** Not scaffolding, not a foundation with nothing on top: something a real person can use end to end and get value from, deployed and reachable. Cut it down only to the trust boundary, never through it (on a multi-tenant product, isolation and auth are part of the floor). If the PRD's phase 1 is a setup phase, reshape it and say why. **This one is load-bearing beyond the plan:** everything downstream assumes the builder is holding a working product after phase 1, and a plan whose phase 1 is scaffolding quietly breaks that promise. If it cannot be made to stand alone, say so explicitly to the human rather than shipping a phase 1 that only looks like one.

## Rules

- The PRD must be approved and the ADRs accepted before this runs. If either is missing or draft, stop and say so.
- **Every phase carries a runnable verification field.** A phase without one is not finished being planned. This field is load-bearing: `/checkpoint` and phase-start read it.
- **The nine non-negotiables are written into every phase by this skill,** not left as a checklist for the human to audit against afterwards. A phase that does not touch an area says so in a clause rather than dropping the line.
- **Phase 1 stands alone as a small working product** (non-negotiable 9), not scaffolding. If the PRD's phase 1 is not that, reshape it; if it cannot be reshaped into one, say so out loud rather than shipping a phase 1 that only looks like one.
- Prerequisites across phases must form a valid dependency chain — no cycles, no missing prereqs.
- The plan is Claude's draft; the human approves it. Do not emit task files or checkpoint manifests until the user has signed off on the plan.
- **Both manifests per phase, written here.** The build manifest carries no acceptance-criteria row; the close manifest carries exactly one, scoped by an explicit alternation of that phase's AC ids, and `"closed": false`. Leaving the close manifest to the worker means it does not exist on the path most people take.
- Execution mode is a recommendation with a stated reason, not a silent default — prefer Solo or Sub-agents; reach for Agent Team only when a shared contract demands it.

## Output

- `docs/implementation-plan.md` — the phased plan, each phase in the block shape above.
- After approval: `docs/checkpoints/phase-<N>.json` and `docs/checkpoints/phase-<N>-close.json` (one pair per phase, the close one carrying `"closed": false` and this phase's scoped AC regex), plus one task file per phase under `docs/tasks/` (`task-store.mjs write`).
- `CLAUDE.md` updated to point at the plan and mark the build ready.
