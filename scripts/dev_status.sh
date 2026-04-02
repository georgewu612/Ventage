#!/bin/bash
set -euo pipefail

ROOT="/Users/georgewu/Documents/Ventage"
API_PID_FILE="$ROOT/.api.pid"
WEB_PID_FILE="$ROOT/.web.pid"
API_LOG="$ROOT/.api.log"
WEB_LOG="$ROOT/.web.log"
API_PORT=8000
WEB_PORT=3000

pid_on_port() {
  local port="$1"
  lsof -tiTCP:"$port" -sTCP:LISTEN -n -P 2>/dev/null | head -n 1
}

print_status() {
  local pid_file="$1"
  local name="$2"

  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if ps -p "$pid" >/dev/null 2>&1; then
      echo "$name: running (PID $pid)"
    else
      echo "$name: stopped (stale pid file PID $pid)"
    fi
  else
    echo "$name: stopped"
  fi
}

echo "== Process Status =="
print_status "$API_PID_FILE" "API"
print_status "$WEB_PID_FILE" "Web"

echo
echo "== PID File vs Port Check =="
for service in API Web; do
  if [ "$service" = "API" ]; then
    pid_file="$API_PID_FILE"
    port="$API_PORT"
  else
    pid_file="$WEB_PID_FILE"
    port="$WEB_PORT"
  fi

  file_pid=""
  if [ -f "$pid_file" ]; then
    file_pid=$(cat "$pid_file")
  fi
  port_pid=$(pid_on_port "$port" || true)

  if [ -n "$file_pid" ] && [ -n "$port_pid" ] && [ "$file_pid" != "$port_pid" ]; then
    echo "$service mismatch: pid file=$file_pid, listening pid=$port_pid"
  else
    echo "$service pid mapping: OK"
  fi
done

echo

echo "== Listening Ports =="
lsof -iTCP:8000 -sTCP:LISTEN -n -P || echo "8000 not listening"
lsof -iTCP:3000 -sTCP:LISTEN -n -P || echo "3000 not listening"

echo

echo "== Health Checks =="
curl -sS -o /dev/null -w "API /healthz: %{http_code}\n" http://127.0.0.1:8000/healthz || echo "API /healthz: failed"
curl -sS -o /dev/null -w "Web /dashboard: %{http_code}\n" http://127.0.0.1:3000/dashboard || echo "Web /dashboard: failed"

echo

echo "== Recent Logs (tail 20) =="
echo "-- API ($API_LOG) --"
tail -n 20 "$API_LOG" 2>/dev/null || echo "no api log"
echo "-- Web ($WEB_LOG) --"
tail -n 20 "$WEB_LOG" 2>/dev/null || echo "no web log"
