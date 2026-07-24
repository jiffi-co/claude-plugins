---
name: ship
description: Take a green, committed phase to live — run the bundled /code-review and /security-review, open the PR via gh, hold for HUMAN sign-off, merge, deploy per the hosting ADR (Vercel), then smoke-check the release. Use when a phase is verified and pushed and the user asks to ship, open a PR, deploy, or says /ship.
allowed-tools: [Read, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# Ship a Phase to Live

Turns a green feature branch into a merged, deployed, verified release. It automates the mechanical pipeline (review, PR, merge, deploy, smoke check) and STOPS at the two gates that stay human: the code-review sign-off and the deploy go-ahead.

## When to use / when not

- **Use** when a phase's checkpoint gate is green and the branch is committed and pushed (i.e. `phase-complete` has run), and you are ready to open the PR and deploy.
- **Not** mid-phase, and not to close a phase — that is `phase-complete`. A red gate or unpushed work means stop and finish the phase first.
- **Never** merge a PR that no human has reviewed and approved. This skill prepares and prompts; the merge is the human's call.

## Process

1. **Confirm the branch is shippable.** `git branch --show-current` (must be a `feature/*` branch, not `main`), `git status --short` (clean), `git log origin/<branch>..<branch>` (nothing unpushed). If any fails, stop and route back to `phase-complete`. Do not open a PR on a dirty or unpushed tree.

2. **Run the bundled reviews.** Both ship with Claude Code — no plugin to install:
   ```
   /code-review
   /security-review
   ```
   `/code-review` runs over the branch diff; raise its effort (high/max) for wider coverage on risky changes. Fix findings, or pass `--fix` for the straightforward ones. `/security-review` catches secrets, injection and auth gaps before the PR. Re-run until clean. A "no high-confidence issues" result is a good sign, NOT a substitute for the human review at step 5.

3. **Open the PR via `gh`.** Draft a description from the diff and the checklist, then create it:
   ```bash
   gh pr create --base main --head "$(git branch --show-current)" \
     --title "<phase N — short description>" --body-file <path>
   ```
   The body must include: Summary (one paragraph), Changes (bullets), Acceptance criteria verified (the AC-XXX numbers from `docs/prd/acceptance-checklist.md`), Testing (tests run, pass count, coverage %), and How to test manually (reviewer steps). If `gh` is missing: `brew install gh && gh auth login`. Optionally post findings to the PR with `/code-review --comment`.

4. **First PR on this repo? Wire up CI (one-time).** If no review workflow exists, run `/install-github-app` — it installs the app and the review workflow and sets the `ANTHROPIC_API_KEY` secret in one guided flow. If your org blocks GitHub apps or you also want test/lint workflows, add them by hand using `anthropics/claude-code-action@v1` (with `prompt` and `claude_args`, e.g. `--allowedTools`). Harden any workflow you write: pin actions by SHA, set explicit `permissions` (contents: read, pull-requests: write), restrict tools, add a 30-minute timeout — this is why the prompt-injection fix in Claude Code 2.1.128 shipped. Show workflow files before creating them.

5. **HUMAN CODE REVIEW — hard gate. STOP.** A human must read the diff, confirm each listed AC is actually tested, run the app locally, check for secrets/injection/auth gaps, and approve or request changes. Use `AskUserQuestion` to confirm the PR has been reviewed AND approved by a person, and that all CI checks are green. Do NOT proceed to merge until both are true. If they want your help digesting reviewer feedback: `gh pr view <number> --comments`.

6. **Merge and sync.** Only after human approval + green CI:
   ```bash
   gh pr merge <number> --squash --delete-branch
   git checkout main && git pull
   ```

7. **Deploy per the hosting ADR.** Read the hosting/deployment ADR in `docs/adr/` — the platform is the human's earlier architecture decision, not yours to pick. For Vercel, deploy with `/vercel:deploy prod` (or the platform's command). Vercel today: Fluid Compute with Active CPU pricing is the default, new projects run Node 24, and there is no edge runtime — do not add `runtime = 'edge'`. Production secrets live in the platform's env UI (or a secrets manager), never in a committed `.env`. If no deployment guide exists, write one at `docs/deployment.md` (env setup, build, deploy, verify, rollback) and prompt for an ADR on the secrets approach.

8. **Post-deploy smoke check.** Point Claude in Chrome (GA in Claude Code) at the deployed URL, walk the release's acceptance criteria end-to-end, and read the console for errors. The Playwright MCP from the test phase works too if you want a scriptable path. Report each AC verified on production, plus any console error, as evidence — not "looks live".

9. **Report.** Print the shipped summary (see Output). If step 8 surfaced a break, say so plainly and do not declare the release verified.

## Rules

- **Human sign-off before merge is non-negotiable.** Automated review never merges a PR. This skill prompts and waits; it does not decide.
- **Do not open a PR on a dirty or unpushed branch**, and never merge with a red CI check or an unresolved review.
- The deploy platform comes from the hosting ADR — surface it, do not choose it. If no ADR exists, stop and prompt for one.
- **Never commit production secrets.** No credentials in `.env`, in env-var UIs that get committed, or anywhere in version control.
- Post-deploy verification needs concrete evidence (a passing flow, a clean console). Absence of a check is an unknown, not a pass.
- On-disk state (the ADR, the acceptance checklist, the PR, CI) is the source of truth, not chat.

## Output

No new source files (edits/actions only). Produces:
- A GitHub PR (via `gh`), merged with `--squash --delete-branch` after human approval; `main` pulled locally.
- `docs/deployment.md` if it did not already exist (env, build, deploy, verify, rollback).
- A deployed release on the ADR's platform, plus a printed ship summary:

```
SHIPPED
PR:         #<n> — merged (squash), branch deleted
Reviews:    /code-review clean, /security-review clean, human approved by <who>
Deployed:   <platform> — <live URL>
Verified:   <k/n> ACs checked live; console clean | <errors named>
Notes:      <rollback pointer, deferred items, follow-ups>
```
