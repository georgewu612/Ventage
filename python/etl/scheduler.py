"""ETL scheduler — runs collectors on a configurable interval.

Usage:
    python -m etl.scheduler          # Start scheduler (runs continuously)
    python -m etl.scheduler --once   # Run all collectors once and exit
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

# Ensure python/ is in the path
PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from supabase import create_client

from agents.signal_engine import SignalEngine
from alerting.manager import AlertManager
from config.settings import get_settings
from etl.collectors.darkpool_collector import DarkPoolCollector
from etl.collectors.insider_collector import InsiderTradesCollector
from etl.collectors.news_collector import NewsCollector
from etl.collectors.options_collector import OptionsFlowCollector
from etl.collectors.sentiment_collector import SentimentCollector
from etl.data_cleaner import cleanup_old_data

logger = structlog.get_logger()


def _create_supabase_client():
    """Create a Supabase client using service role key."""
    settings = get_settings()
    if not settings.has_supabase_config:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _write_job_run(
    db,
    job_name: str,
    status: str,
    collected: int = 0,
    loaded: int = 0,
    error_message: str | None = None,
    duration_ms: int = 0,
) -> None:
    """Persist ETL job execution result to job_runs table (best-effort)."""
    try:
        db.table("job_runs").insert(
            {
                "job_name": job_name,
                "status": status,
                "collected": collected,
                "loaded": loaded,
                "error_message": error_message,
                "duration_ms": duration_ms,
            }
        ).execute()
    except Exception as exc:
        logger.warning("job_run_write_failed", job=job_name, error=str(exc))


async def run_collector(collector_cls, db):
    """Instantiate and run a single collector, recording execution to job_runs."""
    t0 = time.monotonic()
    try:
        collector = collector_cls(db)
        result = await collector.run()
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "collector_result",
            collector=result["collector"],
            status=result["status"],
            collected=result["collected"],
            loaded=result["loaded"],
            duration_ms=duration_ms,
        )
        _write_job_run(
            db,
            job_name=result["collector"],
            status=result["status"],
            collected=result["collected"],
            loaded=result["loaded"],
            duration_ms=duration_ms,
        )
        return result
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        job_name = getattr(collector_cls, "name", str(collector_cls))
        logger.error("collector_error", collector=job_name, error=str(exc))
        _write_job_run(
            db, job_name=job_name, status="error", error_message=str(exc), duration_ms=duration_ms
        )
        raise


async def run_signal_engine(db):
    """Run the signal engine and record execution to job_runs."""
    t0 = time.monotonic()
    try:
        engine = SignalEngine(db)
        signals = await engine.generate_all()
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info("signal_engine_result", signals_generated=len(signals), duration_ms=duration_ms)
        _write_job_run(
            db,
            job_name="signal_engine",
            status="success",
            loaded=len(signals),
            duration_ms=duration_ms,
        )
        return signals
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("signal_engine_error", error=str(exc))
        _write_job_run(
            db,
            job_name="signal_engine",
            status="error",
            error_message=str(exc),
            duration_ms=duration_ms,
        )
        raise


async def run_alert_check(db):
    """Evaluate recent signals and send alerts if warranted."""
    t0 = time.monotonic()
    try:
        manager = AlertManager(db)
        result = await manager.evaluate_and_notify()
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "alert_check_result",
            evaluated=result["evaluated"],
            matched=result["matched"],
            sent=result["sent"],
            duration_ms=duration_ms,
        )
        _write_job_run(
            db,
            job_name="alert_check",
            status="success",
            collected=result["evaluated"],
            loaded=result["sent"],
            duration_ms=duration_ms,
        )
        return result
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("alert_check_error", error=str(exc))
        _write_job_run(
            db,
            job_name="alert_check",
            status="error",
            error_message=str(exc),
            duration_ms=duration_ms,
        )
        raise


async def run_data_cleanup(db):
    """Clean up old data to stay within Supabase storage limits."""
    result = await cleanup_old_data(db)
    logger.info("data_cleanup_result", total_deleted=result["total_deleted"])
    return result


async def run_all_once():
    """Run all collectors once, then generate signals."""
    db = _create_supabase_client()
    collectors = [InsiderTradesCollector, OptionsFlowCollector, SentimentCollector, NewsCollector]

    results = []
    for cls in collectors:
        result = await run_collector(cls, db)
        results.append(result)

    # After collecting data, generate signals
    signals = await run_signal_engine(db)
    results.append(
        {
            "collector": "signal_engine",
            "status": "success",
            "collected": len(signals),
            "loaded": len(signals),
        }
    )

    return results


def start_scheduler():
    """Start the APScheduler with configured intervals."""
    db = _create_supabase_client()
    scheduler = AsyncIOScheduler()

    # Insider trades: every 20 minutes (full market, SEC rate limits)
    scheduler.add_job(
        run_collector,
        "interval",
        minutes=20,
        args=[InsiderTradesCollector, db],
        id="insider_trades",
        name="SEC EDGAR Insider Trades (Full Market)",
        max_instances=1,
    )

    # Options flow: every 5 minutes (CBOE delayed data)
    scheduler.add_job(
        run_collector,
        "interval",
        minutes=5,
        args=[OptionsFlowCollector, db],
        id="options_flow",
        name="Options Flow (CBOE/UW)",
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

    # WallStreetCN news: every 5 minutes (7x24 live feed)
    scheduler.add_job(
        run_collector,
        "interval",
        minutes=5,
        args=[NewsCollector, db],
        id="market_news",
        name="WallStreetCN News",
        max_instances=1,
    )

    # Dark pool: every 30 minutes (FINRA weekly data, UW if available)
    scheduler.add_job(
        run_collector,
        "interval",
        minutes=30,
        args=[DarkPoolCollector, db],
        id="dark_pool",
        name="Dark Pool Orders",
        max_instances=1,
    )

    # Signal engine: every 20 minutes (after collectors have run)
    scheduler.add_job(
        run_signal_engine,
        "interval",
        minutes=20,
        args=[db],
        id="signal_engine",
        name="Signal Engine",
        max_instances=1,
    )

    # Alert check: every 25 minutes (after signal engine)
    scheduler.add_job(
        run_alert_check,
        "interval",
        minutes=25,
        args=[db],
        id="alert_check",
        name="Alert Check (Telegram)",
        max_instances=1,
    )

    # Data cleanup: once daily (every 24 hours)
    scheduler.add_job(
        run_data_cleanup,
        "interval",
        hours=24,
        args=[db],
        id="data_cleanup",
        name="Data Cleanup (Daily)",
        max_instances=1,
    )

    # Run all collectors immediately on startup
    for cls in [
        InsiderTradesCollector,
        OptionsFlowCollector,
        SentimentCollector,
        NewsCollector,
        DarkPoolCollector,
    ]:
        scheduler.add_job(
            run_collector,
            args=[cls, db],
            id=f"{cls.name}_startup",
            name=f"{cls.name} (startup)",
        )

    async def _run():
        scheduler.start()
        logger.info("scheduler_started", jobs=len(scheduler.get_jobs()))
        try:
            # Keep running forever
            while True:
                await asyncio.sleep(3600)
        except (KeyboardInterrupt, SystemExit):
            scheduler.shutdown()
            logger.info("scheduler_stopped")

    asyncio.run(_run())


if __name__ == "__main__":
    if "--once" in sys.argv:
        results = asyncio.run(run_all_once())
        for r in results:
            status_icon = "✅" if r["status"] == "success" else "❌"
            print(
                f"{status_icon} {r['collector']}: collected={r['collected']}, loaded={r['loaded']}"
            )
    else:
        start_scheduler()
