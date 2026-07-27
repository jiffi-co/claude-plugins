# Installing builder-kit

## Prerequisites (outside Claude Code)

git, GitHub CLI (`gh`), Node 22+, and Claude Code itself. If you do not have Claude Code yet:

```bash
curl -fsSL https://claude.ai/install.sh | sh
```

`/builder-kit:setup` checks the rest once the plugin is in, installs what it can without a password, and prints one exact line for anything it will not install for you.

## Step zero: install the plugin (two lines)

```bash
claude plugin marketplace add jiffi-co/claude-plugins
claude plugin install builder-kit@jiffi-claude-plugins
```

This is a hard prerequisite, not a formality. Nothing under `/builder-kit:` exists until both lines have run, so every command block in the kit's own skills and in the Jiffi guides resolves to nothing before this point.

If a Claude Code session was already open, restart it. A plugin installed mid-session is not active until the session restarts.

`claude plugin details builder-kit` shows the component inventory and token cost before you commit. Expect `Skills (37)`: Claude Code counts the 29 skills and the 8 commands together, because they share one namespace and you type both the same way, `/builder-kit:<name>`. It also reports `Hooks (8)`, which cost no model context: they run in the harness.

### Developing on the kit

Add the marketplace by local path rather than by GitHub slug, so your working tree is the source:

```bash
claude plugin marketplace add /absolute/path/to/jiffi-ai-hub/builder-kit
claude plugin install builder-kit@jiffi-claude-plugins
```

The marketplace name is `jiffi-claude-plugins` either way, so use one source per machine, not both.

**An edit does NOT reach the installed copy on its own, and `claude plugin update` does not fetch it either.** Install takes a SNAPSHOT of the plugin directory. Update re-resolves the marketplace, which for a local path re-reads the same directory it already snapshotted, so it reports success and changes nothing. The symptom is the worst kind: the command still exists, still runs, and still behaves like the version you edited an hour ago, so you debug a file that is not the file being executed.

The loop that actually works is uninstall, then install:

```bash
claude plugin uninstall builder-kit@jiffi-claude-plugins
claude plugin install builder-kit@jiffi-claude-plugins
```

Then restart Claude Code. A plugin is loaded at session start; nothing you install mid-session is live until the session restarts.

Verify you are running what you think you are running, rather than assuming:

```bash
claude plugin details builder-kit | head -5           # the version it loaded
ls ~/.claude/plugins/*/builder-kit*/VERSION           # the snapshot on disk
cat VERSION                                           # your working tree
```

Bump `VERSION` on every change worth testing. Two identical version strings are indistinguishable at a glance, and "did my edit land" is the question this whole section exists to answer. When the three disagree, the snapshot is stale and the uninstall/install pair above is the fix.

## First run

```
/builder-kit:setup
/builder-kit:start my-app
```

`/builder-kit:start` also writes the project's `.claude/settings.json` with the deny-`.env` rule and registers this marketplace plus plugin, so trusting the new folder offers to enable it automatically. The older names `/builder-kit:jiffi-doctor` and `/builder-kit:jiffi-init` still work and forward to these two.

## Update

The marketplace is the only update channel, so there is no separate updater to drift. Refresh the marketplace, then apply the new version:

```bash
claude plugin marketplace update jiffi-claude-plugins
claude plugin update builder-kit
```

Then restart Claude Code, which is what applies it. Or enable auto-update for the marketplace.

## Uninstall

```bash
claude plugin uninstall builder-kit@jiffi-claude-plugins
```

## Optional: the Stop test-gate

Off by default. To make a red test suite block a turn from ending during a build phase, add `.claude/builder-kit.json`:

```json
{ "stopTestGate": true, "testCommand": "npm test" }
```

Remove it (or set `false`) for normal chat, because you do not want your tests running at the end of every turn.
