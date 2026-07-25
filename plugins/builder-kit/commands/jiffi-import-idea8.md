---
description: Import an idea8 planning session (ai.jiffi.co) into this project — drops its Idea Pack, PRD and deeper artifacts into builder-kit's canonical docs/ paths and marks the idea validated, so you continue straight from /architect.
argument-hint: "[path to the idea8 markdown export]"
allowed-tools: Bash(node:*)
---

Bring an idea8 planning session into this builder-kit project. idea8 does the deep interview + research and produces richer artifacts than the native `/idea-pack` (a competitive landscape, assumption + dependency registers, a feature brief, a commercialisation blueprint). This command files each one where builder-kit already looks, so the rest of the workflow just continues.

Run the shipped importer against the idea8 markdown export the user downloaded (the combined `Export -> Markdown` file, or the `bundle.md` from the zip):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/import-idea8.mjs" $1
```

- It keys off each artifact's `<!-- type: ... -->` marker (not the filename), maps `idea_pack -> docs/idea/idea-pack.md`, `prd -> docs/prd/prd.md`, and the idea8-only artifacts into `docs/idea/`, and writes `docs/idea/validation.md` as passed so the `/idea-pack` gate is satisfied.
- It never runs the model itself — it only files what idea8 produced.

After it runs, report exactly which artifacts were imported and to which paths, then tell the user the next step it prints (`/architect`). If it found no `<!-- type: -->` markers, the user likely exported a non-markdown format — ask them to re-export from idea8 as Markdown (or unzip and point at `bundle.md`).
