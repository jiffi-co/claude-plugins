---
name: idea-pack
description: Turn a raw product idea into a structured Idea Pack (problem, users, user stories, scope, risks) before any code. The core ten sections are shared; ios and agent projects add platform-specific sections, chosen by projectType in .claude/builder-kit.json (default web). Use after the validate-idea skill, when the user wants to shape a new idea, or asks for an idea pack / product brief.
allowed-tools: [Read, Write, AskUserQuestion, Skill]
---

# Jiffi Idea Pack

Produce a build-ready Idea Pack that front-loads the thinking. Interview first, then draft; the human approves each section before moving on. Write the result to `docs/idea/idea-pack.md`. The core ten sections are the same for every build; an iOS or agent project adds a short block of platform-specific sections, chosen by `projectType` in `.claude/builder-kit.json` (default `web`).

**Experience level.** Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach). Adapt tone and confirmation frequency to the mode, never fork the content, and never skip a human gate.

**Coaching authoring standard.** Every choice you put to the human, in an `AskUserQuestion` card or laid out in the document, carries three things: a context-first, plain-language headline that says what the choice decides in their own words (not the jargon term), a one-sentence why that names what turns on it, and a reversibility tag (an easy change later, or a one-way door).

## Process

1. **Check the gate.** Read `docs/idea/validation.md`. If it is missing or does not pass, run the validate-idea skill first. The Idea Pack builds on the validated one-liner, it does not replace it.
2. **Read the project type.** Read `.claude/builder-kit.json` and take `projectType` (`web`, `ios`, or `agent`). Default to `web` if the file, the key, or a valid value is absent. Web draws the ten sections only; ios and agent keep all ten and add that type's block from "Additional sections by project type" below.
3. **Interview, then draft (do not one-shot), unless the thinking is already done.** First check whether the answers already exist. If the user supplied a full brief (pasted into the prompt, or pointed to as a document) or `docs/idea/idea-pack.md` is already on disk, skip the interview: draft the sections straight from that source, ask only about what it genuinely leaves blank, and note in the pack that the answers were supplied and from where, so the record stays honest. Otherwise, use `AskUserQuestion` to ask the hard questions BEFORE writing: who exactly is this for, the specific problem, why now, what success looks like, what is explicitly out of scope. Ask in small batches so each answer sharpens the next. Never invent answers; if the user is vague, push once for specifics, then record what they said. For an ios or agent build, also ask that type's hard questions before drafting its block (the type block below lists what it must cover), holding the same rule: an unknown is recorded as an open question, never guessed. Skipping the interview never skips the gate: the draft still goes to the human to approve (step 5).
4. Draft the sections below from their answers (the ten for web; the ten plus your type block for ios or agent). Keep each tight and concrete.
5. Show the user the draft, section by section for a new idea or as a whole for a refinement, and revise on their feedback until they approve.

## The ten sections

1. **One-liner** — the product in a single sentence a stranger understands.
2. **Problem** — the specific pain, who feels it, and how they cope today.
3. **Target users** — the primary user and, if relevant, the buyer. Be narrow.
4. **User stories** — 5 to 12 stories in "As a … I want … so that …" form, ordered by importance.
5. **Scope** — what the first version does, as a short bullet list.
6. **Explicitly out of scope** — what it deliberately does NOT do yet.
7. **Success metrics** — how you will know it worked (measurable).
8. **Risks and unknowns** — the assumptions that would sink it if wrong.
9. **Competitive landscape** — the two or three closest alternatives and why yours differs.
10. **Open questions** — what still needs a decision before the PRD.

## Additional sections by project type

Web uses the ten sections above and stops there. An iOS or agent build keeps all ten and adds the block for its type, drafted from the interview like the rest and held to the same evidence rule. These sections front-load the decisions each platform forces early, so the PRD and architecture are not the first place they surface.

### iOS (`projectType: ios`): sections 11 to 13

11. **Platform fit.** Why this is a native iOS app and not a responsive web page: the specific iOS capabilities it genuinely needs (for example offline use, camera, push notifications, HealthKit, widgets, background refresh), the minimum iOS version, and the device classes it targets (iPhone only, iPad, or both). If nothing here needs native, say so. The honest answer might be that this should be a web app.
12. **Privacy and data.** What personal or sensitive data the app collects, where it lives (on the device, your backend, or a third-party SDK), and which permissions it must prompt for (location, contacts, camera, tracking) with the reason string for each. This is the first draft of the App Store privacy details you will have to declare, so record assumptions rather than leaving it blank.
13. **App Store considerations.** The review-shaping decisions to make now, not at submission: the app category and age rating, whether it needs an account and therefore Sign in with Apple and in-app account deletion, whether it takes payment and so whether Apple's in-app purchase rules apply (digital goods) rather than an external processor (physical goods and services), and any App Review Guideline the idea brushes against. This surfaces the risks; it is not a promise of approval.

### Agent (`projectType: agent`): sections 11 to 14

11. **Task and tool surface.** The specific tasks the agent is responsible for (bounded, not "anything you ask"), and the tools or actions it needs, in plain terms: what it may read, call, or write, and what it must never touch. This is the product-level statement of the tool allowlist the build later enforces in code.
12. **Autonomy boundary.** Where the agent may act on its own and where a human must approve first. Separate the reversible, low-cost actions (safe to automate) from the destructive, costly, or irreversible ones (gated behind a human), and state the default posture when it is unsure.
13. **Failure and escalation.** What the agent does when it cannot finish, hits an error, or is asked something out of scope: retry, ask the user, hand to a human, or refuse. Say how a failure is made visible rather than hidden. An agent that reports success it did not achieve is worse than one that stops and says it is stuck.
14. **Cost shape.** The rough economics of a run: what one run costs in model, token, and tool terms, roughly how often it runs, and what a runaway loop would cost. Name the bound that stops that (a step ceiling, a spend cap, or a rate limit) so cost cannot silently climb. A shape and a guardrail, not a precise figure.

## Rules

- Australian English. Plain, direct language. No filler.
- Every claim about users or the market is a stated assumption unless the user gave you evidence.
- The section set follows `projectType`: web is the ten sections, ios and agent add their block and nothing more. Those extra sections obey the same evidence rule: what the user did not tell you is an open question, not an invented fact. Do not promise platform behaviour the build has not been scoped to deliver, such as an App Store approval or a hard autonomy or cost guarantee.
- For a fresh-context second opinion before approval, run the review-idea-pack agent (via the Task/subagent tool). It is advisory only.
- Do not proceed to the PRD until the user approves the Idea Pack. Approval is a human gate.

## Output

`docs/idea/idea-pack.md` (the ten shared sections, plus the ios or agent block when `projectType` selects it). Record near the top how the answers were gathered: through the interview, or from a supplied brief or an existing pack (name the source). This keeps the provenance honest, the way the validation gate records its answers.

Optionally, once approved, also emit `docs/idea/idea-pack.json` beside the human doc, the user stories as machine-readable objects so the PRD and plan skills can parse them without re-reading the prose. The human markdown stays the source of truth. The file is a JSON array of story objects, ordered highest priority first, each object carrying these fields:

- `id`: stable story id in `US-<nnn>` form (for example `US-001`), carried through to the PRD's user stories.
- `as`: the user role, the "As a …" clause of the story.
- `want`: the capability, the "I want …" clause.
- `soThat`: the outcome, the "so that …" clause.
- `priority`: integer rank by importance, `1` highest, matching the order of the stories in the markdown.

```json
[
  {
    "id": "US-001",
    "as": "end-of-day reconciler",
    "want": "import the day's transactions in one click",
    "soThat": "the books are done before close, not after",
    "priority": 1
  }
]
```
