---
description: Scaffold a Jiffi-workflow project — docs structure, CLAUDE.md, AGENTS.md, .claude config and the per-project gate — from shipped templates, with forge-new discipline (never overwrites, verifies, rolls back on failure).
argument-hint: "[project name]"
allowed-tools: Bash(node:*)
---

Scaffold a project set up for the Jiffi build workflow by running the shipped script. It copies templates from the plugin (one source of truth, so the scaffold cannot drift from the guides), never overwrites an existing file, post-flight verifies, and rolls back anything it created if a step fails.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" $1
```

- With a **name** (`$1`), it creates `./$1` and refuses if that directory already exists and is non-empty (it will not clobber your work).
- With **no name**, it scaffolds the current directory in place, skipping any file that already exists and reporting what it skipped.

After it runs, report exactly what was created and skipped, then tell the user the next step it prints (`/validate-idea`, then `/idea-pack`). Do not hand-write the scaffolded files yourself — the script owns them so the plugin and the guides stay in sync.

Note: a Claude Code plugin cannot set a project's permission rules for you, so the scaffolded `.claude/settings.json` carries the deny-`.env` rule and registers the builder-kit marketplace + plugin, so trusting the new folder offers to enable it.
