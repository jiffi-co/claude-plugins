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
3. Show the lifecycle map. Skills run in this order; each writes a real file. The `Type` column tells you what each one is: **cmd** = one of builder-kit's four real slash commands (you type it with a slash), **skill** = a skill you invoke by naming it in plain language (like "validate my idea"), never with a slash, **agent** = a fresh-context reviewer you launch via the Task/subagent tool.

   | # | Type | Name | One-line purpose | Artifact written |
   |---|------|------|------------------|------------------|
   | 1 | cmd | `/jiffi-doctor` | Preflight check the environment before you start | prints a readiness report |
   | 2 | cmd | `/jiffi-init` | Scaffold the repo and wire up builder-kit | project skeleton |
   | 3 | skill | `validate-idea` | Pressure-test the raw idea before any build (HUMAN gate) | notes in `docs/idea/` |
   | 4 | skill | `idea-pack` | Turn the validated idea into a structured Idea Pack | `docs/idea/idea-pack.md` |
   | 5 | skill | `prd` | Expand the pack into a PRD with testable acceptance criteria | `docs/prd/prd.md` |
   | 6 | skill | `architect` | Surface options, record the chosen architecture (HUMAN decides) | `docs/adr/*.md` |
   | 7 | skill | `design-system` | Lock tokens, type, colour, components (HUMAN taste) | `docs/design-system/MASTER.md` |
   | 8 | skill | `create-adr` | Record a single architecture decision as its own ADR | numbered `docs/adr/*.md` |
   | 9 | skill | `implementation-plan` | Break the PRD into independently testable phases | `docs/implementation-plan.md` |
   | 10 | skill | `page-specs` | Spec each page before building it | per-page specs under `docs/` |
   | 11 | skill | `phase-start` | Open the next phase, seed tasks, branch | tasks + git branch |
   | n/a | n/a | *(build)* | Write the phase's code (the build loop) | source + tests |
   | 12 | skill | `verify-acs` | Check each acceptance criterion actually passes | `docs/checkpoints/*.md` |
   | 13 | skill | `ui-review` | Visual + UX pass on the running app in the browser | `docs/checkpoints/ui-review-[phase].md` |
   | 14 | skill | `phase-complete` | Close a phase only when tests are green | commit + closed tasks |
   | 15 | cmd | `/checkpoint` | Snapshot progress so a fresh session can resume | checkpoint entry |
   | 16 | skill | `ci-setup` | Wire up CI so tests gate every push | CI workflow config |
   | 17 | skill | `ship` | Code review, PR, deploy | PR + deployment |
   | 18 | skill | `ops` | Context, cost, security, error recovery (continuous) | ADR updates as needed |
   | 19 | skill | `iterate` | Feed a new change back into the `validate-idea` or `prd` skill | new pack/PRD entry |

   For orientation at any time (these do not advance the build): name the `resume` skill to reload the session state from disk, and `build-status` to report where you are up to.

   Fresh-context reviewers run via the Task/subagent tool (not slash commands): `ac-verifier` (acceptance criteria), `review-idea-pack`, `review-build-plan`, `security-auditor`, and `seo-specialist`.

4. Point out the four gates that stay the human's call (see Rules), then stop. Do not auto-run the next skill.

## Rules

- Do not skip stages. Each reads the artifact the previous one wrote; a missing artifact means run that skill first.
- Four decisions stay HUMAN and a skill only prompts, never auto-answers: (1) idea validation, (2) the architecture decision, (3) design-system taste, (4) approval of the Idea Pack and PRD, plus human code review at ship.
- Do not proceed to build (the `phase-start` skill) until an approved Idea Pack, PRD, acceptance checklist and initial ADRs all exist on disk.
- Context is disk, not chat: if it matters it is in `docs/`, an ADR, or (if you use Beads) a task.
- This skill never edits files. It only reads to orient.

## Output

Writes nothing. Prints: current-stage orientation, the install commands, and the full lifecycle map above (commands, skills, orientation skills and reviewer agents). For any single step, hand off to that step's skill.
