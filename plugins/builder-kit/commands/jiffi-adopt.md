---
description: Scan an existing repo offline and scaffold the workflow around it. Reads the manifests, the file tree and the git heatmap with zero model and zero network calls, writes a real tech-stack ADR from what it finds plus stub idea-pack, PRD and design files, so you land at the ingest skill with the derivable facts already on disk.
argument-hint: "[path to the existing repo to scan, defaults to the current directory]"
allowed-tools: Bash(node:*)
---

Bring an existing repo onto the builder-kit workflow the fast way. Where the `ingest` skill uses the model to interview you and read a prototype, `/jiffi-adopt` is the deterministic first pass: it scans OFFLINE, with no model and no network, and writes down only what it can literally SEE in the code. You run it first, then hand its output to `ingest` to confirm.

Run the shipped scanner against the repo you want to adopt (defaults to the current directory):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/adopt.mjs" $1
```

The scanner reads the repo you point it at, but it writes its `docs/` artifacts (the tech-stack ADR, the scan report, the stubs) into the project you run the command from. To adopt a repo in place, run it from inside that repo. To pull an older repo into a fresh builder-kit project, run it from the new project and pass the old repo's path. It never overwrites an existing file; a re-run routes fresh copies to a dated `docs/ingest/snapshots/` folder for diffing.

What it does, and what it deliberately does not:

- It reads manifests (package.json, requirements.txt, pyproject.toml, go.mod, Cargo.toml, Gemfile, composer.json and more), walks the file tree (skipping node_modules, .git, dist, build, .next and friends, with a 256KB per-file cap), detects routes, components and schemas, and asks git for a 200-commit file heatmap. Each phase degrades gracefully: a weird or partial repo still yields a useful result rather than an error.
- It writes a REAL tech-stack ADR at `docs/adr/ADR-0001-tech-stack.md`, where every line is a [D] derivable fact traced to the file it came from (an Evidence table), plus a full `docs/ingest/scan-report.md` (the D/C/G/A breakdown, the surface counts, the heatmap and an [A] anti-pattern punch list).
- It writes STUB idea-pack, PRD and design files, because a scanner reads code, not intent. Those are marked [G] gaps for you (or the `ingest` skill) to fill. It never asserts why the product exists, who it is for, or what success means.
- It NEVER overwrites. On a re-run, any file that already exists is written fresh into a dated dir under `docs/ingest/snapshots/` so you can diff, instead of clobbering your edits.
- Add `--json` for machine-readable output.

After it runs, report which files it wrote (and any it snapshotted rather than overwrote), then tell the user the next step it prints: run the `ingest` skill to confirm the derived [D] facts, answer the [C] questions and fill the [G] gaps, then `architect`. If it detected no stack, the repo likely uses a toolchain the scanner does not read yet, so lean on `ingest` to fill it in by hand.
