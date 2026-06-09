#!/bin/bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST="127.0.0.1"
PORT="${APP_PORT:-4174}"
URL="http://$HOST:$PORT"

log() {
  printf '[ait-launcher] %s\n' "$*"
}

fail() {
  printf '\n[ait-launcher] ERROR: %s\n' "$*" >&2
  exit 1
}

find_python() {
  local candidate
  for candidate in "${PYTHON:-}" python3 python; do
    [ -n "$candidate" ] || continue
    if command -v "$candidate" >/dev/null 2>&1; then
      if "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 7) else 1)' >/dev/null 2>&1; then
        command -v "$candidate"
        return 0
      fi
    fi
  done
  return 1
}

ensure_port_available() {
  if command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
      local owner
      owner="$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 { printf "%s (PID %s)", $1, $2; exit }')"
      fail "Port $PORT is already in use${owner:+ by $owner}. Stop the existing server first and relaunch."
    fi
  fi
}

wait_and_open_browser() {
  (
    for _ in $(seq 1 30); do
      if nc -z "$HOST" "$PORT" >/dev/null 2>&1; then
        open "$URL" >/dev/null 2>&1 || true
        exit 0
      fi
      sleep 1
    done
  ) &
}

PYTHON_CMD="$(find_python)" || fail "Python 3.7 or newer was not found. Install Python from https://www.python.org, then relaunch."

ensure_port_available

log "Serving AIT Procedure Runner at $URL"
log "Press Control-C to stop the server."
wait_and_open_browser

exec "$PYTHON_CMD" -m http.server "$PORT" --bind "$HOST" --directory "$REPO_ROOT"
