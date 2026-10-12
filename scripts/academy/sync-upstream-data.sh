#!/usr/bin/env bash
# Refresh src/data from upstream (pvpoke/pvpoke) without touching anything the Academy owns.
#
# src/data is 100% upstream's (the Academy keeps nothing there), so this restores that whole tree to match upstream,
# including files upstream deleted, then bumps the Academy-owned cache version in src/academy/version.txt so the PWA and the
# browser fetch the new data. It stages the result; it never commits or pushes.
#
# A data refresh is only safe when upstream's code has not changed in the same range, because new data can need new code
# (a new tag, a new field). If upstream also changed code, the script stops and tells you to do a full merge instead.
#
#   scripts/academy/sync-upstream-data.sh            # refresh, then run scripts/academy/run-gates.sh
#   scripts/academy/sync-upstream-data.sh --check    # report what would change, touch nothing
#   UPSTREAM_REF=other/ref NO_FETCH=1 ...            # use a ref you already have (used by the tests of this script)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REF="${UPSTREAM_REF:-upstream/master}"
CHECK=0
FORCE=0
for arg in "$@"; do
	case "$arg" in
		--check) CHECK=1 ;;
		--force) FORCE=1 ;;
		*) echo "unknown option $arg" >&2; exit 2 ;;
	esac
done

if [ -z "${NO_FETCH:-}" ]; then
	git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/pvpoke/pvpoke
	GIT_LFS_SKIP_SMUDGE=1 git fetch upstream master
fi

git rev-parse --verify -q "$REF" >/dev/null || { echo "no such ref: $REF" >&2; exit 1; }

if [ "$CHECK" = 0 ] && ! git diff --quiet -- src/data; then
	echo "src/data has uncommitted changes. Commit or discard them first." >&2
	exit 1
fi

BASE="$(git merge-base HEAD "$REF")"
CODE_CHANGED="$(git diff --name-only "$BASE" "$REF" -- . ':!src/data' | wc -l | tr -d ' ')"
DATA_CHANGED="$(git diff --name-only HEAD "$REF" -- src/data | wc -l | tr -d ' ')"
DATA_REMOVED="$(git diff --name-only --diff-filter=D HEAD "$REF" -- src/data | wc -l | tr -d ' ')"

echo "upstream ref:             $REF ($(git log -1 --format='%h %ad %s' --date=short "$REF"))"
echo "common ancestor:          $(git log -1 --format='%h %ad' --date=short "$BASE")"
echo "src/data files that differ from upstream: $DATA_CHANGED (of which upstream deleted: $DATA_REMOVED)"
echo "upstream code files changed since the ancestor: $CODE_CHANGED"

if [ "$CODE_CHANGED" != 0 ] && [ "$FORCE" = 0 ]; then
	echo
	echo "Upstream changed code as well as data. A data-only refresh could leave new data running on old code."
	echo "Do a full merge instead (see README: 'Updating from upstream'), or pass --force to refresh data anyway."
	[ "$CHECK" = 1 ] && exit 0
	exit 3
fi

if [ "$CHECK" = 1 ]; then
	exit 0
fi

if [ "$DATA_CHANGED" = 0 ]; then
	echo "src/data already matches upstream. Nothing to do."
	exit 0
fi

# Remove files upstream deleted (the Academy cup menu looks for ranking files, so a stale one would leave a dead cup on it)
git diff --name-only --diff-filter=D HEAD "$REF" -- src/data | while read -r f; do git rm -q --cached -- "$f"; rm -f -- "$f"; done

# Restore the rest of the tree from upstream, adding new files and overwriting changed ones
git checkout "$REF" -- src/data

# Anything still in src/data that upstream does not have is not ours to keep
EXTRA="$(comm -23 <(git ls-files src/data | sort) <(git ls-tree -r --name-only "$REF" src/data | sort))"
if [ -n "$EXTRA" ]; then
	echo "Files in src/data that upstream does not have (left alone, review them):"
	echo "$EXTRA"
fi

# New version for every ?v= URL
V="$(tr -dc '0-9' < src/academy/version.txt || true)"
echo "$(( ${V:-0} + 1 ))" > src/academy/version.txt
git add src/academy/version.txt

echo
echo "Staged. Academy cache version is now $(cat src/academy/version.txt)."
echo "Next: scripts/academy/run-gates.sh, review, then commit. On the server: upload, then purge the host's cache."
