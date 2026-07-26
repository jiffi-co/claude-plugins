---
name: prd
description: Turn an approved Idea Pack into a PRD with numbered, testable acceptance criteria, a data model, contracts and a phased delivery plan. Sections adapt to the projectType in .claude/builder-kit.json (web carries SEO and UI/UX, ios adds privacy and data collection plus on-device persistence and accessibility, agent adds a tool allowlist plus eval scenarios and a cost budget). Use after the Idea Pack is approved, or when the user asks for a PRD, spec or acceptance criteria for a build.
allowed-tools: [Read, Write, AskUserQuestion, mcp__context7__resolve-library-id, mcp__context7__query-docs]
---

# Jiffi PRD

Convert `docs/idea/idea-pack.md` into a specification an agent can build against and a test suite can verify. Write the PRD to `docs/prd/prd.md` and the flat acceptance checklist to `docs/prd/acceptance-checklist.md`.

The core of the document is the same for every build: an overview, user stories with numbered acceptance criteria, a data model, contracts, non-functional requirements, and a phased plan. What shifts is the emphasis, and `projectType` sets it. A web PRD carries SEO and UI/UX. An iOS PRD adds privacy and data collection, on-device persistence, and accessibility. An agent PRD adds a tool allowlist, eval scenarios, and a cost budget. Read the type first, write the shared core, then layer on that type's sections from 'By project type'.

**Experience level.** Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach). Adapt tone and confirmation frequency to the mode, never fork the content, and never skip a human gate.

**Coaching authoring standard.** Every choice you put to the human, in an `AskUserQuestion` card or laid out in the document, carries three things: a context-first, plain-language headline that says what the choice decides in their own words (not the jargon term), a one-sentence why that names what turns on it, and a reversibility tag (an easy change later, or a one-way door).

## Process

1. **Read the inputs and the project type.** Read the approved Idea Pack (`docs/idea/idea-pack.md`); if it is missing, run the idea-pack step first. Then read `.claude/builder-kit.json` and take `projectType` (`web`, `ios`, or `agent`), defaulting to `web` if the file, the key, or a valid value is absent. The type decides which sections in 'By project type' you add on top of the shared core.
2. **Clarify before drafting.** Where the Idea Pack leaves a spec ambiguity that changes the acceptance criteria (an edge case, a data rule, a success threshold), ask the user with `AskUserQuestion` rather than guessing. If a prepared brief already carries these answers (supplied in the prompt, or an existing `docs/prd/prd.md` on disk), take them as given and ask only about what is genuinely missing.
3. **Ground the load-bearing versions, do not recall.** Context7's budget is limited (plan on roughly three `resolve-library-id` calls), so spend it where a wrong version is expensive: confirm the load-bearing, security-relevant dependencies first (auth, the data layer, payments) with Context7 (`resolve-library-id`, then `query-docs`), not the frameworks everyone already knows. builder-kit bundles Context7 for exactly this. For the rest, name the dependency and flag its version to confirm at the architecture/ADR step, where `architect` grounds every candidate library against Context7 before the ADRs are accepted. If no stack is chosen yet (the PRD legitimately comes before architecture), do not force a framework or version now: name the load-bearing dependency by its role (the auth provider, the data layer, the payment processor) and defer its version grounding to the architecture step, where `architect` picks the actual library and grounds it. A named role with a deferred version is honest; a guessed framework is not. Do not leave a silent guess. If Context7 is unavailable or cannot confirm something, say so in the PRD rather than guessing a version.
4. **Derive numbered, testable acceptance criteria.** Number them `AC-<US>.<n>` (e.g. AC-001.1). Each is a single statement checkable by a test, a build check, or a request you can make and assert on, not a matter of opinion. Every user story gets at least one happy-path AC and at least one edge-case or error AC. For an agent, at least one of those edge cases is adversarial: a prompt-injection attempt, a tool error, or a request it must refuse.
5. **Propose a phased delivery plan** where Phase 1 is the smallest shippable slice, and note which phases can run in parallel and which must run in order.
6. **Show the user and revise before finalising**, then write the PRD and the paired acceptance checklist.

## Shared sections (every project type)

1. **Overview.** One paragraph, from the Idea Pack one-liner.
2. **User stories.** Carried from the Idea Pack, each given an ID (US-001, and so on).
3. **Acceptance criteria.** Numbered `AC-<US>.<n>`, each a single testable statement, given/when/then where useful. These become the acceptance checklist that `verify-acs` ticks off one by one, with the `ac-verifier` reviewer as a fresh-context second opinion.
4. **Functional requirements.** Grouped by feature area, each tagged with the user stories it satisfies.
5. **Data model.** Entities, key fields, relationships. Enough to design the schema.
6. **Contracts.** The interface the build coordinates through, precise enough that separate teammates build against it without talking. Its exact shape follows the project type (see 'By project type'): a web or iOS API contract, or an agent tool interface.
7. **Non-functional requirements.** Performance and security as the baseline, plus the type-specific bar from 'By project type'. Each written as a checkable statement, not "should be fast".
8. **Out of scope.** Carried from the Idea Pack, expanded where needed.
9. **Dependencies.** External services, libraries and SDKs. Ground the load-bearing versions in Context7 and flag the rest to confirm at the architecture step (Process step 3). Note what breaks if one is unavailable.
10. **Delivery plan.** 3 to 6 phases, each listing the ACs it delivers. Phase 1 is the smallest shippable slice.

## By project type

Add these on top of the shared core for the `projectType` read in step 1. Describe what the product will do; do not claim tooling the plugin does not ship.

### web (default)

- **Contracts are API contracts.** Endpoints, methods, request and response shapes, status codes, a consistent success and error envelope, precise enough that a frontend and a backend teammate build against it without talking to each other.
- **UI/UX requirements.** The key screens and flows, and the primary action on each. This sets up the design-system step.
- **Discovery and SEO,** wherever the product is public-facing: target keywords, what is public versus gated, the technical requirements (SSR, structured data), and the social-sharing experience. Send this section to the `seo-specialist` reviewer for a second opinion. For a purely internal tool with no public surface, note that search does not apply and move on.
- **Non-functional bar.** Performance targets, accessibility, browser support, responsiveness, security.

### ios

- **Contracts are API contracts, or none.** If the app has a backend, use the same API-contract shape as web. If it has none, say so explicitly: all data stored on-device.
- **Persistence in the data model.** For each entity, whether it lives on-device (SwiftData, with the `@Model` shape), remote (the API schema), or both, and whether it syncs across devices via iCloud or CloudKit. These are the app's design choices you record here, not something the scaffold provides.
- **Privacy and data collection.** Per data type: what the app collects, whether it is linked to the user's identity, and whether it is used for tracking. This section is the source of truth the `PrivacyInfo.xcprivacy` manifest and the App Store privacy answers (the nutrition label) must match. The `ios-release-checklist` reviewer checks them against it before an upload, so a gap here becomes a rejection later.
- **Accessibility in the non-functional bar.** VoiceOver labels on every interactive element, Dynamic Type up to the accessibility sizes without truncation, 44x44pt touch targets, WCAG AA contrast. Plus performance (cold-start, transition and scrolling targets), device and offline support, and battery.
- **iOS-specific ACs and UI/UX.** ACs name the exact gesture, permission prompt or system behaviour, and cover empty, loading, error and offline states. UI/UX records the structural calls: tab-bar layout, modal versus push, sheet versus full-screen cover, dark mode, and Liquid Glass (system chrome adopts it under the iOS 26 SDK; list any custom view taking `.glassEffect()` and note availability gating if you deploy below iOS 26).
- **iOS dependencies.** Swift packages (name, SPM URL, free-tier limits), Apple frameworks beyond SwiftUI (HealthKit, MapKit, StoreKit and the like), and entitlements (Push, iCloud, Sign in with Apple).

### agent

- **Contracts are the tool interface (the tool allowlist).** Every tool the agent may call, with its input and output shape and its scope: name what each tool can do and, just as importantly, what it cannot. This is the agent's API contract, and it doubles as the allowlist the `security-auditor` agent pass checks, so keep each tool's scope as narrow as the job allows.
- **Behaviour and data model.** The agent's persona and rules alongside the entities it reads or writes.
- **Eval scenarios.** An agent's acceptance criteria are behavioural and run as evals: a fixed input, an expected behaviour, and pass criteria checkable against the transcript rather than the vibe of the answer. Phase 1 carries a handful; `ui-review` and the `agent-eval` reviewer run them before ship.
- **Prompt-injection stance,** stated in Out of scope and the behaviour rules. Write down what the agent must refuse, and that untrusted content (tool results, fetched documents, user-supplied fields) is treated as data, never as instructions that can rewrite the prompt or widen the allowlist.
- **Cost and step budget in the non-functional bar.** Latency and cost-per-run targets, and a hard cap on tool-call iterations per turn (a max-steps or max-turns ceiling): an uncapped loop is both a runaway-cost and a reliability risk. Plus the model tier each step needs, and the logging and safety posture.
- **Interaction requirements.** The shape of a run (input in, steps, output out) and where a human sits in the loop.

## Rules

- Every acceptance criterion must be **agent-runnable**: a test, a build check, or a request you can make and assert on. For an agent that means a scenario you can run on a fixed input and rule pass or fail. If you cannot see how to test it, rewrite it until you can.
- Pair the human-readable checklist with the numbered ACs so `verify-acs` can tick them off one by one.
- Read `projectType` from `.claude/builder-kit.json` first (default `web`) and write that type's sections. Do not put SEO into an agent PRD, or a tool allowlist into a web one.
- **Claim only what the product will do, and only tooling the plugin ships.** SwiftData, Liquid Glass, iCloud and their kin are the app's design choices you record here, not features the scaffold provides. Do not promise a check or a capability the build does not have.
- Ground the load-bearing library and version facts with Context7 within its budget, flag the rest to confirm at the architecture step, and when a fact cannot be confirmed, say so in the PRD rather than guessing.
- Do not start architecture until the PRD is approved.
