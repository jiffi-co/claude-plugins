# {{PROJECT_NAME}}: agent notes

This project was scaffolded by builder-kit as an **agent** (OpenClaw-style). The
type is recorded in `.claude/builder-kit.json` (`{ "projectType": "agent" }`),
and every builder-kit tail step (scaffold, `ui-review`, `ship`, the reviewers)
reads that and branches to the agent path.

## The runtime

This starter is a Node plus TypeScript agent process. Python is also a valid
agent runtime in the builder-kit workflow; this template is TypeScript.

- **Entry point:** `src/agent.ts`.
- **Run it:** `npm start` (passes any extra args as the user input, e.g.
  `npm start "add 2 and 40"`).
- **Node version:** `node src/agent.ts` runs TypeScript directly on Node 23.6+.
  On older Node use `npx tsx src/agent.ts`, or add `--experimental-strip-types`
  (Node 22.6 to 23.5). `npm test` is plain JavaScript and runs on any Node.
- **Out of the box it fails on purpose.** No model is wired, so `npm start` stops
  with a clear "wire a ModelClient" message. That is intentional: an unwired
  agent should never look like a working one.

## The tool-call loop

`src/agent.ts` is a provider-agnostic loop: system prompt to model, model asks
for tool calls or gives a final answer, tools run, results go back, repeat until
a final answer or a step ceiling. Four extension points are marked in the file:

1. **`SYSTEM_PROMPT`:** the agent's role, limits, and tool guidance.
2. **`defaultTools`:** the tools it may call (an allowlist). Two real example
   tools ship: `get_time` and `add`.
3. **`ModelClient`:** the only stub. Plug in your LLM provider (for example the
   Anthropic or OpenAI SDK) and pass it as `config.model`.
4. **The tool-scope guard:** unregistered tools are refused, not trusted. This
   is where you add human approval for destructive tools, and where you sanitise
   tool output before it re-enters the transcript (treat tool output as data,
   not as instructions).

## Evals instead of UI review

An agent has no pixels to screenshot, so the pre-ship quality gate is an eval,
not a browser `ui-review`. Scenarios live in `evals/` (one Markdown file each,
starting with `smoke.md`); `npm test` runs the harness. See `evals/README.md`
for how eval replaces UI review and how to wire real behavioural checks once a
model is in place. For `projectType: agent`, builder-kit's `ui-review` step
means "run the evals and review the transcripts".

## Ship = deploy to the agent host

For a web build, `ship` deploys to Vercel. For an agent, `ship` **packages the
agent and deploys it to your agent host** (the OpenClaw or container host that
runs it), not to a web platform. The specific host and its credentials are
chosen during `architect` and wired once via `ci-setup`. builder-kit runs the
code-review and security passes and holds the human sign-off gate, then performs
that deploy and smoke-checks the release. builder-kit ships the workflow and the
gates, not a particular hosting account, so point `ship` at whichever host you
picked.

## Security posture (agent-specific)

The `security-auditor` reviewer runs an agent-flavoured pass: prompt-injection,
secrets, and tool-scope. Hold the line on all three:

- **Prompt injection:** tool results and fetched documents are untrusted input.
  Never let them rewrite the system prompt or expand the tool allowlist.
- **Secrets:** read keys from the environment (`process.env`), never inline, and
  never log them. See `.claude/rules/security.md`.
- **Tool scope:** keep `defaultTools` as small as the job needs. Every tool is
  attack surface.

## Where builder-kit picks up

The build workflow is the same spine as every builder-kit project. Every command
is `/builder-kit:` followed by a name, and `/builder-kit:status` will always tell
you which one is next. From here: `/builder-kit:validate-idea` to pressure-test
the idea, then `/builder-kit:idea-pack`, `/builder-kit:prd`,
`/builder-kit:architect`, `/builder-kit:implementation-plan`, and into the
phase-by-phase build loop with `/builder-kit:build`.

## If this was scaffolded over code you already had

The scaffold never overwrites a file that was already there, so a project that
already had a `package.json` kept its own. That means the three commands above
(`npm start`, `npm test`, `npm run eval`) run **your** scripts, not the agent's,
and the `start` command wrote out exactly which scripts were missing and the one
line that adds each. Until you have added them, the `Run it` and `Evals` sections
above describe scripts this project does not have.
