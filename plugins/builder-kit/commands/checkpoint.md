---
description: Verify a build phase is genuinely done — artifacts on disk, tests passing, acceptance criteria ticked — using a deterministic, shipped gate. Not a judgement call.
argument-hint: "[phase number]"
allowed-tools: Bash(node:*), Read
---

Run the deterministic checkpoint gate for phase **$1** and report its result verbatim.

Invoke the shipped script — it, not you, decides pass/fail:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/checkpoint.mjs" $1
```

The script resolves the checks manifest in this order: `docs/checkpoints/phase-$1.json`, then `docs/checkpoints/checkpoint.json`, then the plugin's shipped default. Each check is labelled **mechanical** (an exit code, a file on disk, a regex count — deterministic) or **semantic** (advisory, a human/agent judgement). Mechanical failures set a non-zero exit and are not negotiable.

After running it:

- If it exits non-zero, the phase is **not** done. Report the failing mechanical check and its evidence exactly as printed, fix that first, and re-run. Do not describe the phase as complete, and do not tick its acceptance criteria.
- If it exits zero, report that the mechanical checks passed, then walk the **semantic** (advisory) items yourself — those are real work the script cannot judge (was the phase committed and pushed? if UI changed, was it reviewed against the design system?). A green mechanical gate is necessary, not sufficient.

Never soften or reinterpret a mechanical failure. If the manifest is missing, the script says so and that is **not** a pass — scaffold `docs/checkpoints/checkpoint.json` (or run `/jiffi-init`) first.
