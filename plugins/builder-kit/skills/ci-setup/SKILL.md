---
name: ci-setup
description: Use once per repo when the user has their first PR up and asks to set up CI/CD, automated PR review, branch protection or secret scanning, or says /ci-setup. One-time hardening, not a per-PR step.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# CI/CD and Security Hardening (one-time per repo)

Wires up automated PR review, a test/lint gate, branch protection and secret scanning so a non-technical builder gets CI they did not hand-assemble. Run this once, on the repo's first PR.

## When to use / when not

- Use when: first PR is up (see the ship skill), no `.github/workflows/` exists yet, and the user wants automated review + gates.
- Skip when: CI already exists (check `.github/workflows/` first) — this is one-time, not per-PR.
- Not a substitute for human review: the workflow adds a second opinion, a person still approves.

## Process

1. Check what already exists. Do not re-run setup over a configured repo.
   ```bash
   ls .github/workflows/ 2>/dev/null; gh auth status
   ```
   If workflows exist, stop and report; only fill genuine gaps.

2. Confirm `gh` is present and authenticated. If not:
   ```bash
   gh --version || brew install gh
   gh auth login
   ```

3. Try the guided install first. It installs the Claude GitHub app and wires the review workflow plus the `ANTHROPIC_API_KEY` secret in one flow:
   ```
   /install-github-app
   ```
   If the org blocks GitHub apps, or you also want the test/lint workflows (the command only does review), go to step 4.

4. Draft the three workflows, then STOP and show each file before writing. Use AskUserQuestion: "Approve these workflows?" — the human approves CI that will gate their merges; never write them silently. On approval, write:
   - `.github/workflows/claude-review.yml` — `anthropics/claude-code-action@v1`, triggers `pull_request: [opened, synchronize]`, uses `prompt` + `claude_args` (never the old `mode`/`direct_prompt`/`allowed_tools` inputs).
   - `.github/workflows/test.yml` — triggers on `pull_request` and push to `main`; installs deps, runs `npx vitest run --coverage`, fails under 80%.
   - `.github/workflows/lint.yml` — triggers on `pull_request`; runs the stack's linter; fails on errors.

5. Harden every workflow (this is why the skill exists — see Rules). Apply to the Claude action especially:
   ```yaml
   permissions:
     contents: read
     pull-requests: write
   timeout-minutes: 30
   ```
   - Pin each `uses:` to a full commit SHA, not a floating tag.
   - Restrict the Claude action's tools via `claude_args: "--allowedTools Read,Grep,Glob"` — least privilege, no shell/write unless a real need is stated.

6. Guide the secret, do not fabricate it. Tell the user to add `ANTHROPIC_API_KEY` at GitHub → Settings → Secrets and variables → Actions → New repository secret. Confirm it exists before relying on it:
   ```bash
   gh secret list
   ```

7. Enable branch protection on `main` so CI is enforced, not decorative. Confirm the checks with the user, then:
   ```bash
   gh api -X PUT repos/{owner}/{repo}/branches/main/protection \
     -f 'required_pull_request_reviews[required_approving_review_count]=1' \
     -F 'required_status_checks[strict]=true' \
     -f 'required_status_checks[contexts][]=test' \
     -f 'required_status_checks[contexts][]=lint' \
     -F 'enforce_admins=false' -F 'restrictions=null'
   ```
   If the API call is refused (private repo on a plan without protection, or org policy), report it plainly and point the user to Settings → Branches in the UI. Verify the check ran — do not assume success.

8. Turn on secret scanning. GitHub push protection is the real defence; gitleaks is the local pre-commit backstop.
   - Ask the user to enable GitHub → Settings → Code security → Secret scanning + Push protection (a click; the skill cannot toggle org settings).
   - Add gitleaks as a CI step or a pre-commit hook so a leaked key fails the build before it lands. Note in `docs/decisions.md` (via the decision-log habit) that gitleaks + push protection is the secrets story, not the demo hook.

9. Verify the pipeline is live. Push a trivial commit to the PR branch and confirm the workflows run:
   ```bash
   gh run list --branch $(git branch --show-current) --limit 5
   ```

## Rules

- One-time per repo. If `.github/workflows/` is populated, do not overwrite; report and fill only gaps.
- Human approves the workflow files before they are written (AskUserQuestion). CI that gates merges is the human's call.
- Hardening is mandatory, not optional. A prompt-injection payload was shown to steer this Action into leaking `ANTHROPIC_API_KEY`; Anthropic shipped the fix in Claude Code 2.1.128. Least-privilege `--allowedTools`, `contents: read` / `pull-requests: write`, SHA-pinned actions and a 30-minute timeout are what stop a compromised run becoming a compromised secret.
- Never write the API key into a file, workflow or `.env`. It lives only in GitHub Actions secrets. Never commit secrets.
- The skill prompts for the secret, branch protection and secret-scanning toggles; it does not silently perform account/org changes it cannot verify. Confirm each ran.

## Output

- `.github/workflows/claude-review.yml`, `.github/workflows/test.yml`, `.github/workflows/lint.yml` — approved, SHA-pinned, hardened.
- Repo config (not files): `ANTHROPIC_API_KEY` secret, branch protection on `main`, GitHub secret scanning + push protection, gitleaks in CI or pre-commit.
- One line appended to `docs/decisions.md` recording the CI/secrets decisions (via the decision-log habit).
