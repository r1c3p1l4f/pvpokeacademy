#!/usr/bin/env bash
# Take upstream (pvpoke/pvpoke) changes into this branch as a real merge, so data and code updates both work and the
# merge base keeps moving (a copy-style sync would leave the base stale, and the next merge would then conflict on every
# ranking file that changed again: they are single-line JSON).
#
# What it does:
#   1. fetches upstream, refuses to start on a dirty tree
#   2. merges upstream/master (--no-commit, so you can look first)
#   3. src/data is upstream's, so any conflict there is resolved with upstream's version (and upstream's deletions)
#   4. bumps the Academy cache version (src/academy/version.txt)
#   5. reports which upstream code files changed and which of them hold an Academy hook (tests/academy/hooks.json)
#   6. if nothing else conflicts, commits; otherwise leaves the merge open for you to resolve (re-apply the hook, git add)
#
#   scripts/academy/update-from-upstream.sh --check   # dry run: what would change, what would conflict; touches nothing
#   scripts/academy/update-from-upstream.sh           # do it
#   then: PLAYWRIGHT_PATH=... scripts/academy/run-gates.sh, upload, purge the host's cache.
#
#   UPSTREAM_REF=some/ref NO_FETCH=1 ...  use a ref you already have (for rehearsals)
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REF="${UPSTREAM_REF:-upstream/master}"
CHECK=0
for arg in "$@"; do
	case "$arg" in
		--check) CHECK=1 ;;
		*) echo "unknown option $arg" >&2; exit 2 ;;
	esac
done

if [ -z "${NO_FETCH:-}" ]; then
	git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/pvpoke/pvpoke
	GIT_LFS_SKIP_SMUDGE=1 git fetch upstream master
fi

git rev-parse --verify -q "$REF" >/dev/null || { echo "no such ref: $REF" >&2; exit 1; }

BASE="$(git merge-base HEAD "$REF")"
AHEAD="$(git rev-list --count "$BASE..$REF")"

echo "upstream ref:   $REF ($(git log -1 --format='%h %ad %s' --date=short "$REF"))"
echo "common ancestor: $(git log -1 --format='%h %ad' --date=short "$BASE")  -  upstream is $AHEAD commits ahead"

if [ "$AHEAD" = 0 ]; then
	echo "Already up to date with upstream."
	exit 0
fi

CODE_FILES="$(git diff --name-only "$BASE" "$REF" -- . ':!src/data')"
DATA_COUNT="$(git diff --name-only "$BASE" "$REF" -- src/data | wc -l | tr -d ' ')"
CODE_COUNT="$(printf '%s' "$CODE_FILES" | grep -c . || true)"
HOOK_FILES="$(grep -o '"file": "[^"]*"' tests/academy/hooks.json | sed 's/"file": "//; s/"$//')"
HOOKS_HIT="$(comm -12 <(printf '%s\n' "$CODE_FILES" | sort) <(printf '%s\n' "$HOOK_FILES" | sort))"

echo "upstream changed $DATA_COUNT data files and $CODE_COUNT other files since the ancestor"
if [ -n "$HOOKS_HIT" ]; then
	echo "files with an Academy hook that upstream also changed (review these in the merge):"
	printf '  %s\n' $HOOKS_HIT
else
	echo "none of the files with an Academy hook changed upstream."
fi

# Dry run: ask git what would conflict without touching the working tree
if [ "$CHECK" = 1 ]; then
	if OUT="$(git merge-tree --write-tree --name-only HEAD "$REF" 2>&1)"; then
		echo "A merge would apply cleanly."
	else
		CONFLICTS="$(printf '%s\n' "$OUT" | sed -n '2,/^$/p' | grep -v '^$' || true)"
		DATA_CONFLICTS="$(printf '%s\n' "$CONFLICTS" | grep -c '^src/data/' || true)"
		OTHER="$(printf '%s\n' "$CONFLICTS" | grep -v '^src/data/' || true)"
		echo "A merge would conflict in $(printf '%s\n' "$CONFLICTS" | grep -c . || true) files: $DATA_CONFLICTS in src/data (the script resolves those with upstream's version), and:"
		if [ -n "$OTHER" ]; then printf '  %s\n' $OTHER; else echo "  no others."; fi
	fi
	exit 0
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
	echo "Working tree has uncommitted changes. Commit or stash them first." >&2
	exit 1
fi

set +e
git merge --no-commit --no-ff "$REF" >/dev/null 2>&1
set -e

# src/data belongs to upstream: take upstream's side of every conflict there
git diff --name-only --diff-filter=U -- src/data | while read -r f; do
	if git cat-file -e "$REF:$f" 2>/dev/null; then
		git checkout "$REF" -- "$f"
	else
		git rm -q -f -- "$f"
	fi
done

# New version for every ?v= URL
V="$(tr -dc '0-9' < src/academy/version.txt || true)"
echo "$(( ${V:-0} + 1 ))" > src/academy/version.txt
git add src/academy/version.txt

REMAINING="$(git diff --name-only --diff-filter=U)"
if [ -n "$REMAINING" ]; then
	echo
	echo "The merge is open. These files conflict and need you (files with hooks are listed in tests/academy/hooks.json):"
	printf '  %s\n' $REMAINING
	echo "Resolve them, git add each, run scripts/academy/run-gates.sh, then git commit."
	exit 4
fi

git commit -q -m "Merge upstream $(git rev-parse --short "$REF"); Academy cache version $(cat src/academy/version.txt)"
echo
echo "Merged and committed. Academy cache version is now $(cat src/academy/version.txt)."
echo "Next: scripts/academy/run-gates.sh, upload, then purge the host's cache."
