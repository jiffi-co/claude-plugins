---
name: implementation-plan
description: Turn the approved PRD and accepted ADRs into docs/implementation-plan.md — phases each carrying the ACs they deliver, an execution mode, a definition of done, and a required per-phase verification check Claude can run. Use when the PRD and ADRs are done and the user asks to plan the build, or says /plan.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Implementation Plan

Produce the build blueprint an agent follows one phase at a time: `docs/implementation-plan.md`. This is the recovery document — if context is lost mid-build, `/checkpoint` and phase-start read this file to know where things stand. Every phase MUST carry a verification field: a check Claude can actually run, not an honour-system tick.

## When to use / when not

- Use after the PRD is approved and the ADRs are accepted, when the user asks to plan the build or says `/plan`.
- Do not use before the PRD or ADRs exist — run `prd` / `create-adr` first. Do not use to write code; this produces the plan only.

## Process

1. Read the source-of-truth files: `docs/prd/prd.md`, `docs/prd/acceptance-checklist.md`, every file in `docs/adr/`, `CLAUDE.md` and `AGENTS.md` if present. These, not chat, define the stack, ownership and the phased delivery already sketched in the PRD.
2. Take the PRD's delivery plan as the phase skeleton. Phase 1 is the **smallest shippable slice** — a thin end-to-end path that runs, not a foundation with nothing on top. If the PRD's Phase 1 is not that, reshape it and say why.
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
   Definition of done: [ ] steps done [ ] tests pass [ ] ACs ticked [ ] human-reviewed [ ] committed to branch
   ```

4. Choose the execution mode per phase from the phase's shape, and state the one-line reason:
   - **Solo** — single-area or foundational setup.
   - **Sub-agents** — independent parallel tasks with no cross-talk. This is the default parallelism story (subagents run in the background); use worktrees when they need separate checkouts.
   - **Agent Team** — only when teammates must coordinate against a shared contract. Still experimental and opt-in (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`); if chosen, list the team composition (roles and owned directories, matching the AGENTS.md table) and the spawn context each teammate needs.
5. Write the **verification field** so it is genuinely runnable. Phrase each as one of: a command (`npm test`, `npx tsc --noEmit`, a curl asserting a status), a file that must exist, or a regex/heading that must be present. This is the contract `/checkpoint` enforces — an advisory "looks done" is not acceptable.
6. Show the full plan to the user and revise before writing anything downstream. The plan is a work product; the human's review is the gate. Do not silently proceed to Beads or checkpoint manifests.
7. After approval, optionally emit the machine-readable siblings beside the human plan:
   - **Per-phase checkpoint manifests** — for each phase, write `docs/checkpoints/phase-<N>.json` turning that phase's verification field into a mechanical check the shipped gate runs. Types available: `command`, `file-exists`, `grep-min`, `heading`, `checklist-done` (see `scripts/checkpoint-manifest.json` for the shape). Mark tightened checks `"kind": "mechanical"`.
   - **Beads issues** — one per phase, prerequisite phases first, parallelisable phases noted in both:
     ```bash
     bd create --title "Phase <N> — <name>" --body "<branch, mode, US/AC numbers, prereqs, definition of done>"
     bd list   # show the user to verify ordering
     ```
     Native Tasks track the in-session work; Beads is the cross-session, dependency-aware memory this plan needs. Run `bd setup claude` once if Beads is not wired in yet.
8. Update `CLAUDE.md`: set current phase to "Ready to build — Phase 1" and point to `docs/implementation-plan.md`.

## Rules

- The PRD must be approved and the ADRs accepted before this runs. If either is missing or draft, stop and say so.
- **Every phase carries a runnable verification field.** A phase without one is not finished being planned. This field is load-bearing: `/checkpoint` and phase-start read it.
- Phase 1 is the smallest slice that ships and runs end to end.
- Prerequisites across phases must form a valid dependency chain — no cycles, no missing prereqs.
- The plan is Claude's draft; the human approves it. Do not emit Beads issues or checkpoint manifests until the user has signed off on the plan.
- Execution mode is a recommendation with a stated reason, not a silent default — prefer Solo or Sub-agents; reach for Agent Team only when a shared contract demands it.

## Output

- `docs/implementation-plan.md` — the phased plan, each phase in the block shape above.
- Optional, after approval: `docs/checkpoints/phase-<N>.json` (one per phase) and Beads issues via `bd create`.
- `CLAUDE.md` updated to point at the plan and mark the build ready.
