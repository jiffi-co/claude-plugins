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
for f in .claude-plugin/plugin.json hooks/hooks.json .mcp.json scripts/checkpoint-manifest.json templates/project/.claude/settings.json templates/project/docs/checkpoints/checkpoint.json; do
  if node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" >/dev/null 2>&1; then ok "valid JSON: $f"; else bad "invalid JSON: $f"; fi
done

echo "== scripts syntax =="
for f in hooks/secret-scan.mjs hooks/session-reground.mjs hooks/stop-test-gate.mjs scripts/checkpoint.mjs scripts/doctor.mjs scripts/init.mjs; do
  if node --check "$f" >/dev/null 2>&1; then ok "syntax: $f"; else bad "syntax: $f"; fi
done

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

echo "== doctor behaviour =="
assert_exit 0 "doctor --json runs and exits per core" bash -c "node '$ROOT/scripts/doctor.mjs' --json | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d);process.stdin.on(\"end\",()=>{JSON.parse(s)})'"

echo "== init behaviour =="
T3="$(mktemp -d)"
( cd "$T3" && node "$ROOT/scripts/init.mjs" my-app >/dev/null 2>&1 )
[ -f "$T3/my-app/CLAUDE.md" ] && [ -f "$T3/my-app/.claude/settings.json" ] && [ -f "$T3/my-app/docs/checkpoints/checkpoint.json" ] && ok "init scaffolds the expected files" || bad "init missing scaffolded files"
grep -q "Project: my-app" "$T3/my-app/CLAUDE.md" && ok "init substitutes {{PROJECT_NAME}}" || bad "init did not substitute the name"
assert_exit 1 "init refuses a non-empty new dir" bash -c "cd '$T3' && node '$ROOT/scripts/init.mjs' my-app"
rm -rf "$T3"

echo "== stop-gate + session-reground fail open =="
assert_exit 0 "stop-gate no-ops without config" bash -c 'echo "{}" | node hooks/stop-test-gate.mjs'
T4="$(mktemp -d)"; assert_exit 0 "session-reground silent in empty dir" bash -c "cd '$T4' && node '$ROOT/hooks/session-reground.mjs'"; rm -rf "$T4"

echo ""
echo "== $pass passed, $fail failed =="
[ "$fail" = 0 ]
