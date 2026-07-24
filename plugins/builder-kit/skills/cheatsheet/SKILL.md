---
name: cheatsheet
description: Use when the user is new to the builder-kit, asks "what do I run next", "where am I up to", "what's the whole workflow", or says /cheatsheet — prints the one-screen map of skills, artifacts and gates in order.
allowed-tools: [Read, Glob]
---

# Builder-Kit Cheatsheet

The one-screen map of the whole workflow: every skill in lifecycle order, the artifact it writes to disk, and the human gates you cannot skip. Everything lives in `docs/` and Beads, never in chat.

## When to use / when not

Use when someone wants the big picture, has lost their place, or is deciding what to run next. Not a doing skill: it reads and orients, it does not create artifacts. For an actual step, invoke that step's own skill.

## Process

1. If a build is already in flight, orient the human before showing the map. Glob `docs/idea/`, `docs/prd/`, `docs/adr/`, `docs/design-system/`, `docs/implementation-plan.md`, `docs/checkpoints/` and run `bd list` to see which artifacts exist, then say plainly which stage they are up to.
2. Show the two install commands (one machine, one project):
   ```bash
   # 1. Machine: install Claude Code via the native installer (Node 22+)
   curl -fsSL https://claude.com/install.sh | sh
   # 2. Project: wire up Beads task tracking in the repo
   bd setup claude
   ```
3. Show the lifecycle map (skills run in this order; each writes a real file):

   | # | Skill / command | One-line purpose | Artifact written |
   |---|---|---|---|
   | 1 | `/validate-idea` | Pressure-test the raw idea before any build (HUMAN gate) | notes in `docs/idea/` |
   | 2 | `/idea-pack` | Turn the validated idea into a structured Idea Pack | `docs/idea/idea-pack.md` |
   | 3 | `/prd` | Expand the pack into a PRD with testable acceptance criteria | `docs/prd/prd.md` |
   | 4 | `/architect` | Surface options, record the chosen architecture (HUMAN decides) | `docs/adr/*.md` |
   | 5 | `/design-system` | Lock tokens, type, colour, components (HUMAN taste) | `docs/design-system/MASTER.md` |
   | 6 | `/implementation-plan` | Break the PRD into independently testable phases | `docs/implementation-plan.md` |
   | 7 | `/phase-start` | Open the next phase, seed Beads issues, branch | Beads issues + git branch |
   | 8 | `/phase-complete` | Close a phase only when tests are green | commit + `bd close` |
   | 9 | `/verify-acs` | Check each acceptance criterion actually passes | `docs/checkpoints/*.md` |
   | 10 | `/ui-review` | Visual + UX pass on the running app in the browser | review notes |
   | 11 | `/ship` | Code review, PR, CI/CD, deploy | PR + deployment |
   | 12 | `/ops` | Context, cost, security, error recovery (continuous) | ADR updates as needed |
   | 13 | `/iterate` | Feed a new change back to step 1 or 3 | new pack/PRD entry |

4. Point out the four gates that stay the human's call (see Rules), then stop. Do not auto-run the next skill.

## Rules

- Do not skip stages. Each reads the artifact the previous one wrote; a missing artifact means run that skill first.
- Four decisions stay HUMAN and a skill only prompts, never auto-answers: (1) idea validation, (2) the architecture decision, (3) design-system taste, (4) approval of the Idea Pack and PRD, plus human code review at ship.
- Do not proceed to build (step 7) until an approved Idea Pack, PRD, acceptance checklist and initial ADRs all exist on disk.
- Context is disk, not chat: if it matters it is in `docs/`, an ADR, or Beads.
- This skill never edits files. It only reads to orient.

## Output

Writes nothing. Prints: current-stage orientation, the two install commands, and the 13-row lifecycle map above. For any single step, hand off to that step's skill.
