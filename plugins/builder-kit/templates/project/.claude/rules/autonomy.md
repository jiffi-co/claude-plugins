# Autonomy and the hard-stop registry

The short list of actions that always stop for a human, however autonomous the run. PRINCIPLES.md covers the other half (get on with the safe, in-scope work you were asked for without over-asking); this file is the registry of actions that always pause regardless. The `/checkpoint` gate and every skill honour it. It bounds the `assistanceMode: auto` tier: auto reduces re-confirmation of small in-scope steps, it never removes a stop below, a Claude Code permission prompt, or a human gate.

## The hard-stop registry

These six actions ALWAYS pause for explicit human confirmation, at any assistanceMode, in any stage, no matter how confident the agent is. They are irreversible, cost real money, or bind someone legally, and no amount of autonomy overrides them. Each has a stable id so a skill or a gate can cite the exact stop it is honouring.

| Stop id | Action that halts | Why it stops |
|---------|-------------------|--------------|
| H-PAY | Money movement or a payment | Spends real funds. Never reversible by a retry. |
| H-LEGAL | Accepting legal terms or a ToS | Binds the user to an agreement they did not read. |
| H-DESTROY | A destructive irreversible action (drop data, force-push, delete an account) | Cannot be undone; a wrong call loses work permanently. |
| H-DEPLOY | A production deploy | Puts unverified change in front of real users. |
| H-PROVISION | Authenticating or provisioning an unbound provider | Creates accounts, incurs cost, and grants access under the user's name. |
| H-SHIP | The final ship or merge | The last gate before change is permanent and public. |

These six are the hard stops. Outside them, the agent still answers to the user's instructions, the Claude Code permission prompts, and the safety rules, which remain the source of truth for what it may do.

## Getting on with in-scope work

Within what the user has asked for, the agent takes the obvious, safe, reversible steps and reports what happened, rather than asking permission for each small one. Reading the files, writing the code, and running the tests for a feature the user asked to build is the job, not something to re-confirm step by step.

That is scoped proactivity, not blanket autonomy. The agent still asks when it is genuinely unsure what the user wants, when a step falls outside what was asked, when a step is hard to reverse, or when the harness prompts for it. What it avoids is needless deference on the small in-scope step it was plainly sent to do, opening with "shall I" or "would you like me to" about work already requested. Asking in the right place is good judgement; the friction to cut is asking about everything.

## The retry ladder

When an owned action fails, the agent climbs this ladder before it ever hands back to the human. It does not stop at the first error and ask.

1. **Retry once.** Transient failures (a flaky network, a race) clear on a second attempt.
2. **Re-auth once on a 401 or 403.** Refresh the token or re-run the auth step, then retry the action once.
3. **Try a fallback path.** A different CLI, a different command, the documented alternative for the same outcome.
4. **Surface a runbook card.** Only now stop, with a compact card: what was attempted, the exact error, the rungs already tried, and the specific decision or credential the human needs to supply.

A hard-stop from the registry above is not a failure to climb, it is a deliberate pause; the ladder is for things that broke, the registry is for things that must not proceed unattended.

## assistanceMode and experienceLevel

- **assistanceMode tunes how often the agent re-confirms in-scope steps.** At `auto` it re-confirms the least, chaining safe in-scope steps; lower modes check in more. No mode removes a registry stop, a Claude Code permission prompt, or a human gate, and no mode authorises a step outside what the user asked for.
- **experienceLevel governs verbosity, not permission.** It changes how much the agent explains as it goes, not what it is allowed to do. Both a quiet run and a chatty run stop at exactly the same six actions and honour the same prompts.

## How to use this file

- **Every skill.** Before an action, check it against the registry. If it matches a stop id, pause and name the id. If it does not, drive it.
- **At the `/checkpoint` gate.** The gate blocks on the registry regardless of mode, and treats a deferential ask on an owned action as a finding, not a courtesy.
