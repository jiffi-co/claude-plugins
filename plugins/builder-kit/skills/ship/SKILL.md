---
name: ship
description: Take a green, committed phase to live. Runs the bundled /code-review and /security-review, opens the PR via gh, holds for HUMAN sign-off, merges, then deploys per project type and the hosting ADR (Vercel for web, TestFlight for iOS, the agent host for agent) and smoke-checks the release. Use when a phase is verified and pushed and the user asks to ship, open a PR, deploy, or names the ship skill.
allowed-tools: [Read, Edit, Bash, Grep, Glob, Task, AskUserQuestion]
---

# Ship a Phase to Live

Turns a green feature branch into a merged, deployed, verified release. It automates the mechanical pipeline (review, PR, merge, deploy, smoke check) and STOPS at the two gates that stay human: the code-review sign-off and the deploy go-ahead. The confirm, review, PR, sign-off and merge steps are identical for web, iOS and agent projects; only the deploy and the post-deploy check branch by project type (see 'By project type').

## When to use / when not

- **Use** when a phase's checkpoint gate is green and the branch is committed and pushed (i.e. `phase-complete` has run), and you are ready to open the PR and deploy.
- **Not** mid-phase, and not to close a phase — that is `phase-complete`. A red gate or unpushed work means stop and finish the phase first.
- **Never** merge a PR that no human has reviewed and approved. This skill prepares and prompts; the merge is the human's call.

## Process

This pipeline runs the same way for web, iOS and agent projects through step 6. Step 7 (deploy) and step 8 (the post-deploy check) branch on `projectType`, read from `.claude/builder-kit.json` (default `web` if the file is absent), per 'By project type' below.

1. **Confirm the branch is shippable.** In order: `git branch --show-current` (must be a `feature/*` branch, not `main`), then `git status --short` (must be clean). If either fails, stop and route back to `phase-complete`; do not open a PR on `main` or a dirty tree. Then confirm nothing is unpushed, upstream-aware so a never-pushed branch does not crash the gate:
   - Resolve the upstream with `git rev-parse --abbrev-ref @{u}`.
   - **Upstream resolves** (prints e.g. `origin/feature/foo`): `git log @{u}..HEAD --oneline` must be empty. If it lists commits, the push is unfinished, so route back to `phase-complete` to push. Do not open a PR on a partly-pushed branch.
   - **Upstream fails** (`fatal: no upstream configured for branch`): the branch has never been pushed. Do NOT fall back to `git log origin/<branch>..<branch>`; with no remote branch that command fatals, which is exactly the crash to avoid. Ask the builder (AskUserQuestion) which case applies:
     - **Deploying now (the normal path):** set the remote and tracking with `git push -u origin "$(git branch --show-current)"`, then re-run the check and continue.
     - **Staying local for now (not deploying yet):** `ship`'s PR, merge and deploy pipeline needs a remote, so do not force a push. Run the documented LOCAL-ONLY validation and stop there: the production build passes, any database migration applies cleanly to a fresh DB (where the project has migrations), and the rollback is rehearsed (the down-migration or revert has been run and confirmed to restore the prior state). Report those three as the local gate; opening the PR and deploying resume from here once you run `git push -u origin <branch>`.

2. **Run the bundled reviews.** Both ship with Claude Code — no plugin to install:
   ```
   /code-review
   /security-review
   ```
   `/code-review` runs over the branch diff; raise its effort (high/max) for wider coverage on risky changes. Fix findings, or pass `--fix` for the straightforward ones. `/security-review` catches secrets, injection and auth gaps before the PR. Re-run until clean. A "no high-confidence issues" result is a good sign, NOT a substitute for the human review at step 5.

   Then route to the fresh-context reviewer agents (via the Task/subagent tool, not slash commands): the `security-auditor` agent for a deeper, project-aware security pass on every project type, plus the reviewer keyed to `projectType`. For a **web** build, the `seo-specialist` agent checks the crawlable pages against the SEO checklist. For an **agent** build, the `agent-eval` agent runs straight after `security-auditor`. The security pass reads the diff statically; `agent-eval` goes further and actually RUNS the eval scenarios and adversarial probes (prompt injection, jailbreak, loop and cost caps), judging how the agent behaves when pushed. Treat it as a hard gate: a single clean injection or jailbreak bypass, an uncapped loop, or a leaked secret is a FAIL that blocks the ship, so fix it and re-run until it returns PASS. (An **ios** build's extra gate, `ios-release-checklist`, runs later in the ios branch, right before the archive.) Fix what every reviewer raises and re-run until clean. These agent reviews sit alongside the bundled reviews above; none of them replaces the human code review at step 5.

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

7. **Deploy per the hosting ADR.** (This step and step 8 are the **web** path; on an iOS or agent project follow the matching branch in 'By project type' below instead.) Read the hosting/deployment ADR in `docs/adr/` — the platform is the human's earlier architecture decision, not yours to pick. For Vercel, deploy with `npx vercel --prod` (or the platform's command). Vercel today: Fluid Compute with Active CPU pricing is the default, and new projects run Node 24 with server code on the Node runtime (avoid `runtime = 'edge'`, which opts into the more limited Edge runtime). Production secrets live in the platform's env UI (or a secrets manager), never in a committed `.env`. If no deployment guide exists, write one at `docs/deployment.md` (env setup, build, deploy, verify, rollback) and prompt for an ADR on the secrets approach.

8. **Post-deploy smoke check.** Point Claude in Chrome (GA in Claude Code) at the deployed URL, walk the release's acceptance criteria end-to-end, and read the console for errors. The Playwright MCP from the test phase works too if you want a scriptable path. Report each AC verified on production, plus any console error, as evidence — not "looks live".

9. **Report.** Print the shipped summary (see Output). If step 8 surfaced a break, say so plainly and do not declare the release verified.

## By project type

Read `.claude/builder-kit.json` and treat `projectType` as `web` if the file is absent (`/jiffi-init --type` writes it). Steps 1 to 6 are identical for every type: the confirm, review, PR, human sign-off and merge discipline never branches. Only step 7 (deploy) and step 8 (the post-deploy check) change, and both keep step 7's rule for all three types: the target and its credentials come from the project's ADR or `docs/deployment.md`, so surface them and never invent them.

### web (default)

Steps 7 and 8 exactly as written above. Deploy to the ADR's platform (Vercel: `npx vercel --prod`), then smoke-check the live URL with Claude in Chrome or the Playwright MCP, walking the ACs and reading the console.

### ios

Steps 1 to 6 run unchanged. Skip `seo-specialist` (it is web-only) and point `security-auditor` at the iOS surface (entitlements, keychain, ATS). Then, from `main`, in place of steps 7 and 8:

1. Bump `CFBundleVersion`. App Store Connect rejects a duplicate build number, so every upload needs a fresh one.
2. **App Store rejection gate. STOP.** Run the `ios-release-checklist` agent (via the Task/subagent tool, in a fresh context) before you archive. It reviews the on-disk build the way App Store review will and returns one verdict. A FAIL blocks the archive: fix each finding and re-run until it returns PASS. The agent never archives, uploads, or approves the submission, so a PASS means the build should clear review, not that the app is released.
3. Archive a Release build:
   ```bash
   xcodebuild -scheme "<Scheme>" -configuration Release -archivePath build/App.xcarchive archive
   ```
   Add `-workspace App.xcworkspace` if the project uses one. Signing must resolve first: a Distribution certificate plus an App Store provisioning profile, or Xcode automatic signing under your team. `/jiffi-doctor` confirms Xcode, Swift and a simulator are present; it cannot set up your signing identity, which is account state you provide.
4. Export a signed IPA through an `ExportOptions.plist` set to the App Store Connect distribution method:
   ```bash
   xcodebuild -exportArchive -archivePath build/App.xcarchive -exportOptionsPlist ExportOptions.plist -exportPath build/
   ```
5. Upload to TestFlight, authenticating with an App Store Connect API key (`--apiKey` and `--apiIssuer`), not an Apple ID and password:
   - fastlane (recommended, it also resolves signing): `fastlane pilot upload --ipa build/App.ipa`. Keep fastlane current, because Xcode 26 changed the upload CLI beneath it.
   - Apple's CLI: `xcrun altool` with the same API key. The old `--upload-app` form is deprecated in favour of `--upload-package`, which also wants the bundle id and version flags, so fastlane is the simpler path; Apple's Transporter app is the GUI alternative.
6. App Store submission is a separate, manual gate. TestFlight is not the App Store: `ship` stops at a build available to testers. Submitting for App Store review (screenshots, metadata, privacy labels, export compliance) is a human decision, not part of `ship`. Do not call the app released because it reached TestFlight.

Post-deploy check (in place of step 8): once the build finishes processing, install it from TestFlight on a simulator or a registered device and walk the release's ACs, holding the same evidence bar as web (a passing flow, no crash, clean logs). The simulator-screenshot or XCUITest path from `ui-review` is the scriptable version. Report each AC verified on the build, not "it archived".

### agent

Steps 1 to 6 run unchanged. Skip `seo-specialist` and point `security-auditor` at the agent surface (prompt injection, secret handling, tool scope); step 2's `agent-eval` gate then runs right after `security-auditor` and must return PASS before you proceed, since a clean injection or jailbreak bypass there blocks the ship. Then, from `main`, in place of steps 7 and 8:

1. Build the deployable artifact for the runtime `/jiffi-doctor` detected: a container image (`docker build -t <image>:<tag> .`, pushed to the registry the host reads) or a package or bundle (a built server bundle, an `npm pack` tarball, or a Python wheel or zip).
2. Deploy that artifact to the agent host named in the ADR. The host is the human's architecture decision (for example the OpenClaw runtime, a container platform, or a service you run), so surface it and do not invent one. Push the exact version the build produced; do not hand-edit prod. Model keys and tool credentials live in the host's secret store, never in the artifact or a committed `.env`.
3. Smoke-run one eval after deploy. Run one representative case from the agent's eval harness (the same evals `ui-review` uses) against the deployed agent, not a local build. Confirm it passes, then read the transcript for tool-call errors, leaked secrets, or off-policy output.

Post-deploy check (in place of step 8): the deployed agent passes at least one eval and its transcript is clean. Report the eval result and the transcript as evidence, because a deploy that merely started is not a verified release.

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

The `Deployed` and `Verified` lines follow the project type: **web** reports the live URL and a clean console; **ios** reports the TestFlight build (version and build number) and the ACs walked on a simulator or device, with App Store submission still pending as a manual gate; **agent** reports the host and deployed version, plus the eval that passed after deploy.
