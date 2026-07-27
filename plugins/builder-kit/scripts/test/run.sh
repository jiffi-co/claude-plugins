#!/usr/bin/env bash
# builder-kit test suite. Plain bash, no framework. Validates the plugin is
# well-formed and that its shipped scripts behave. Exits non-zero on any failure
# so it can gate CI and a pre-publish smoke. Run: bash scripts/test/run.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

pass=0
fail=0
ok()   { echo "  PASS  $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $1"; fail=$((fail+1)); }
# assert_exit <expected> <desc> <command...>
assert_exit() { local want="$1" desc="$2"; shift 2; "$@" >/dev/null 2>&1; local got=$?; [ "$got" = "$want" ] && ok "$desc (exit $got)" || bad "$desc (want $want, got $got)"; }

echo "== JSON validity =="
for f in .claude-plugin/plugin.json hooks/hooks.json .mcp.json \
         scripts/checkpoint-manifest.json scripts/checkpoint-close-manifest.json \
         scripts/hard-stops.json scripts/guide-map.json \
         templates/project/.claude/settings.json \
         templates/project/docs/checkpoints/checkpoint.json \
         templates/project/docs/checkpoints/checkpoint-close.json; do
  if node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" >/dev/null 2>&1; then ok "valid JSON: $f"; else bad "invalid JSON: $f"; fi
done

echo "== scripts syntax =="
for f in hooks/autosave.mjs hooks/block-report.mjs hooks/git-allow.mjs hooks/hard-stop.mjs \
         hooks/secret-scan.mjs hooks/session-reground.mjs hooks/stop-test-gate.mjs hooks/task-mirror.mjs \
         scripts/adopt.mjs scripts/checkpoint.mjs scripts/doctor.mjs scripts/evolve.mjs scripts/gate.mjs \
         scripts/import-idea8.mjs scripts/init.mjs scripts/lint-kit.mjs scripts/repo-create.mjs \
         scripts/state.mjs scripts/task-store.mjs scripts/test/install-resolver.test.mjs; do
  if node --check "$f" >/dev/null 2>&1; then ok "syntax: $f"; else bad "syntax: $f"; fi
done

# The real oracle for frontmatter and the manifest. lint-kit assertion 9 catches the
# one YAML shape that has actually shipped broken; this catches the rest, but only
# when the CLI is installed, so it skips rather than failing on a bare CI box.
echo "== plugin manifest validates =="
if command -v claude >/dev/null 2>&1; then
  assert_exit 0 "claude plugin validate" claude plugin validate "$ROOT"
else
  ok "claude plugin validate (skipped: no claude CLI on PATH)"
fi

echo "== hook commands reference existing scripts =="
node -e '
const fs=require("fs");const h=JSON.parse(fs.readFileSync("hooks/hooks.json","utf8")).hooks;let miss=[];
for(const ev of Object.keys(h))for(const g of h[ev])for(const hk of g.hooks){const m=hk.command.match(/hooks\/([\w.-]+)/);if(m&&!fs.existsSync("hooks/"+m[1]))miss.push(m[1]);}
if(miss.length){console.error("missing: "+miss.join(","));process.exit(1)}
' && ok "all hook scripts exist" || bad "a hook references a missing script"

echo "== command files reference existing scripts =="
missing_cmd=0
for c in commands/*.md; do
  for s in $(grep -oE 'scripts/[a-z-]+\.mjs' "$c" | sort -u); do
    [ -f "$s" ] || { bad "$c -> missing $s"; missing_cmd=1; }
  done
done
[ "$missing_cmd" = 0 ] && ok "all command-referenced scripts exist"

echo "== skill + agent frontmatter =="
if node -e '
const fs=require("fs"),path=require("path");
function walk(d){let o=[];if(!fs.existsSync(d))return o;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o=o.concat(walk(p));else if(e.name.endsWith(".md"))o.push(p);}return o;}
let bad=0;for(const f of [...walk("skills"),...walk("agents")]){const b=fs.readFileSync(f,"utf8");const m=b.match(/^---\n([\s\S]*?)\n---/);if(!m){console.error("no-fm "+f);bad++;continue;}const fm=m[1],ag=f.startsWith("agents/");if(!/^name:\s*\S/m.test(fm)){console.error("no name "+f);bad++;}if(!/^description:\s*\S/m.test(fm)){console.error("no desc "+f);bad++;}if(!(ag?/^tools:\s*\S/m.test(fm):/^allowed-tools:/m.test(fm))){console.error("no tools "+f);bad++;}const nv=(fm.match(/^name:\s*(.+)$/m)||[])[1];const exp=ag?path.basename(f,".md"):path.basename(path.dirname(f));if(nv&&nv.trim()!==exp){console.error("name mismatch "+f);bad++;}}
process.exit(bad?1:0);
' >/dev/null 2>&1; then ok "all skills/agents have valid, consistent frontmatter"; else bad "a skill/agent has bad frontmatter"; fi

echo "== secret-scan behaviour =="
assert_exit 2 "blocks .env write"        bash -c 'echo "{\"tool_input\":{\"file_path\":\".env\",\"content\":\"X=1\"}}" | node hooks/secret-scan.mjs'
assert_exit 0 "allows normal write"      bash -c 'echo "{\"tool_input\":{\"file_path\":\"src/a.ts\",\"content\":\"const x=1\"}}" | node hooks/secret-scan.mjs'
assert_exit 0 "allows .env.example"      bash -c 'echo "{\"tool_input\":{\"file_path\":\".env.example\",\"content\":\"X=your-key\"}}" | node hooks/secret-scan.mjs'
assert_exit 2 "blocks live AWS key"      bash -c 'echo "{\"tool_input\":{\"file_path\":\"src/a.ts\",\"content\":\"const k=\\\"AKIAABCDEFGHIJKLMNOP\\\"\"}}" | node hooks/secret-scan.mjs'

echo "== block visibility =="
# A blocked turn renders nothing in the Claude Code panel of Claude Desktop, so every
# block must also leave a file the user can open. Run in a scratch project with
# CLAUDE_PROJECT_DIR unset, which is both hermetic and the harder of the two root paths
# (it forces the fallback to the payload's cwd). The reporter deliberately writes
# nothing when the resolved root is the plugin's own tree, so this cannot be asserted
# from $ROOT.
TB="$(mktemp -d)"
BLOCK_PAYLOAD="{\"cwd\":\"$TB\",\"tool_input\":{\"file_path\":\".env\",\"content\":\"X=1\"}}"
assert_exit 2 "blocks .env write from a project dir" \
  env -u CLAUDE_PROJECT_DIR bash -c "cd '$TB' && echo '$BLOCK_PAYLOAD' | node '$ROOT/hooks/secret-scan.mjs'"
if [ -f "$TB/.claude/builder-kit/last-block.md" ]; then ok "block is recorded for a Desktop user"; else bad "no .claude/builder-kit/last-block.md after a block"; fi
if grep -q "secret-scan" "$TB/.claude/builder-kit/last-block.md" 2>/dev/null && grep -q "Blocked:" "$TB/.claude/builder-kit/last-block.md" 2>/dev/null; then ok "the record names the hook and what it blocked"; else bad "last-block.md is missing the hook name or the reason"; fi
rm -rf "$TB"
TB2="$(mktemp -d)"
( cd "$TB2" && echo "{\"cwd\":\"$TB2\",\"tool_input\":{\"file_path\":\"src/a.ts\",\"content\":\"const x=1\"}}" | env -u CLAUDE_PROJECT_DIR node "$ROOT/hooks/secret-scan.mjs" >/dev/null 2>&1 )
if [ -e "$TB2/.claude" ]; then bad "an allowed write left a block record"; else ok "an allowed write records nothing"; fi
rm -rf "$TB2"

echo "== kit lint =="
LINTLOG="$(mktemp)"
if node "$ROOT/scripts/lint-kit.mjs" >"$LINTLOG" 2>&1; then ok "lint-kit: the kit describes itself truthfully"; else bad "lint-kit found problems"; sed 's/^/  | /' "$LINTLOG" | tail -30; fi
rm -f "$LINTLOG"

echo "== checkpoint behaviour =="
T="$(mktemp -d)"; mkdir -p "$T/docs/prd" "$T/docs/adr"; echo "# p" > "$T/docs/prd/prd.md"; printf -- "- [x] a\n" > "$T/docs/prd/acceptance-checklist.md"; echo "# plan" > "$T/docs/implementation-plan.md"; echo "# adr" > "$T/docs/adr/README.md"
assert_exit 0 "checkpoint passes a complete project" bash -c "cd '$T' && node '$ROOT/scripts/checkpoint.mjs' --manifest '$ROOT/scripts/checkpoint-manifest.json'"
rm -rf "$T"
T2="$(mktemp -d)"; mkdir -p "$T2/docs/prd"; echo "# p" > "$T2/docs/prd/prd.md"; echo "cl" > "$T2/docs/prd/acceptance-checklist.md"
assert_exit 1 "checkpoint fails a project missing the plan" bash -c "cd '$T2' && node '$ROOT/scripts/checkpoint.mjs' --manifest '$ROOT/scripts/checkpoint-manifest.json'"
rm -rf "$T2"
# phase-scoped AC check: match gates only this phase's ACs, ignoring later unticked ones
T3="$(mktemp -d)"; printf -- "- [x] AC-001.1 done\n- [ ] AC-002.1 later phase\n" > "$T3/cl.md"
printf '{"checks":[{"id":"a","type":"checklist-done","kind":"mechanical","path":"cl.md","match":"AC-001"}]}' > "$T3/m1.json"
printf '{"checks":[{"id":"a","type":"checklist-done","kind":"mechanical","path":"cl.md","match":"AC-002"}]}' > "$T3/m2.json"
assert_exit 0 "checkpoint match scopes to a passing phase (AC-001)" bash -c "cd '$T3' && node '$ROOT/scripts/checkpoint.mjs' --manifest m1.json"
assert_exit 1 "checkpoint match fails an unticked phase (AC-002)" bash -c "cd '$T3' && node '$ROOT/scripts/checkpoint.mjs' --manifest m2.json"
rm -rf "$T3"

echo "== the build gate and the close gate are actually split =="
# The whole reason there are two manifests. A checklist-done row in the BUILD gate
# fails by construction on every first close, and the only way through it is to tick
# the boxes to make it green, which inverts evidence-then-tick into tick-to-go-green.
for m in scripts/checkpoint-manifest.json templates/project/docs/checkpoints/checkpoint.json; do
  if node -e '
  const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const rows=(m.checks||[]).filter(c=>c.type==="checklist-done");
  if(rows.length){console.error("build gate carries "+rows.length+" checklist-done row(s)");process.exit(1)}
  ' "$m" 2>/dev/null; then ok "build gate has no acceptance-criteria row: $m"; else bad "build gate still gates on ticked criteria: $m"; fi
done
for m in scripts/checkpoint-close-manifest.json templates/project/docs/checkpoints/checkpoint-close.json; do
  if node -e '
  const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const rows=(m.checks||[]).filter(c=>c.type==="checklist-done");
  if(rows.length!==1){console.error("close gate has "+rows.length+" checklist-done rows, want exactly 1");process.exit(1)}
  if(rows[0].optional){console.error("the close gate acceptance row is optional, so it never blocks");process.exit(1)}
  if(rows[0].kind!=="mechanical"){console.error("the close gate acceptance row is not mechanical");process.exit(1)}
  ' "$m" 2>/dev/null; then ok "close gate requires the acceptance criteria: $m"; else bad "close gate does not require ticked criteria: $m"; fi
done
# Both shipped manifests reach gate.mjs, and they reach it through the token rather
# than an absolute path (which points at one machine) or ${CLAUDE_PLUGIN_ROOT}
# (which carries the plugin version and dies at the next update).
for m in scripts/checkpoint-manifest.json scripts/checkpoint-close-manifest.json \
         templates/project/docs/checkpoints/checkpoint.json templates/project/docs/checkpoints/checkpoint-close.json; do
  if node -e '
  const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
  const cmds=(m.checks||[]).filter(c=>c.type==="command").map(c=>c.cmd);
  const gate=cmds.filter(c=>/gate\.mjs/.test(c));
  if(!gate.length){console.error("no gate.mjs rows at all");process.exit(1)}
  const badpath=gate.filter(c=>!c.includes("{{PLUGIN_SCRIPTS}}"));
  if(badpath.length){console.error("gate row without the token: "+badpath[0]);process.exit(1)}
  if(cmds.some(c=>c.includes("CLAUDE_PLUGIN_ROOT"))){console.error("a row bakes in the versioned CLAUDE_PLUGIN_ROOT");process.exit(1)}
  ' "$m" 2>/dev/null; then ok "gate.mjs rows are wired and version-proof: $m"; else bad "gate.mjs rows missing or version-fragile: $m"; fi
done
# An explicitly named manifest that does not exist must not fall through to the
# lenient shipped default. phase-complete runs the close gate by name; a silent
# fallback there would run the WRONG gate and report a green phase.
TM="$(mktemp -d)"
assert_exit 2 "a named manifest that does not exist is an error, not a fallback" \
  bash -c "cd '$TM' && node '$ROOT/scripts/checkpoint.mjs' --manifest docs/checkpoints/phase-9-close.json"
# The token has to actually expand, or every gate row is a file-not-found.
mkdir -p "$TM/docs/prd"; echo x > "$TM/docs/prd/prd.md"
# --emit-checks always exits 0, so this assertion is about the PATH resolving and
# nothing else. A row whose verdict depends on the fixture would confuse "the token
# did not expand" with "the gate found something wrong".
printf '{"checks":[{"id":"g","label":"gate reachable","kind":"mechanical","type":"command","cmd":"node \\"{{PLUGIN_SCRIPTS}}/gate.mjs\\" --emit-checks","expectExit":0}]}' > "$TM/m.json"
assert_exit 0 "{{PLUGIN_SCRIPTS}} expands to the plugin scripts directory" \
  bash -c "cd '$TM' && node '$ROOT/scripts/checkpoint.mjs' --manifest m.json"
rm -rf "$TM"

echo "== doctor behaviour =="
assert_exit 0 "doctor --json runs and exits per core" bash -c "node '$ROOT/scripts/doctor.mjs' --json | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d);process.stdin.on(\"end\",()=>{JSON.parse(s)})'"
assert_exit 0 "install resolver fixtures" node scripts/test/install-resolver.test.mjs

echo "== hard-stop registry =="
assert_exit 0 "every stop fires against its fixture and every negative control stays quiet" node hooks/hard-stop.mjs --selftest
# A registry that cannot be read must never look like a clean scan.
HS="$(mktemp -d)"
printf '{"stops":[{"id":"X","preflight":{"patterns":["("]}}]}' > "$HS/broken.json"
assert_exit 2 "--scan on a file it cannot read exits 2, not 0" node hooks/hard-stop.mjs --scan "$HS/nope.md"
rm -rf "$HS"

echo "== the map matches the kit =="
# The cheatsheet is the one-screen map. If it names something that does not exist,
# or misses something that does, it is worse than no map.
if node -e '
const fs=require("fs");
const skills=fs.readdirSync("skills",{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name);
const cmds=fs.readdirSync("commands").filter(f=>f.endsWith(".md")).map(f=>f.replace(/\.md$/,""));
const all=new Set([...skills,...cmds]);
const body=fs.readFileSync("skills/cheatsheet/SKILL.md","utf8");
const named=new Set([...body.matchAll(/\/builder-kit:([a-z0-9-]+)/g)].map(m=>m[1]));
const missing=[...all].filter(n=>!named.has(n));
const ghosts=[...named].filter(n=>!all.has(n));
const claim=(body.match(/All (\d+) entries \((\d+) skills and (\d+) commands\)/)||[]);
const problems=[];
if(missing.length) problems.push("not on the map: "+missing.join(", "));
if(ghosts.length) problems.push("on the map but not in the kit: "+ghosts.join(", "));
if(!claim.length) problems.push("the cheatsheet no longer states its inventory count");
else if(Number(claim[1])!==all.size||Number(claim[2])!==skills.length||Number(claim[3])!==cmds.length)
  problems.push(`claims ${claim[1]} (${claim[2]} skills, ${claim[3]} commands), actual ${all.size} (${skills.length} skills, ${cmds.length} commands)`);
if(problems.length){console.error(problems.join("\n"));process.exit(1)}
' 2>/dev/null; then ok "cheatsheet names every skill and command, and counts them correctly"; else bad "cheatsheet has drifted from the kit"; fi

echo "== init behaviour =="
T3="$(mktemp -d)"
( cd "$T3" && node "$ROOT/scripts/init.mjs" my-app --entry-point nothing-yet >/dev/null 2>&1 )
[ -f "$T3/my-app/CLAUDE.md" ] && [ -f "$T3/my-app/.claude/settings.json" ] && [ -f "$T3/my-app/docs/checkpoints/checkpoint.json" ] && ok "init scaffolds the expected files" || bad "init missing scaffolded files"
grep -q "Project: my-app" "$T3/my-app/CLAUDE.md" && ok "init substitutes {{PROJECT_NAME}}" || bad "init did not substitute the name"
assert_exit 1 "init refuses a non-empty new dir" bash -c "cd '$T3' && node '$ROOT/scripts/init.mjs' my-app --entry-point nothing-yet"
rm -rf "$T3"
# The entry-point question is the fork the whole front door hangs on, so a missing
# answer must be its OWN exit code. Sharing exit 1 with the non-empty-directory
# refusal would let a caller read "you forgot to ask" as "that folder is in use".
T3B="$(mktemp -d)"
assert_exit 2 "init refuses to run without --entry-point" bash -c "cd '$T3B' && node '$ROOT/scripts/init.mjs' my-app"
[ -e "$T3B/my-app" ] && bad "init wrote something despite refusing" || ok "init wrote nothing when it refused"
assert_exit 2 "init refuses an unknown --entry-point" bash -c "cd '$T3B' && node '$ROOT/scripts/init.mjs' my-app --entry-point banana"
rm -rf "$T3B"
# entryPoint lands BEFORE any other scaffold write, so a run killed halfway still
# knows which door it came through.
T3C="$(mktemp -d)"
( cd "$T3C" && node "$ROOT/scripts/init.mjs" app --entry-point idea >/dev/null 2>&1 )
if node -e '
const fs=require("fs"),p=process.argv[1];
const cfg=JSON.parse(fs.readFileSync(p+"/.claude/builder-kit.json","utf8"));
if(cfg.entryPoint!=="idea"){console.error("entryPoint is "+cfg.entryPoint);process.exit(1)}
const mine=fs.statSync(p+"/.claude/builder-kit.json").mtimeNs;
const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(d+"/"+e.name):[d+"/"+e.name]);
const later=walk(p).filter(f=>!f.endsWith("/.claude/builder-kit.json")&&fs.statSync(f).mtimeNs<mine);
if(later.length){console.error("written before the config: "+later.join(","));process.exit(1)}
' "$T3C/app" 2>/dev/null; then ok "init writes entryPoint before any other scaffold write"; else bad "init wrote scaffold files before recording entryPoint"; fi
rm -rf "$T3C"

echo "== the front door carries every answer it asked for =="
# Each assertion below is a defect three readers hit walking the published guides
# end to end. They are here so the same walk cannot break the same way twice.

# 1. existing-build + a NAME. The literal block on page 3 is `start my-app --type <t>`,
# and the adopt reader is by definition already standing in their project, so running it
# verbatim used to scaffold a full empty project into a NEW subdirectory beside the code
# it was meant to wrap: exit 0, no warning, then advice to adopt the empty scaffold.
TD="$(mktemp -d)"
mkdir -p "$TD/proto" && (cd "$TD/proto" && git init -q -b main && echo x > app.js && printf '{"name":"proto","scripts":{"start":"node app.js"}}' > package.json)
assert_exit 2 "init refuses existing-build together with a project name" \
  bash -c "cd '$TD/proto' && node '$ROOT/scripts/init.mjs' my-app --type agent --entry-point existing-build"
[ -e "$TD/proto/my-app" ] && bad "init created the nested scaffold anyway" || ok "init wrote nothing when it refused the nested scaffold"
( cd "$TD/proto" && node "$ROOT/scripts/init.mjs" --type agent --entry-point existing-build --repo skip >"$TD/inplace.log" 2>&1 )
[ -f "$TD/proto/CLAUDE.md" ] && ok "the same door, with no name, scaffolds in place" || bad "in-place existing-build scaffold did not land"

# 2. The next step comes from state.mjs, prefixed, so the scaffold cannot name a command
# that does not resolve. init.mjs used to print `/validate-idea` and `/jiffi-adopt`.
if grep -qE '^Next: /builder-kit:[a-z0-9-]+$' "$TD/inplace.log"; then ok "init prints one next command, plugin-prefixed"; else bad "init's next step is not a typeable /builder-kit: command: $(grep -i '^next' "$TD/inplace.log" | head -1)"; fi

# 3. A recorded testCommand that does not exist is read as fact by the close gate and the
# Stop hook, so a suite that never ran reports green. This repo has no `eval` script.
if node -e '
const c=JSON.parse(require("fs").readFileSync(process.argv[1]+"/.claude/builder-kit.json","utf8"));
if(c.testCommand!==null){console.error("recorded testCommand "+JSON.stringify(c.testCommand)+" against a package.json that has no eval script");process.exit(1)}
' "$TD/proto" 2>/dev/null; then ok "init records no testCommand when the script it names does not exist"; else bad "init recorded a testCommand that cannot run"; fi
grep -q "No test command recorded" "$TD/inplace.log" && ok "init says so, in words, rather than leaving it silent" || bad "init recorded nothing and said nothing"
# ... and the skipped overlay scripts are named, with the line that adds each. Silently
# dropping them is how agent-notes.md ends up saying `npm test` runs the agent when it
# runs the builder's old Express app.
grep -q 'npm pkg set scripts.eval=' "$TD/inplace.log" && ok "init names the scripts the kept package.json is missing" || bad "the skipped overlay scripts vanished silently"
# The warning must follow what was RECORDED, not what this run computed. Re-running in
# place over a config that already carries a good testCommand must stay quiet.
node -e '
const f=process.argv[1]+"/.claude/builder-kit.json",fs=require("fs");
const j=JSON.parse(fs.readFileSync(f));j.testCommand="npm run check";fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")
' "$TD/proto"
( cd "$TD/proto" && node "$ROOT/scripts/init.mjs" --type agent --entry-point existing-build --repo skip >"$TD/rerun.log" 2>&1 )
if grep -q "No test command recorded" "$TD/rerun.log"; then bad "re-running warns about a testCommand the config already has"; else ok "the warning follows what was recorded, not what was computed"; fi
grep -q '"testCommand": "npm run check"' "$TD/proto/.claude/builder-kit.json" && ok "a re-run leaves an existing testCommand alone" || bad "a re-run clobbered the recorded testCommand"
# A flag is never another flag's value.
TF="$(mktemp -d)"
( cd "$TF" && node "$ROOT/scripts/init.mjs" app --entry-point nothing-yet --cost-ceiling --repo skip >/dev/null 2>&1 )
if node -e '
const c=JSON.parse(require("fs").readFileSync(process.argv[1]+"/app/.claude/builder-kit.json","utf8"));
if(typeof c.costCeiling==="string"&&c.costCeiling.startsWith("--")){console.error("recorded "+c.costCeiling+" as the cost ceiling");process.exit(1)}
' "$TF" 2>/dev/null; then ok "a missing flag value is missing, not the next flag"; else bad "a flag was swallowed as another flag's value"; fi
rm -rf "$TF" "$TD"

# 4. The cost ceiling is asked on page one of every guide and used to land nowhere, while
# two later skills were told to read it back.
TC="$(mktemp -d)"
( cd "$TC" && node "$ROOT/scripts/init.mjs" app --entry-point nothing-yet --repo skip --cost-ceiling "nothing at all, free tiers only" >"$TC/out.log" 2>&1 )
if node -e '
const c=JSON.parse(require("fs").readFileSync(process.argv[1]+"/app/.claude/builder-kit.json","utf8"));
if(c.costCeiling!=="nothing at all, free tiers only"){console.error("costCeiling is "+JSON.stringify(c.costCeiling));process.exit(1)}
' "$TC" 2>/dev/null; then ok "init records the cost ceiling the front door asked for"; else bad "the cost ceiling was asked and lost"; fi
for s in prd architect; do
  grep -q "costCeiling" "$ROOT/skills/$s/SKILL.md" && ok "the $s skill reads the ceiling back from where it is recorded" || bad "$s still reads the ceiling back from nowhere"
done
# The scaffold manifest is what lets /jiffi-adopt tell the kit's own files apart from the
# builder's. Without it, adopting a 7-file prototype reports 32 files back at them.
if node -e '
const m=JSON.parse(require("fs").readFileSync(process.argv[1]+"/app/.claude/builder-kit/scaffold-manifest.json","utf8"));
if(!Array.isArray(m.files)||!m.files.includes("CLAUDE.md")){console.error("manifest does not list what it created");process.exit(1)}
' "$TC" 2>/dev/null; then ok "init records what it scaffolded, for adopt to exclude"; else bad "no usable scaffold manifest"; fi
rm -rf "$TC"

# 5. The private backup. repo-create.mjs shipped complete and NOTHING called it, so page
# 3's promise of a private remote was half unbuilt and the phase-1 close gate ("work
# committed and pushed") could not be satisfied by any command in the free arc.
grep -q "repo-create.mjs" "$ROOT/scripts/init.mjs" && ok "init actually calls repo-create.mjs" || bad "repo-create.mjs is still dead code"
SHIM2="$(mktemp -d)"; ln -sf "$(command -v node)" "$SHIM2/node"; ln -sf "$(command -v git)" "$SHIM2/git"
TR="$(mktemp -d)"
( cd "$TR" && PATH="$SHIM2" node "$ROOT/scripts/init.mjs" app --entry-point nothing-yet --repo create >"$TR/out.log" 2>&1 )
code=$?
[ "$code" = 0 ] && ok "a missing gh does not fail the scaffold (exit 0)" || bad "gh missing took the whole scaffold down (exit $code)"
[ -f "$TR/app/CLAUDE.md" ] && ok "the project is there regardless of the backup" || bad "no project after a failed backup"
grep -qi "github command line tool is not installed" "$TR/out.log" && ok "it says gh is missing, in a sentence" || bad "the gh-missing reason never reached the reader"
grep -q "builder-kit:start --repo create" "$TR/out.log" && ok "it prints the one line that retries the backup" || bad "no retry line for the backup"
( cd "$TR" && node "$ROOT/scripts/init.mjs" plain --entry-point nothing-yet --repo skip >"$TR/skip.log" 2>&1 )
if git -C "$TR/plain" remote get-url origin >/dev/null 2>&1; then bad "--repo skip created a remote"; else ok "--repo skip creates nothing"; fi
grep -q "close gate checks that it has been pushed" "$TR/skip.log" && ok "skipping says what it costs later" || bad "skipping the backup is silent about the close gate"
rm -rf "$TR" "$SHIM2"

echo "== a placeholder is not a step done =="
# /jiffi-adopt writes idea-pack.md and prd.md as shells whose every section reads "[G] Gap".
# state.mjs proved a step with "a non-empty file exists", so those stubs advanced an
# adopting builder two steps and straight past the PRD approval gate.
TS="$(mktemp -d)"
mkdir -p "$TS/docs/idea" "$TS/docs/prd" "$TS/.claude"
echo '{"projectType":"web","entryPoint":"existing-build"}' > "$TS/.claude/builder-kit.json"
mkdir -p "$TS/docs/ingest"; echo "# scan" > "$TS/docs/ingest/scan-report.md"
printf '# Idea Pack (STUB, written by /jiffi-adopt)\n\n## One-liner\n[G] Gap.\n\n## Problem\n[G] Gap.\n\n## Users\n[G] Gap.\n' > "$TS/docs/idea/idea-pack.md"
if node --input-type=module -e '
import {getState} from "'"$ROOT"'/scripts/state.mjs";
const s=getState("'"$TS"'");
if(s.stage!=="idea-pack"){console.error("stage is "+s.stage+", a stub was counted as proof");process.exit(1)}
if(!s.blockers.some(b=>b.id==="ARTEFACT_IS_A_STUB")){console.error("no stub blocker; the reason is invisible");process.exit(1)}
' 2>/dev/null; then ok "state holds the step open on a stub, and says why"; else bad "state counted a stub as a finished stage"; fi
# ... and a real document still counts. A rule that never lets anything through is worse
# than the bug it fixes: telling a builder their finished work is absent is the kit
# calling them a liar. This one deliberately uses the word STUB in its prose and leaves
# two gaps open, which is what a real working draft looks like.
printf '# Idea Pack\n\nWe will STUB the payment path in phase one and wire it later.\n\n## One-liner\nA link shortener for one team.\n\n## Problem\nPeople paste raw URLs.\n\n## Open questions\n[G] Who owns the domain?\n[G] Which team goes first?\n' > "$TS/docs/idea/idea-pack.md"
if node --input-type=module -e '
import {getState} from "'"$ROOT"'/scripts/state.mjs";
const s=getState("'"$TS"'");
if(s.stage!=="prd"){console.error("a real idea pack did not count; stage is "+s.stage);process.exit(1)}
if(s.blockers.some(b=>b.id==="ARTEFACT_IS_A_STUB")){console.error("a real document was called a stub");process.exit(1)}
' 2>/dev/null; then ok "a real draft that says STUB and has two gaps still proves its step"; else bad "the stub rule swallowed a real document"; fi
rm -rf "$TS"

echo "== adopt describes what the builder brought =="
TA="$(mktemp -d)"
( cd "$TA" && git init -q -b main && printf '{"name":"p","scripts":{"start":"node src/index.js"}}' > package.json \
  && mkdir -p src && echo "1" > src/index.js && echo "# r" > README.md \
  && git add -A && git -c user.name=t -c user.email=t@t commit -qm init \
  && node "$ROOT/scripts/init.mjs" --entry-point existing-build --repo skip >/dev/null 2>&1 \
  && node "$ROOT/scripts/adopt.mjs" . >"$TA/adopt.log" 2>&1 )
if node -e '
const b=require("fs").readFileSync(process.argv[1]+"/docs/ingest/scan-report.md","utf8");
const m=b.match(/^- Files: (\d+), directories: (\d+)/m);
if(!m){console.error("no file count in the scan report");process.exit(1)}
if(Number(m[1])>5){console.error("counted "+m[1]+" files for a 3-file prototype; the kit is counting itself");process.exit(1)}
if(!/^- Excluded: \d+ file/m.test(b)){console.error("the exclusion is not stated, so the number cannot be checked");process.exit(1)}
' "$TA" 2>/dev/null; then ok "adopt excludes the scaffold it just wrote, and says how many"; else bad "adopt counts the builder-kit scaffold as the builder's code"; fi
if grep -qE '^Next: /builder-kit:[a-z0-9-]+$' "$TA/adopt.log"; then ok "adopt's next step is the same one state.mjs gives"; else bad "adopt still prints its own next step: $(grep -i '^next' "$TA/adopt.log" | head -1)"; fi
rm -rf "$TA"

echo "== every hard stop can fire where it fires =="
# Three of the six had "inflight": null, so a command could walk straight past them while
# the page promised all six stop "whatever else is running".
if node -e '
const r=JSON.parse(require("fs").readFileSync("scripts/hard-stops.json","utf8"));
const bare=r.stops.filter(s=>!s.inflight||!(s.inflight.rules||[]).length).map(s=>s.id);
if(bare.length){console.error("no in-flight guard at all: "+bare.join(", "));process.exit(1)}
' 2>/dev/null; then ok "all six stops carry an in-flight guard, not just a plan scan"; else bad "a hard stop cannot fire on a command"; fi
# The two words the destructive pre-flight missed, which are the exact words the planning
# skill teaches planners to write into a phase.
HSTMP="$(mktemp -d)"
printf '### Phase 3: dedupe\nData migrations and rollback: irreversible, back up first. This cannot be undone.\n' > "$HSTMP/plan.md"
if node hooks/hard-stop.mjs --scan "$HSTMP/plan.md" --phase 3 2>/dev/null | grep -q '"id": "H-DESTROY"'; then ok "the destructive pre-flight fires on the wording the plan skill writes"; else bad "an irreversible phase passes the pre-flight clean"; fi
rm -rf "$HSTMP"

echo "== the pages and the skills say runnable things =="
# `--fast` skips the two live-session probes, which are exactly the rows the setup page
# promises are checked, so the plan the reader approves was not the plan that ran.
if grep -q -- "--fast" "$ROOT/commands/setup.md"; then
  grep -q "No \`--fast\` here" "$ROOT/commands/setup.md" && ok "setup.md only mentions --fast to explain why it is not used" || bad "setup.md step 1 still skips the session rows it says it checks"
else ok "setup.md does not skip the session rows"; fi
# $1 drops --type, which scaffolds the wrong domain overlay on the ios and agent tracks.
grep -q 'init.mjs" --entry-point <answer>.*\$ARGUMENTS' "$ROOT/commands/start.md" && ok "start.md forwards every argument, not just \$1" || bad "start.md still forwards \$1 and drops --type"
# The bootstrap proof harness assumed a framework the ADRs may not have chosen.
if grep -q "npm run dev > .claude/builder-kit/bootstrap-dev.log" "$ROOT/skills/bootstrap/SKILL.md"; then bad "bootstrap still hardcodes npm run dev in the proof harness"; else ok "bootstrap reads the run command instead of assuming it"; fi
grep -q "127\\\\.0\\\\.0\\\\.1" "$ROOT/skills/bootstrap/SKILL.md" && ok "the proof accepts 127.0.0.1, not only localhost" || bad "the proof still only greps for localhost"
# The catch-up boundary. Without it, one command on the shaping page runs the architecture,
# the design system and the plan in the same turn.
grep -q "guide-page boundary" "$ROOT/skills/build/SKILL.md" && ok "the build loop's catch-up has a stated boundary" || bad "the build catch-up runs the whole spine"
# The close manifest is what the phase-1 gate runs. Leaving it to the forked worker means
# it does not exist on the path most people take.
grep -q "phase-<N>-close.json" "$ROOT/skills/implementation-plan/SKILL.md" && ok "the plan writes each phase's close manifest at plan time" || bad "the close manifest is still only scaffolded by the fork"
# Review artefacts under the project, not wherever the browser MCP thought it was.
grep -q "docs/evidence/phase-<N>/" "$ROOT/skills/ui-review/SKILL.md" && ok "ui-review names an explicit output path per screenshot" || bad "ui-review still lets the MCP choose where frames land"
# A local-path marketplace is not re-snapshotted by `claude plugin update`, so an edit
# never reaches the installed copy and you debug a file that is not running.
grep -q "claude plugin uninstall builder-kit@jiffi-claude-plugins" "$ROOT/INSTALL.md" && ok "INSTALL.md documents the dev loop that actually applies an edit" || bad "INSTALL.md still implies `plugin update` picks up a local edit"

echo "== every command the kit names exists in the kit =="
# The defect that ended all three reader runs was a page naming a command the installed
# plugin did not have. This is the same check, pointed at everything the plugin itself
# ships: its own skills, its commands, and the guide map it hands to state.mjs.
if node -e '
const fs=require("fs"),path=require("path");
const have=new Set([
  ...fs.readdirSync("skills",{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name),
  ...fs.readdirSync("commands").filter(f=>f.endsWith(".md")).map(f=>f.replace(/\.md$/,"")),
]);
const walk=(d)=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):(e.name.endsWith(".md")?[path.join(d,e.name)]:[]));
const ghosts=new Map();
for(const f of [...walk("skills"),...walk("commands"),"INSTALL.md","README.md"]){
  for(const m of fs.readFileSync(f,"utf8").matchAll(/\/builder-kit:([a-z0-9-]+)/g)){
    if(!have.has(m[1])) ghosts.set(m[1],(ghosts.get(m[1])||new Set()).add(f));
  }
}
const map=JSON.parse(fs.readFileSync("scripts/guide-map.json","utf8"));
for(const p of (map.pages||[])){
  for(const m of String(p.command||"").matchAll(/\/builder-kit:([a-z0-9-]+)/g)){
    if(!have.has(m[1])) ghosts.set(m[1],(ghosts.get(m[1])||new Set()).add("scripts/guide-map.json"));
  }
}
if(ghosts.size){
  for(const [n,where] of ghosts) console.error(`/builder-kit:${n} does not exist, named in: ${[...where].join(", ")}`);
  process.exit(1);
}
' 2>/dev/null; then ok "no skill, command or guide-map row names a command that does not exist"; else bad "something names a /builder-kit: command the kit does not ship"; fi

echo "== hooks fail open, except the two that must not =="
assert_exit 0 "stop-gate no-ops without config" bash -c 'echo "{}" | node hooks/stop-test-gate.mjs'
# CLAUDE_PROJECT_DIR is unset on purpose: with it set, these assert against whatever
# repo the suite happens to be running inside rather than the temp dir, which is both
# non-hermetic and the easier of the two paths.
T4="$(mktemp -d)"
assert_exit 0 "session-reground silent in empty dir" env -u CLAUDE_PROJECT_DIR bash -c "cd '$T4' && node '$ROOT/hooks/session-reground.mjs'"
# Every non-blocking hook, fed rubbish, in a directory that is not a repo and not a
# project. Exit 0 on all of them or the plugin can brick a turn it has no business
# blocking. autosave is given an explicit non-repo cwd so it can never write a ref
# into the repo the suite itself lives in.
for h in git-allow hard-stop task-mirror; do
  assert_exit 0 "hook fails open on rubbish input: $h" \
    env -u CLAUDE_PROJECT_DIR bash -c "cd '$T4' && printf 'not json at all' | node '$ROOT/hooks/$h.mjs'"
  assert_exit 0 "hook fails open on an empty payload: $h" \
    env -u CLAUDE_PROJECT_DIR bash -c "cd '$T4' && printf '{}' | node '$ROOT/hooks/$h.mjs'"
done
for ev in PostToolUse SessionEnd PreCompact TaskCompleted; do
  assert_exit 0 "autosave exits 0 outside a repo on $ev" \
    env -u CLAUDE_PROJECT_DIR bash -c "cd '$T4' && node '$ROOT/hooks/autosave.mjs' --event=$ev"
done
rm -rf "$T4"
# Both PreToolUse Bash hooks answer the same tool call. If git-allow ever said
# "allow" to something hard-stop wants to ASK about, the outcome would depend on
# an undocumented precedence between two hook decisions. It must not overlap at
# all, so this drives every positive fixture in the registry through git-allow.
if node -e '
const fs=require("fs"),{spawnSync}=require("child_process");
const reg=JSON.parse(fs.readFileSync("scripts/hard-stops.json","utf8"));
const cmds=[];
for(const s of reg.stops) for(const r of (s.inflight&&s.inflight.rules)||[])
  for(const c of [r.fixture,...(r.mustMatch||[])]) if(c) cmds.push([s.id,c]);
if(cmds.length<8){console.error("only "+cmds.length+" in-flight fixtures; the registry looks empty");process.exit(1)}
const bad=[];
for(const [id,cmd] of cmds){
  const r=spawnSync("node",["hooks/git-allow.mjs"],{input:JSON.stringify({tool_name:"Bash",tool_input:{command:cmd}}),encoding:"utf8"});
  if((r.stdout||"").includes("\"permissionDecision\":\"allow\"")) bad.push(id+": "+cmd);
}
if(bad.length){console.error("git-allow allows a hard stop:\n"+bad.join("\n"));process.exit(1)}
console.error("checked "+cmds.length+" hard-stop fixtures");
' 2>/dev/null; then ok "git-allow never allows a command a hard stop asks about"; else bad "git-allow allows a command hard-stop wants to ask about"; fi
# secret-scan has no opinion about Bash, so an auto-allow here is the last thing
# between a key and the index.
for c in 'git add .env' 'git add config/prod.env' 'git add certs/server.pem' 'git add .' 'git add -A'; do
  if [ -z "$(printf '{"tool_name":"Bash","tool_input":{"command":"%s"}}' "$c" | node hooks/git-allow.mjs 2>/dev/null)" ]; then
    ok "git-allow defers: $c"
  else
    bad "git-allow auto-allowed: $c"
  fi
done

# The sub-suites. Each is standalone and exits non-zero on any failure, so one line
# here wires all of its assertions in. Their output is folded away unless they fail,
# because ~300 extra PASS lines drown the ones above.
echo "== sub-suites =="
run_suite() { # run_suite <desc> <command...>
  local desc="$1"; shift
  local log; log="$(mktemp)"
  if "$@" >"$log" 2>&1; then
    ok "$desc ($(grep -cE '^[[:space:]]*(PASS|ok)' "$log" | tr -d ' ') assertions)"
  else
    bad "$desc"
    grep -E '(FAIL|not ok|Error)' "$log" | head -12 | sed 's/^/  | /'
    tail -3 "$log" | sed 's/^/  | /'
  fi
  rm -f "$log"
}
run_suite "autosave, git-allow and repo-create"  bash "$ROOT/scripts/test/autosave.test.sh"
run_suite "state.mjs, /status and the reground"  bash "$ROOT/scripts/test/state.test.sh"
run_suite "the task store and its mirror"        bash "$ROOT/scripts/test/task-store.test.sh"
run_suite "gate.mjs rows behave"                 bash "$ROOT/scripts/test/gate.sh"

echo ""
echo "== $pass passed, $fail failed =="
[ "$fail" = 0 ]
