# Publishing the marketplace

`builder-kit/` is a self-contained Claude Code marketplace (marketplace.json at the root, the plugin under `plugins/builder-kit/`). It is developed here inside jiffi-ai-hub and published to its own git repo, `jiffi-co/claude-plugins`, which is what learners add.

## One-time: create and push the repo

From the `builder-kit/` directory:

```bash
# validate first — never publish red
bash plugins/builder-kit/scripts/test/run.sh

# create the public repo under the jiffi-co org and push this directory to it
gh repo create jiffi-co/claude-plugins --public \
  --description "Jiffi's Claude Code plugins — builder-kit: the whole build workflow, installable." \
  --source . --remote origin --push
```

(If the `jiffi-co` org or repo name differs, adjust `jiffi-co/claude-plugins` here AND in three places that reference it: `plugins/builder-kit/README.md`, `plugins/builder-kit/INSTALL.md`, and the `extraKnownMarketplaces` block in `plugins/builder-kit/templates/project/.claude/settings.json`. The marketplace *name* stays `jiffi-claude-plugins`.)

## Publish an update (the routine path)

Once the public repo exists, do NOT hand-run `git archive` and `git add -A` to sync it. That is the footgun that emptied the public repo once: run from the wrong directory it extracts nothing, then `git add -A` deletes everything. Use the guarded script instead. Bump `plugins/builder-kit/VERSION` and commit it first, then, from the jiffi-ai-hub repo root:

```bash
bash builder-kit/scripts/publish.sh "builder-kit X.Y.Z: <what changed>"
```

It archives from the committed `HEAD:builder-kit`, fresh-clones the public repo to a temp dir, refuses to push a tree under 40 files or one missing `VERSION`, requires the 29-check suite to pass, and skips the commit entirely if nothing changed. It cleans up its temp clone on success. Nothing is pushed unless every guard passes.

## Verify the install end-to-end

In a scratch project, run the two install commands and confirm the first-run flow:

```
/plugin marketplace add jiffi-co/claude-plugins
/plugin install builder-kit@jiffi-claude-plugins
/reload-plugins
/jiffi-doctor
/jiffi-init smoke-test
```

Check: the plugin appears, `/jiffi-doctor` prints its tiered table, `/jiffi-init` scaffolds, and the secret-scan blocks a `.env` write. `/plugin details builder-kit` should list the skills/commands/agents.

## Releases

Push to `main` triggers the validate workflow (runs the test suite). Cutting a version is a git tag:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

The release workflow validates, zips the plugin, attaches a SHA-256 checksum (students execute this as Claude instructions — the checksum is the difference between distribution and a supply chain), and publishes a GitHub Release. A `-beta` suffix (`v1.1.0-beta`) publishes a pre-release channel. While iterating weekly, skip tags — every push to `main` is the update, and `plugin.json`/`marketplace.json` deliberately omit `version` so students never get stuck on stale content.

## Sync back to jiffi-ai-hub

The plugin source of truth is here in jiffi-ai-hub during development. After publishing, keep this directory as the working copy and push to the marketplace repo from it, or make the marketplace repo primary and vendor it back. Do NOT let two edited copies drift.
