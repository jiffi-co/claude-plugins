#!/usr/bin/env bash
# gate.mjs behaviour. Plain bash, no framework, same shape as run.sh. Every
# assertion here is an exit code, because that is the entire claim gate.mjs
# makes: coverage, dependency advisories, saved work and the review artefact are
# decided by the machine rather than graded by the model. Wire it into run.sh
# with one line: assert_exit 0 "gate rows behave" bash "$ROOT/scripts/test/gate.sh"
# Run on its own: bash scripts/test/gate.sh
set -uo pipefail
GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/gate.mjs"
pass=0; fail=0
ok(){ pass=$((pass+1)); echo "  ok   $1"; }
bad(){ fail=$((fail+1)); echo "  FAIL $1"; }
expect(){ # expect <code> <name> <cmd...>
  local want="$1" name="$2"; shift 2
  local out; out="$("$@" 2>&1)"; local got=$?
  if [ "$got" = "$want" ]; then ok "$name (exit $got)"; else bad "$name: wanted $want got $got"; echo "$out" | sed 's/^/       | /' | tail -8; fi
}

# says <dir> <needle> <desc> <gate args...>: assert the evidence names the reason.
# Captured, never piped: under pipefail a pipeline inherits gate.mjs's own
# non-zero exit and would report a mismatch on text that matched perfectly well.
says(){
  local dir="$1" needle="$2" desc="$3"; shift 3
  local out; out="$(cd "$dir" && node "$GATE" "$@" 2>&1)"
  case "$out" in *"$needle"*) ok "$desc";; *) bad "$desc"; echo "$out" | sed 's/^/       | /' | tail -6;; esac
}

# denies <dir> <needle> <desc> <gate args...>: the same, inverted.
denies(){
  local dir="$1" needle="$2" desc="$3"; shift 3
  local out; out="$(cd "$dir" && node "$GATE" "$@" 2>&1)"
  case "$out" in *"$needle"*) bad "$desc"; echo "$out" | sed 's/^/       | /' | tail -6;; *) ok "$desc";; esac
}

echo "== coverage =="
T="$(mktemp -d)"
mkdir -p "$T/coverage"
cat > "$T/red.mjs" <<'EOF'
process.exit(1)
EOF
cat > "$T/green.mjs" <<'EOF'
import {writeFileSync,mkdirSync} from 'node:fs'
mkdirSync('coverage',{recursive:true})
writeFileSync('coverage/coverage-summary.json', JSON.stringify({total:{lines:{pct:Number(process.env.PCT||'42')}}}))
EOF
printf '{"gate":{"coverageCommand":"node red.mjs"}}' > "$T/cfg-red.json"
mkdir -p "$T/.claude"

cp "$T/cfg-red.json" "$T/.claude/builder-kit.json"
expect 1 "red suite fails coverage" bash -c "cd '$T' && node '$GATE' coverage"
says "$T" "suite is red" "red suite names the reason" coverage

printf '{"gate":{"coverageCommand":"node green.mjs","coverageMin":80}}' > "$T/.claude/builder-kit.json"
expect 1 "42%% under an 80%% bar fails" bash -c "cd '$T' && node '$GATE' coverage"
expect 0 "42%% over a 40%% bar passes" bash -c "cd '$T' && node '$GATE' coverage --min 40"
expect 1 "--min overrides config upward" bash -c "cd '$T' && PCT=70 node '$GATE' coverage --min 90"
expect 0 "PCT=95 clears the 80 bar" bash -c "cd '$T' && PCT=95 node '$GATE' coverage"

# no report written at all
cat > "$T/silent.mjs" <<'EOF'
EOF
rm -rf "$T/coverage"
printf '{"gate":{"coverageCommand":"node silent.mjs"}}' > "$T/.claude/builder-kit.json"
expect 1 "green run with no report fails" bash -c "cd '$T' && node '$GATE' coverage"

# coverage-final.json fallback: 3 of 4 statements hit = 75%
cat > "$T/final.mjs" <<'EOF'
import {writeFileSync,mkdirSync} from 'node:fs'
mkdirSync('coverage',{recursive:true})
writeFileSync('coverage/coverage-final.json', '{"a.js":{"s":{"0":1,"1":0,"2":3}},"b.js":{"s":{"0":9}}}')
EOF
printf '{"gate":{"coverageCommand":"node final.mjs"}}' > "$T/.claude/builder-kit.json"
expect 0 "coverage-final fallback computes 75%% >= 60" bash -c "cd '$T' && node '$GATE' coverage"
expect 1 "coverage-final fallback fails an 80 bar" bash -c "cd '$T' && node '$GATE' coverage --min 80"
says "$T" "statements 75%" "fallback names the metric and number" coverage

# no command configured anywhere -> skip, exit 0
rm -f "$T/.claude/builder-kit.json"
expect 0 "no coverage command skips" bash -c "cd '$T' && node '$GATE' coverage"
says "$T" "skip" "skip is printed, not hidden" coverage
rm -rf "$T"

echo "== committed =="
G="$(mktemp -d)"
expect 0 "outside a repo, committed skips" bash -c "cd '$G' && node '$GATE' committed"
( cd "$G" && git init -q . && git config user.email t@t && git config user.name t )
expect 1 "unborn HEAD fails" bash -c "cd '$G' && node '$GATE' committed"
( cd "$G" && echo hi > a.txt )
expect 1 "dirty tree fails" bash -c "cd '$G' && node '$GATE' committed"
( cd "$G" && git add -A && git commit -qm one )
expect 1 "no upstream fails" bash -c "cd '$G' && node '$GATE' committed"
R="$(mktemp -d)"; ( cd "$R" && git init -q --bare . )
( cd "$G" && git remote add origin "$R" && git push -q -u origin HEAD >/dev/null 2>&1 )
expect 0 "clean and pushed passes" bash -c "cd '$G' && node '$GATE' committed"
( cd "$G" && echo more >> a.txt && git commit -qam two )
expect 1 "unpushed commit fails" bash -c "cd '$G' && node '$GATE' committed"
says "$G" "not yet on" "unpushed names the upstream" committed
rm -rf "$G" "$R"

echo "== ui-review =="
U="$(mktemp -d)"
expect 1 "missing ui-review artefact fails" bash -c "cd '$U' && node '$GATE' ui-review"
mkdir -p "$U/docs/checkpoints"; : > "$U/docs/checkpoints/ui-review-1.md"
expect 1 "empty ui-review artefact fails" bash -c "cd '$U' && node '$GATE' ui-review"
echo "# review" > "$U/docs/checkpoints/ui-review-1.md"
expect 0 "written ui-review artefact passes" bash -c "cd '$U' && node '$GATE' ui-review"
expect 1 "phase 2 has no artefact yet" bash -c "cd '$U' && node '$GATE' ui-review 2"
rm -rf "$U"

echo "== audit =="
A="$(mktemp -d)"
expect 0 "no package.json skips audit" bash -c "cd '$A' && node '$GATE' audit"
printf '{"name":"x","version":"1.0.0"}' > "$A/package.json"
expect 0 "no lockfile skips audit" bash -c "cd '$A' && node '$GATE' audit"
printf '{"name":"x","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"x","version":"1.0.0"}}}' > "$A/package-lock.json"
expect 0 "empty tree has no advisories" bash -c "cd '$A' && node '$GATE' audit"
# The level reaches a shell, so an unrecognised value must be refused rather than
# interpolated. Proved by effect (did the shell run it?), not by reading the message.
mkdir -p "$A/.claude"; printf '{"gate":{"auditLevel":"high; touch OWNED"}}' > "$A/.claude/builder-kit.json"
expect 1 "an audit level that is not one of npm's is refused" bash -c "cd '$A' && node '$GATE' audit"
[ -e "$A/OWNED" ] && bad "the audit level was executed as a shell command" || ok "the audit level never reached the shell"
rm -rf "$A"

echo "== the ways a gate gets talked out of failing =="
S="$(mktemp -d)"; mkdir -p "$S/.claude" "$S/coverage" "$S/docs/checkpoints"
# a stale report from a previous run must not count as this run's evidence
printf '{"total":{"lines":{"pct":99}}}' > "$S/coverage/coverage-summary.json"
printf '{"gate":{"coverageCommand":"true","coverageMin":90}}' > "$S/.claude/builder-kit.json"
expect 1 "a no-op command cannot inherit yesterday's coverage" bash -c "cd '$S' && node '$GATE' coverage"
says "$S" "predates this run" "stale report is named as stale" coverage
# a command that really writes the report passes
printf '{"gate":{"coverageCommand":"node -e \\"require(process.cwd()+\x27/w.cjs\x27)\\"","coverageMin":90}}' > "$S/.claude/builder-kit.json"
cat > "$S/w.cjs" <<'EOF'
require('fs').writeFileSync('coverage/coverage-summary.json', JSON.stringify({total:{lines:{pct:99}}}))
EOF
expect 0 "a command that writes a fresh report passes" bash -c "cd '$S' && node '$GATE' coverage"
# a config that does not parse must say so rather than silently using defaults
printf '{"gate":{ oops' > "$S/.claude/builder-kit.json"
says "$S" "not valid JSON" "unparseable config is named" coverage
# a directory is not a review artefact
rm -f "$S/.claude/builder-kit.json"
mkdir -p "$S/docs/checkpoints/ui-review-1.md"
expect 1 "a directory named like the artefact fails" bash -c "cd '$S' && node '$GATE' ui-review"
rm -rf "$S"

echo "== argument plumbing =="
# --min's value must not be mistaken for a phase number
V="$(mktemp -d)"; mkdir -p "$V/.claude" "$V/docs/checkpoints" "$V/coverage"
cat > "$V/w.cjs" <<'EOF'
require('fs').writeFileSync('coverage/coverage-summary.json', JSON.stringify({total:{lines:{pct:99}}}))
EOF
printf '{"gate":{"coverageCommand":"node w.cjs"}}' > "$V/.claude/builder-kit.json"
echo "# review" > "$V/docs/checkpoints/ui-review-1.md"
expect 0 "--min 80 does not become phase 80" bash -c "cd '$V' && node '$GATE' coverage ui-review --min 80"
denies "$V" "phase 80" "--min value stays out of the phase" ui-review --min 80
expect 0 "an explicit --phase 1 still resolves" bash -c "cd '$V' && node '$GATE' ui-review --phase 1"
expect 1 "an explicit --phase 4 has no artefact" bash -c "cd '$V' && node '$GATE' ui-review --phase 4"
# newest-by-mtime, not alphabetical
echo "# ten" > "$V/docs/checkpoints/ui-review-10.md"
says "$V" "ui-review-10.md" "picks the newest artefact, not the last alphabetically" ui-review
expect 2 "--min with no value exits 2" bash -c "cd '$V' && node '$GATE' coverage --min"
expect 2 "--phase with no value exits 2" bash -c "cd '$V' && node '$GATE' ui-review --phase"
rm -rf "$V"

echo "== plumbing =="
expect 2 "unknown flag exits 2" node "$GATE" --wat
P="$(mktemp -d)"
expect 0 "--emit-checks prints four mechanical rows" bash -c "cd '$P' && node '$GATE' --emit-checks | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d);process.stdin.on(\"end\",()=>{const j=JSON.parse(s);if(j.checks.length!==4)process.exit(1);if(j.checks.some(c=>c.kind!==\"mechanical\"))process.exit(1)})'"
expect 1 "--json on a failing row exits 1" bash -c "cd '$P' && node '$GATE' ui-review --json"
expect 0 "--json is valid JSON" bash -c "cd '$P' && node '$GATE' ui-review --json | node -e 'let s=\"\";process.stdin.on(\"data\",d=>s+=d);process.stdin.on(\"end\",()=>JSON.parse(s))'"
rm -rf "$P"

echo ""
echo "== $pass passed, $fail failed =="
[ "$fail" = 0 ]
