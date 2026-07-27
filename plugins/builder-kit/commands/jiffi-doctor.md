---
description: Deprecated alias for /builder-kit:setup. Runs the same health check, read-only, and points at the new name.
argument-hint: "[--json]"
allowed-tools: Bash(node:*)
---

This command is now `/builder-kit:setup`. Tell the user that once, then carry on.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" $ARGUMENTS
```

Without arguments this is a read-only health check. It reports core tooling (Node 22 or newer, git, gh), the live session (plugin loaded, docs MCP answering, git identity, gh scopes, worktree), then recommended, optional, and the project scaffold.

Report the table verbatim. A blocking failure exits non-zero and its fix line says exactly what to do. `--json` gives support a paste-able artifact with the same exit contract.

To install what is missing rather than only report it, run `/builder-kit:setup`. That is where `--fix` lives: it installs everything that needs no password and writes the rest to a bootstrap script with one line to paste.
