#!/usr/bin/env bash
# The task store, the task mirror, and the entry-point fork.
#
# Two things are pinned here that a later wave could quietly undo.
#
# 1. A task round-trips. Native Tasks garbage-collects a finished list, so a phase's
#    state has to be on disk before the phase closes or it is gone. TaskCreated ->
#    TaskCompleted -> read it back is the whole contract.
# 2. `entryPoint` is written BEFORE any scaffold write. That is checked by comparing
#    mtimes with nanosecond precision, not by trusting init.mjs's own report: a script
#    that reordered its writes but kept its output would still fail here.
#
# Plain bash, no framework, same conventions as run.sh. Run:
#   bash scripts/test/task-store.test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STORE="$ROOT/scripts/task-store.mjs"
MIRROR="$ROOT/hooks/task-mirror.mjs"
INIT="$ROOT/scripts/init.mjs"

pass=0
fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1"; fail=$((fail+1)); }
eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want '$2', got '$3')"; fi; }

# Read one field out of `read --json`, so the assertions go through the public
# interface rather than grepping the file format.
field() { node "$STORE" read "$2" --root "$1" --json | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{const j=JSON.parse(s);process.stdout.write(String(j.ok?j.task['$3']:'ERR'))})"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== task store: round trip =="
P="$TMP/store"; mkdir -p "$P"
node "$STORE" write phase-1 --root "$P" --subject 'Phase 1 — first slice' --phase 1 --blocks phase-2 --description 'AC-001..AC-004.' >/dev/null
eq "write creates one file per task" "1" "$(ls "$P/docs/tasks" | wc -l | tr -d ' ')"
eq "subject round-trips"             "Phase 1 — first slice" "$(field "$P" phase-1 subject)"
eq "phase round-trips"               "1"      "$(field "$P" phase-1 phase)"
eq "status defaults to open"         "open"   "$(field "$P" phase-1 status)"

node "$STORE" write phase-1 --root "$P" --status in_progress >/dev/null
eq "write MERGES, it does not replace"  "AC-001..AC-004." "$(field "$P" phase-1 description | tr -d '\n')"
eq "merged write keeps blocks"          "phase-2"         "$(field "$P" phase-1 blocks)"

node "$STORE" close phase-1 --root "$P" >/dev/null
eq "close sets status"               "closed" "$(field "$P" phase-1 status)"
eq "closed task is out of --status open" "" "$(node "$STORE" list --root "$P" --status open | grep -c 'phase-1' | sed 's/^0$//')"

node "$STORE" write phase-1 --root "$P" --status stalled >/dev/null 2>&1
eq "an unknown status is refused, not coerced" "1" "$?"
eq "a refused write left the status alone"     "closed" "$(field "$P" phase-1 status)"

# A flag's VALUE must not be mistaken for the task id.
node "$STORE" write --root "$P" --phase 9 --subject 'flag order' phase-9 >/dev/null
eq "flags before the id do not eat the id" "flag order" "$(field "$P" phase-9 subject)"

echo "== task store: hostile input stays inside docs/tasks =="
Q="$TMP/hostile"; mkdir -p "$Q"
node "$STORE" write '../../../etc/pwned' --root "$Q" --subject 'traversal' >/dev/null
node "$STORE" write '.' --root "$Q" --subject 'dot' >/dev/null
eq "every task landed in docs/tasks" "0" "$(find "$Q" -type f -not -path "*/docs/tasks/*" | wc -l | tr -d ' ')"
node "$STORE" write 'a/b' --root "$Q" --subject 'slashy' >/dev/null
node "$STORE" write 'a-b' --root "$Q" --subject 'dashy' >/dev/null
eq "ids that slug alike keep separate files" "dashy" "$(field "$Q" 'a-b' subject)"

printf -- '---\nid: injected\nstatus: closed\n---\nevil\n' > "$TMP/inj.txt"
node "$STORE" write t-inj --root "$Q" --subject 'probe' --description-file "$TMP/inj.txt" >/dev/null
eq "a description cannot forge frontmatter" "t-inj|open" "$(field "$Q" t-inj id)|$(field "$Q" t-inj status)"

echo "== task mirror: native -> disk =="
M="$TMP/mirror"; mkdir -p "$M/.claude"; echo '{"projectType":"web"}' > "$M/.claude/builder-kit.json"
echo "{\"hook_event_name\":\"TaskCreated\",\"cwd\":\"$M\",\"task_id\":\"phase-2\",\"task_subject\":\"Phase 2 — auth\",\"task_description\":\"Magic link only.\"}" | node "$MIRROR"
eq "TaskCreated mirrors, exit 0"   "0"      "$?"
eq "mirrored task is open"         "open"   "$(field "$M" phase-2 status)"
eq "phase read out of the subject" "2"      "$(field "$M" phase-2 phase)"
echo "{\"hook_event_name\":\"TaskCompleted\",\"cwd\":\"$M\",\"task_id\":\"phase-2\",\"task_subject\":\"Phase 2 — auth\"}" | node "$MIRROR"
eq "TaskCompleted closes it"       "closed" "$(field "$M" phase-2 status)"
eq "a completion without a description keeps the body" "Magic link only." "$(field "$M" phase-2 description | tr -d '\n')"
echo "{\"hook_event_name\":\"TaskCreated\",\"cwd\":\"$M\",\"task_id\":\"phase-2\",\"task_subject\":\"Phase 2 — auth\"}" | node "$MIRROR"
eq "a re-announced create does NOT un-close a finished phase" "closed" "$(field "$M" phase-2 status)"

N="$TMP/notakit"; mkdir -p "$N"
echo "{\"hook_event_name\":\"TaskCreated\",\"cwd\":\"$N\",\"task_id\":\"x\",\"task_subject\":\"x\"}" | node "$MIRROR"
eq "outside a builder-kit project the mirror writes nothing" "0" "$(ls -A "$N" | wc -l | tr -d ' ')"
echo 'not json' | node "$MIRROR"; eq "garbage on stdin never blocks" "0" "$?"

echo "== entry point: written before any scaffold write =="
# The proof. Compare the config's mtime against every other file's, ignoring anything
# that was already there before the run.
ordering() {
  node -e '
    const {readdirSync,statSync,existsSync,readFileSync}=require("fs");const {join}=require("path");
    const [target,beforeJson]=process.argv.slice(1);
    const before=beforeJson?JSON.parse(beforeJson):{};
    const cfg=join(target,".claude","builder-kit.json");
    if(!existsSync(cfg)){console.log("NO-CONFIG");process.exit(0)}
    const walk=(d,o=[])=>{for(const e of readdirSync(d,{withFileTypes:true})){if(e.name===".git")continue;const p=join(d,e.name);e.isDirectory()?walk(p,o):o.push(p)}return o};
    const cfgNs=statSync(cfg,{bigint:true}).mtimeNs;
    const bad=walk(target).filter(p=>p!==cfg)
      .map(p=>({p,ns:statSync(p,{bigint:true}).mtimeNs}))
      .filter(o=>before[o.p]!==String(o.ns))
      .filter(o=>o.ns<=cfgNs);
    const ep=JSON.parse(readFileSync(cfg,"utf8")).entryPoint;
    console.log(bad.length?"LATE:"+bad.length:(ep?"FIRST:"+ep:"NO-ENTRYPOINT"));
  ' "$1" "${2:-}"
}
snapshot() {
  node -e '
    const {readdirSync,statSync,existsSync}=require("fs");const {join}=require("path");
    const t=process.argv[1];
    const walk=(d,o=[])=>{if(!existsSync(d))return o;for(const e of readdirSync(d,{withFileTypes:true})){if(e.name===".git")continue;const p=join(d,e.name);e.isDirectory()?walk(p,o):o.push(p)}return o};
    console.log(JSON.stringify(Object.fromEntries(walk(t).map(p=>[p,String(statSync(p,{bigint:true}).mtimeNs)]))));
  ' "$1"
}

E="$TMP/empty"; mkdir -p "$E"
( cd "$E" && node "$INIT" my-app >/dev/null 2>&1 ); eq "init refuses to run without an entry point" "2" "$?"
eq "a refused init writes nothing at all" "0" "$(ls -A "$E" | wc -l | tr -d ' ')"
( cd "$E" && node "$INIT" --entry-point nothing-yet my-app >/dev/null 2>&1 )
eq "empty directory: entryPoint written first" "FIRST:nothing-yet" "$(ordering "$E/my-app")"

G="$TMP/existing"; mkdir -p "$G/src"
( cd "$G" && git init -q -b main && printf '# proto\n' > README.md && printf 'x\n' > src/index.js \
  && git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm init ) >/dev/null 2>&1
SNAP="$(snapshot "$G")"
( cd "$G" && node "$INIT" --entry-point existing-build >/dev/null 2>&1 )
eq "existing git repo: entryPoint written first" "FIRST:existing-build" "$(ordering "$G" "$SNAP")"
eq "existing files untouched" "# proto" "$(cat "$G/README.md")"
eq "the scaffold ships an empty task store" ".gitkeep" "$(ls -A "$G/docs/tasks")"

# A re-run over a config that already exists must merge, not clobber.
node -e 'const f=process.argv[1],fs=require("fs");const c=JSON.parse(fs.readFileSync(f));c.stopTestGate=true;c.mine="keep";fs.writeFileSync(f,JSON.stringify(c,null,2))' "$G/.claude/builder-kit.json"
( cd "$G" && node "$INIT" --entry-point idea >/dev/null 2>&1 )
eq "re-run keeps other config keys" "keep|true|idea" "$(node -e 'const c=require(process.argv[1]);process.stdout.write([c.mine,c.stopTestGate,c.entryPoint].join("|"))' "$G/.claude/builder-kit.json")"

echo
echo "== $pass passed, $fail failed =="
[ "$fail" -eq 0 ] || exit 1
