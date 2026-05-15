#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
WEB_PID_FILE="$RUN_DIR/web.pid"

stop_pid_file() {
  local pid_file="$1"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Stopping process $pid"
      kill "$pid" 2>/dev/null || true
      sleep 1
    fi
    rm -f "$pid_file"
  fi
}

stop_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "${pids:-}" ]]; then
    echo "Stopping stale process on port $port"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
}

stop_pid_file "$WEB_PID_FILE"
stop_port 3000

echo "GOJO Health App local web process stopped."
