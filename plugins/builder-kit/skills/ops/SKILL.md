---
name: ops
description: Use when the user has a live or in-progress product and asks about day-to-day running — context/cost house rules, monitoring, keeping the toolchain current, or says /ops. A reference to return to throughout every project, not a one-shot task.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Ongoing Operations

The house rules for running Claude Code and a live product well: manage context before it degrades quality, keep spend intentional, wire up monitoring, and keep the toolchain current. This is a reference you return to, not a linear task.

## When to use / when not

- Use when: the user asks how to manage context or cost, wants error monitoring set up, asks how to update their tools, or wants the monthly freshness routine. Also use as the standing reference between phases.
- Not for: building features (that is `plan` then `phase-start`), shipping (`ship`), or debugging a specific failure (`/debug`, or the troubleshooting reference).
- This skill PROMPTS on judgement calls (budget, model choice, when to clear). It never decides them for the user.

## Process

Pick the section the user needs. Do not run all of them.

### 1. Context management (the most important operational skill)

Context is the number-one cause of Claude degrading. Enforce as house rules:

- Check usage with `/context`. Stay below **60%** — a Jiffi house rule, not a product limit, so quality never gets the chance to slide.
- `/clear` between every phase and after finishing a task. It wipes the conversation but keeps CLAUDE.md and auto memory loaded.
- After **two failed corrections** on the same problem, `/clear` and restart with a better prompt. A clean session beats a long corrected one.
- Prefer `/clear` over `/compact`. If you must compact, add a focus instruction (`/compact preserving Phase 3 progress and the current schema`).
- `/rewind` sheds history from a checkpoint; `/btw` handles a side question without it entering session history.
- Signs context is too full: Claude forgets earlier decisions, re-suggests rejected approaches, hallucinates file or API names, slows down, or drops code quality. Clear immediately.

### 2. Cost management

- Check spend with `/usage` (`/cost` still works as an alias) — it shows current session token usage.
- Ask the user for a weekly or monthly budget per person and record it; there is no built-in spending cap, so this is discipline. Use AskUserQuestion if they have not set one.
- Levers: `/effort` (low through max) to dial down routine work; `opusplan` for Opus-planning / cheaper-execution; keep context clean; use subagents for focused tasks; be specific in prompts. Note `/fast` runs Opus at premium pricing — a cost **increaser**, flag it so nobody trips it by accident.
- Model choice is the user's call and account-dependent (see the `plan`/model decision guide). Do not hard-recommend one.
- Agent Teams use materially more tokens than a single session — reach for them only when the work genuinely needs parallel sessions; subagents are the default way to parallelise.

### 3. Monitoring (Sentry)

For a live product, wire up error monitoring so you hear about failures before users report them.

1. Confirm with the user, then install and configure Sentry for the stack (its wizard walks the setup):
   ```bash
   npx @sentry/wizard@latest -i nextjs
   ```
2. Put the DSN in environment config, never in a committed file. Verify `.env*` is gitignored.
3. After deploy, trigger a test error and confirm it lands in the Sentry dashboard — **verify the check ran**; a silently-failing monitor looks identical to a healthy one.

### 4. Keeping the toolchain current

- **Claude Code:** native installer auto-updates in the background — nothing to run by hand. Choose speed with `autoUpdatesChannel` (`latest` default, or `stable` ~a week behind). On the demoted npm path (needs Node 22+): `npm update -g @anthropic-ai/claude-code`.
- **Health check:** `claude doctor` from the shell, or `/doctor` in-session. The old `claude /doctor` form does not work.
- **Beads:** update from `gastownhall/beads` (Dolt-backed); check its README for the current command.
- **Plugins:** run `/plugin marketplace update` at the start of each module, then `/reload-plugins` if prompted.
- After a major Claude Code update, re-run `verify-setup` to confirm everything still works.

### 5. Monthly freshness routine

Ecosystem churn outpaces any static doc. Once a month, walk the project's pinned versions, URLs and tool claims against live sources, and open a Beads issue per rotted claim:
```bash
bd create -t "Freshness: <claim that went stale>"
```
Keep a "verified against" note (tool versions + date) on docs that pin versions.

### 6. Logging decisions and ADRs (pointers)

- When the user confirms a choice worth remembering, use the `decision-log` habit ("log it") to append to `docs/decisions.md`.
- For an architectural decision a teammate would later ask "why?" about, use `create-adr` to write `docs/adr/`. Do not fold that into this skill.

## Rules

- The 60% context ceiling and the two-failed-corrections rule are hard house rules — enforce them, do not soften them.
- Budget and model choice stay the human's decision. Prompt, present options, never auto-answer.
- Never commit `.env` files or put secrets (Sentry DSN, DB URLs) in tracked config; use `.claude/settings.local.json` or environment config.
- Monitoring is not "done" until a test error has been seen in the dashboard.
- Cost and context are managed by the human, not by waiting for auto-compaction — check `/context` and `/usage` yourself.

## Output

This is a reference skill; it writes files only when a section acts:

- Section 3 (monitoring): Sentry config files created by its wizard, DSN in environment config (never tracked).
- Section 5 (freshness): one `bd` issue per stale claim; optional "verified against" note in the relevant doc.
- Section 6: appends to `docs/decisions.md` or writes `docs/adr/NNNN-*.md` via the dedicated skills, not inline here.
