"""One-off script: clear recent market_signals and regenerate with bilingual analysis.

Usage:
    cd python
    python scripts/refresh_signals.py
"""

from __future__ import annotations

import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config.settings import get_settings
from supabase import create_client
from agents.signal_engine import SignalEngine


async def main() -> None:
    settings = get_settings()
    if not settings.has_supabase_config:
        print("ERROR: Supabase config missing. Check .env")
        sys.exit(1)

    db = create_client(settings.supabase_url, settings.supabase_service_role_key)

    print("Clearing all market_signals ...")
    db.table("market_signals").delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    print("  Done.")

    print("Running signal engine ...")
    engine = SignalEngine(db)
    result = await engine.generate_all()
    print(f"  Generated {len(result)} signals.")
    print("Finished.")


if __name__ == "__main__":
    asyncio.run(main())
