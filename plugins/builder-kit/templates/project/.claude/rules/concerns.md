# Cross-cutting concerns

The six persistent rubrics that ride along with every build. They are not a stage you pass once, they apply across stages and get re-checked as the surface grows. The `verify-acs` skill consults this file for the phase's surface, and the `ship` skill consults it before shipping. A concern that does not apply to your project (say i18n on a single-market internal tool) is dismissed with a reason, not silently ignored.

Each rubric has a stable rule id so an acceptance criterion, an ADR, or a friction-log row can cite it directly.

| Rule id | Rubric | What it asks | Applies at stages |
|---------|--------|--------------|-------------------|
| C-A11Y | Accessibility | Can everyone use it. Keyboard reach, focus order, semantic markup, alt text, WCAG AA colour contrast, screen-reader labels. | design-system, wireframe, brand, page-specs, build, ui-review, verify-acs, ship |
| C-SEC | Security | No secrets in the repo, input validated, auth enforced server-side, no injection or client-trusted data. See `security.md` for the env-file rules. | architect, build, verify-acs, ship, ops |
| C-PERF | Performance | Fast enough for the real user. Payload size, query cost, N+1s, image weight, LCP and CLS budgets, no blocking work on the main path. | architect, design-system, build, ui-review, verify-acs, ship |
| C-SEO | Discoverability | Crawlable pages render server-side, unique titles and meta, structured data, a sitemap, correct noindex on private routes. Skip for apps with no public web surface (say an agent or an internal tool). | prd, architect, page-specs, build, verify-acs, ship |
| C-LEGAL | Legal and privacy | What data is collected, consent and cookie notices, a privacy policy and terms, data retention and deletion, licence compliance for dependencies. | idea-pack, prd, architect, build, ship |
| C-I18N | Internationalisation | Text externalised not hardcoded, locale-aware dates, numbers and currency, right-to-left readiness, no layout that assumes English string lengths. | design-system, wireframe, page-specs, build, verify-acs |

## How to use this file

- **At verify-acs.** For the surface the phase touched, walk the rubrics that apply and confirm the acceptance criteria actually cover them. A phase that ships a public page with no C-A11Y or C-SEO criterion has a gap, not a pass.
- **At ship.** Do a final pass across all six before the PR. Anything unmet is either fixed, or recorded as a known limitation with an owner and a reason. Do not ship a silent failure.
- **Dismissing a rubric.** If a rubric genuinely does not apply, write the reason once (an ADR or a decision note) so a later reviewer sees it was a choice, not an oversight.

## The checks per rubric

- **C-A11Y.** Every interactive element reachable and operable by keyboard, focus visible and in a sensible order, images have alt text, form fields have labels, colour is never the only signal, contrast meets WCAG AA (the design-guide already shows computed ratios).
- **C-SEC.** Secrets via environment only (never committed, see `security.md`), all input validated on the server, authorisation checked on every protected action not just hidden in the UI, no user-supplied data trusted into a query or a shell.
- **C-PERF.** A stated budget (for a web page, LCP under 2.5s and CLS under 0.1 is a reasonable default), no N+1 queries, images sized and compressed, heavy work off the critical path, bundle watched as it grows.
- **C-SEO.** Public pages server-rendered and crawlable, each with a unique title and description, structured data where it fits, an accurate sitemap, and private or auth-only routes marked noindex.
- **C-LEGAL.** A clear answer to what personal data is collected and why, consent captured where required, a privacy policy and terms in place before public launch, a data deletion path, and dependency licences that permit your use.
- **C-I18N.** User-facing strings externalised rather than hardcoded, dates, numbers and currency formatted per locale, layouts that survive longer translated strings, and right-to-left considered if a target locale needs it.
