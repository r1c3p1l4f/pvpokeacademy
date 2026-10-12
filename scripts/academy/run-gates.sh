#!/usr/bin/env bash
# Run the Academy's checks against the working tree, starting its own PHP server.
#
#   PLAYWRIGHT_PATH=/path/to/node_modules/ scripts/academy/run-gates.sh          # everything
#   PLAYWRIGHT_PATH=... scripts/academy/run-gates.sh --quick                    # skip the slow live-battle checks
#
# Which update each gate protects against:
#   unit tests (incl. enginereasons)  upstream rewording the engine's decision log; quiz and turn math
#   hooks.test                        a merge dropping one of the Academy's hooks in an upstream file
#   engine-check                      the turn model drifting from the simulator's
#   engine-replay-check               the stand-in battle disagreeing with the engine (blocking)
#   cups-check                        cups added or removed, a cup gaining a team rule, borrowed-ranking bans
#   mega-check                        gamemaster schema changes (supermega tag, third Charged Move)
#   pwa-check                         the service worker and install path
#   live/advice/lookahead/audit/ui/phone   the Coach, the timing panel and the quiz in a real browser
#
# Some assertions encode today's data (specific cups and Pokemon). If one fails right after a data refresh, check whether
# the data changed legitimately before assuming a bug; the tests say which names they depend on.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)"
QUICK=0
[ "${1:-}" = "--quick" ] && QUICK=1

if [ -z "${PLAYWRIGHT_PATH:-}" ]; then
	echo "Set PLAYWRIGHT_PATH to a node_modules directory that contains playwright." >&2
	exit 2
fi

DOCROOT="$(mktemp -d)"
ln -s "$PWD" "$DOCROOT/pvpoke"
PORT="${GATE_PORT:-18090}"
PHP_CLI_SERVER_WORKERS=4 php -S "127.0.0.1:$PORT" -t "$DOCROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null; rm -rf "$DOCROOT"' EXIT

for i in $(seq 1 50); do
	curl -sf -o /dev/null "http://127.0.0.1:$PORT/pvpoke/src/academy/" && break
	sleep 0.2
done

export SITE_URL="http://127.0.0.1:$PORT/pvpoke/src/"
FAILED=()

run() {
	local name="$1"; shift
	if "$@" >"/tmp/gate-$name.log" 2>&1; then
		echo "PASS  $name"
	else
		echo "FAIL  $name   (see /tmp/gate-$name.log)"
		FAILED+=("$name")
	fi
}

run unit node --test tests/academy/*.test.mjs
run engine-check node tests/academy/engine-check.mjs
run engine-replay-check node tests/academy/engine-replay-check.mjs
run cups-check node tests/academy/cups-check.mjs
run mega-check node tests/academy/mega-check.mjs
run audit-check node tests/academy/audit-check.mjs
run ui-check node tests/academy/ui-check.mjs
run phone-check node tests/academy/phone-check.mjs
run pwa-check node tests/academy/pwa-check.mjs
if [ "$QUICK" = 0 ]; then
	run review-lookahead-check node tests/academy/review-lookahead-check.mjs
	run advice-check node tests/academy/advice-check.mjs
	run live-check node tests/academy/live-check.mjs
fi

echo
if [ ${#FAILED[@]} -eq 0 ]; then
	echo "All gates passed."
else
	echo "Failed: ${FAILED[*]}"
	exit 1
fi
