#!/bin/bash
set -euo pipefail

ROOT="/Users/georgewu/Documents/Ventage"
API_PID_FILE="$ROOT/.api.pid"
WEB_PID_FILE="$ROOT/.web.pid"
API_LOG="$ROOT/.api.log"
WEB_LOG="$ROOT/.web.log"
API_URL="http://127.0.0.1:8000/healthz"
WEB_URL="http://127.0.0.1:3000/dashboard"
API_PORT=8000
WEB_PORT=3000

is_running() {
  local pid="$1"
  ps -p "$pid" >/dev/null 2>&1
}

pid_on_port() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | head -n 1
}

cleanup_stale_pid() {
  local pid_file="$1"
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if ! is_running "$pid"; then
      rm -f "$pid_file"
    fi
  fi
}

wait_http_ok() {
  local url="$1"
  local name="$2"
  local retries=20
  local i
  for i in $(seq 1 "$retries"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name health check passed: $url"
      return 0
    fi
    sleep 1
  done

  echo "$name health check failed: $url"
  return 1
}

sync_pid_with_port() {
  local pid_file="$1"
  local port="$2"
  local name="$3"
  local port_pid
  port_pid=$(pid_on_port "$port" || true)

  if [ -n "$port_pid" ]; then
    echo "$port_pid" > "$pid_file"
    echo "$name already listening on :$port (PID $port_pid)"
    return 0
  fi
  return 1
}

check_frontend_env() {
  local env_file="$ROOT/.env"
  if [ ! -f "$env_file" ]; then
    echo "Warning: $env_file not found. Frontend may not know API base URL."
    return
  fi

  local configured
  configured=$(grep -E '^NEXT_PUBLIC_API_BASE_URL=' "$env_file" | tail -n 1 | cut -d'=' -f2- || true)
  if [ -z "$configured" ]; then
    echo "Warning: NEXT_PUBLIC_API_BASE_URL is not set in .env (recommended: http://127.0.0.1:8000)."
  elif [ "$configured" != "http://127.0.0.1:8000" ] && [ "$configured" != "http://localhost:8000" ]; then
    echo "Warning: NEXT_PUBLIC_API_BASE_URL=$configured (expected local API URL for demo)."
  fi
}

start_api() {
  if [ -f "$API_PID_FILE" ] && is_running "$(cat "$API_PID_FILE")"; then
    echo "API already running (PID $(cat "$API_PID_FILE"))"
    return
  fi
  if sync_pid_with_port "$API_PID_FILE" "$API_PORT" "API"; then
    return
  fi

  cd "$ROOT/python"
  nohup python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000 >"$API_LOG" 2>&1 &
  echo $! > "$API_PID_FILE"
  sleep 1
  if ! is_running "$(cat "$API_PID_FILE")"; then
    echo "Failed to start API process. Check log: $API_LOG"
    return 1
  fi
  echo "Started API (PID $(cat "$API_PID_FILE"))"
}

start_web() {
  if [ -f "$WEB_PID_FILE" ] && is_running "$(cat "$WEB_PID_FILE")"; then
    echo "Web already running (PID $(cat "$WEB_PID_FILE"))"
    return
  fi
  if sync_pid_with_port "$WEB_PID_FILE" "$WEB_PORT" "Web"; then
    return
  fi

  cd "$ROOT"
  nohup npm run dev -- -H 0.0.0.0 -p 3000 >"$WEB_LOG" 2>&1 &
  echo $! > "$WEB_PID_FILE"
  sleep 1
  if ! is_running "$(cat "$WEB_PID_FILE")"; then
    echo "Failed to start Web process. Check log: $WEB_LOG"
    return 1
  fi
  echo "Started Web (PID $(cat "$WEB_PID_FILE"))"
}

cleanup_stale_pid "$API_PID_FILE"
cleanup_stale_pid "$WEB_PID_FILE"
check_frontend_env

start_api
start_web

api_ok=true
web_ok=true

if ! wait_http_ok "$API_URL" "API"; then
  api_ok=false
fi
if ! wait_http_ok "$WEB_URL" "Web"; then
  web_ok=false
fi

# Normalize pid files to the actual listeners (npm may spawn child process for Next.js).
sync_pid_with_port "$API_PID_FILE" "$API_PORT" "API" >/dev/null || true
sync_pid_with_port "$WEB_PID_FILE" "$WEB_PORT" "Web" >/dev/null || true

echo
if [ "$api_ok" = true ] && [ "$web_ok" = true ]; then
  echo "Ventage services are up."
  echo "- Web:  http://127.0.0.1:3000/dashboard"
  echo "- API:  http://127.0.0.1:8000/docs"
else
  echo "One or more services failed to pass health checks."
  echo "Logs:"
  echo "- API: $API_LOG"
  echo "- Web: $WEB_LOG"
  exit 1
fi
