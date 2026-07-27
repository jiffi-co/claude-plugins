#!/usr/bin/env bash
# scripts/state.mjs, against fixture repos built here and torn down at the end.
#
# The fixtures ARE the specification. state.mjs is the one thing every hook and
# skill asks "where am I", so a wrong answer is worse than no answer: it marches
# a builder past a gate. These three repos (empty, mid-plan, complete) plus the
# unreadable case pin the shape and the stage machine so a later wave cannot
# quietly change what "step 8" means.
#
# Plain bash, no framework, same conventions as run.sh. Run:
#   bash scripts/test/state.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/scripts/state.mjs"

pass=0
fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }

# eq <desc> <expected> <actual>
eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$2', got '$3')"; fi
}
# matches <desc> <ere> <actual>
matches() {
  if printf '%s' "$3" | grep -Eq "$2"; then ok "$1"; else bad "$1 (want /$2/, got '$3')"; fi
}

# field <root> <dotted.path> -> the value, or the literal string "undefined"
field() {
  node "$STATE" "$1" --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
      let v;try{v=JSON.parse(s)}catch{process.stdout.write("PARSE-ERROR");return}
      for(const k of process.argv[1].split(".")) v = (v==null?undefined:v[k])
      process.stdout.write(v===undefined?"undefined":typeof v==="object"?JSON.stringify(v):String(v))
    })' "$2"
}

# Fixtures live under /private/tmp, per the wave's acceptance, falling back to the
# platform temp dir anywhere that path does not exist.
FIXBASE=/private/tmp
[ -d "$FIXBASE" ] || FIXBASE="${TMPDIR:-/tmp}"
FIX="$(mktemp -d "$FIXBASE/builder-kit-state.XXXXXX")" || { echo "cannot create fixture root"; exit 1; }
cleanup() { chmod -R u+rwX "$FIX" 2>/dev/null; rm -rf "$FIX"; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Fixture 1: empty. A bare directory, no builder-kit anything.
# ---------------------------------------------------------------------------
EMPTY="$FIX/empty"
mkdir -p "$EMPTY"

# ---------------------------------------------------------------------------
# Fixture 2: mid-plan. Scaffolded, planned, phase 1 verified, phases 2 and 3 open.
# ---------------------------------------------------------------------------
MID="$FIX/mid-plan"
mkdir -p "$MID/.claude" "$MID/docs/idea" "$MID/docs/prd" "$MID/docs/adr" "$MID/docs/design-system" "$MID/docs/checkpoints" "$MID/.git"
cat > "$MID/.claude/builder-kit.json" <<'JSON'
{ "projectType": "web", "entryPoint": "an idea", "testCommand": "npm test", "stopTestGate": false }
JSON
echo "# Validation — passed" > "$MID/docs/idea/validation.md"
echo "# Idea Pack" > "$MID/docs/idea/idea-pack.md"
echo "# PRD" > "$MID/docs/prd/prd.md"
printf -- "- [x] AC-001 signup works\n- [ ] AC-002 booking works\n- [ ] AC-003 email sends\n" > "$MID/docs/prd/acceptance-checklist.md"
echo "# ADR-0001 Tech stack" > "$MID/docs/adr/ADR-0001-tech-stack.md"
echo "# ADR index" > "$MID/docs/adr/README.md"
echo "# Design system MASTER" > "$MID/docs/design-system/MASTER.md"
cat > "$MID/docs/implementation-plan.md" <<'MD'
# Implementation plan

### Phase 1: Signup
Branch: feature/phase-1-signup
Prerequisites: none

### Phase 2: Booking
Branch: feature/phase-2-booking
Prerequisites: Phase 1

### Phase 3: Email
Branch: feature/phase-3-email
Prerequisites: Phase 2
MD
echo "# Phase 1 AC evidence" > "$MID/docs/checkpoints/phase-1-acs.md"
# A planning-time manifest for phase 2. This must NOT read as "phase 2 is done".
echo '{"checks":[]}' > "$MID/docs/checkpoints/phase-2.json"
echo "ref: refs/heads/feature/phase-2-booking" > "$MID/.git/HEAD"
printf '# Project\n\n- **Current phase:** 2 — Booking\n' > "$MID/CLAUDE.md"

# ---------------------------------------------------------------------------
# Fixture 3: complete. Every phase closed, shipped, every AC ticked.
# ---------------------------------------------------------------------------
DONE="$FIX/complete"
cp -R "$MID" "$DONE"
printf -- "- [x] AC-001 signup works\n- [x] AC-002 booking works\n- [x] AC-003 email sends\n" > "$DONE/docs/prd/acceptance-checklist.md"
for n in 1 2 3; do echo "{\"phase\":$n,\"closed\":true}" > "$DONE/docs/checkpoints/phase-$n-close.json"; done
echo "# Deployment" > "$DONE/docs/deployment.md"
echo "ref: refs/heads/main" > "$DONE/.git/HEAD"
printf '# Project\n\n- **Current phase:** Complete\n' > "$DONE/CLAUDE.md"

echo "== fixture 1: empty =="
eq   "empty: ok"                 "true"     "$(field "$EMPTY" ok)"
eq   "empty: no error"           "null"     "$(field "$EMPTY" error)"
eq   "empty: stage"              "scaffold" "$(field "$EMPTY" stage)"
eq   "empty: step number"        "1"        "$(field "$EMPTY" step.number)"
eq   "empty: step total"         "10"       "$(field "$EMPTY" step.total)"
eq   "empty: progress.done"      "0"        "$(field "$EMPTY" progress.done)"
eq   "empty: progress.total"     "10"       "$(field "$EMPTY" progress.total)"
eq   "empty: blockers empty"     "[]"       "$(field "$EMPTY" blockers)"
eq   "empty: not a kit project"  "false"    "$(field "$EMPTY" isBuilderKitProject)"
matches "empty: next command scaffolds" '^/builder-kit:(start|jiffi-init)$' "$(field "$EMPTY" nextCommand)"
node "$STATE" "$EMPTY" >/dev/null 2>&1 && ok "empty: exits 0" || bad "empty: exits non-zero"

echo "== fixture 2: mid-plan =="
eq   "mid: ok"                   "true"  "$(field "$MID" ok)"
eq   "mid: stage"                "build" "$(field "$MID" stage)"
eq   "mid: step number"          "8"     "$(field "$MID" step.number)"
eq   "mid: progress.done"        "7"     "$(field "$MID" progress.done)"
eq   "mid: phases total"         "3"     "$(field "$MID" phases.total)"
eq   "mid: phase 1 counted done" "1"     "$(field "$MID" phases.done)"
eq   "mid: current phase"        "2"     "$(field "$MID" phases.current)"
eq   "mid: project type"         "web"   "$(field "$MID" projectType)"
eq   "mid: greenfield door"      "greenfield" "$(field "$MID" door)"
eq   "mid: branch from .git/HEAD" "feature/phase-2-booking" "$(field "$MID" branch)"
matches "mid: next command names the phase" '^/builder-kit:(build|phase-start) --phase 2$' "$(field "$MID" nextCommand)"
eq   "mid: unticked ACs are a note, not a blocker" "[]" "$(field "$MID" blockers)"
matches "mid: the note counts them" "2 acceptance criteria still unticked" "$(field "$MID" notes)"
matches "mid: human block prints the next command" '/builder-kit:(build|phase-start) --phase 2' "$(node "$STATE" "$MID")"

echo "== fixture 3: complete =="
eq   "complete: stage"           "operate" "$(field "$DONE" stage)"
eq   "complete: step number"     "10"      "$(field "$DONE" step.number)"
eq   "complete: progress.done"   "9"       "$(field "$DONE" progress.done)"
eq   "complete: phases done"     "3"       "$(field "$DONE" phases.done)"
eq   "complete: no current phase" "null"   "$(field "$DONE" phases.current)"
eq   "complete: next command"    "/builder-kit:iterate" "$(field "$DONE" nextCommand)"
eq   "complete: no blockers"     "[]"      "$(field "$DONE" blockers)"

echo "== error contract =="
if [ "$(id -u)" = "0" ]; then
  echo "  SKIP  unreadable-root case (running as root, chmod 000 does not deny)"
else
  UNREADABLE="$FIX/unreadable"
  mkdir -p "$UNREADABLE"
  chmod 000 "$UNREADABLE"
  eq "unreadable: ok is false"      "false"            "$(field "$UNREADABLE" ok)"
  eq "unreadable: error code"       "ROOT_UNREADABLE"  "$(field "$UNREADABLE" error.code)"
  eq "unreadable: stage"            "unknown"          "$(field "$UNREADABLE" stage)"
  eq "unreadable: still has progress" "10"             "$(field "$UNREADABLE" progress.total)"
  matches "unreadable: names a blocker" "ROOT_UNREADABLE" "$(field "$UNREADABLE" blockers)"
  node "$STATE" "$UNREADABLE" >/dev/null 2>&1; eq "unreadable: exits 1" "1" "$?"
  chmod 755 "$UNREADABLE"
fi
eq "missing root: error code"     "ROOT_NOT_FOUND"        "$(field "$FIX/no-such-dir" error.code)"
echo "not a directory" > "$FIX/a-file"
eq "file as root: error code"     "ROOT_NOT_A_DIRECTORY"  "$(field "$FIX/a-file" error.code)"

echo "== the shape is always complete =="
for f in "$EMPTY" "$MID" "$DONE" "$FIX/no-such-dir" "$FIX/a-file"; do
  missing="$(node "$STATE" "$f" --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
      let v;try{v=JSON.parse(s)}catch{process.stdout.write("PARSE-ERROR");return}
      const need=["ok","error","root","isBuilderKitProject","stage","stageLabel","nextCommand","progress","blockers","step","phases","guide","door","projectType","branch","notes"]
      const miss=need.filter(k=>!(k in v))
      if(typeof v.progress!=="object"||!("done" in v.progress)||!("total" in v.progress))miss.push("progress.{done,total}")
      if(!Array.isArray(v.blockers))miss.push("blockers[]")
      if(typeof v.nextCommand!=="string"||!v.nextCommand.startsWith("/builder-kit:"))miss.push("nextCommand")
      process.stdout.write(miss.join(","))
    })')"
  [ -z "$missing" ] && ok "full shape: $(basename "$f")" || bad "full shape: $(basename "$f") missing $missing"
done

echo "== guide map is consumed, never required =="
# A project with no map of its own falls back to the copy that ships beside the
# plugin's scripts, so the guide row is populated from there and NAMES that file as
# its source. (Before the plugin copy was generated, this same fixture asserted a
# null guide. That assertion silently became untestable the moment the file landed,
# which is why this one pins the SOURCE and not just the presence.)
matches "no project map: falls back to the shipped copy" 'scripts/guide-map\.json$' "$(field "$MID" guide.source)"
mkdir -p "$MID/docs/guides"
# The hub's real schema: `steps` is a COUNT, the rows live under `pages`, and two
# reference pages carry no step number. Reading rows.length as the step total here
# is the bug this fixture exists to catch (10 rows, 8 steps).
cat > "$MID/docs/guides/guide-map.json" <<'JSON'
{
  "version": 1,
  "steps": 8,
  "pages": [
    { "step": 3, "key": "start-your-project", "slug": "start-your-project", "title": "Start your project", "command": "/builder-kit:jiffi-init" },
    { "step": 4, "key": "shape-it", "slug": "shape-it", "title": "Shape it", "command": "/builder-kit:build" },
    { "step": 6, "key": "build-and-ship-your-first-slice", "slug": "build-and-ship-your-first-slice", "title": "Build and ship your first slice", "command": "/builder-kit:ship" },
    { "step": 7, "key": "run-the-plan", "slug": "run-the-plan", "title": "Run the plan", "command": "/builder-kit:build --mode auto" },
    { "step": null, "key": "words", "slug": "glossary", "title": "Words that come up", "command": null }
  ]
}
JSON
# Mid-plan sits on phase 2, so it is running the plan, not shipping its first slice.
eq "guide map: step number"  "7"                          "$(field "$MID" guide.step)"
eq "guide map: step total is steps, not rows" "8"         "$(field "$MID" guide.of)"
eq "guide map: title"        "Run the plan"               "$(field "$MID" guide.title)"
eq "guide map: stage unchanged" "build"                   "$(field "$MID" stage)"
# The project's own map WINS over the shipped fallback. Without this the two copies
# can agree by luck and the precedence is never actually exercised.
matches "guide map: the project copy beats the shipped one" 'docs/guides/guide-map\.json$' "$(field "$MID" guide.source)"
# Three rows carry /builder-kit:build; matching on the command alone lands on the
# wrong one, which is why the stage-to-key table exists.
matches "guide map: not the loose command match" '^(7|6)$' "$(field "$MID" guide.step)"
# A bare array is still accepted, for a map that is reshaped later.
cat > "$MID/docs/guides/guide-map.json" <<'JSON'
[ { "step": 2, "key": "build", "slug": "b", "title": "Bare array form" } ]
JSON
eq "guide map: bare array form"  "Bare array form" "$(field "$MID" guide.title)"
eq "guide map: array total falls back to numbered rows" "1" "$(field "$MID" guide.of)"
echo '{ not json' > "$MID/docs/guides/guide-map.json"
eq "broken guide map: still ok"   "true"  "$(field "$MID" ok)"
eq "broken guide map: guide null" "null"  "$(field "$MID" guide)"
matches "broken guide map: says so in notes" "could not be parsed" "$(field "$MID" notes)"
rm -rf "$MID/docs/guides"

echo "== blockers =="
B1="$FIX/no-phases"; mkdir -p "$B1/.claude" "$B1/docs/idea" "$B1/docs/prd" "$B1/docs/adr" "$B1/docs/design-system"
echo '{"projectType":"web"}' > "$B1/.claude/builder-kit.json"
for p in docs/idea/validation.md docs/idea/idea-pack.md docs/prd/prd.md docs/prd/acceptance-checklist.md docs/design-system/MASTER.md; do echo "# x" > "$B1/$p"; done
echo "# ADR" > "$B1/docs/adr/ADR-0001-stack.md"
echo "# a plan with prose but no phase headings" > "$B1/docs/implementation-plan.md"
matches "plan without phase headings blocks" "PLAN_NO_PHASES" "$(field "$B1" blockers)"

B2="$FIX/bad-config"; mkdir -p "$B2/.claude"
echo '{ this is not json' > "$B2/.claude/builder-kit.json"
matches "invalid config blocks" "CONFIG_INVALID" "$(field "$B2" blockers)"

B3="$FIX/blocked"; mkdir -p "$B3/.claude/builder-kit"
printf '# blocked\n\n## secret-scan at now\n\n**Blocked:** write to .env\n' > "$B3/.claude/builder-kit/last-block.md"
matches "an unread hook block surfaces" "LAST_BLOCK" "$(field "$B3" blockers)"

B4="$FIX/stale-marker"
cp -R "$MID" "$B4"
printf '# Project\n\n- **Current phase:** 3 — Email\n' > "$B4/CLAUDE.md"
matches "stale CLAUDE.md phase marker warns" "PHASE_MARKER_STALE" "$(field "$B4" blockers)"

echo "== the continue-existing door =="
# The three canonical --entry-point values jiffi-init writes.
D1="$FIX/door-existing"; mkdir -p "$D1/.claude"
echo '{"projectType":"web","entryPoint":"existing-build"}' > "$D1/.claude/builder-kit.json"
eq "existing-build maps to the existing door" "existing" "$(field "$D1" door)"
eq "existing door points at ingest" "/builder-kit:ingest" "$(field "$D1" nextCommand)"
matches "existing door names the offline scan" "jiffi-adopt" "$(field "$D1" notes)"
D2="$FIX/door-idea"; mkdir -p "$D2/.claude"
echo '{"projectType":"web","entryPoint":"idea"}' > "$D2/.claude/builder-kit.json"
eq "idea maps to the greenfield door" "greenfield" "$(field "$D2" door)"
eq "greenfield door points at validate-idea" "/builder-kit:validate-idea" "$(field "$D2" nextCommand)"
D3="$FIX/door-nothing"; mkdir -p "$D3/.claude"
echo '{"projectType":"web","entryPoint":"nothing-yet"}' > "$D3/.claude/builder-kit.json"
eq "nothing-yet maps to the greenfield door" "greenfield" "$(field "$D3" door)"
# An adopted repo with no entryPoint recorded is still recognised by its artefacts.
D4="$FIX/door-inferred"; mkdir -p "$D4/.claude" "$D4/docs/ingest"
echo '{"projectType":"web"}' > "$D4/.claude/builder-kit.json"
echo "# scan" > "$D4/docs/ingest/scan-report.md"
eq "an ingest artefact infers the existing door" "existing" "$(field "$D4" door)"
eq "the ingest scan proves the ground-idea step" "idea-pack" "$(field "$D4" stage)"

echo "== the shaping page's own blocks =="
# The dogfood defect, pinned. A reader who ran the first block on the shaping page
# and stopped had a PRD and nothing else, and the kit told them "step 5 of 8" while
# /builder-kit:wireframe and /builder-kit:brand were still sitting above them on
# step 4. Neither artefact was known to this file at all, so skipping both and
# writing the later documents by hand advanced cleanly to the build with no
# complaint. The step number is the whole assertion: it is the line the reader acts
# on, and it was the line that was wrong.
SHAPE="$FIX/shape-skipped"; mkdir -p "$SHAPE/.claude" "$SHAPE/docs/idea" "$SHAPE/docs/prd"
echo '{"projectType":"web","entryPoint":"idea"}' > "$SHAPE/.claude/builder-kit.json"
echo "# Validation — passed" > "$SHAPE/docs/idea/validation.md"
echo "# Idea Pack" > "$SHAPE/docs/idea/idea-pack.md"
echo "# PRD" > "$SHAPE/docs/prd/prd.md"
echo "- [x] AC-001 signup works" > "$SHAPE/docs/prd/acceptance-checklist.md"
eq "a PRD with no wireframes holds the guide on step 4" "4" "$(field "$SHAPE" guide.step)"
eq "and names the page it is held on"       "shape-it"               "$(field "$SHAPE" guide.key)"
eq "the next command is the block they skipped" "/builder-kit:wireframe" "$(field "$SHAPE" nextCommand)"
matches "the skip is named as a blocker"    "SHAPE_STEP_SKIPPED"     "$(field "$SHAPE" blockers)"
matches "the blocker names the wireframes"  "docs/wireframes/README.md" "$(field "$SHAPE" blockers)"
matches "and the brand block as well"       "docs/brand/brand.md"    "$(field "$SHAPE" blockers)"
# The kit spine is untouched and stays honest: the next STAGE really is architecture.
# Only the guide, which is what the reader is following, is held.
eq "the spine stage is unchanged"           "architecture"           "$(field "$SHAPE" stage)"
eq "and so is the spine step number"        "5"                      "$(field "$SHAPE" step.number)"

mkdir -p "$SHAPE/docs/wireframes"
echo "# Screens, and the data-testid contract" > "$SHAPE/docs/wireframes/README.md"
eq "wireframes drawn: still step 4, one block left" "4"              "$(field "$SHAPE" guide.step)"
eq "wireframes drawn: the next command moves along" "/builder-kit:brand" "$(field "$SHAPE" nextCommand)"
eq "wireframes drawn: only one block still open" "1" "$(node "$STATE" "$SHAPE" | grep -c 'SHAPE_STEP_SKIPPED')"

mkdir -p "$SHAPE/docs/brand"
: > "$SHAPE/docs/brand/brand.md"
eq "an empty brand.md is not a look"        "4"                      "$(field "$SHAPE" guide.step)"

echo "# Brand — the chosen direction" > "$SHAPE/docs/brand/brand.md"
eq "all four artefacts: the guide advances" "5"                      "$(field "$SHAPE" guide.step)"
eq "all four artefacts: onto the next page" "decide-and-plan"        "$(field "$SHAPE" guide.key)"
eq "all four artefacts: the spine command returns" "/builder-kit:architect" "$(field "$SHAPE" nextCommand)"
eq "all four artefacts: nothing left to say" "[]"                    "$(field "$SHAPE" blockers)"

# The window stays open across the ADR, because design-system is the skill that
# reads docs/brand/. An architecture decision does not make a missing look moot.
mkdir -p "$SHAPE/docs/adr"; echo "# ADR-0001 Tech stack" > "$SHAPE/docs/adr/ADR-0001-stack.md"
rm "$SHAPE/docs/brand/brand.md"
eq "an ADR does not close the shaping window" "design-system"        "$(field "$SHAPE" stage)"
eq "the guide is still held on step 4"      "4"                      "$(field "$SHAPE" guide.step)"
matches "and the fix names the stage it precedes" "/builder-kit:design-system" "$(field "$SHAPE" blockers)"

echo "== an agent build has no screens to shape =="
# The agent track's shaping page carries no wireframe block, so demanding the
# artefact would fail a project on work its own guide never asked for.
AG="$FIX/shape-agent"; mkdir -p "$AG/.claude" "$AG/docs/idea" "$AG/docs/prd" "$AG/docs/brand"
echo '{"projectType":"agent","entryPoint":"idea"}' > "$AG/.claude/builder-kit.json"
for p in docs/idea/validation.md docs/idea/idea-pack.md docs/prd/prd.md docs/prd/acceptance-checklist.md; do echo "# x" > "$AG/$p"; done
echo "# Brand — tone first" > "$AG/docs/brand/brand.md"
eq "an agent is never asked for wireframes" "[]"                     "$(field "$AG" blockers)"
eq "so its guide advances on the brand alone" "5"                    "$(field "$AG" guide.step)"
rm "$AG/docs/brand/brand.md"
eq "an agent with no brand is still held"   "4"                      "$(field "$AG" guide.step)"
eq "and only the brand block is named"      "/builder-kit:brand"     "$(field "$AG" nextCommand)"

echo "== nothing is said before the PRD exists =="
# Both skills refuse to run before the PRD, so an absence nobody could have filled
# yet is not a skip. Warning here would train the reader to ignore the warning.
NOPRD="$FIX/shape-early"; mkdir -p "$NOPRD/.claude" "$NOPRD/docs/idea"
echo '{"projectType":"web","entryPoint":"idea"}' > "$NOPRD/.claude/builder-kit.json"
echo "# Validation — passed" > "$NOPRD/docs/idea/validation.md"
echo "# Idea Pack" > "$NOPRD/docs/idea/idea-pack.md"
eq "no PRD yet: the shaping blocks cannot be skipped" "[]"           "$(field "$NOPRD" blockers)"
eq "no PRD yet: the stage is the PRD"       "prd"                    "$(field "$NOPRD" stage)"

echo "== once the design system is locked it becomes a note =="
# MID has a design system, a plan and a closed phase, and never drew a wireframe.
# A blocker there is pointless: the look cannot be picked retrospectively without
# redoing the tokens. The silence was the defect, not the advance, so the absence
# is still SAID. Same for the page specs, which is the identical hole one page on.
matches "the never-drawn wireframes are still named" "docs/wireframes/README.md was never written" "$(field "$MID" notes)"
matches "so is the never-picked brand"      "docs/brand/brand.md was never written" "$(field "$MID" notes)"
matches "and the missing page specs"        "page-specs never ran"   "$(field "$MID" notes)"
eq "but none of them stops a build in flight" "[]"                   "$(field "$MID" blockers)"

echo "== the stale-marker probe does not invent a phase =="
B6="$FIX/marker-prose"
cp -R "$MID" "$B6"
# The exact shape a finished project carries. A loose regex reads "6" out of this
# and warns that a done project is on the wrong phase.
printf '# Project\n\n- **Current phase:** Complete -- All 6 phases built. 91/91 criteria passing.\n' > "$B6/CLAUDE.md"
eq "prose phase marker is not misread" "[]" "$(field "$B6" blockers)"
printf '# Project\n\n- **Current phase:** Ready to build — Phase 2\n' > "$B6/CLAUDE.md"
eq "a named phase that agrees does not warn" "[]" "$(field "$B6" blockers)"
printf '# Project\n\n- **Current phase:** Ready to build — Phase 3\n' > "$B6/CLAUDE.md"
matches "a named phase that disagrees warns" "PHASE_MARKER_STALE" "$(field "$B6" blockers)"

echo "== hand-edited files cannot forge a line in the block =="
B7="$FIX/forged"; mkdir -p "$B7/.claude/builder-kit"
printf '**Blocked:** first line\nBlockers:   none\nStep:       1 of 10\n' > "$B7/.claude/builder-kit/last-block.md"
forged="$(node "$STATE" "$B7")"
eq "the forged block reports one Step line" "1" "$(printf '%s' "$forged" | grep -c '^Step:')"
eq "the forged block still reports its blocker" "1" "$(printf '%s' "$forged" | grep -c 'LAST_BLOCK')"

echo "== degrades, never throws =="
eq "empty file as prd is not proof" "prd" "$(
  B5="$FIX/zero-byte"; mkdir -p "$B5/.claude" "$B5/docs/idea" "$B5/docs/prd"
  echo '{"projectType":"web"}' > "$B5/.claude/builder-kit.json"
  echo "# v" > "$B5/docs/idea/validation.md"; echo "# ip" > "$B5/docs/idea/idea-pack.md"
  : > "$B5/docs/prd/prd.md"
  field "$B5" stage)"
eq "the plugin's own tree still answers" "true" "$(field "$ROOT" ok)"
if node "$STATE" /dev/null --json >/dev/null 2>&1 || true; then
  matches "a device node as root is a named error" "^ROOT_NOT" "$(field /dev/null error.code)"
fi

echo "== SessionStart re-grounding carries the step number =="
# CLAUDE_PROJECT_DIR is unset so the hook resolves the fixture, not whatever repo
# the suite happens to be running inside.
REGROUND="$ROOT/hooks/session-reground.mjs"
mid_out="$(env -u CLAUDE_PROJECT_DIR bash -c "cd '$MID' && node '$REGROUND'" 2>/dev/null)"
if printf '%s' "$mid_out" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const j=JSON.parse(s);const c=j.hookSpecificOutput.additionalContext;if(!/Step:\s+8 of 10/.test(c))process.exit(1);if(!/builder-kit:(build|phase-start) --phase 2/.test(c))process.exit(1)})' 2>/dev/null; then
  ok "reground injects the step number and the next command"
else
  bad "reground did not inject the step number / next command"
fi
if printf '%s' "$mid_out" | grep -q '"hookEventName":"SessionStart"'; then ok "reground emits a SessionStart payload"; else bad "reground payload is not SessionStart-shaped"; fi
env -u CLAUDE_PROJECT_DIR bash -c "cd '$MID' && node '$REGROUND'" >/dev/null 2>&1; eq "reground exits 0 in a project" "0" "$?"

BARE="$FIX/bare"; mkdir -p "$BARE"
bare_out="$(env -u CLAUDE_PROJECT_DIR bash -c "cd '$BARE' && node '$REGROUND'" 2>/dev/null)"
eq "reground stays silent outside a project" "" "$bare_out"
env -u CLAUDE_PROJECT_DIR bash -c "cd '$BARE' && node '$REGROUND'" >/dev/null 2>&1; eq "reground exits 0 outside a project" "0" "$?"

# The whole point of the hook is that it cannot take a session down with it.
hidden="$ROOT/scripts/state.mjs.hidden-for-test"
mv "$STATE" "$hidden"
env -u CLAUDE_PROJECT_DIR bash -c "cd '$MID' && node '$REGROUND'" >/dev/null 2>&1; eq "reground fails open without state.mjs" "0" "$?"
degraded="$(env -u CLAUDE_PROJECT_DIR bash -c "cd '$MID' && node '$REGROUND'" 2>/dev/null)"
if printf '%s' "$degraded" | grep -q "Implementation plan"; then ok "reground still injects the doc heads when state.mjs is gone"; else bad "reground lost the doc heads on the degraded path"; fi
mv "$hidden" "$STATE"

echo ""
echo "== $pass passed, $fail failed =="
[ "$fail" = 0 ]
