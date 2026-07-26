# builder-kit

The Jiffi build workflow as an installable Claude Code plugin. It takes a raw idea to a shipped, well-built product and keeps you iterating on it — with real gates, not vibes. Your expert 2IC.

It replaces the copy-paste setup and mega-prompts from the Jiffi guides. The guides still teach the *why* (and stay the taught path the first time through); this is the accelerator for every project after.

## Quick start

```
/plugin marketplace add jiffi-co/claude-plugins
/plugin install builder-kit@jiffi-claude-plugins
/reload-plugins
```

Then, in a project:

```
/jiffi-doctor            # is my machine ready?  (read-only)
/jiffi-init my-app       # scaffold a new project
/validate-idea           # pressure-test the idea, then /idea-pack
```

## What it gives you

The whole lifecycle, each step a skill or command:

- **Set up** — `/jiffi-doctor` (tiered health check, `--json`), `/jiffi-init` (scaffold with rollback).
- **Shape** — `validate-idea` → `idea-pack` → `prd` → `architect` → `design-system` → `create-adr` → `implementation-plan` → `page-specs`.
- **Build** — `phase-start` → build one step at a time → `verify-acs` / `ui-review` → `phase-complete` (with learnings written back) → `/checkpoint` (a deterministic gate) → `build-status` for orientation.
- **Ship** — `ci-setup` (one-time), `ship` (review, PR, deploy, post-deploy verify).
- **Operate & extend** — `ops`, `decision-log`, `resume`, and `iterate` to add a feature to a product that is already live.
- **Reviewers** (fresh-context second opinions) — `ac-verifier`, `review-idea-pack`, `review-build-plan`, `security-auditor`, `seo-specialist`.
- **Guards** — a secret-scan on writes, an optional Stop test-gate, and a SessionStart re-grounding that reads your decisions/ADRs/plan.

Run `cheatsheet` any time for the one-screen map.

## What stays your call

builder-kit prompts, it never decides for you: validating the idea, the architecture choice, design taste, approving the Idea Pack and PRD, and signing off code review. It automates the mechanical and surfaces the judgement.

## Bundled MCP

`.mcp.json` starts Context7 (current library docs) and Playwright (drive the real UI) when the plugin is enabled. Both degrade gracefully if unavailable.

See INSTALL.md for the full install, update and uninstall flow.
