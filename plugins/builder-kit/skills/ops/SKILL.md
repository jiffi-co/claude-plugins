---
name: ops
description: The house rules for running a build and a live product well, covering context and cost discipline, monitoring, and keeping the toolchain current. A standing reference, not a one-shot task. Fires between phases, when context passes the 60 percent house limit, when a deployed product has no error tracking wired, and when tracking is wired but has never been watched to fire.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Ongoing Operations

The house rules for running Claude Code and a live product well: manage context before it degrades quality, keep spend intentional, wire up monitoring, and keep the toolchain current. This is a reference you return to, not a linear task.

## When to use / when not

- Use when: context is past the 60 percent house limit, spend needs a decision, a live product has no error tracking wired, or the toolchain is due its monthly freshness pass. Also use as the standing reference between phases.
- Not for: building features (that is `implementation-plan` then `phase-start`), shipping (`ship`), or debugging a specific failure (trace the bug inline, or use `/debug` if your Claude Code ships it).
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
- Model choice is the user's call and account-dependent (see the `implementation-plan` model decision guide). Do not hard-recommend one.
- Agent Teams use materially more tokens than a single session — reach for them only when the work genuinely needs parallel sessions; subagents are the default way to parallelise.

### 3. Monitoring, and proving it fired

For a live product, wire up error monitoring so you hear about failures before users report them. **A monitor nobody has watched fire looks exactly like a healthy one**, so wiring it is half the job and proving it is the other half. This section is not finished until an error you caused on purpose has been seen arriving.

1. Confirm with the user, then install and configure error tracking for the stack (a Sentry-class service; its wizard walks the setup):
   ```bash
   npx @sentry/wizard@latest -i nextjs
   ```
2. Put the DSN in environment config, never in a committed file. Verify `.env*` is gitignored.
3. **Prove it, do not assert it.** After the deploy, walk these four in order and keep the evidence from each; a step you did not watch happen is a step that did not happen (PRINCIPLES.md, state honesty).
   1. **Cause a real error on purpose**, in the deployed environment rather than locally, from a route or path that only you will hit. A deliberate throw behind an unlinked route is enough. Note the exact time you triggered it.
   2. **Fetch it back from the monitor rather than from the app.** Query the service's own API for events since that timestamp and read the response, or have the user open the dashboard and tell you what they see. Either is evidence; assuming the wizard's success message means events are arriving is not.
   3. **Check the alert reached a person.** An event sitting in a dashboard nobody opens is not monitoring. Confirm the alert rule exists, that its destination is somewhere the user actually reads (email, a chat channel, a phone), and that this test error produced a message there. If it did not, the alert routing is the defect, not the tracking.
   4. **Record the proof.** Append one line to `docs/decisions.md`: the date, what you triggered, where it arrived, and where the alert landed. Then remove the deliberate error. Without that line, the next person has no way to tell a working monitor from an untested one, which is the whole failure this section exists to prevent.
4. If any of the four cannot be completed (no deployed environment yet, no alert destination decided), say which one and why, and leave monitoring recorded as **not proven** rather than done. A half-wired monitor described as finished is worse than none, because it buys false confidence.

### 4. Keeping the toolchain current

- **Claude Code:** native installer auto-updates in the background — nothing to run by hand. Choose speed with `autoUpdatesChannel` (`latest` default, or `stable` ~a week behind). On the demoted npm path (needs Node 22+): `npm update -g @anthropic-ai/claude-code`.
- **Health check:** `claude doctor` from the shell, or `/doctor` in-session. The old `claude /doctor` form does not work.
- **Plugins:** run `/plugin marketplace update` at the start of each module, then `/reload-plugins` if prompted.
- After a major Claude Code update, re-run `/jiffi-doctor` to confirm everything still works.

### 5. Monthly freshness routine

Ecosystem churn outpaces any static doc. Once a month, walk the project's pinned versions, URLs and tool claims against live sources, and track one item per rotted claim:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/task-store.mjs" write freshness-<slug> --subject "Freshness: <claim that went stale>"
```
Keep a "verified against" note (tool versions + date) on docs that pin versions.

### 6. Logging decisions and ADRs (pointers)

- When the user confirms a choice worth remembering, use the `decision-log` habit ("log it") to append to `docs/decisions.md`.
- For an architectural decision a teammate would later ask "why?" about, use `create-adr` to write `docs/adr/`. Do not fold that into this skill.

### 7. Application logging policy

The full contract lives in `.claude/rules/logging.md` (scaffolded by `/jiffi-init`). It governs the logs the running product emits, not the decision log above. Consult it whenever you add or review a log line.

- **The load-bearing test:** could a future you, on a Saturday morning, reconstruct the incident from the logs alone? If not, the line is wrong. Add the missing field rather than a second sentence of prose.
- **Severity, four rungs:** debug, info, warn, error. Tie-breaker when unsure, log lower. Every line carries the mandatory structured fields (event name, timestamp, a correlation or request id, the relevant entity id); an error names the attempt in the event, puts the message (not the full stack) in `data.error`, and sets a `recoverable` boolean.
- **The HARD never-log list:** secrets, keys and tokens, passwords, full user content, file contents, and PII beyond an id. This is stack-neutral and non-negotiable. A log line that would breach it is a defect, not a verbosity preference. It is the same boundary as the redaction rule in section 8, applied at the point the product writes the log.

### 8. Secrets in commands, and proactive CLI discipline

- **Secrets via stdin, never argv.** A token on the command line leaks into shell history, `ps` output, and any process listing. Pass it on stdin or from the environment instead. So `gh auth login --with-token < token.txt`, not `gh auth login --token ghp_...`; read a value from `process.env` in code, never paste it inline. The same applies to anything you script here.
- **Redact known token shapes before echoing a line.** Before you print command output, a log excerpt, or a diff back to the user, scrub the shapes that read as live credentials: JWTs (`eyJ` triple-segment), `ghp_`, `sbp_`, `vc_`, `sk_live_`, and PEM blocks (`-----BEGIN`). Replace the body with `[redacted]`, keep enough of the prefix to name what it was. If you are unsure a string is a secret, redact it, a false redaction costs nothing.
- **Check provider status yourself before asking.** Run the read-only status checks rather than asking the user to run them: `gh auth status`, `vercel whoami`, `supabase projects list`. Report what you found, and on a stale session take it up to the point the user must act. Authenticating or provisioning an *unbound* provider is a hard stop (see `.claude/rules/autonomy.md`), so pause there for the user rather than binding an account on their behalf.

## Rules

- The 60% context ceiling and the two-failed-corrections rule are hard house rules — enforce them, do not soften them.
- Budget and model choice stay the human's decision. Prompt, present options, never auto-answer.
- Never commit `.env` files or put secrets (Sentry DSN, DB URLs) in tracked config; use `.claude/settings.local.json` or environment config.
- Never pass a secret as a command-line argument; stdin or the environment only. Redact known token shapes (JWT, `ghp_`, `sbp_`, `vc_`, `sk_live_`, PEM) before echoing any line back.
- The application's own logs obey `.claude/rules/logging.md`: the Saturday-morning test, the four-rung severity ladder, and the hard never-log list.
- **Monitoring is not done until a deliberate error has been seen arriving and the alert has reached a person**, with the proof written into `docs/decisions.md`. Anything short of that is recorded as not proven, never as done.
- Cost and context are managed by the human, not by waiting for auto-compaction — check `/context` and `/usage` yourself.

## Output

This is a reference skill; it writes files only when a section acts:

- Section 3 (monitoring): error-tracking config files created by the wizard, DSN in environment config (never tracked), and one line in `docs/decisions.md` recording the deliberate error, where it arrived, and where the alert landed. Monitoring with no such line is not proven.
- Section 5 (freshness): one tracked item per stale claim (a task file under `docs/tasks/`); optional "verified against" note in the relevant doc.
- Section 6: appends to `docs/decisions.md` or writes `docs/adr/NNNN-*.md` via the dedicated skills, not inline here.
