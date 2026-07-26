---
name: ci-setup
description: Use once per repo when the user has their first PR up and asks to set up CI/CD, automated PR review, branch protection or secret scanning, or names the ci-setup skill. Adapts the test/build gate to the project type (web, iOS or agent). One-time hardening, not a per-PR step.
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, AskUserQuestion]
---

# CI/CD and Security Hardening (one-time per repo)

Wires up automated PR review, a build-and-test gate, branch protection and secret scanning so a non-technical builder gets CI they did not hand-assemble. The PR review and the hardening are identical for every project; the build-and-test gate adapts to the project type (web, iOS or agent) read from `.claude/builder-kit.json`, defaulting to web. Run this once, on the repo's first PR.

## Preconditions

CI attaches to a repo that already exists on GitHub: the review app, the `ANTHROPIC_API_KEY` Actions secret, branch protection and the run history all live on the remote, not on your laptop. So before drafting anything, confirm the repo has been pushed:

```bash
git remote -v      # a remote must be listed (authoritative, needs no auth)
gh repo view       # confirms that remote resolves on GitHub (after gh auth, step 2)
```

No remote listed means the repo has never been pushed, so there is nothing on GitHub for CI to attach to. Stop here and say so plainly, rather than drafting workflow files that only fail later at the `gh` steps (`/install-github-app`, branch protection, `gh run list`). Push first: the `ship` skill sets `origin` and opens the first PR (`git push -u origin <branch>`), and CI setup resumes from there once the repo is live on GitHub.

## When to use / when not

- Use when: first PR is up (see the ship skill), no `.github/workflows/` exists yet, and the user wants automated review + gates.
- Skip when: CI already exists (check `.github/workflows/` first) — this is one-time, not per-PR.
- Not a substitute for human review: the workflow adds a second opinion, a person still approves.

## Process

1. Confirm the remote precondition holds (see Preconditions above), then check what already exists, and read the project type. Do not re-run setup over a configured repo.
   ```bash
   ls .github/workflows/ 2>/dev/null; gh auth status
   ```
   If workflows exist, stop and report; only fill genuine gaps. Then read `.claude/builder-kit.json` for `projectType` ("web", "ios" or "agent"; default web if the file is absent). The project type decides which test/build workflow you draft in step 4 and which status checks you require in step 7. The PR review workflow and every hardening step are identical for all types.

2. Confirm `gh` is present and authenticated. If not:
   ```bash
   gh --version || brew install gh
   gh auth login
   ```

3. Try the guided install first. It installs the Claude GitHub app and wires the review workflow plus the `ANTHROPIC_API_KEY` secret in one flow:
   ```
   /install-github-app
   ```
   If the org blocks GitHub apps, or you also want the test/build workflows (the command only wires review), go to step 4.

4. Draft the workflows for this project type, then STOP and show each file before writing. Use AskUserQuestion: "Approve these workflows?" — the human approves CI that will gate their merges; never write them silently. Every type gets `claude-review.yml`; the test/build workflow(s) come from the `projectType` branch below. On approval, write:

   **All types (shared): PR review**
   - `.github/workflows/claude-review.yml` — `anthropics/claude-code-action@v1`, triggers `pull_request: [opened, synchronize]`, uses `prompt` + `claude_args` (never the old `mode`/`direct_prompt`/`allowed_tools` inputs). This reviews the diff and is language-agnostic, so it is the same file for web, iOS and agent repos.

   **web (`projectType` "web", or absent): test + lint**
   - `.github/workflows/test.yml`, which triggers on `pull_request` and push to `main`, installs deps, then runs the test command recorded in `.claude/builder-kit.json` (`testCommand`, `npm test` by default). The builder may have set vitest, jest, node --test or another runner, so run the recorded command, not `vitest` by name. If that command is configured to emit coverage (for example `vitest run --coverage`), keep the fail-under-80% gate; do not bolt a coverage threshold onto a runner that reports none.
   - `.github/workflows/lint.yml` — triggers on `pull_request`; runs the stack's linter; fails on errors.
   - Whether CI needs a deploy job depends on the hosting ADR (`docs/adr/`), so read it before deciding. Some hosts (Vercel, Netlify) build a preview per PR natively, so CI writes no deploy workflow. Others (Fly, a VPS) have no native preview, so they need either a deploy job in CI or a documented manual deploy. Either way the production deploy itself is the ship skill's territory, not this one's.

   **ios (`projectType` "ios"): build + test on a macOS runner**
   - `.github/workflows/ios-ci.yml`: runs on `macos-14`, triggered by `pull_request` and push to `main`. Steps: checkout; pin the Xcode version (`maxim-lobanov/setup-xcode`); if the scaffold uses XcodeGen, run `xcodegen generate`; resolve Swift packages (`xcodebuild -resolvePackageDependencies`); run `xcodebuild test` against a simulator the runner image provides (for example `-destination 'platform=iOS Simulator,name=iPhone 15'`), then `xcodebuild build`. Name the job `ios-build-test`.
   - Optional `.github/workflows/ios-beta.yml`: a `fastlane beta` lane that uploads a build to TestFlight, triggered by `workflow_dispatch` or a version tag, never on every PR (macOS minutes and code signing make per-PR uploads wasteful). Only write it if the repo already has a `Fastfile` (from the scaffold or `fastlane init`) and the user wants it; it needs the App Store Connect API key secrets from step 6. No `Fastfile`? Skip it and say so, and do not fabricate a signing or upload flow.
   - macOS runners bill at a higher minute multiplier and start slower than Linux runners. That is normal for iOS CI, worth a one-line heads-up to the user.

   **agent (`projectType` "agent"): eval suite + deploy artifact**
   - `.github/workflows/agent-ci.yml`: runs on `ubuntu-latest`, triggered by `pull_request` and push to `main`. Steps: checkout; set up the runtime the scaffold uses (`actions/setup-node` when a `package.json` is present, `actions/setup-python` when a `pyproject.toml` or `requirements.txt` is present); install deps; run unit tests if the project has them; run the eval suite via the project's own eval script (for example `npm run eval` or `python -m evals`) and fail the job on a regression; then build the deploy artifact (`docker build` when a `Dockerfile` is present, otherwise package the agent bundle the host expects, typically a tarball). Name the job `agent-eval-build`. Do NOT deploy from here: ci-setup builds and verifies the artifact, and the ship skill deploys it to the agent host.
   - If the scaffold defines no eval script, run the unit tests, still wire the artifact build, and record the missing eval gate in your report. Do not invent an eval command the repo does not have.
   - The eval job calls the model, so `ANTHROPIC_API_KEY` must be available to it too (step 6), not only to the review workflow.

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
   Extra secrets by project type:
   - web: none beyond `ANTHROPIC_API_KEY`.
   - agent: none beyond `ANTHROPIC_API_KEY`, but reference it in the eval job as well as the review workflow, since the evals call the model.
   - ios: only if you wired the optional TestFlight lane, the user also adds App Store Connect API key secrets (an issuer ID, a key ID, and the private key), which they create in App Store Connect. Guide them to add these; never generate or commit a signing key. Skip them entirely when there is no beta lane.

7. Enable branch protection on `main` so CI is enforced, not decorative. The required status checks are the job names from step 4: web uses `test` and `lint`; ios uses `ios-build-test`; agent uses `agent-eval-build` (the optional ios beta lane is not a required check, it does not run on PRs). Confirm the checks with the user, then, for a web repo:
   ```bash
   gh api -X PUT repos/{owner}/{repo}/branches/main/protection \
     -f 'required_pull_request_reviews[required_approving_review_count]=1' \
     -F 'required_status_checks[strict]=true' \
     -f 'required_status_checks[contexts][]=test' \
     -f 'required_status_checks[contexts][]=lint' \
     -F 'enforce_admins=false' -F 'restrictions=null'
   ```
   For ios or agent, swap the two `required_status_checks[contexts][]=` lines for that type's single job name (`ios-build-test` or `agent-eval-build`). If the API call is refused (private repo on a plan without protection, or org policy), report it plainly and point the user to Settings → Branches in the UI. Verify the check ran — do not assume success.

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
- Read `projectType` from `.claude/builder-kit.json` first (default web) and write only that type's test/build workflow. Do not put web's recorded test command into an iOS or agent repo, and do not put `xcodebuild` into a web repo. The PR review workflow and the hardening are the only parts shared across all types.
- Claim only tooling the repo actually has. Gate the optional iOS TestFlight lane on a real `Fastfile`, gate the agent artifact build on a real `Dockerfile` or packaging script, and gate the agent eval step on a real eval script. Where one is missing, skip that piece and report the gap; do not scaffold a fake lane, image or eval.

## Output

- `.github/workflows/claude-review.yml` (all types) plus the test/build workflow for the project type, all approved, SHA-pinned, hardened:
  - web: `test.yml`, `lint.yml`.
  - ios: `ios-ci.yml` (and `ios-beta.yml` only if a `Fastfile` and TestFlight lane were wired).
  - agent: `agent-ci.yml`.
- Repo config (not files): `ANTHROPIC_API_KEY` secret (referenced by the eval job too for agent), branch protection on `main` requiring that type's status checks, GitHub secret scanning + push protection, gitleaks in CI or pre-commit. For ios with a TestFlight lane, the App Store Connect API key secrets as well.
- One line appended to `docs/decisions.md` recording the CI/secrets decisions (via the decision-log habit).
