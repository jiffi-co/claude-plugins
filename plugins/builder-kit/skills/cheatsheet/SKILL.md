---
name: cheatsheet
description: Use when the user is new to the builder-kit, asks "what do I run next", "where am I up to", or "what's the whole workflow". Prints the one-screen map of skills, artifacts and gates in order.
allowed-tools: [Read, Glob]
---

# Builder-Kit Cheatsheet

The one-screen map of the whole workflow: every skill in lifecycle order, the artifact it writes to disk, and the human gates you cannot skip. Everything lives in `docs/` (and Beads if you use it), never in chat.

## When to use / when not

Use when someone wants the big picture, has lost their place, or is deciding what to run next. Not a doing skill: it reads and orients, it does not create artifacts. For an actual step, invoke that step's own skill.

## Process

1. If a build is already in flight, orient the human before showing the map. Glob `docs/idea/`, `docs/prd/`, `docs/adr/`, `docs/design-system/`, `docs/implementation-plan.md`, `docs/checkpoints/` to see which artifacts exist (if you use Beads, `bd list` shows open tasks too; otherwise check native Tasks or `docs/tasks.md`), then say plainly which stage they are up to.
2. Show the install commands:
   ```bash
   # 1. Machine: install Claude Code via the native installer (Node 22+)
   curl -fsSL https://claude.com/install.sh | sh
   # 2. Project: scaffold the repo and wire up builder-kit
   /jiffi-init
   # Optional (recommended): task tracking with Beads
   bd setup claude
   ```
3. Show the lifecycle map. Skills run in this order; each writes a real file. The `Type` column tells you what each one is: **cmd** = one of builder-kit's six real slash commands (`/jiffi-doctor`, `/jiffi-init`, `/checkpoint`, `/jiffi-import-idea8`, `/jiffi-adopt`, `/jiffi-evolve`), the only things you type with a slash, **skill** = a skill you invoke by naming it in plain language (like "validate my idea"), never with a slash, **agent** = a fresh-context reviewer you launch via the Task/subagent tool.

   There are two front doors after `/jiffi-init`. Greenfield (a fresh idea): take rows 3 to 5. Continue existing work (you already have a prototype from Lovable, v0, Bolt, Cursor or Claude Artifacts, a repo, or a brief): take the `ingest` front door instead of 3 to 5, then rejoin the shared spine at `architect` (row 6). Both doors converge from row 6 on.

   | # | Type | Name | One-line purpose | Artifact written |
   |---|------|------|------------------|------------------|
   | 1 | cmd | `/jiffi-doctor` | Preflight check the environment before you start | prints a readiness report |
   | 2 | cmd | `/jiffi-init` | Scaffold the repo and wire up builder-kit | project skeleton |
   | 3 | skill | `validate-idea` | Greenfield door. Pressure-test the raw idea before any build (HUMAN gate) | notes in `docs/idea/` |
   | 4 | skill | `idea-pack` | Turn the validated idea into a structured Idea Pack | `docs/idea/idea-pack.md` |
   | 5 | skill | `prd` | Expand the pack into a PRD with testable acceptance criteria | `docs/prd/prd.md` |
   | 3b | skill | `ingest` | Continue-existing door (alternative to 3 to 5). Bring a prototype, repo or brief in, derive and confirm the early artifacts (D/C/G/A confidence model), then hand to `architect` | `docs/ingest/bible.md`, `docs/ingest/reception.md`, derived `docs/` |
   | 3c | cmd | `/jiffi-adopt` | Offline fast path into `ingest`. Scan an existing repo with zero network calls, write a real tech-stack ADR plus stub docs | `docs/ingest/`, `docs/adr/*.md` |
   | 3d | agent | `review-ingest` | Adversarially check the derived `[D]` facts before you rely on them; downgrade over-confident guesses to `[C]` | ranked downgrade list |
   | 6 | skill | `architect` | Surface options, record the chosen architecture (HUMAN decides) | `docs/adr/*.md` |
   | 7 | skill | `wireframe` | Low-fi shape approval per screen, before any brand taste is spent | `docs/wireframes/*.html` |
   | 8 | skill | `brand` | Pick tone, palette and type by looking (N10 visual choice), hand the chosen brand to `design-system` | `docs/brand/*` |
   | 9 | skill | `design-system` | Lock tokens, type, colour, components (HUMAN taste) | `docs/design-system/MASTER.md` |
   | 10 | skill | `create-adr` | Record a single architecture decision as its own ADR | numbered `docs/adr/*.md` |
   | 11 | skill | `implementation-plan` | Break the PRD into independently testable phases | `docs/implementation-plan.md` |
   | 12 | skill | `page-specs` | Spec each page before building it | per-page specs under `docs/` |
   | 13 | skill | `phase-start` | Open the next phase, seed tasks, branch | tasks + git branch |
   | n/a | n/a | *(build)* | Write the phase's code (the build loop) | source + tests |
   | 14 | skill | `verify-acs` | Check each acceptance criterion actually passes | `docs/checkpoints/*.md` |
   | 15 | skill | `ui-review` | Visual + UX pass on the running app in the browser | `docs/checkpoints/ui-review-[phase].md` |
   | 16 | skill | `phase-complete` | Close a phase only when tests are green | commit + closed tasks |
   | 17 | cmd | `/checkpoint` | Snapshot progress so a fresh session can resume | checkpoint entry |
   | 18 | skill | `ci-setup` | Wire up CI so tests gate every push | CI workflow config |
   | 19 | skill | `ship` | Code review, PR, deploy | PR + deployment |
   | 20 | skill | `ops` | Context, cost, security, error recovery (continuous) | ADR updates as needed |
   | 21 | skill | `iterate` | Feed a new change back into the `validate-idea` or `prd` skill | new pack/PRD entry |
   | 22 | cmd | `/jiffi-evolve` | Anti-staleness loop. Harvest `docs/evolve/friction-log.md`, currency-check the skills, propose gated edits | `docs/evolve/CHANGELOG.md` |

   Wireframe and brand sit between the PRD and `design-system` on purpose: approve the shape (`wireframe`), then choose the look (`brand`), then lock the tokens (`design-system`). The continue-existing door skips 3 to 5 but still passes through the shared spine from `architect`.

   For orientation at any time (these do not advance the build): name the `resume` skill to reload the session state from disk, and `build-status` to report where you are up to.

   Fresh-context reviewers run via the Task/subagent tool (not slash commands): `ac-verifier` (acceptance criteria), `review-idea-pack`, `review-build-plan`, `review-ingest` (derived-fact audit for the `ingest` door), `security-auditor`, and `seo-specialist`.

4. Point out the four gates that stay the human's call (see Rules), then stop. Do not auto-run the next skill.

## Rules

- Do not skip stages. Each reads the artifact the previous one wrote; a missing artifact means run that skill first.
- Four decisions stay HUMAN and a skill only prompts, never auto-answers: (1) idea validation, (2) the architecture decision, (3) design-system taste, (4) approval of the Idea Pack and PRD, plus human code review at ship.
- Do not proceed to build (the `phase-start` skill) until an approved Idea Pack, PRD, acceptance checklist and initial ADRs all exist on disk.
- Exit criteria are file-based. Every phase closes on criteria that name a path they are written or saved to; a criterion that cannot point at a file it landed in is a smell, rewrite it as one that can. (The `verify-acs` skill enforces this.)
- Context is disk, not chat: if it matters it is in `docs/`, an ADR, or (if you use Beads) a task.
- This skill never edits files. It only reads to orient.

## Coaching primitives

The interactive skills read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default `beginner`/`coach`) and adapt their tone and confirmation frequency, they never fork the content and never skip a human gate. In `coach` mode you get one opinionated recommendation and one decision at a time in plain language; `execute` is terser for people who know the terrain; `auto` chains the non-binding steps and stops only at the four gates and anything irreversible. Whichever mode is set, a visual choice (palette, type, spacing, a whole direction) is shown as an HTML file you open in a browser, never described in prose or picked from a hex list (the N10 rule). When you lack the words for a design feeling, the refinement cheatsheet in `PRINCIPLES.md` gives you shared vocabulary so the pickers present choices consistently.

## Output

Writes nothing. Prints: current-stage orientation, the install commands, and the full lifecycle map above (commands, skills, orientation skills and reviewer agents). For any single step, hand off to that step's skill.
