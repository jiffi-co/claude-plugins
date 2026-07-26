# Judging discipline

The rule every evaluative skill and agent imports before it renders a verdict. When Claude judges anything it did not compute deterministically, a screenshot, a rendered artifact, a diff, a test result read by eye, it is acting as a fallible judge that hallucinates in both directions: it passes broken things and it fails correct ones. `verify-acs`, `ui-review`, `ac-verifier`, the `review-*` agents, `security-auditor` and `agent-eval` all consult this file so a subjective call is made the same disciplined way each time. The one line that holds it together: fail loudly, never silently. A mute pass is a worse smell than a noisy fail.

Each rule has a stable id so a finding or a gate can cite it.

| Rule id | Rule | What it asks |
|---------|------|--------------|
| J-NEG | Negative question first | Ask what is broken before asking whether it looks right. |
| J-FLOOR | Confidence floor | A pass requires real confidence; unsure is not a pass. |
| J-SECOND | Second pass on high stakes | Re-judge a high-stakes gate a different way; disagreement means uncertain. |
| J-ABSTAIN | Abstain over guess | If you cannot actually see or verify a criterion, abstain, do not guess. |
| J-LOUD | Fail loudly | Surface every doubt; never resolve uncertainty into a silent pass. |

## The discipline, in order

- **Ask the negative question first (J-NEG).** Before "does this look right?", ask "are there visible errors, empty or broken states, missing elements, overlaps, unreadable text?". The affirmative question invites confirmation; the negative question hunts for the failure you would otherwise wave through. Answer the negative one on the record before you form an overall verdict.
- **Gate the pass behind a confidence floor (J-FLOOR).** A pass is a positive claim that you checked and it held. If you are not confident, the verdict is not "pass", it is "cannot verify" or "pass with notes". Low confidence never rounds up.
- **Second, differently-phrased pass on high stakes (J-SECOND).** On a gate that blocks a ship or a merge, judge it twice: once directly, once framed differently (a different question, a different order, a fresh look). If the two passes disagree, the result is uncertain, never a silent pass to the more convenient answer. Treat disagreement as a signal to slow down.
- **Abstain on what you cannot see (J-ABSTAIN).** If a criterion depends on something not actually in front of you, a state you did not reach, a viewport you did not capture, a value you did not read this turn, abstain on that criterion and say so. A guessed pass on an unseen criterion is the exact failure this rule exists to stop. Maps to the house rule: verify the check ran.
- **Fail loudly, not silently (J-LOUD).** Every doubt goes in the output with its evidence. A noisy fail costs a re-check; a mute pass ships the bug. When in doubt, make noise.

## The verdict vocabulary

Judges here speak four verdicts, never a bare pass/fail:

- **pass.** Checked, confident, holds.
- **pass with notes.** Holds, with named minor issues recorded.
- **fail.** A specific defect, named with evidence.
- **cannot verify.** Could not actually see or reach the thing to judge it (J-ABSTAIN). This is not a pass and not a fail; it blocks a high-stakes gate until resolved.

Findings demand specificity: "cta-secondary is about 3.2:1, below the 4.5:1 floor", not "contrast looks low". A vague finding cannot be actioned or re-checked.

## How to use this file

- **Any evaluative skill or agent.** State up front that it applies these rules, then answer the negative question, apply the floor, and use the four-verdict vocabulary in its output.
- **On a ship or merge gate.** Run the second differently-phrased pass and honour disagreement as uncertainty. The `/checkpoint` gate treats a `cannot verify` as unresolved, not as a pass.
