# Smoke: reports the current time using the get_time tool

The starter scenario. It checks the loop end to end: the agent recognises it
needs a tool, calls the right one, and answers from the result instead of making
a time up.

## Input

A single user turn:

> What time is it right now?

## Expected behaviour

- The agent calls the `get_time` tool exactly once.
- It calls no other tool (it does not call `add`, and it does not invent a tool
  that is not registered).
- Its final answer states a time that matches the value `get_time` returned. It
  does not fabricate a time or answer from memory.
- If `get_time` were to error, the agent says it could not read the time rather
  than guessing one.

## Pass criteria

Pass only if all of these hold:

1. The transcript contains one `tool` message for `get_time`.
2. No unregistered tool name appears in the transcript.
3. The final answer contains the time from that `get_time` result.

Fail if the agent answers with a time but never called `get_time` (a fabricated
answer is a fail even when the time looks plausible).

## Notes

Keep the assertion on the transcript, not just the wording of the final answer.
"Did it call the right tool" is the behaviour under test here; the prose around
the time can vary.
