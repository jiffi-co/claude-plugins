# builder-kit

The Jiffi build workflow as an installable Claude Code plugin. It takes a raw idea, or an existing prototype, to a shipped, well-built product and keeps you iterating on it, with real file-grounded gates, not vibes. Your expert 2IC.

It replaces the copy-paste setup and mega-prompts from the Jiffi guides. The guides still teach the *why* (and stay the taught path the first time through); this is the accelerator for every project after. It works across web, iOS and agent projects, on any stack.

## Step zero: install it

Two lines, in a terminal:

```bash
claude plugin marketplace add jiffi-co/claude-plugins
claude plugin install builder-kit@jiffi-claude-plugins
```

This is a hard prerequisite, not a formality. Until both have run, every `/builder-kit:` block in this README, in the kit's own skills and in the Jiffi guides resolves to nothing. If a Claude Code session is already open, restart it: a plugin installed mid-session is not active until the session restarts.

Working on the kit itself, point the marketplace at your checkout instead, so an edit reaches the installed copy without a republish:

```bash
claude plugin marketplace add /path/to/jiffi-ai-hub/builder-kit
claude plugin install builder-kit@jiffi-claude-plugins
```

## Quick start

Then, in a project:

```
/builder-kit:setup                   # is my machine ready?  (installs what it can)
/builder-kit:start my-app            # scaffold a new project
```

Run `/builder-kit:cheatsheet` any time for the one-screen map.

## How you invoke it

Every entry is typed the same way: `/builder-kit:<name>`, where `<name>` is the directory name under `skills/` or the file name under `commands/`. Claude Code registers all 37 (29 skills, 8 commands) in one flat namespace and makes no distinction between the two kinds at the prompt. Arguments pass straight through, so `/builder-kit:prd a booking tool for physios` reaches the skill with that context attached.

Naming a skill in plain words ("validate my idea") still works as a secondary path, because the model can match your request to a skill description, but the slash form is the documented one and the only form to print in a guide.

The directory name is the invocation key, which makes it a published contract. See `PRINCIPLES.md`.

## The eight that live in `commands/`

They behave exactly like the skills at the prompt. The only difference is which folder the file sits in:

- `/builder-kit:setup`: environment and live-session health check, installs what it can without a password and prints one exact line for the rest.
- `/builder-kit:start`: ask where you are starting from, then scaffold a project and wire up builder-kit, with rollback.
- `/builder-kit:checkpoint`: snapshot progress so a fresh session resumes cleanly.
- `/builder-kit:jiffi-adopt`: offline scan of an existing repo into the ingest flow (writes a tech-stack ADR plus stub docs, zero network).
- `/builder-kit:jiffi-import-idea8`: pull an idea8 plan in as the starting artifacts.
- `/builder-kit:jiffi-evolve`: the anti-staleness loop (harvest friction, currency-check the skills, propose gated edits).
- `/builder-kit:jiffi-doctor` and `/builder-kit:jiffi-init`: the previous names for `setup` and `start`. They still work, because they are printed in guides that are already published, and each says so before forwarding.

## What it gives you

The whole lifecycle, each step one entry in the namespace above (names below are bare for readability, you still type them as `/builder-kit:<name>`). There are two front doors after `start`:

- **Greenfield** (a fresh idea): `validate-idea` to `idea-pack` to `prd`.
- **Continue existing** (a prototype from Lovable, v0, Bolt, Cursor or Claude Artifacts, a repo, or a brief): `ingest` (or `jiffi-adopt` for an offline repo scan), audited by the `review-ingest` reviewer.

Both doors converge on the shared spine:

- **Shape**: `architect` to `wireframe` (approve the shape) to `brand` (choose the look) to `design-system` (lock tokens plus the WCAG AA contrast contract) to `create-adr` to `implementation-plan` to `page-specs`.
- **Build**: `bootstrap` (a runnable shell, proved), then `build`, which runs the loop in step or auto mode: it pre-flights each phase against the hard-stop registry, hands the mechanical span to the forked `build-phase` worker, and confirms on disk that the phase actually closed before it moves on. `verify-acs` / `ui-review`, `phase-complete` (learnings written back), `checkpoint`. `status` and `resume` orient you at any time.
- **When it goes wrong**: `status` (where am I), `unstick` (the same thing failed twice), `undo` (put the files back to when they worked, from the snapshots the kit takes as you go).
- **Ship**: `ci-setup` (one-time), then `ship` (review, PR, deploy, post-deploy verify), gated by the vision-verified ship gate.
- **Operate and extend**: `ops`, `decision-log`, and `iterate` to add a feature to a product that is already live.

## Reviewers (fresh-context second opinions)

The one exception to the namespace above. Reviewers are not slash commands, you launch them with the Agent tool: `ac-verifier`, `review-idea-pack`, `review-build-plan`, `review-ingest`, `security-auditor`, `seo-specialist`, `agent-eval`, and `ios-release-checklist`.

## Guards

A secret-scan on writes, an optional Stop test-gate, and a SessionStart re-grounding that reads your decisions, ADRs and plan. Auto-scaffolded rules (`concerns`, `security`, `copy-voice`, `logging`, `judging`, `autonomy`) are always-on contracts the skills consult rather than re-derive.

## What stays your call

builder-kit prompts, it never decides for you: validating the idea, the architecture choice, design taste, approving the Idea Pack and PRD, and signing off code review. Four gates always stay human, and the `autonomy` hard-stop registry (money, legal, destructive, deploy, provision, ship) always pauses for a person. It automates the mechanical and surfaces the judgement.

## Bundled MCP

`.mcp.json` starts Context7 (current library docs) and Playwright (drive the real UI) when the plugin is enabled. Both degrade gracefully if unavailable.

See INSTALL.md for the full install, update and uninstall flow.
