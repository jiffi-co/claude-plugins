# Copy voice

The standard for every user-facing string the build ships. It is not marketing copy, it is product copy: the words on buttons, in error banners, in empty states and loading states. The `ui-review` skill greps the built UI against it, `design-system` consults it when it defines text tokens, and the build loop applies it as each screen is written. The bar is one question: would Linear or Stripe ship this string? If no, rewrite.

Each rule has a stable id so an acceptance criterion or a ui-review finding can cite it directly.

| Rule id | Rule | What it asks |
|---------|------|--------------|
| V-SPEC | Be specific | Name the actual thing that happened or the actual field at fault, never a generic gesture at failure. |
| V-CONSEQ | Name the consequence | A message that precedes an action states what the action will do, especially a destructive one. |
| V-VERB | Imperative verbs on buttons | A button is a verb naming its action ("Publish"), never a filler word ("Submit", "OK", "Go"). |
| V-CALM | No exclamation-mark cheer | State the fact. Do not celebrate at the user or apologise theatrically. |
| V-PLAIN | Plain language, not jargon | Words a first-time user knows. No internal nouns, no stack terms, no error codes as the whole message. |
| V-HONEST | Honesty over reassurance | Say what is true, including that something failed, rather than a soothing non-answer. |

## The three templates

Most shipped strings fall into one of three shapes. Fill the shape, do not freestyle.

- **Error.** `<what happened>. <what to do>.` Two sentences. The first names the specific failure, the second gives the user their next move. "We could not save your changes. Check your connection and try again." Not "Oops, something went wrong."
- **Empty state.** `<the state in one line>. <how to populate it>.` "No posts yet. Write your first one to see it here." An empty state that only says "Nothing here" wastes the one moment the user is looking for a way forward.
- **Loading.** Name what is loading. "Loading your posts" or "Publishing" or a labelled skeleton. Never a bare "Loading..." that could mean anything, and never a spinner with no words on a wait longer than a blink.

## Buttons and confirms

- A button label is an imperative verb naming the action it performs. "Publish", "Delete", "Invite", "Save draft". Reserve "Cancel" for dismissing without effect.
- A destructive confirm names the consequence in the question, with the count where there is one. "Delete 3 posts?" with a "Delete" button, not "Are you sure?" with an "OK" button. The user should be able to act on the button alone without re-reading the body.
- The confirming button carries the verb, not a generic yes. Pair "Delete 3 posts?" with "Delete", never with "Yes".

## The mechanical check (for ui-review)

Grep the built UI (the rendered strings, not just source) for the banned patterns below and flag every hit with its file and line. These are near-certain smells, not style opinions.

```
Oops
Something went wrong
Loading...
Are you sure?
```

Each hit is rewritten to the matching template before the string ships. A bare "Loading..." becomes a named loader (V-SPEC). "Oops" / "Something went wrong" becomes a real error (V-SPEC + V-HONEST). "Are you sure?" becomes a consequence-naming confirm (V-CONSEQ). A finding here is a fail, not a note, because the fix is known and cheap.

## How to use this file

- **When writing a screen.** Every string goes through a template. Before you move on, read the button labels back as verbs and the error strings back as `<what happened>. <what to do>.`.
- **At ui-review.** Run the mechanical check, then read the remaining copy against the six rules and cite the id on each finding.
- **At design-system.** When you name a text style or a status token, the sample copy you show follows this file so the pattern is set from the first screen.
