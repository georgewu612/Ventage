#!/bin/bash
set -euo pipefail

ROOT="/Users/georgewu/Documents/Ventage"
TS=$(date +"%Y%m%d_%H%M%S")

if [ -f "$ROOT/.api.log" ]; then
  cp "$ROOT/.api.log" "$ROOT/.api.log.$TS.bak"
fi
if [ -f "$ROOT/.web.log" ]; then
  cp "$ROOT/.web.log" "$ROOT/.web.log.$TS.bak"
fi

"$ROOT/scripts/dev_down.sh"
"$ROOT/scripts/dev_up.sh"

echo "Restart complete. Previous logs backed up with suffix .$TS.bak"
