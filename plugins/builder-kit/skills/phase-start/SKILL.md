---
name: phase-start
description: Deprecated alias for the build skill, kept for one release so published `/builder-kit:phase-start` blocks keep resolving. Forwards straight to build, which runs the same phase through an inline parent that owns every human gate and a forked worker that owns the mechanical span. Fires only when something invokes the old name.
allowed-tools: [Read, Skill]
---

# Phase Start (deprecated, use `build`)

**This skill has moved. Invoke the `build` skill (`/builder-kit:build`) instead.**

## What to do

Invoke `build` now, passing along whatever arguments came in (a phase number, `--mode step|auto`, `--spike`). Then say one line, once: *"`/builder-kit:phase-start` is now `/builder-kit:build`. Same phase, same gates."* Do not repeat the notice on later turns, and do not do any of the work here.

## Why it changed

`phase-start` did two jobs that cannot live in one place. Four of its steps ask a human something (execution mode, brief approval, the spike promote-or-discard gate, and the go-ahead before code), and the rest is a long mechanical span that wants its own clean context window.

A forked subagent gets that clean context, but it cannot ask: AskUserQuestion is stripped from every subagent in code, with no frontmatter escape. So a gate inside a fork does not pause, it disappears without a trace. The split is the answer:

| Skill | Runs | Owns |
|---|---|---|
| `build` | inline | every question: mode, brief, spike, the circuit breaker, and every hard stop |
| `build-phase` | `context: fork`, `background: false` | the mechanical span of one phase, escalating on one greppable line |

The directory name is a published contract (see `PRINCIPLES.md`), so this file stays for at least one release rather than breaking every guide page, screenshot and habit that prints the old name. It will be removed once the guide set has caught up.

## Rules

- Forward. Do not re-implement any of the loop here; two copies of the build discipline is how they drift.
- Do not start a phase from this file, even if the arguments look unambiguous.

## Output

Nothing of its own. `build` writes everything.
