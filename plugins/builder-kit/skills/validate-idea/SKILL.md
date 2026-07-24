---
name: validate-idea
description: Use when the user is starting a new build, has a raw idea, or says /validate-idea, before any Idea Pack or PRD work. Runs the Phase-0 six-question idea check, records the answers, and gates the move to idea-pack. Never answers the questions for the user.
allowed-tools: [Read, Write, AskUserQuestion]
---

# Validate Your Idea (Phase 0)

Runs the Phase-0 idea validation: six hard questions that push a raw idea from a general direction to a specific, buildable one-liner. Produces `docs/idea/validation.md`, the honest record the whole build stands on. Half-baked ideas produce half-baked products; Claude Code amplifies that speed in both directions, so this is where you slow down.

## When to use / when not

- Use when someone wants to build something and there is no `docs/idea/validation.md` yet, or when they explicitly ask to validate or re-check an idea.
- Not for: writing the Idea Pack, the PRD, or the architecture. Those are later skills and each needs a passing validation first.
- This is a coaching moment. It stays human. You ask; the user answers in their own words.

## Process

1. **Check for prior work.** Read `docs/idea/validation.md` if it exists. If it is already complete and passes, tell the user and ask whether they want to revise or move on; do not silently redo it.
2. **Explain the rule up front, in one line:** you are the interviewer, not the answerer. You will not fill in an idea they have not formed. A vague answer gets one honest push-back, then it gets recorded as-is.
3. **Ask the six questions** with `AskUserQuestion`, one at a time so each answer can sharpen the next. Do NOT pre-fill answers. Ask in plain words, capture their exact reply:
   - **The exact problem.** Which specific workflow breaks down, at the exact moment it goes wrong? Not a general frustration. One sentence.
   - **Who it affects.** The specific person who hits this every day. "The one who does end-of-day reconciliation" beats "my ops team".
   - **The current workaround.** Spreadsheet, WhatsApp thread, manual process, nothing? This is the bar the build has to clear.
   - **What solved looks like.** What changes day-to-day when it works? If they cannot describe the after, the before is not clear enough.
   - **The scope.** Is this one problem or three wearing a coat? If the idea keeps expanding as they explain it, which single thing ships first?
   - **The one-liner.** Have them fill in: "I am building [X] for [specific person] so that [specific outcome]." If it needs more than one sentence, keep editing with them.
4. **Push back once where an answer is vague, then stop.** If "who" is "everyone" or "solved" is "it just works", reflect that back and ask them to get concrete. You may sharpen wording, never invent substance. One push per question; record whatever they land on.
5. **Write `docs/idea/validation.md`** with all six answers verbatim (see Output), then read the four gate conditions back to them.
6. **Judge readiness and say it plainly.** Score the four gates below. Present the verdict with `AskUserQuestion` and let the user decide whether to proceed; do not auto-advance.
   - **All four met:** confirm, then point them to `/idea-pack`.
   - **Any missing:** say which, say that is their homework now, and refuse to hand off to idea-pack until they are met. Offer the Jiffi call for ideas that need a conversation.
7. **Say the thing this skill cannot do:** it checks that the idea is *defined*, not that it is *good*. A crisp one-liner for a product nobody wants still passes the format and still fails in the market. If the idea itself feels shaky, that is a signal to book the 30-minute Jiffi call before building, not to push on.

## Rules

- Never answer the six questions for the user, and never write substance they did not say. Sharpening their words is allowed; supplying the idea is not.
- Proceeding to `/idea-pack` is a human gate. Do not hand off until all four conditions are met AND the user has explicitly chosen to continue.
- The four gate conditions, all required: a one-liner in the required format; the exact workflow the app replaces or improves; a specific daily user; a clear picture of success.
- `docs/idea/validation.md` is the source of truth, not this chat. It must exist before any later phase skill runs.
- State the limit honestly: this cannot protect the user from a bad idea, only from an undefined one.

## Output

`docs/idea/validation.md`:

```markdown
# Idea Validation (Phase 0)
_Date: <YYYY-MM-DD>_

## The exact problem
<verbatim answer>

## Who it affects
<verbatim answer>

## Current workaround
<verbatim answer>

## What solved looks like
<verbatim answer>

## Scope (the one thing that ships first)
<verbatim answer>

## One-liner
> I am building <X> for <specific person> so that <specific outcome>.

## Gate check
- [ ] One-liner passes the format
- [ ] Exact workflow named
- [ ] Specific daily user named
- [ ] Clear picture of success

Status: PASS | NEEDS WORK — <which conditions are unmet>
```

Reference (full Phase-0 rationale): `docs/strategy/2026-07/guide-audit/corrected/prototype-creation-web/00-phase-0-validate-your-idea.md`.
