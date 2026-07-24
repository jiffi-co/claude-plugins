---
description: Verify the machine and project are ready for the Jiffi build workflow — a tiered, read-only health check that replaces the manual Verify Setup checklist.
argument-hint: "[--json]"
allowed-tools: Bash(node:*)
---

Run the shipped, read-only setup health check and report its output.

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" $ARGUMENTS
```

The script probes tools in tiers — **core** (Node 22+, Claude Code, git, gh + auth), **recommended** (Beads, a docs MCP), **optional** — plus project config when run inside a project (CLAUDE.md, AGENTS.md, the `.env` deny rule, the docs folders). It changes nothing (there is deliberately no `--fix` for a beginner audience).

Report the table verbatim. A **core** failure means "not ready" and the script exits non-zero; the fix line tells the user exactly what to install or run. Recommended/optional warnings are worth doing but do not block. For support, `--json` prints a paste-able machine-readable result with the same exit-code contract (non-zero only when a core check fails).

If a core tool is missing, point the user at the fix line rather than trying to install it for them.
