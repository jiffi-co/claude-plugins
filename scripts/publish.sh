#!/usr/bin/env bash
# Guarded marketplace publish for builder-kit.
#
# Publishes builder-kit/ from this repo to the public marketplace repo
# (jiffi-co/claude-plugins), which is what learners add. It exists to prevent the
# footgun that once emptied the public repo: running `git archive` from the wrong
# directory extracts nothing, and a following `git add -A` deletes everything.
# This script archives from a known-good HEAD:builder-kit, refuses an empty or
# tiny tree, and requires the validation suite to pass before it pushes.
#
# Usage:
#   bash builder-kit/scripts/publish.sh "builder-kit X.Y.Z: <what changed>"
#   bash builder-kit/scripts/publish.sh --dry-run     # every guard, no commit, no push
#
# Bump builder-kit/plugins/builder-kit/VERSION and commit it first. The manifests
# deliberately omit a version so installers always get latest.
#
# Env overrides (optional):
#   PUBLIC_REPO   git URL of the marketplace repo (default: jiffi-co/claude-plugins)
#   PUB           path to an existing clone to reuse (default: a fresh temp clone)
set -euo pipefail

# --dry-run runs every guard (archive, file count, VERSION, validation) and stops
# before the commit. It takes no message because it writes nothing.
DRY=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY=1; MSG="(dry run)"
else
  MSG="${1:?commit message required, e.g. \"builder-kit 0.6.1: fix the doctor table\"}"
fi
PUBLIC_REPO="${PUBLIC_REPO:-https://github.com/jiffi-co/claude-plugins.git}"

# HUB = the repo this script lives in. builder-kit/scripts/publish.sh -> ../.. = repo root.
HUB="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HUB"
git rev-parse HEAD:builder-kit >/dev/null 2>&1 || {
  echo "ABORT: HEAD:builder-kit does not resolve. Run from the jiffi-ai-hub repo, and commit builder-kit/ first."; exit 1;
}

# PUB = a clone of the public repo. Reuse $PUB if given and valid, else fresh-clone to a temp dir.
CLEANUP=""
if [ -n "${PUB:-}" ] && [ -d "$PUB/.git" ]; then
  git -C "$PUB" fetch -q origin && git -C "$PUB" reset -q --hard origin/main
else
  PUB="$(mktemp -d)/claude-plugins-pub"
  CLEANUP="$(dirname "$PUB")"
  echo "Cloning $PUBLIC_REPO ..."
  git clone -q "$PUBLIC_REPO" "$PUB"
fi

# Clear the clone (keep .git), then extract builder-kit/ from the HUB's committed tree.
find "$PUB" -mindepth 1 -not -path "$PUB/.git" -not -path "$PUB/.git/*" -delete
git -C "$HUB" archive HEAD:builder-kit | tar -x -C "$PUB"

# GUARD: refuse to publish an empty or suspiciously small tree.
N=$(find "$PUB" -type f -not -path "$PUB/.git/*" | wc -l | tr -d ' ')
[ "$N" -ge 40 ] || { echo "ABORT: only $N files extracted, expected >=40. Not publishing."; exit 1; }
[ -f "$PUB/plugins/builder-kit/VERSION" ] || { echo "ABORT: no VERSION file. Not publishing."; exit 1; }
VER="$(cat "$PUB/plugins/builder-kit/VERSION")"

# GUARD: the artifact must pass its own suite before we push.
LOG=/tmp/bk-publish-validate.log
bash "$PUB/plugins/builder-kit/scripts/test/run.sh" >"$LOG" 2>&1 \
  || { echo "ABORT: validation failed"; tail -8 "$LOG"; exit 1; }

# Read the two counts out of the summary line rather than pinning a total. The suite
# gains assertions every wave, and a literal "29 passed" turns each addition into a
# broken publish. The floor stays, so a suite that quietly shrinks still aborts.
MIN_CHECKS=36   # the count at 0.6.1; raise it deliberately, never lower it to go green
PASSED="$(sed -n 's/^== \([0-9][0-9]*\) passed, [0-9][0-9]* failed ==$/\1/p' "$LOG" | tail -1)"
FAILED="$(sed -n 's/^== [0-9][0-9]* passed, \([0-9][0-9]*\) failed ==$/\1/p' "$LOG" | tail -1)"
case "${PASSED:-x}${FAILED:-x}" in
  ''|*[!0-9]*) echo "ABORT: no validation summary in $LOG. Did run.sh change its output?"; tail -8 "$LOG"; exit 1;;
esac
[ "$FAILED" -eq 0 ] || { echo "ABORT: validation not green ($PASSED passed, $FAILED failed; see $LOG)"; exit 1; }
[ "$PASSED" -ge "$MIN_CHECKS" ] || { echo "ABORT: only $PASSED checks ran, expected at least $MIN_CHECKS (see $LOG)"; exit 1; }

if [ "$DRY" = 1 ]; then
  echo "DRY RUN OK: $N files, VERSION $VER, $PASSED passed / $FAILED failed. Nothing committed, nothing pushed."
  if [ -n "$CLEANUP" ]; then rm -rf "$CLEANUP"; fi
  exit 0
fi

cd "$PUB"
if [ -z "$(git status --porcelain)" ]; then
  echo "Nothing to publish: the public repo already matches builder-kit/ at $VER."
  if [ -n "$CLEANUP" ]; then rm -rf "$CLEANUP"; fi
  exit 0
fi

git add -A
git commit -q -m "$MSG"
git push origin HEAD:main
echo "PUBLISHED: $N files, VERSION $VER, validation green -> jiffi-co/claude-plugins"
if [ -n "$CLEANUP" ]; then rm -rf "$CLEANUP"; fi
