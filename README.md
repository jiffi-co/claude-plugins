# Jiffi Claude Plugins

A Claude Code plugin marketplace hosting **builder-kit** — the Jiffi build workflow as an installable plugin, so builders stop copy-pasting setup and steps out of long guides and instead install and update the workflow like software.

This repo is a self-contained marketplace, hosted like Palate's. It is developed inside the jiffi-ai-hub repo and published to its own git repo (`jiffi-co/claude-plugins`); it is not part of the Next.js app build.

## Install

```
/plugin marketplace add jiffi-co/claude-plugins
/plugin install builder-kit@jiffi-claude-plugins
```

Then `/reload-plugins` (or restart) — a freshly installed plugin is not active until you do. Update later with `/plugin marketplace update jiffi-claude-plugins`.

## What builder-kit gives you

The whole build lifecycle, each step a skill or command — set up, shape (idea -> PRD -> ADRs -> plan), the phase-by-phase build loop with deterministic gates, test & verify, CI/CD, ship, operate, and iterate on a product that is already live. Plus fresh-context reviewer agents and safety hooks.

Full component map, install detail, and the "what stays your call" boundary: see [`plugins/builder-kit/README.md`](plugins/builder-kit/README.md) and [`plugins/builder-kit/INSTALL.md`](plugins/builder-kit/INSTALL.md).

## Structure

```
.
├── .claude-plugin/marketplace.json     # the catalogue (points at the plugin below)
├── .github/workflows/                  # validate on push; release on tag (with SHA-256 checksums)
└── plugins/builder-kit/
    ├── .claude-plugin/plugin.json
    ├── skills/            # validate-idea, idea-pack, prd, architect, design-system,
    │                      # implementation-plan, page-specs, phase-start/complete,
    │                      # build-status, ui-review, verify-acs, ship, ci-setup, ops,
    │                      # decision-log, iterate, resume, cheatsheet, create-adr
    ├── commands/          # jiffi-init, jiffi-doctor, checkpoint
    ├── agents/            # ac-verifier, review-idea-pack, review-build-plan,
    │                      # security-auditor, seo-specialist
    ├── hooks/             # secret-scan, session-reground, stop-test-gate
    ├── scripts/           # checkpoint.mjs, doctor.mjs, init.mjs (+ scripts/test/run.sh)
    ├── templates/         # the project scaffold jiffi-init copies from
    ├── .mcp.json          # Context7 + Playwright
    └── README.md, INSTALL.md, VERSION
```

## Developing / testing

```
bash plugins/builder-kit/scripts/test/run.sh
```

Validates the plugin is well-formed (JSON, script syntax, hook/command references, frontmatter) and that every shipped script behaves. CI runs the same on every push; a git tag cuts a GitHub Release with a SHA-256 checksum.

## What a plugin cannot do (and how this handles it)

A plugin cannot set a project's permission rules for you, so `/jiffi-init` **writes** the deny-`.env` rule and the marketplace/plugin registration into the new project's `.claude/settings.json`. A plugin-root `CLAUDE.md` is not loaded, so project context ships as skills; the scaffold provides the project's own `CLAUDE.md` with the `@AGENTS.md` import. Everything else — skills, commands, agents, hooks, MCP — ships in the plugin and updates through the marketplace.
