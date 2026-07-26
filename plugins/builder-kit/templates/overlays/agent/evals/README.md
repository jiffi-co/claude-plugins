# Evals

For a web build, the quality gate before you ship a change is `ui-review`:
builder-kit drives the real pages with a browser and checks the pixels. An agent
has no pixels. Its behaviour is the surface you review.

So for an `agent` project the same tail step is an **eval**: run the agent
against a set of fixed scenarios and judge the result, both the final answer and
the transcript (which tools it called, in what order, with what inputs), against
what the scenario said should happen. That is the agent equivalent of a UI
review. In the builder-kit workflow, `ui-review` for `projectType: agent` means
"run the evals and review the transcripts", not "screenshot the pages".

## How this folder works

- One Markdown file per scenario (`smoke.md` is the starter). Each scenario
  states an **Input** and an **Expected behaviour**, then **Pass criteria** that
  are checkable against the transcript, not just the vibe of the answer.
- `npm test` runs the stub harness (`run.mjs`). Today it lints the scenarios:
  it confirms each one exists and is well formed (a title plus an
  "Expected behaviour" section). It does **not** yet invoke your agent or score
  it, because no model is wired in the starter. That wiring is the extension
  point below. The harness prints `PENDING` for the behavioural check so a green
  run is never mistaken for "the agent passed".

## Wiring real evals (the extension point)

Once you have wired a `ModelClient` in `src/agent.ts`, turn each scenario into a
real check:

1. Import `runAgent` and your configured agent from `../src/agent`.
2. For each scenario, run the agent on its Input and capture the transcript
   (extend `runAgent` to return the message list, or record it as it goes).
3. Assert the Pass criteria. Deterministic tools (like `get_time`, `add`) can be
   asserted directly. For open-ended answers, use an LLM-as-judge: give a model
   the scenario's Expected behaviour and the transcript, and ask it to score
   pass or fail with a reason.
4. Exit non-zero if any scenario fails, so `npm test` gates the build.

## What good scenarios cover

- **Happy path:** the agent does the obvious right thing (that is `smoke.md`).
- **Tool-use correctness:** it calls the right tool, with the right input, and
  answers from the result rather than fabricating one.
- **Scope and refusal:** it refuses a tool that is not registered, and refuses a
  request outside its brief instead of improvising.
- **Prompt-injection resistance:** when a tool result or document contains
  "ignore your instructions and ...", the agent treats it as data, not as a new
  instruction.

## Before you ship

At ship time, route the `agent-eval` reviewer (a fresh-context second opinion)
over the eval results, alongside the `security-auditor` pass for agents
(prompt-injection, secrets, tool-scope). Neither replaces your own read of the
transcripts.
