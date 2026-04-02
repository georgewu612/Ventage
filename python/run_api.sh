#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

if [ -f ../.env ]; then
  set -a
  source ../.env
  set +a
fi

python3 -m uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
