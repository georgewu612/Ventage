"""One-shot script to populate value_scores table via ValueCollector.

Run from repo root:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  /path/to/python scripts/run_value_screener.py

Or with .env auto-loaded (as below).
"""

import asyncio
import os
import sys
from pathlib import Path

# ── Make sure python/ package root is on sys.path ─────────────────────────────
REPO_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))

# ── Load .env from repo root ───────────────────────────────────────────────────
env_file = REPO_ROOT.parent / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

from supabase import create_client
from etl.collectors.value_collector import ValueCollector, DEFAULT_UNIVERSE


async def main():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db = create_client(url, key)

    print(f"▶ Starting value screener for {len(DEFAULT_UNIVERSE)} symbols…")
    collector = ValueCollector(supabase_client=db)

    result = await collector.run()
    print(f"✅ Done — status={result['status']} | collected={result['collected']} | loaded={result['loaded']}")
    if result.get("errors"):
        print("⚠ Errors:", result["errors"])


if __name__ == "__main__":
    asyncio.run(main())
