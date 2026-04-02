"""ETL scheduler — runs collectors on a configurable interval.

Usage:
    python -m etl.scheduler          # Start scheduler (runs continuously)
    python -m etl.scheduler --once   # Run all collectors once and exit
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Ensure python/ is in the path
PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import create_client

from config.settings import get_settings
from etl.collectors.insider_collector import InsiderTradesCollector
from etl.collectors.sentiment_collector import SentimentCollector

import structlog

logger = structlog.get_logger()


def _create_supabase_client():
    """Create a Supabase client using service role key."""
    settings = get_settings()
    if not settings.has_supabase_config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


async def run_collector(collector_cls, db):
    """Instantiate and run a single collector."""
    collector = collector_cls(db)
    result = await collector.run()
    logger.info(
        "collector_result",
        collector=result["collector"],
        status=result["status"],
        collected=result["collected"],
        loaded=result["loaded"],
    )
    return result


async def run_all_once():
    """Run all collectors once (for testing or manual invocation)."""
    db = _create_supabase_client()
    collectors = [InsiderTradesCollector, SentimentCollector]

    results = []
    for cls in collectors:
        result = await run_collector(cls, db)
        results.append(result)

    return results


def start_scheduler():
    """Start the APScheduler with configured intervals."""
    db = _create_supabase_client()
    scheduler = AsyncIOScheduler()

    # Insider trades: every 15 minutes (SEC rate limits)
    scheduler.add_job(
        run_collector,
        "interval",
        minutes=15,
        args=[InsiderTradesCollector, db],
        id="insider_trades",
        name="SEC EDGAR Insider Trades",
        max_instances=1,
    )

    # Reddit sentiment: every 10 minutes
    scheduler.add_job(
        run_collector,
        "interval",
        minutes=10,
        args=[SentimentCollector, db],
        id="market_sentiment",
        name="Reddit Sentiment",
        max_instances=1,
    )

    # Run all collectors immediately on startup
    scheduler.add_job(
        run_collector,
        args=[InsiderTradesCollector, db],
        id="insider_trades_startup",
        name="Insider Trades (startup)",
    )
    scheduler.add_job(
        run_collector,
        args=[SentimentCollector, db],
        id="sentiment_startup",
        name="Sentiment (startup)",
    )

    scheduler.start()
    logger.info("scheduler_started", jobs=len(scheduler.get_jobs()))

    # Keep the event loop running
    try:
        asyncio.get_event_loop().run_forever()
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
        logger.info("scheduler_stopped")


if __name__ == "__main__":
    if "--once" in sys.argv:
        results = asyncio.run(run_all_once())
        for r in results:
            status_icon = "✅" if r["status"] == "success" else "❌"
            print(f"{status_icon} {r['collector']}: collected={r['collected']}, loaded={r['loaded']}")
    else:
        start_scheduler()
