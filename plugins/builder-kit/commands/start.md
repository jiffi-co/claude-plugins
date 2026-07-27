---
description: Start a project on the Jiffi build workflow. Asks three questions first (where you are starting from, whether to back the work up to a private GitHub repo, and the monthly cost ceiling), then scaffolds the docs structure, CLAUDE.md, AGENTS.md, .claude config and the per-project gate from shipped templates, with forge-new discipline (never overwrites, verifies, rolls back on failure). Supports --type web|ios|agent, --repo create|skip and --cost-ceiling.
argument-hint: "[project name] [--type web|ios|agent] [--repo create|skip]"
allowed-tools: AskUserQuestion, Bash(node:*)
---

The front door. It runs in two steps, in this order, and the order is the point.

## Step 1 — ask, before anything is written

Ask all three with **AskUserQuestion**, in one call, and nothing touches the disk until they come back.

**1. Starting point** (`header: Starting point`) — "Where are you starting from?"

- `Nothing yet` — "A blank page. We will work the idea up from scratch." → `nothing-yet`
- `An idea` — "It is written down somewhere, or planned out in idea8." → `idea`
- `An existing build` — "A prototype, a repo or a running app already exists." → `existing-build`

Ask it even when you think you can infer the answer from the directory. A folder with code in it might be last week's abandoned spike, and a folder with nothing in it might belong to someone who has a full brief in idea8. Guessing here is what put this question on page 4 of the old design, weeks after the scaffold, by which point the workflow had already been laid out for the wrong starting point.

**2. Backup** (`header: Backup`) — "Should your work be backed up to a private GitHub repository?"

- `Yes, create it` — "A private repo only you can see. Your work survives this laptop." → `--repo create`
- `Not now` — "Everything stays on this machine until you say otherwise." → `--repo skip`

This is asked HERE because the gate that closes phase 1 checks that the work has been pushed, and until it is asked there is no page, and no command, that ever creates a remote. A reader who follows the pages end to end and answers "not now" still gets told, in words, that the gate will ask for it later. A reader who answers yes gets a private repo and a first push, and `gh repo create --private` is the only thing that runs.

**3. Monthly ceiling** (`header: Cost ceiling`) — "What is the most you want this to cost each month?"

- `Nothing at all` — "Free tiers only. Anything that needs a card is a decision, not a default." (recommended)
- `Up to about $20` — "A hosting plan or a small database, nothing more."
- `Up to about $100` — "Room for paid services where they earn it."
- Let them type their own.

Two later steps read this number back rather than asking again (`prd`'s fourth judgement question, and `architect`'s fifth decision). Before it was recorded here it landed nowhere, so both read-backs had nothing to read and quietly became fresh questions or, worse, assumptions.

Ask each exactly once. If the builder has already answered one in this conversation, use that answer and do not re-ask it.

## Step 2 — scaffold, carrying the answers

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" --entry-point <answer> --repo <create|skip> --cost-ceiling "<their answer>" $ARGUMENTS
```

Substitute `<answer>` with `nothing-yet`, `idea` or `existing-build`. `$ARGUMENTS` carries everything the builder typed, so a `--type web|ios|agent` and a project name both come through; do not reduce it to `$1`, which drops the type and scaffolds the wrong domain overlay on the iOS and agent tracks.

The script refuses to run without `--entry-point` and exits 2. That refusal is deliberate: a default would be a side door, and the whole reason the question moved to the front is that no stage should be reachable without it having been asked.

It also refuses, with the same exit 2, when `--entry-point existing-build` arrives together with a project NAME. Someone whose code already exists is standing in it, so a name would create an empty scaffold in a new subdirectory beside the code it was meant to wrap. Do not work around the refusal by dropping the entry point: drop the name.

`entryPoint` lands in `.claude/builder-kit.json` before a single template file is copied, so a run that dies halfway still leaves the one thing that cannot be reconstructed from the templates.

## What the answer does, and what it does not do

It records which stages arrive with material already in hand. It does **not** branch the stage sequence and it does **not** skip anything. All three entry points run idea → PRD → ADRs → design → plan → build loop, in that order. Someone arriving with a finished prototype still goes through the idea stage; they just start it from the prototype instead of a blank page. Say this to the builder if they ask why they are being walked through a stage they think they have already done.

## The rest of the run

- With a **name** (`$1`), it creates `./$1` and refuses if that directory already exists and is non-empty (it will not clobber your work).
- With **no name**, it scaffolds the current directory in place, skipping any file that already exists and reporting what it skipped. If a `.claude/builder-kit.json` is already there, it merges `entryPoint` in and leaves every other key alone.
- With **`--type web|ios|agent`** (default `web`), it lays the shared workflow base and then the domain overlay for that target, and records the type so the tail skills (`ci-setup`, `ship`, `ui-review`, the reviewers) and `/builder-kit:jiffi-doctor` branch to the right toolchain. The spine is identical across all types.
- With **`--repo create`**, it creates the private GitHub repository and pushes the scaffold commit. It never creates anything without that flag, and when `gh` is missing or signed out it says so in a sentence with the one line that fixes it, then leaves a perfectly good local project behind. Re-run `/builder-kit:start --repo create` from inside the project once it is fixed; scaffolding in place is non-destructive, so the second run only does the part that failed.
- With **`--cost-ceiling "<answer>"`**, it records `costCeiling` in `.claude/builder-kit.json`.

After it runs, report exactly what was created, updated and skipped, then tell the builder the next step it prints. That line comes from `state.mjs`, the same source `/builder-kit:status` and the session re-ground read, so it is the one answer rather than a fourth opinion. Do not hand-write the scaffolded files yourself. The script owns them so the plugin and the guides stay in sync.

Two things it may print that are not failures, and must be passed on rather than smoothed over:

- **No test command recorded.** It only records one when the script it names actually exists. A `package.json` that was already there with no `test` script gets no `testCommand`, because a recorded command that does not exist is read as fact by the close gate and the Stop hook, and a suite that never ran reports green. Tell the builder, and name theirs when they give it to you.
- **No monthly cost ceiling recorded.** It was not asked or not answered. Say that the PRD step will ask instead.

Note: a Claude Code plugin cannot set a project's permission rules for you, so the scaffolded `.claude/settings.json` carries the deny-`.env` rule and registers the builder-kit marketplace plus plugin, so trusting the new folder offers to enable it.
