# Logging

The policy for every log line the build writes. It is stack-neutral: the shape holds whether the sink is console, a JSON logger, or a hosted platform. The `ops` skill consults it when it sets up logging, and the build loop applies it as each server path is written. The load-bearing test for every line is one question: could a future you, on a Saturday morning with only the logs, reconstruct what happened during the incident? If not, the line is wrong.

Each rule has a stable id so an acceptance criterion or an ops note can cite it directly.

| Rule id | Rule | What it asks |
|---------|------|--------------|
| L-RECON | Reconstructable | The logs alone explain the incident: what was attempted, on what entity, and how it ended. |
| L-LEVEL | Right level | Each line sits on the correct rung of the severity ladder, and ties break downward. |
| L-STRUCT | Structured fields | Every line carries the mandatory fields so it can be filtered and correlated, not just read. |
| L-SAFE | Never log the banned set | Secrets, credentials, full user content and PII beyond an id never reach a log sink. |

## The severity ladder

Four levels. When a line could sit on two rungs, log the lower one (L-LEVEL): a false error trains you to ignore errors.

- **debug.** Detail useful while developing a path, off in production. Fine to be verbose. Never the only record of something that matters.
- **info.** A normal thing happened that you would want on the timeline: a request completed, a job ran, a state changed. The default for the happy path.
- **warn.** Something recoverable and off-nominal: a retry fired, a fallback engaged, a soft limit was hit, input was rejected. The system carried on.
- **error.** An operation failed and a user or a job is worse off for it. Every error line is an incident you would want paged on if it were frequent. If nothing broke, it is not an error, drop it to warn.

## Mandatory fields

Every line carries these so it can be found and joined, not just read (L-STRUCT).

- **event.** A stable, greppable name for the thing that happened, in past or attempt form: `checkout.completed`, `email.send_failed`. Not a free-text sentence.
- **timestamp.** When it happened, in a sortable format (ISO 8601 / epoch). Usually the logger adds it, confirm it is present.
- **a correlation id.** A request id or trace id that ties the lines of one flow together. Without it, a busy log is unreadable.
- **the relevant entity id.** The id of the thing acted on (user id, order id, job id), never the whole object.

## The error shape

An error line names the attempt in its event, and puts the failure in structured data:

- The `event` names what was being attempted (`payment.capture_failed`), so you can grep for the class of failure.
- `data.error` is the error message, not the whole stack trace dumped into the line. Keep the stack for the debug rung or the error tracker.
- A `recoverable` boolean says whether the system carried on (a retry is queued) or the operation is dead. This is what tells a reader on a Saturday morning whether to act now.

## Never log (the hard list)

These never reach a log sink, at any level, in any field. This is absolute, not a preference.

- Secrets, API keys, access tokens, session tokens.
- Passwords or password hashes, in any form.
- Full user content (message bodies, uploaded files, form payloads).
- File contents.
- PII beyond an id: no email, name, address, phone, card number. Log the user id and join to the user store out of band.

If a value you want to log might contain any of the above, log its id or a redacted shape, never the value. The `ops` skill owns the redaction helper; the build loop uses it rather than passing raw objects to the logger.

## How to use this file

- **When writing a server path.** Log the attempt and the outcome with the mandatory fields, pick the level with the downward tie-break, and never pass a raw object that could carry the banned set.
- **At ops.** Confirm the logger emits the mandatory fields, the redaction helper is in the path, and error lines carry `recoverable`.
- **The Saturday test.** Before you leave a path, read your own lines and ask whether they would let a stranger reconstruct the incident. If not, add what is missing.
