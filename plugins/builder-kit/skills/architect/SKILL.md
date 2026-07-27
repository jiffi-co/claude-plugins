---
name: architect
description: Turn an approved PRD into architecture decisions by sizing the product against the house stack first (is this more than it needs, and can it run without signing up for anything), then presenting real stack and structural options with trade-offs, asking the six decisions a first build skips, letting the human choose, and handing the choices to create-adr. Recommendations branch on projectType in .claude/builder-kit.json and come from the house stack, so an iOS project is never offered a web framework. Fires when docs/prd/prd.md exists and is approved and docs/adr/ does not yet record the stack decisions, before any implementation plan or code.
allowed-tools: [Read, Write, Edit, Glob, AskUserQuestion, Skill, mcp__context7__resolve-library-id, mcp__context7__query-docs]
---

# Architect

Turn the approved PRD into recorded technical decisions: present real options with trade-offs, let the human choose, then hand ADR writing to the `create-adr` skill. The output is a set of accepted ADRs the build phase can trust, not a decision Claude made on its own.

**Experience level.** Read `experienceLevel` and `assistanceMode` from `.claude/builder-kit.json` (default beginner/coach). Adapt tone and confirmation frequency to the mode, never fork the content, and never skip a human gate.

**Coaching authoring standard.** Every choice you put to the human, in an `AskUserQuestion` card or laid out in the document, carries three things: a context-first, plain-language headline that says what the choice decides in their own words (not the jargon term), a one-sentence why that names what turns on it, and a reversibility tag (an easy change later, or a one-way door).

## When to use / when not

- **Use** once `docs/prd/prd.md` is approved and before any code or implementation plan exists.
- **Not** for writing the ADR files themselves (that is the `create-adr` skill), the implementation plan (`plan`), or the design system (`design-system`). This skill stops at the decision.

## The project type and the house stack

**Read `projectType` from `.claude/builder-kit.json` before you propose anything** (`web`, `ios` or `agent`, defaulting to `web` when the file, the key or the value is missing or invalid). Every recommendation below branches on it. Getting this wrong is the specific failure this section exists to stop: proposing a web framework to someone building an iOS app.

The house stack is checked-in data rather than a recollection. Read it when it is on disk (`src/lib/guides/stack.json` in the jiffi-ai-hub repo, or a `stack.json` shipped beside this plugin's scripts) and prefer what that file says. The table below is the same list written down so this skill still works in a project that has neither copy.

| Layer | House choice | Applies to |
|---|---|---|
| App framework | Next.js | web, agent |
| Content-website framework | Astro, reached through palate | website |
| Hosting | Vercel | web, agent, website |
| Database, storage, row-level security | Supabase | web, agent |
| Auth | Clerk | web, agent, ios |
| Transactional email | Resend | web, agent |
| Background jobs, queues, scheduled work | Inngest | web, agent |
| Unit and integration tests | Vitest | web, agent |
| End-to-end tests | Playwright | web, agent, website |

**`web`, an application.** The rows above, whole. The connection shape follows the hosting answer rather than being picked separately (see decision 2 in Process step 7).

**`web`, a content website.** A marketing site, a documentation set or a publication is not an application, and it does not get the application stack. It goes through palate, which builds with Astro and deploys to Vercel, with Playwright for end-to-end checks. No database, auth or job runner unless the site genuinely needs one, and a website proposal that names Next.js is the same defect as an application proposal that names Astro: two framework families in one product. Decide which of the two you are looking at from the PRD (does it hold user accounts and user data, or does it publish content?) and say which you concluded, because the rest of the stack follows from it.

**`ios`.** Swift and SwiftUI with Xcode's own build and test tooling, distributed through TestFlight and the App Store, with data on-device (SwiftData) unless the PRD says otherwise. **Never propose a web framework, a web host, Vitest or Playwright as the iOS client's stack.** If the app needs a backend, that backend is a web surface and takes the web rows above (Supabase for data, Clerk for auth); say plainly that you are deciding two things, the client and the service behind it. Note the $99 per year Apple Developer account, which is a real prerequisite for distribution rather than a detail to discover later.

**`agent`.** The web rows as the host and data layer, plus the evaluation harness the PRD's eval scenarios need, and the tool allowlist as a first-class interface decision.

**The house stack is a default, not a mandate.** PRINCIPLES.md says recommend a default and never mandate, and that holds here: when the human picks something else, that is the decision, and it goes into the ADR with their reason. What is not allowed is silent drift, proposing an alternative because it came to mind rather than because the human chose it. A tool the PRD names is an input like any other and gets re-screened at step 4.

## Process

1. **Check the gate.** Read `docs/prd/prd.md`. If it is missing or not yet approved, stop and point the user at the `prd` step. Read `.claude/builder-kit.json` for `projectType` and read the house stack (the section above) before you form any opinion about tooling. Also read `AGENTS.md` (the placeholder coordination template) and `docs/idea/idea-pack.md` for product context. Read these from disk every time. The SessionStart re-ground that normally loads your PRD, idea pack and ADRs back into context only fires in an interactive session, so in a batch or subagent run nothing is preloaded and you must read `docs/prd/` and `docs/idea/` yourself before proposing anything.
2. **Read the ground, if any.** Greenfield (no `/src`): skip. Brownfield: `Glob` and read the existing `/src` layout before proposing a project structure, so the recommendation fits what is already there.
3. **Verify, do not recall.** For every candidate library or framework, confirm it exists and check its current API with Context7 (`resolve-library-id` then `query-docs`). If Context7 cannot confirm something, say so explicitly rather than guessing.
4. **Screen the PRD's proposed tools.** The PRD is an input, not the last word on tooling. Re-verify every tool it names against the retired-tools list (NextAuth v5, Tailwind v3 config files, Vercel Postgres, styled-components, and a Next.js per-route `runtime = 'edge'` on a Node-API route; note that this last item is the anti-pattern, not deploying to an edge host such as Cloudflare Workers or Deno Deploy, which stays a legitimate first-class choice) and against Context7. If the PRD proposes a retired tool (for example NextAuth v5, which never shipped stable), do not carry it through: override it with the current equivalent, tell the user you overrode it, and record the override and its reason in an ADR so the choice is traceable rather than silent.
5. **Size the product BEFORE you propose the stack. Two cards, asked first.** The house stack is sized for a product with accounts, a database and paying users. Plenty of first builds are four routes and one table, and nothing in this flow used to ask. That is the invisible failure: no gate fails, nothing goes wrong, the builder just quietly ends up with a build step, a bundler, a few hundred megabytes of dependencies and a hosted database account for something that would have run as one file. Count the routes/screens and the entities in the PRD, say both numbers out loud, then ask these two with `AskUserQuestion` before you present any options.

   1. **Is the house stack more than this needs?** (`header: Proportionality`) — "This product is <N> screens and <M> kinds of data. The house stack gives you <the rows>. Do you want all of it?"
      - `The house stack` — "The full set. More to learn, but everything is there when the product grows." (flag this as the recommendation only when the count genuinely warrants it)
      - `Trim it` — "Drop the layers this product does not use yet. Fewer moving parts, less to go wrong." Name exactly which rows you would drop and what is lost.
      - `The smallest thing that works` — "A runtime and a file. Add a layer when something actually needs it." Only offer this when the counts support it.
      PRINCIPLES.md and `create-adr` both already say to prefer the simplest option that meets the PRD and not to default to the most powerful. Nothing asked it. This card is what asks it.

   2. **Can this run without you signing up for anything?** (`header: Accounts`) — "Free" and "free but you have to create an account, agree to terms and put a card on file" are different answers, and only one of them can be done tonight without leaving the terminal.
      - `No new accounts` — "Everything runs locally or on what you already have. Hosted services come later, as their own step." (recommended when the ceiling is free-tier only)
      - `Free tiers are fine` — "Signing up is fine as long as nothing charges." Name every account the recommendation would require, and say that each is an H-PROVISION stop that will pause and ask.
      - `Whatever it takes` — "Provision what the product needs."

   Both answers constrain everything below. Record them, and record them as decisions with reasons, not as preferences you inferred.

6. **Present options per decision area.** For each area the PRD actually needs, give 2 to 3 real options with honest pros and cons, then a recommendation. Cover the core stack: frontend framework, backend framework, database, ORM/data access, hosting/deployment, testing, styling, state management, authentication, API style, and project structure. Skip core areas the product does not need; do not invent decisions. **Every recommendation must survive step 5's two answers**: a proposal that names a hosted database after "no new accounts", or the full house stack after "the smallest thing that works", is a defect and not a preference.
   - **Recommend from the house stack for this `projectType`** (the section above), one recommendation per area with its reason, and offer the alternatives as real options rather than straw men. On the current app stack that means Next.js on Node 22+ with Tailwind v4 (CSS-first `@theme`), Clerk, Supabase, Vitest and Playwright, on Vercel; a content website means palate and Astro instead; an iOS client means Swift and SwiftUI and none of the web rows. Any framework the human picks is a worked alternative and becomes the decision the moment they pick it. Do not offer retired tools (NextAuth v5, Tailwind v3 config files, Vercel Postgres, styled-components, or a Next.js per-route `runtime = 'edge'` on a Node-API route, which is the anti-pattern rather than a bar on edge hosts).
   - For **project structure**, map directories to teammate roles (API, DB, frontend, shared), isolate shared code in one owned directory, and route integration through explicit interfaces so no two teammates routinely edit the same file.
   - **The six decisions a first build skips.** A PRD written by a non-developer will not list these, and any product that ships needs all six, so the kit asks them rather than leaving the builder to know they exist. Each is asked as its own question in step 7, in the builder's words, carrying a default they can accept, and each is recorded as its own ADR (or grouped sensibly). The plain-language framing on the left is what the human is asked; the substance on the right is what you present as the options.
     1. **Who can see whose data, and where that is checked**, which is security and authorisation.
     2. **Where it runs, and where its data lives**, which is hosting and the data layer, asked once (this is the same decision as the hosting and database areas above, not a second pass at them).
     3. **Separate places for the version you are testing and the version people use**, which is environment separation.
     4. **How you find out it broke**, which is observability and error tracking.
     5. **The spend ceiling**, which is cost and abuse control. Read it back rather than asking again, and confirm rather than re-open. It is recorded in three places, in this order of authority: `costCeiling` in `.claude/builder-kit.json` (written by `/builder-kit:start` when the builder answered the question at the front door), then the PRD's non-functional bar, then `docs/idea/idea-pack.md` section 10. If none of the three carries it, say so plainly and ask it here as a fresh question rather than assuming a number — but say that it should have been captured earlier, because a ceiling nobody wrote down is the reason a stack gets chosen against an imaginary budget.
     6. **How the data shape changes later without losing anything**, which is migrations, backup and rollback.

     Two more follow from those answers rather than being asked separately: **connection pooling** falls out of decision 2 (the runtime shape decides it), and the **accessibility target** takes the house default of WCAG AA unless the human says otherwise. Record both; do not spend a question on either.

     The substance behind each:
     - **Security and authorisation (the trust boundary).** The authorisation model (who may read or change whose data, enforced on the server on every request, never "the button is hidden"), where secrets live (server environment only, never in the client bundle, and never behind a build-time public-env prefix, which ships the value to the client by design: whatever prefix your framework exposes, for example Next's `NEXT_PUBLIC_`, Nuxt's `NUXT_PUBLIC_` (or `runtimeConfig.public`), SvelteKit's `PUBLIC_`, Vite's `VITE_`), that every external input is validated before it reaches a query or a path, and the abuse posture. This is the ADR the `security-auditor` reviewer (run via the Agent tool) holds the built code against.
     - **Where it runs, and where its data lives.** The host, the data layer, and how the two reach each other, decided together because the second follows the first. On the house stack that is Vercel and Supabase for an application, Vercel alone for a content website, and for an iOS client, the App Store plus whatever service (if any) sits behind it. Name the region the data sits in when the product touches personal data, because it is a compliance answer as much as a latency one, and name what the free tier's ceiling is so nobody discovers it on launch day.
     - **Environment separation.** Dev, staging and production as separate environments with separate databases and separate secrets. Never let one default connection string (a bare `DATABASE_URL`) serve every environment; select the environment with an explicit variable (an `APP_ENV`, say) and record where each connection string lives. (Relying on `NODE_ENV=production` is one such trap: on a serverless setup it can silently point a local build at the live database, so this is not optional.)
     - **Observability and error tracking.** Error and crash tracking (a Sentry-class service) plus structured logging, decided now so they are wired at first ship rather than discovered after the first silent 500.
     - **Cost and abuse control.** A spend alert on the hosting and database accounts, and rate limiting on any write or expensive endpoint, enforced at the framework or app layer or at a reverse proxy or host firewall (a platform WAF such as Vercel's or Cloudflare's is one option). A public endpoint is a public bill.
     - **Data migration, backup and rollback.** A migration tool with reviewed, reversible migrations (schema-first tools like Drizzle or Prisma generate them and you diff to prove the schema is current; hand-authored tools like Kysely or Knex have you write the migration in their API and that is correct, not a smell; the only fail is ad-hoc DDL run outside the migration system), no destructive change without a backup first, and point-in-time recovery confirmed on (know your retention window).
     - **Database connection pooling (derived, not asked).** This follows how the runtime reaches the database, not which SQL engine was picked, so it falls out of decision 2 rather than costing a question. On the house stack: serverless invocations reach Supabase over its HTTP client, and a long-lived server uses its pooled connection string. The general rule, for a host the human chose instead: a long-lived process wants a bounded pool fronted by a pooler, while serverless or edge invocations each open their own connection and exhaust the limit under load, so they need an HTTP or serverless driver. One caveat worth recording either way: an HTTP driver cannot hold an interactive row-lock transaction, so a workload that needs one wants the pooled-server shape. Record the conclusion in the database or hosting ADR.
     - **An accessibility target (derived, not asked).** WCAG AA is the house default and it stands unless the human names a different level. This flows straight into the design system and is a real compliance exposure if skipped, so record it rather than leaving it implied.
7. **STOP. The human decides.** This is a judgement call, not Claude's. Use `AskUserQuestion`, one question per decision area, with the presented options as the choices and your recommendation flagged. Never auto-answer. Record exactly what they pick.
   - **The six are asked, always, one card each.** Take the plain-language headline from step 6's list, give two or three real options with the recommended default flagged, one sentence on what turns on it, and a reversibility tag. This is the kit doing the asking: a builder who has never shipped anything does not know these decisions exist, so they are never left as something to remember. Do not fold the six into one card, and do not skip one because the answer looks obvious to you. Decision 5 is a confirmation of the ceiling the builder already named, not a fresh question, so show the number back and ask whether it still holds.
   - **Running non-interactively:** `AskUserQuestion` needs an interactive session. In a batch or subagent run there is no one to answer it, so take the decisions from the input you were given and never invent a choice to get unblocked. If a decision area has no answer in that input, present the options and stop rather than picking the stack yourself.
8. **Hand off to ADRs.** Invoke the `create-adr` skill (the create-adr step) with the confirmed decisions. It writes `docs/adr/ADR-<n>-<slug>.md` per decision (status Accepted, alternatives, consequences, the PRD requirement each serves), a dedicated project-structure ADR documenting the `/src` layout and team file ownership, and `docs/adr/README.md`. Do not write ADR files yourself.
9. **Log and propagate.** Append the confirmed choices to `docs/decisions.md` (date, decision, why, supersedes), then update the coordination files so downstream steps read accurate context:
   - `CLAUDE.md`: fill the Tech Stack section with chosen tools and versions; set current phase to "Planning — implementation plan next".
   - `AGENTS.md`: fill Architecture Rules and Code Standards from the decisions; make the File Ownership table match the project-structure ADR.
10. **Hold the line.** Do not start the `plan` or `design-system` step until the ADRs are accepted.

## Rules

- **Gate:** `docs/prd/prd.md` must exist and be approved before this skill runs.
- **Read `projectType` before proposing anything, and stay inside that type's stack family.** Proposing a web framework for an iOS client, or the application stack for a content website, is a defect rather than a preference.
- **Recommend from the house stack, defer to the human.** The stack file on disk beats the table in this skill, and the human's choice beats both. What is never acceptable is drifting to an alternative nobody chose.
- **Proportionality is asked, not assumed** (Process step 5). Count the screens and the entities, put both cards, and let the answers constrain every recommendation below. A stack heavier than the product is the failure nothing else in this flow catches: no gate fails and nothing goes wrong, so it is only ever caught by asking.
- **The six get asked as six questions, each with a default.** Never leave them for the builder to discover, and never answer one on their behalf to keep things moving.
- **The decision is the human's.** Present options and a recommendation, then `AskUserQuestion`. Never pick the stack for them.
- **Verify current APIs with Context7;** state plainly when a fact cannot be confirmed. Never reintroduce a retired tool.
- **Only decisions the PRD needs,** plus the two proportionality cards from Process step 5 and the six from Process step 6 that any shipping product requires, plus the two derived records (connection pooling, accessibility target). No speculative architecture beyond those.
- **A project-structure ADR is mandatory:** it is the boundary contract teammates reference.
- ADR files are written by `create-adr`, not here. Do not proceed to planning until they are Accepted.

## Output

- `docs/adr/ADR-<n>-<slug>.md` and `docs/adr/README.md` — written by the delegated `create-adr` skill.
- `docs/decisions.md` — appended with each confirmed decision.
- `CLAUDE.md` and `AGENTS.md` — Tech Stack, Architecture Rules, Code Standards, and File Ownership updated to match the accepted decisions.
