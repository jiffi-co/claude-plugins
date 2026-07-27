---
name: bootstrap
description: "Stand up a runnable app shell from the accepted ADRs, then prove it runs. Runs the framework's own create command, wires the test runner to the recorded testCommand, installs the database driver and migration tool, writes .env from .env.example, runs the first migration, then proves the shell with two captured outputs: the app answers, and the test command exits 0. Fires when the ADRs are accepted and the repo has no runnable app shell yet."
allowed-tools: [Read, Write, Edit, Bash, Grep, Glob, Skill]
---

# Bootstrap the app shell

The step between "the architecture is decided" and "there is something to build into". It reads the decisions already on disk, runs the framework's own scaffold, wires the pieces the ADRs name, and then **proves the result runs** rather than asserting it.

Operating rules: re-read `${CLAUDE_PLUGIN_ROOT}/PRINCIPLES.md` before you start.

## When to use / when not

- **Use** once the tech-stack ADR is accepted and before the first build phase, in a repo with no runnable app shell.
- **Not** to add a library mid-build (that belongs to the phase that needs it), and **not** to choose the stack. If there is no accepted tech-stack ADR, stop and run `architect`. Guessing a stack here silently overrides a decision the human owns.
- Safe to re-run. It never overwrites an existing file, it reports what was already there, and it fills only the gaps.

## Read first, decide nothing

1. `.claude/builder-kit.json` for `projectType` (`web` / `ios` / `agent`) and `testCommand`. Everything below branches on `projectType`.
2. Every file in `docs/adr/` with status accepted: the framework, the database, the ORM or migration tool, the test runner, the hosting target.
3. `docs/implementation-plan.md`, phase 1 only. The shell exists to make phase 1 buildable, nothing more.

If an ADR names a version, honour it. If it does not, **check the current create command with Context7 before you run it**. Framework CLIs change flags between majors and a remembered flag is the most common way this step fails.

## Process

### 1. Scaffold with the framework's own create command

Never hand-roll a project structure a generator already produces. The kit's directories (`docs/`, `.claude/`, `CLAUDE.md`) are already in place, so most create commands refuse to run in the directory. Scaffold into the kit's scratch directory and copy out without clobbering:

```bash
npx create-next-app@latest .builder-kit-tmp --ts --app --eslint --use-npm --yes
cp -Rn .builder-kit-tmp/. .        # -n never overwrites; it EXITS 1 when it skips
rm -rf .builder-kit-tmp
test -f package.json && echo "app shell in place"
```

Two things here are not decoration:

- **`cp -Rn` is what protects the work already on disk.** It never overwrites, so an existing `CLAUDE.md`, `.gitignore` or `README.md` survives the scaffold. Dotfiles come across because the source is `.builder-kit-tmp/.`, not `.builder-kit-tmp/*`.
- **These are separate lines, not an `&&` chain.** BSD `cp` exits 1 when `-n` skips an existing file, and it always skips at least one here, so `cp ... && rm -rf ...` never reaches the `rm` and strands the scratch directory. The `test -f package.json` line is the real check; that cp exit code is not evidence of anything.

Swap the create command for whatever the ADR chose (`npm create vite@latest`, `npx create-expo-app`, `npx sv create`), keeping the same shape.

**Batch the installs.** Permission prompts scale with Bash tool CALLS, not with subprocesses, so one call that installs six things costs one prompt where six calls cost six. Chain the INSTALLS with `&&` so a failure stops the chain rather than hiding under a later success. The copy step above is the deliberate exception to that.

- **ios:** the scaffold already ships. `xcodegen generate` builds the `.xcodeproj` from `project.yml`, which is the source of truth. Do not hand-edit the `.xcodeproj`.
- **agent:** the scaffold already ships (`src/agent.ts`, `evals/`). `npm install` is usually the whole step.

### 2. Wire the test runner to `testCommand`, exactly

Install the runner the ADR names, then make the project's script and the recorded `testCommand` agree **character for character**. A mismatch is silent: the Stop gate runs the recorded command, the recorded command does not exist, the gate fails open, and the project looks green with no tests running at all.

```bash
npm i -D vitest && npm pkg set scripts.test="vitest run"
```

Then set `"testCommand": "npm test"` in `.claude/builder-kit.json`, or change the script to match what is already recorded. One of the two moves; never leave both.

**Write one smoke test, do not ship an empty suite.** Vitest exits 1 with "No test files found" unless you pass `--passWithNoTests`, so an empty suite is not a passing suite, and papering over it with that flag hides a runner that never actually executes. One trivial test (the app module imports, or the health route returns 200) proves the runner runs, and it is the test the first phase extends.

### 3. Database and environment

Only if an ADR names a database.

- Install the driver and the migration tool the ADR chose, in the same batched call.
- Copy `.env.example` to `.env` and fill it with LOCAL development values only. Never write a real secret into a file: the secret-scan hook blocks it, correctly, and a blocked write in Claude Desktop renders as a hang. If a real credential is needed, stop and ask for it to be put in the environment.
- Stand the local database up (Docker, or the provider's local emulator), then run the first migration through the tool's own command. A schema applied by hand is the defect `phase-complete` exists to catch.
- If the ADR names a hosted database that must be provisioned, that is **H-PROVISION**. Do not create it. Report it and let the human decide.

### 4. Prove it. Two captured outputs, or it did not happen

State honesty applies here more than anywhere: never write "the dev server is running" without the output in front of you.

**Proof 1, the app answers.** Web:

```bash
mkdir -p .claude/builder-kit
START=$(node -e 'const s=(require("./package.json").scripts)||{};for(const k of ["dev","start","serve"])if(s[k]){console.log("npm run "+k);break}')
[ -z "$START" ] && { echo "no dev/start/serve script in package.json — name the run command yourself"; exit 1; }
$START > .claude/builder-kit/bootstrap-dev.log 2>&1 &
DEV=$!
URL=""
for i in $(seq 1 45); do
  URL=$(grep -Eom1 'https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):[0-9]+' .claude/builder-kit/bootstrap-dev.log) && [ -n "$URL" ] && break
  sleep 1
done
[ -z "$URL" ] && URL="http://localhost:3000"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL")
kill $DEV 2>/dev/null
echo "app at $URL answered $CODE (started with: $START)"
```

Two things here are the fix for a real failure, not defensiveness. **The run command is read from `package.json`, never assumed to be `dev`.** The instruction above says to swap the create command for whatever the ADR chose, and that instruction stopped at the scaffold: the proof harness below it still hardcoded `npm run dev`, so an accepted ADR that chose no framework had no `dev` script and the harness had to be rewritten by hand — by the one person the kit exists so as not to need. **And the URL grep accepts `127.0.0.1` and `0.0.0.0`, not just `localhost`.** A bare `node:http` server logs `127.0.0.1` and the old pattern found nothing, silently fell back to port 3000, and reported `000` against a server that was answering perfectly well two lines above.

Any HTTP status is an answer; `000` after 45 seconds is a failure, and the log holds the reason. Always kill the server, in the same call, so a background process does not outlive the turn.

If the ADRs chose something with no long-running server at all (a CLI, a library), say so and prove it the way that thing is proved: the entry point runs and exits 0, with its output pasted. Do not invent a server to satisfy the shape of this block.

- **ios:** there is no dev server. The proof is a clean build for the simulator: `xcodebuild build -scheme <name> -destination 'platform=iOS Simulator,name=iPhone 16'` exits 0.
- **agent:** the proof is that the entrypoint runs and the eval harness exits 0: `npm start` (or `node --check src/agent.ts`) then `npm run eval`.

**Proof 2, the test command exits 0.** Run the exact recorded `testCommand`, not a command you think is equivalent, and paste its last lines.

If either proof fails, **stop and report it**. Do not soften it, do not proceed to phase 1, and do not describe the shell as ready. A shell that does not run is the problem this skill exists to prevent, not a detail for the first phase to sort out.

### 5. Commit and hand back

Stage explicit paths and commit (`chore: bootstrap the app shell`). Never `git add -A`; other agents may be working in this tree. Then print what exists now, the two proofs verbatim, and the next action (`/builder-kit:build`).

## Rules

- The ADRs decide the stack. This skill executes them; it never chooses, and it never substitutes a stack it likes better. **That includes the proof harness**, not just the create command: read the run command off `package.json` and match the URL the app actually prints. Nothing in this skill may assume a framework the ADRs did not choose.
- Verify the create command with Context7 before running it. A remembered CLI flag is a guess.
- Never overwrite an existing file. `cp -Rn`, report what was skipped.
- A proof is captured output from this turn. Nothing else counts as evidence.
- Batch installs into one Bash call. Prompts scale with calls.
- Provisioning a hosted provider is H-PROVISION and stops for the human, whatever the assistance mode says.

## Output

- A runnable app shell at the repo root, from the framework's own generator.
- A test script and `testCommand` that match exactly, with one passing smoke test.
- `.env` from `.env.example` with local values, and the first migration applied where a database is in scope.
- `.claude/builder-kit/bootstrap-dev.log`, runtime state, safe to delete.
- One commit, and the two proofs printed verbatim.
