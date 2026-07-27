---
name: status
description: Answer "where am I" from the artefacts on disk — the stage, the step number, the one command that comes next, and anything blocking it. Runs the shipped scripts/state.mjs, which derives all of it from files, never from chat. Read-only, writes nothing, advances nothing. Fires at the start of a session, after a /clear, when a step finishes and the next one is not obvious, and any time the current phase or the next command is in doubt.
allowed-tools: [Bash, Read]
---

# Status

The kit's answer to "where am I". One command, one block of output: stage, step number, the next `/builder-kit:` command to type, and any blocker standing in front of it.

Everything comes from `scripts/state.mjs`, which reads the artefacts on disk. Not the conversation, not a "Current phase" line somebody forgot to bump, not your memory of what happened before the last `/clear`. If the state block and the chat disagree, the block is right.

## When to use / when not

- **Use** at the start of a session, after a `/clear`, when a step just finished, or when the next command is not obvious.
- **Not** for doing the work. This reports and stops. To act, type the command it prints.
- **Not** an environment check. Whether Node, git and `gh` are installed is `/builder-kit:jiffi-doctor`'s job. This is about the project, not the machine.

## Process

1. **Read the state.** One Bash call, which is the whole probe:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs"
   ```

   Add `--json` when you need to branch on a field rather than print the block. The script never throws: an unreadable directory comes back as `ok: false` with a named error code, not a stack trace.

2. **Print the block verbatim.** Do not summarise it, do not reorder it, do not soften a blocker. The step number and the next command are the two things the reader came for, and paraphrasing them is how a reader ends up at the wrong step.

3. **Make the next command copyable.** It comes out of the script already in `/builder-kit:<name>` form, including the phase number where there is one. Print it on its own line, exactly as given. Do not translate it into prose ("you should now plan your phases"), and do not invent a command the script did not name.

4. **Speak to each blocker.** For every entry in `blockers`, say what it is and read out its `fix` line. A `[block]` entry means the next command will not do anything useful until it is cleared. A `[warn]` entry means proceed, but knowing.

5. **Read out `LAST_BLOCK` if it appears.** It means a hook stopped something and the user may have seen nothing at all: in the Claude Code panel of Claude Desktop a blocked turn renders empty. Open `.claude/builder-kit/last-block.md`, tell them what was blocked and why, then say the file is safe to delete once handled.

6. **Stop.** Do not run the next command. Do not tick an acceptance criterion, close a phase, commit, or edit a document. Reporting and acting are different jobs and this is the reporting one.

## Reading the block

```
BUILDER-KIT STATUS
Project:    /Users/you/my-app
Stage:      build — Build the phases
Step:       8 of 10
Next:       /builder-kit:build --phase 2
Progress:   7 of 10 steps proven · phases 1 of 3 closed
Branch:     feature/phase-2-booking
Type:       web (greenfield door)
Guide:      step 7 of 8 — Run the plan (run-the-plan)
Blockers:   none
Notes:      2 acceptance criteria still unticked
```

- **Stage and step** come from the kit's ten-step spine. The current stage is the first step whose artefact is missing, so "step 8" means steps 1 to 7 have files on disk proving they happened.
- **Progress** counts proven steps, and adds closed phases once there is a plan to count them against.
- **Guide** only appears when `docs/guides/guide-map.json` exists. It is the matching guide page. Its numbering is the guides' own eight-step spine, not the kit's ten, which is why the two sit on separate lines and are never added together.
- **Notes** are observations, not obstacles. Unticked acceptance criteria mid-build are the normal state; the same count becomes a blocker at the ship gate.

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/state.mjs" --explain` to print the ten steps and the artefact that proves each one.

## Rules

- Read-only. Never edit a doc, tick a criterion, close a task, commit, push, or switch branch. If something needs doing, name it and stop.
- The script's answer wins. If it says step 4 and the conversation assumed step 6, report step 4 and say the disk disagrees with the transcript.
- Absence of evidence is not evidence of completion. A missing artefact is reported as missing, never guessed as done. A probe that silently fails looks identical to a real negative, which is why every stage names the file that proves it.
- Do not invent a next command. Print the one the script returned. If the script returns an error, print the error and its code.
- One Bash call. The whole state is one script run; probing the same facts a second time with `ls` and `git` adds permission prompts and can disagree with itself.

## Output

Writes nothing. Prints the state block above, plus a plain-language line for each blocker and the one command to type next.
