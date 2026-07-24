#!/usr/bin/env bash
#
# Boot smoke-test for a compiled koincode binary. Catches the class of failure that only exists
# in `bun build --compile` output (assets that don't resolve out of Bun's /$bunfs/ virtual
# filesystem, etc.) — the kind typecheck/lint/dev-mode all pass but that crashes a real binary at
# startup. Spawns the binary, waits, and asserts it didn't die during startup.
#
# Usage: bin/smoke-test.sh [path-to-binary]
#   With no argument, auto-detects dist/koincode-{os}-{arch} for the current machine (matching
#   compile.ts's naming) — for local use via `bun run smoke-test` after `bun run compile:test`.
#   CI passes an explicit path per-platform.
# Exit: 0 if the binary booted (still running after the wait, or exited cleanly with code 0);
#       1 if it crashed during startup (exited non-zero) — prints its captured output.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

default_binary_path() {
  local os arch suffix
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    MINGW*|MSYS*|CYGWIN*) os="windows" ;;
    *) return 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *) return 1 ;;
  esac
  [ "$os" = "windows" ] && suffix=".exe" || suffix=""
  echo "${SCRIPT_DIR}/../dist/koincode-${os}-${arch}${suffix}"
}

BIN="${1:-}"
if [ -z "$BIN" ]; then
  BIN="$(default_binary_path)" || {
    echo "::error::smoke-test: couldn't auto-detect a binary for this platform ($(uname -s) $(uname -m)) — pass the path explicitly: smoke-test.sh <path-to-binary>"
    exit 1
  }
fi
WAIT_SECONDS="${SMOKE_WAIT_SECONDS:-15}"

if [ ! -x "$BIN" ]; then
  echo "::error::smoke-test: binary not found or not executable: $BIN"
  exit 1
fi

LOG="$(mktemp)"

# Run hermetically: an isolated HOME (fresh config/DB/PID, never touches the user's ~/.koincode)
# and a non-default port, so running this locally can't disturb a real koincode instance or its
# server on 37420. The seeded config sets `port`, which both the client (getServerPort) and the
# spawned server honour. On CI runners this isolation is harmless; locally it keeps us a good
# citizen. (On Windows, os.homedir() keys off USERPROFILE, so set that too.)
SMOKE_HOME="$(mktemp -d)"
SMOKE_PORT="${SMOKE_PORT:-39871}"
mkdir -p "$SMOKE_HOME/.koincode"
printf '{"port": %s}\n' "$SMOKE_PORT" > "$SMOKE_HOME/.koincode/config.json"

echo "Smoke-testing boot: $BIN (waiting ${WAIT_SECONDS}s, isolated HOME + port ${SMOKE_PORT})"

# No TTY in CI — opentui renders escape codes into the (non-tty) stdout and keeps running, so a
# healthy binary stays alive. A boot crash exits within a few seconds (the crash-guard's update
# check is bounded by an 8s timeout, so even the self-heal path exits well before the wait ends).
HOME="$SMOKE_HOME" USERPROFILE="$SMOKE_HOME" "$BIN" > "$LOG" 2>&1 &
PID=$!

sleep "$WAIT_SECONDS"

RESULT=0
if kill -0 "$PID" 2>/dev/null; then
  echo "OK: still running after ${WAIT_SECONDS}s — no startup crash."
  kill -TERM "$PID" 2>/dev/null || true
else
  wait "$PID"
  CODE=$?
  if [ "$CODE" -eq 0 ]; then
    echo "OK: exited cleanly (code 0) during startup — no crash."
  else
    echo "::error::koincode crashed on startup (exit ${CODE})."
    echo "----- captured output -----"
    cat "$LOG"
    echo "---------------------------"
    RESULT=1
  fi
fi

# Best-effort: reap the background server the binary spawned (on our isolated port) so it doesn't
# linger, and clean up the temp HOME.
if command -v lsof >/dev/null 2>&1; then
  # shellcheck disable=SC2046
  kill -9 $(lsof -ti "tcp:${SMOKE_PORT}" 2>/dev/null) 2>/dev/null || true
fi

rm -f "$LOG"
rm -rf "$SMOKE_HOME"
exit "$RESULT"
