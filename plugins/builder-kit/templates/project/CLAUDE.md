# Project: {{PROJECT_NAME}}

## Overview
<!-- One paragraph: what this product is and who it is for. Filled from the Idea Pack. -->

## Tech Stack
<!-- Filled during the architect step, from the accepted ADRs. -->

## Architecture Rules
<!-- The load-bearing rules for this codebase. Keep lean; detail lives in docs/adr/ and .claude/rules/. -->

## Commands
```bash
# dev / build / test — filled once the stack is chosen
```

## Testing
- Run the test suite after every change.

## Rules
- Never commit secrets, API keys, or `.env` files.
- One phase at a time. Never build the whole app in one go.
- Feature branches only. Never commit directly to `main`.
- Everything lives on disk: docs/, ADRs, the acceptance checklist and `docs/tasks/` are the source of truth, not chat.

@AGENTS.md
