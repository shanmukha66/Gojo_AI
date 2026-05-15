#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT/web"
RUN_DIR="$ROOT/.run"
LOG_DIR="$RUN_DIR/logs"
WEB_PID_FILE="$RUN_DIR/web.pid"

WEB_PORT="3000"
NEO4J_HOST="127.0.0.1"
NEO4J_PORT="7687"
REQUIRE_NEO4J="${REQUIRE_NEO4J:-0}"

mkdir -p "$LOG_DIR"

kill_if_running() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

kill_port_if_busy() {
  local port="$1"
  local pids
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "${pids:-}" ]]; then
    echo "Cleaning stale process on port $port"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

wait_for_port() {
  local host="$1"
  local port="$2"
  local label="$3"
  for _ in {1..30}; do
    if nc -z "$host" "$port" 2>/dev/null; then
      echo "$label is up on $host:$port"
      return 0
    fi
    sleep 1
  done
  echo "Failed to start $label on $host:$port"
  return 1
}

echo "Starting GOJO Health App locally"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not installed or not on PATH"
  exit 1
fi

if command -v neo4j >/dev/null 2>&1; then
  echo "Ensuring Neo4j is running..."
  neo4j start >/dev/null 2>&1 || true
  if ! wait_for_port "$NEO4J_HOST" "$NEO4J_PORT" "Neo4j"; then
    if [[ "$REQUIRE_NEO4J" == "1" ]]; then
      exit 1
    fi
    echo "Continuing without Neo4j. SQL-backed demo pages will still run."
  fi
else
  if [[ "$REQUIRE_NEO4J" == "1" ]]; then
    echo "neo4j CLI is not installed or not on PATH"
    exit 1
  fi
  echo "neo4j CLI is not installed or not on PATH; continuing without Neo4j."
fi

kill_if_running "$WEB_PID_FILE"
kill_port_if_busy "$WEB_PORT"
rm -f "$WEB_DIR/.next/dev/lock"

echo "Starting web app..."
nohup bash -lc 'cd "$1" && npm run dev -- --hostname 127.0.0.1 --port "$2"' bash "$WEB_DIR" "$WEB_PORT" >"$LOG_DIR/web.log" 2>&1 &
echo $! >"$WEB_PID_FILE"
wait_for_port "127.0.0.1" "$WEB_PORT" "Web app"

cat <<EOF

GOJO Health App is running.

Web:  http://127.0.0.1:${WEB_PORT}
Neo4j bolt: bolt://127.0.0.1:${NEO4J_PORT}

External sentence-transformer retrieval server is disabled.
Doctor evidence search now uses local SQL + Neo4j text retrieval inside the Next app.

Logs:
- $LOG_DIR/web.log

To stop everything:
  $ROOT/scripts/stop_gojo_local.sh

EOF
