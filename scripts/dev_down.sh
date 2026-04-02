#!/bin/bash
set -euo pipefail

ROOT="/Users/georgewu/Documents/Ventage"
API_PID_FILE="$ROOT/.api.pid"
WEB_PID_FILE="$ROOT/.web.pid"
API_PORT=8000
WEB_PORT=3000

stop_pid_file() {
  local pid_file="$1"
  local name="$2"

  if [ ! -f "$pid_file" ]; then
    echo "$name not running (no pid file)."
    return
  fi

  local pid
  pid=$(cat "$pid_file")
  if ps -p "$pid" >/dev/null 2>&1; then
    kill "$pid" || true
    sleep 1
    if ps -p "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" || true
    fi
    echo "Stopped $name (PID $pid)"
  else
    echo "$name pid file existed but process already stopped (PID $pid)"
  fi
  rm -f "$pid_file"
}

stop_pid_file "$API_PID_FILE" "API"
stop_pid_file "$WEB_PID_FILE" "Web"

stop_port_listener() {
  local port="$1"
  local name="$2"
  local pid
  pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | head -n 1 || true)
  if [ -n "$pid" ]; then
    kill "$pid" || true
    sleep 1
    if ps -p "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" || true
    fi
    echo "Stopped $name listener on :$port (PID $pid)"
  fi
}

stop_port_listener "$API_PORT" "API"
stop_port_listener "$WEB_PORT" "Web"

echo "Stopped local dev services."
