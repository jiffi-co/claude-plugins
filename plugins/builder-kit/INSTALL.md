# Installing builder-kit

## Prerequisites (outside Claude Code)

git, GitHub CLI (`gh`), Node 22+, and Claude Code itself. `/jiffi-doctor` checks all of them and prints the fix for anything missing.

## Install (two commands)

Slash commands run one at a time:

```
/plugin marketplace add jiffi-co/claude-plugins
/plugin install builder-kit@jiffi-claude-plugins
```

Then `/reload-plugins` (or restart Claude Code) — a freshly installed plugin is not active until you do.

`/plugin details builder-kit` shows the component inventory and token cost before you commit.

## First run

```
/jiffi-doctor
/jiffi-init my-app
```

`/jiffi-init` also writes the project's `.claude/settings.json` with the deny-`.env` rule and registers this marketplace + plugin, so trusting the new folder offers to enable it automatically.

## Update

The marketplace is the only update channel — there is no separate updater to drift.

```
/plugin marketplace update jiffi-claude-plugins
```

Then restart. Or enable auto-update for the marketplace.

## Uninstall

```
/plugin uninstall builder-kit@jiffi-claude-plugins
```

## Optional: the Stop test-gate

Off by default. To make a red test suite block a turn from ending during a build phase, add `.claude/builder-kit.json`:

```json
{ "stopTestGate": true, "testCommand": "npm test" }
```

Remove it (or set `false`) for normal chat — you do not want your tests running at the end of every turn.
