#!/usr/bin/env bash
# Upload src/ to the server over SSH, leaving out developer tools (deploy-excludes.txt) and never deleting anything there,
# so the server's untracked config.local.php survives every upload.
#
#   SSH_USER=u123-abcdef SSH_HOST=ssh.example.com SSH_PORT=18765 REMOTE_DIR='www/example.com/public_html/' \
#     scripts/academy/deploy-rsync.sh          # dry run: lists what would be sent
#   ... scripts/academy/deploy-rsync.sh --go   # really send it
#
# Remember: bump src/academy/version.txt first (the update script does it for merges), and purge the host's cache after.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

: "${SSH_USER:?set SSH_USER}"
: "${SSH_HOST:?set SSH_HOST}"
: "${REMOTE_DIR:?set REMOTE_DIR (the folder the site is served from, ending in /)}"
SSH_PORT="${SSH_PORT:-22}"

MODE="-n"
[ "${1:-}" = "--go" ] && MODE=""

# No --delete: a mirror that deletes would remove config.local.php (and anything else only the server has)
rsync -avz $MODE --itemize-changes \
	--exclude-from=scripts/academy/deploy-excludes.txt \
	-e "ssh -p $SSH_PORT" \
	src/ "$SSH_USER@$SSH_HOST:$REMOTE_DIR"

if [ -n "$MODE" ]; then
	echo
	echo "Dry run only. Run again with --go to upload."
else
	echo
	echo "Uploaded. Now purge the host's cache (SiteGround: Site Tools > Speed > Caching) and open the site in a private window."
fi
