---
name: cheatsheet
description: Print the one-screen map of the whole builder-kit workflow, every skill in lifecycle order, the file each one writes, and the human gates that cannot be skipped. Reads and orients, writes nothing. Fires when a repo has no builder-kit artefacts yet, or when what is on disk does not make the next step obvious.
allowed-tools: [Read, Glob]
---

# Builder-Kit Cheatsheet

The one-screen map of the whole workflow: every skill in lifecycle order, the artifact it writes to disk, and the human gates you cannot skip. Everything lives in `docs/`, never in chat.

## When to use / when not

Use when someone wants the big picture, has lost their place, or is deciding what to run next. Not a doing skill: it reads and orients, it does not create artifacts. For an actual step, run that step's own command.

## Process

1. If a build is already in flight, orient the human before showing the map. Glob `docs/idea/`, `docs/prd/`, `docs/adr/`, `docs/design-system/`, `docs/implementation-plan.md`, `docs/checkpoints/` to see which artifacts exist, plus `docs/tasks/` for the open tasks, then say plainly which stage they are up to.
2. Show the install commands. This is step zero, not an optional extra: until the plugin is installed, every `/builder-kit:` command in the map below resolves to nothing.

   In a terminal:

   ```bash
   # 1. Claude Code itself, via the native installer (Node 22+)
   curl -fsSL https://claude.ai/install.sh | sh
   # 2. The kit: add the marketplace, then install the plugin
   claude plugin marketplace add jiffi-co/claude-plugins
   claude plugin install builder-kit@jiffi-claude-plugins
   ```

   Then in a Claude Code session, from the directory you want the project in:

   ```
   /builder-kit:setup
   /builder-kit:start
   ```

   `setup` checks the machine and the live session and installs what it can without a password. `start` asks one question (where you are starting from) and scaffolds the project. The old names `/builder-kit:jiffi-doctor` and `/builder-kit:jiffi-init` still work and will keep working, because they are printed in guides that are already published, but they only forward to these two.

   Task tracking needs no setup. The kit keeps its own record at `docs/tasks/`, one markdown file per task, mirrored from the live native Tasks list so it survives a `/clear`.

3. Show the lifecycle map. Skills run in this order; each writes a real file.

   **How you invoke any of it.** Everything in the table is typed the same way: `/builder-kit:<name>`, where `<name>` is the directory name under `skills/` or the file name under `commands/`. Claude Code draws no distinction between the two. All 37 entries (29 skills and 8 commands) register in one flat namespace, and the plugin's own inventory counts them together. Arguments pass straight through, so `/builder-kit:prd some context here` reaches the skill with that context attached. Naming a skill in plain words ("validate my idea") still works as a secondary path, because the model can match your request to a skill description, but it is not the documented path and it is not what to print in a guide.

   The `Type` column only says where the entry lives: **cmd** = a file under `commands/`, **skill** = a directory under `skills/`. **agent** is the one exception to the paragraph above: reviewer agents are not slash commands, you launch them with the Agent tool.

   There are two front doors after `/builder-kit:start`. Greenfield (a fresh idea): take rows 3 to 5. Continue existing work (you already have a prototype from Lovable, v0, Bolt, Cursor or Claude Artifacts, a repo, or a brief): take the `ingest` front door instead of 3 to 5, then rejoin the shared spine at `architect` (row 6). Both doors converge from row 6 on.

   | # | Type | Invocation | One-line purpose | Artifact written |
   |---|------|------------|------------------|------------------|
   | 1 | cmd | `/builder-kit:setup` | Ready the machine and the live session, install what it can, print an exact line for the rest | prints a readiness report |
   | 2 | cmd | `/builder-kit:start` | Ask where you are starting from, then scaffold the repo and wire up builder-kit | project skeleton |
   | 3 | skill | `/builder-kit:validate-idea` | Greenfield door. Pressure-test the raw idea before any build (HUMAN gate) | notes in `docs/idea/` |
   | 4 | skill | `/builder-kit:idea-pack` | Turn the validated idea into a structured Idea Pack | `docs/idea/idea-pack.md` |
   | 5 | skill | `/builder-kit:prd` | Expand the pack into a PRD with testable acceptance criteria | `docs/prd/prd.md` |
   | 3b | skill | `/builder-kit:ingest` | Continue-existing door (alternative to 3 to 5). Bring a prototype, repo or brief in, derive and confirm the early artifacts (D/C/G/A confidence model), then hand to `architect` | `docs/ingest/bible.md`, `docs/ingest/reception.md`, derived `docs/` |
   | 3c | cmd | `/builder-kit:jiffi-adopt` | Offline fast path into `ingest`. Scan an existing repo with zero network calls, write a real tech-stack ADR plus stub docs | `docs/ingest/`, `docs/adr/*.md` |
   | 3d | agent | `review-ingest` | Adversarially check the derived `[D]` facts before you rely on them; downgrade over-confident guesses to `[C]` | ranked downgrade list |
   | 6 | skill | `/builder-kit:architect` | Surface options, record the chosen architecture (HUMAN decides) | `docs/adr/*.md` |
   | 6b | skill | `/builder-kit:bootstrap` | Stand up a runnable app shell from the accepted ADRs and prove it runs (the app answers, the test command exits 0). Runs any time from here until the first phase starts | app shell, `.env`, first migration, one smoke test |
   | 7 | skill | `/builder-kit:wireframe` | Low-fi shape approval per screen, before any brand taste is spent | `docs/wireframes/*.html` |
   | 8 | skill | `/builder-kit:brand` | Pick tone, palette and type by looking (N10 visual choice), hand the chosen brand to `design-system` | `docs/brand/*` |
   | 9 | skill | `/builder-kit:design-system` | Lock tokens, type, colour, components, and the WCAG AA contrast contract (HUMAN taste) | `docs/design-system/MASTER.md` |
   | 10 | skill | `/builder-kit:create-adr` | Record a single architecture decision as its own ADR | numbered `docs/adr/*.md` |
   | 11 | skill | `/builder-kit:implementation-plan` | Break the PRD into independently testable phases | `docs/implementation-plan.md` |
   | 12 | skill | `/builder-kit:page-specs` | Spec each page before building it | per-page specs under `docs/` |
   | 13 | skill | `/builder-kit:build` | Run the build loop. Picks step or auto mode, pre-flights the phase against the hard stops, hands the mechanical span to a forked worker, then confirms the phase actually advanced before it continues | branch, source, tests, `docs/checkpoints/phase-N*.json` |
   | 13b | skill | `/builder-kit:build-phase` | The forked worker `build` invokes. Not something you type: it cannot ask you anything, which is exactly why the questions stay with `build` | the phase's commits |
   | 14 | skill | `/builder-kit:verify-acs` | Check each acceptance criterion actually passes | `docs/checkpoints/*.md` |
   | 15 | skill | `/builder-kit:ui-review` | Visual + UX pass on the running app in the browser, including the vision-verified ship gate | `docs/checkpoints/ui-review-[phase].md` |
   | 16 | skill | `/builder-kit:phase-complete` | Close a phase only when tests are green | commit + closed tasks |
   | 17 | cmd | `/builder-kit:checkpoint` | Snapshot progress so a fresh session can resume | checkpoint entry |
   | 18 | skill | `/builder-kit:ci-setup` | Wire up CI so tests gate every push | CI workflow config |
   | 19 | skill | `/builder-kit:ship` | Code review, PR, deploy | PR + deployment |
   | 20 | skill | `/builder-kit:ops` | Context, cost, security, error recovery (continuous) | ADR updates as needed |
   | 21 | skill | `/builder-kit:iterate` | Feed a new change back into the `validate-idea` or `prd` skill | new pack/PRD entry |
   | 22 | cmd | `/builder-kit:jiffi-evolve` | Anti-staleness loop. Harvest `docs/evolve/friction-log.md`, currency-check the skills, propose gated edits | `docs/evolve/CHANGELOG.md` |

   Wireframe and brand sit between the PRD and `design-system` on purpose: approve the shape (`wireframe`), then choose the look (`brand`), then lock the tokens (`design-system`). The continue-existing door skips 3 to 5 but still passes through the shared spine from `architect`.

   **When something goes wrong, or you have lost the thread.** Three entries exist for exactly that, and none of them advance the build:

   | Type | Invocation | Use it when |
   |------|------------|-------------|
   | skill | `/builder-kit:status` | You do not know where you are. Reads the artifacts on disk and answers with the stage, the step number, the next command, and anything blocking it. |
   | skill | `/builder-kit:unstick` | The same thing has failed twice, or a turn ended blocked with nothing on screen. Names one cause with its evidence and offers three ways forward with their costs. |
   | skill | `/builder-kit:undo` | A change made things worse. Puts the files back to a point where they worked, from the snapshots the kit takes automatically as you go, and snapshots first so the undo can itself be undone. |

   Four more sit off the lifecycle: `/builder-kit:resume` reloads the session state from disk, `/builder-kit:cheatsheet` prints this map, `/builder-kit:decision-log` records a decision at the moment you make it, and `/builder-kit:jiffi-import-idea8` pulls an idea8 plan in as the starting artifacts.

   **Old names that still resolve.** Four entries are deprecated aliases, kept because they are printed in guides already published. Each forwards and says so: `/builder-kit:jiffi-doctor` goes to `setup`, `/builder-kit:jiffi-init` to `start`, `/builder-kit:build-status` to `status`, and `/builder-kit:phase-start` to `build`. Use the new names from here on.

   That is the full set of 37: the 26 rows above, the three recovery entries, the four off-lifecycle entries, and the four aliases.

   Fresh-context reviewers are the exception: they are not slash commands and you launch them with the Agent tool. `ac-verifier` (acceptance criteria), `review-idea-pack`, `review-build-plan`, `review-ingest` (derived-fact audit for the `ingest` door), `security-auditor`, and `seo-specialist`.

   Rules that ride along (auto-scaffolded by `/builder-kit:start` into `.claude/rules/`) are not stages, they are always-on contracts the stage skills consult rather than re-derive: `concerns.md` (the six cross-cutting rubrics), `security.md` (env and secret handling), `copy-voice.md` (the shipped-string standard the `ui-review` skill greps the built UI against), `logging.md` (the stack-neutral log policy `ops` and the build loop apply), `judging.md` (the judge discipline every evaluative skill and agent imports before it renders a verdict) and `autonomy.md` (the hard-stop registry that bounds `auto` mode). Each skill reads only the rules its surface touches.

   Two gates worth calling out early, both sitting above the CLI gates (typecheck, lint, unit, build) which only prove the machine did not explode. First, the contrast contract: `design-system` locks it and `ui-review` re-runs it on the built UI, so every token-derived text and background pair passes WCAG AA (4.5:1 normal text, 3:1 large and non-text) in both light and dark, computed inline. Second, the vision-verified ship gate: `ui-review` and `verify-acs` drive the running app in a real browser, screenshot every waypoint at desktop, tablet and mobile in light and dark, and score each against a fixed rubric under the `judging.md` discipline, so a green build cannot pass a journey that is broken in the browser.

4. Point out the four gates that stay the human's call (see Rules), then stop. Do not auto-run the next skill.

## Rules

- Do not skip stages. Each reads the artifact the previous one wrote; a missing artifact means run that skill first.
- Four decisions stay HUMAN and a skill only prompts, never auto-answers: (1) idea validation, (2) the architecture decision, (3) design-system taste, (4) approval of the Idea Pack and PRD, plus human code review at ship.
- Do not proceed to build (the `build` skill) until an approved Idea Pack, PRD, acceptance checklist and initial ADRs all exist on disk.
- Exit criteria are file-based. Every phase closes on criteria that name a path they are written or saved to; a criterion that cannot point at a file it landed in is a smell, rewrite it as one that can. (The `verify-acs` skill enforces this.)
- Context is disk, not chat: if it matters it is in `docs/`, an ADR, or a task file under `docs/tasks/`.
- This skill never edits files. It only reads to orient.

## Coaching primitives

The interactive skills read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default `beginner`/`coach`) and adapt their tone and confirmation frequency, they never fork the content and never skip a human gate. In `coach` mode you get one opinionated recommendation and one decision at a time, worded for a non-engineer; `execute` is terser for people who know the terrain; `auto` chains the non-binding steps and stops only at the four gates and anything on the `autonomy.md` hard-stop registry (money movement, accepting legal terms, a destructive irreversible action, a production deploy, provisioning an unbound provider, the final ship or merge). Whichever mode is set, a visual choice (palette, type, spacing, a whole direction) is shown as an HTML file you open in a browser, never described in prose or picked from a hex list (the N10 rule). When you lack the words for a design feeling, the refinement cheatsheet in `PRINCIPLES.md` gives you shared vocabulary so the pickers present choices consistently.

## Output

Writes nothing. Prints: current-stage orientation, the install commands, and the full lifecycle map above (commands, skills, the five off-lifecycle entries and the reviewer agents), with every entry shown in its `/builder-kit:<name>` form. For any single step, hand off to that step's command.
