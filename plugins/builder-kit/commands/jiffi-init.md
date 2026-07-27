---
description: "DEPRECATED alias for /builder-kit:start. Kept so published links and older guides keep working. Scaffolds a Jiffi-workflow project after asking one question: where you are starting from."
argument-hint: "[project name] [--type web|ios|agent]"
allowed-tools: AskUserQuestion, Bash(node:*)
---

**Deprecated.** This is now `/builder-kit:start`. The old name still works, and will keep working, because it is printed in guides and posts that are already out there. Use `/builder-kit:start` from here on.

Do exactly what `/builder-kit:start` does, in the same order:

1. Ask **one** question with AskUserQuestion, before anything is written to disk: "Where are you starting from?" with three options, `Nothing yet` (`nothing-yet`), `An idea` written down or in idea8 (`idea`), `An existing build`, meaning a prototype, repo or running app (`existing-build`).

2. Scaffold, carrying the answer:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --entry-point <answer> $1
```

The script exits 2 without `--entry-point`. It has no default, on purpose.

Read `commands/start.md` in this plugin for the full behaviour: what the entry point does (marks which stages arrive with material in hand), what it does not do (branch or skip any stage), and the in-place merge rules. Mention to the builder, once, that the command has been renamed to `/builder-kit:start`.
