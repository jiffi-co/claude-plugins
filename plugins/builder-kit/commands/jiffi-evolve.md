---
description: The anti-staleness engine. Harvest the friction-log, check every skill is still current (Context7 + Claude release notes + the live tool roster), propose bounded SKILL.md edits, then keep only the ones that survive the held-out gate (scripts/test/run.sh plus a self-check). Records a changelog.
argument-hint: "[--dry-run]"
allowed-tools: Bash(node:*), Read, Edit, WebFetch, Task, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

Run the SkillOpt self-improvement loop over this plugin's skills. The point is to stop the skills going stale: as Claude gains new tools, models, MCP servers and processes, a skill that still tells the builder to do something by hand can quietly become wrong. This command reflects on where the skills actually caused friction, checks each one against what Claude can do TODAY, and proposes tight edits, but it keeps an edit only if a real gate says the plugin still passes.

The deterministic parts (read the log, run the gate, record the changelog) live in the shipped script. You do the reflect and propose. Never skip the script for the parts it owns, and never keep an edit the gate rejected.

## 1. Harvest the friction

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/evolve.mjs" harvest
```

This reads `docs/evolve/friction-log.md` (the `| date | skill | step | what-broke | what-the-user-did |` table that skills append to whenever a gate fails, a marked recommendation is overridden, or a manual workaround was needed) and clusters it by skill and root cause, most recurring first. The clusters are buckets, not conclusions. Read the underlying rows and name the actual root cause per cluster. If the log is empty, there is no friction to act on, but still do the currency check below.

## 2. Currency check (per skill)

For each skill implicated by a cluster, and for any skill that instructs the builder to do a manual step that a tool might now automate, verify against what Claude can do today. Do not answer from memory:

- Read the plugin VERSION (the harvest header prints it) so the changelog is anchored.
- For any library, framework or API a skill names, confirm the current guidance via Context7 (`mcp__context7__resolve-library-id` then `mcp__context7__query-docs`).
- Check Claude release notes with WebFetch for a new tool, model or process that supersedes a manual instruction.
- Scan the live tool roster in this session (including MCP servers) for a capability a skill still tells the builder to do by hand.

Flag every skill that tells the user to do manually something a new Claude tool, model, MCP server or process now automates. That is a currency gap, whether or not it also showed up in the friction-log.

## 3. Propose bounded edits

For each confirmed friction or currency gap, propose the SMALLEST edit to the affected `SKILL.md` that fixes it: an add, a delete, or a replace, each with a one-line rationale tied to its evidence (a friction cluster, a Context7 finding, a release note). Bounded means surgical: touch only the lines the fix needs, never a drive-by rewrite. If a fix would touch a human gate (idea validation, the architecture decision, design-system/brand taste, code review at ship), do not weaken it. Prefer editing a skill over adding one.

If invoked with `--dry-run`, stop here and print the proposed edits without applying any. Otherwise continue.

## 4. Apply and GATE each edit (held-out validation)

Apply ONE proposed edit at a time with the Edit tool, then validate it:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/evolve.mjs" gate
```

The gate runs the full test suite (`scripts/test/run.sh`, the 29 checks that prove the plugin is well-formed and its scripts behave) plus a self-check that every `SKILL.md` still has balanced code fences. It exits zero only when both pass.

- Gate exits zero: keep the edit.

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/evolve.mjs" log --skill <name> --change "<what changed>" --result applied --reason "gate green"
  ```

- Gate exits non-zero: revert the edit (restore the exact prior text), then record the rejection so the loop does not retry it blindly.

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/evolve.mjs" log --skill <name> --change "<what was proposed>" --result rejected --reason "<which check failed>"
  ```

Apply edits one at a time, never as a batch, so a single failure cannot mask a good edit or leave the plugin in a half-edited state. Both applied and rejected outcomes are recorded, that record is the point.

## 5. Changelog and report

Every `log` call appends a dated row to `docs/evolve/CHANGELOG.md` (it creates the file with a header on first use). After the loop, report the changelog: how many edits were proposed, how many survived the gate, how many were rejected and why. If nothing changed, say so plainly, a clean pass is a valid result.

## Nightly SkillOpt-Sleep (optional, off by default)

You can schedule an unattended nightly pass so the skills stay current without being asked. It is OFF by default and should stay off unless the builder asks for it, because it edits the plugin's own skills. To turn it on, use the schedule/cron capability to run `/jiffi-evolve` on a nightly cron; the gate still guards every edit, so a nightly pass can only ever keep edits that pass `scripts/test/run.sh`. To turn it off, delete that schedule.

## Rules

- The script decides what it owns (parse, gate, log). Never hand-simulate the gate, and never keep an edit it rejected.
- Verify current capability, do not recall it. A currency claim without a Context7, release-note or tool-roster citation is a guess, not a finding.
- Bounded edits only: the smallest add/delete/replace that fixes the evidence, one skill at a time.
- Never weaken a human gate or delete a safety rule to make a friction go away. Log it as a rejection instead.
- Record both outcomes. An honest changelog of what was rejected is as valuable as the edits that landed.
