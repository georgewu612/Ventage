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
from services.regime_engine import RegimeEngine
from alerting.manager import AlertManager
from alerting.telegram import TelegramNotifier
from config.settings import get_settings
from etl.collectors.darkpool_collector import DarkPoolCollector
from etl.collectors.insider_collector import InsiderTradesCollector
from etl.collectors.news_collector import NewsCollector
from etl.collectors.options_collector import OptionsFlowCollector
from etl.collectors.sentiment_collector import SentimentCollector
from etl.collectors.value_collector import ValueCollector
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


async def run_regime_refresh(db):
    """Compute and persist a fresh market regime snapshot."""
    t0 = time.monotonic()
    try:
        engine = RegimeEngine(db)
        snapshot = await engine.compute_and_save()
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info(
            "regime_refresh_result",
            regime=snapshot.regime,
            vix=snapshot.vix,
            duration_ms=duration_ms,
        )
        _write_job_run(
            db,
            job_name="regime_refresh",
            status="success",
            loaded=1,
            duration_ms=duration_ms,
        )
        return snapshot
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("regime_refresh_error", error=str(exc))
        _write_job_run(
            db,
            job_name="regime_refresh",
            status="error",
            error_message=str(exc),
            duration_ms=duration_ms,
        )
        raise


async def run_portfolio_snapshots(db):
    """Save daily portfolio snapshots for all users who have holdings."""
    from api.routes.portfolio import portfolio_summary, save_snapshot  # local import to avoid circular

    t0 = time.monotonic()
    try:
        result = db.table("portfolio_holdings").select("user_id").execute()
        user_ids = list({r["user_id"] for r in (result.data or [])})
        saved = 0
        for uid in user_ids:
            try:
                save_snapshot(user_id=uid)
                saved += 1
            except Exception as exc:
                logger.warning("portfolio_snapshot_failed", user_id=uid, error=str(exc))

        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info("portfolio_snapshots_done", users=len(user_ids), saved=saved, duration_ms=duration_ms)
        _write_job_run(db, job_name="portfolio_snapshots", status="success", loaded=saved, duration_ms=duration_ms)
        return {"users": len(user_ids), "saved": saved}
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("portfolio_snapshots_error", error=str(exc))
        _write_job_run(db, job_name="portfolio_snapshots", status="error", error_message=str(exc), duration_ms=duration_ms)
        raise


async def run_data_cleanup(db):
    """Clean up old data to stay within Supabase storage limits."""
    result = await cleanup_old_data(db)
    logger.info("data_cleanup_result", total_deleted=result["total_deleted"])
    return result


async def run_regime_change_alert(db):
    """Compare the two most recent regime snapshots; alert via Telegram if regime changed."""
    t0 = time.monotonic()
    try:
        result = (
            db.table("market_regime_snapshots")
            .select("regime, generated_at")
            .order("generated_at", desc=True)
            .limit(2)
            .execute()
        )
        rows = result.data or []
        if len(rows) < 2:
            logger.info("regime_change_alert_skipped", reason="insufficient_snapshots")
            return {"changed": False}

        current, previous = rows[0]["regime"], rows[1]["regime"]
        if current == previous:
            logger.info("regime_change_alert_skipped", reason="no_change", regime=current)
            _write_job_run(db, "regime_change_alert", "success", duration_ms=int((time.monotonic() - t0) * 1000))
            return {"changed": False, "regime": current}

        # Regime changed — send Telegram alert
        settings = get_settings()
        message = (
            f"⚠️ 市场环境切换\n\n"
            f"前次体制：{previous}\n"
            f"当前体制：{current}\n\n"
            f"请及时审视仓位与策略适配度。"
        )
        if settings.telegram_bot_token and settings.telegram_chat_id:
            notifier = TelegramNotifier(
                bot_token=settings.telegram_bot_token,
                chat_id=settings.telegram_chat_id,
            )
            await notifier.send_message(message)
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info("regime_change_alert_sent", previous=previous, current=current)
        _write_job_run(db, "regime_change_alert", "success", loaded=1, duration_ms=duration_ms)
        return {"changed": True, "previous": previous, "current": current}
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("regime_change_alert_error", error=str(exc))
        _write_job_run(db, "regime_change_alert", "error", error_message=str(exc), duration_ms=duration_ms)
        raise


async def run_portfolio_drawdown_alert(db):
    """Alert users whose portfolio dropped >3% vs the previous day's snapshot."""
    t0 = time.monotonic()
    alerts_sent = 0
    try:
        users_result = db.table("portfolio_holdings").select("user_id").execute()
        user_ids = list({r["user_id"] for r in (users_result.data or [])})

        settings = get_settings()
        notifier: TelegramNotifier | None = None
        if settings.telegram_bot_token and settings.telegram_chat_id:
            notifier = TelegramNotifier(
                bot_token=settings.telegram_bot_token,
                chat_id=settings.telegram_chat_id,
            )

        for uid in user_ids:
            try:
                snaps = (
                    db.table("portfolio_snapshots")
                    .select("snapshot_date, total_value")
                    .eq("user_id", uid)
                    .order("snapshot_date", desc=True)
                    .limit(2)
                    .execute()
                ).data or []

                if len(snaps) < 2:
                    continue

                today_val = float(snaps[0]["total_value"])
                prev_val = float(snaps[1]["total_value"])
                if prev_val <= 0:
                    continue

                drawdown_pct = (today_val - prev_val) / prev_val * 100
                if drawdown_pct < -3.0 and notifier:
                    message = (
                        f"📉 组合日内回撤预警\n\n"
                        f"今日组合价值：${today_val:,.0f}\n"
                        f"昨日组合价值：${prev_val:,.0f}\n"
                        f"单日跌幅：{drawdown_pct:.1f}%\n\n"
                        f"请及时检视持仓风险。"
                    )
                    await notifier.send_message(message)
                    alerts_sent += 1
            except Exception as exc:
                logger.warning("portfolio_drawdown_user_error", user_id=uid, error=str(exc))

        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info("portfolio_drawdown_alert_done", users=len(user_ids), alerts_sent=alerts_sent)
        _write_job_run(db, "portfolio_drawdown_alert", "success", loaded=alerts_sent, duration_ms=duration_ms)
        return {"users_checked": len(user_ids), "alerts_sent": alerts_sent}
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("portfolio_drawdown_alert_error", error=str(exc))
        _write_job_run(db, "portfolio_drawdown_alert", "error", error_message=str(exc), duration_ms=duration_ms)
        raise


async def run_report_generation(db, report_type: str):
    """Pre-generate a scheduled report by calling the report route logic directly."""
    import httpx
    t0 = time.monotonic()
    try:
        api_base = "http://localhost:8000"
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(f"{api_base}/v1/reports/{report_type}")
        status = "success" if resp.status_code == 200 else "error"
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.info("report_generated", report_type=report_type, http_status=resp.status_code)
        _write_job_run(db, f"report_{report_type}", status, loaded=1, duration_ms=duration_ms)
        return {"report_type": report_type, "status": status}
    except Exception as exc:
        duration_ms = int((time.monotonic() - t0) * 1000)
        logger.error("report_generation_error", report_type=report_type, error=str(exc))
        _write_job_run(db, f"report_{report_type}", "error", error_message=str(exc), duration_ms=duration_ms)
        raise


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


async def run_value_screener(db) -> dict:
    """Run value screener for the full universe — updates value_scores table.

    Scheduled daily at 07:00 ET (12:00 UTC) before market open so that
    Portfolio Builder has fresh fundamental data each trading day.
    """
    logger.info("value_screener_start")
    collector = ValueCollector(supabase_client=db)
    result = await collector.run()
    logger.info(
        "value_screener_done",
        loaded=result.get("loaded", 0),
        status=result.get("status"),
    )
    return result


async def run_symbol_regime_scan(db) -> dict:
    """Classify per-symbol regime for Watchlist + holdings universe.

    Phase A.4 of Trading System v2. Pulls all distinct symbols from:
      - watchlists  (user-curated)
      - portfolio_holdings (active positions)
    Then computes 6-state regime via regime_classifier and writes to
    symbol_regimes table. Runs daily after US market close (22:00 UTC).
    """
    import yfinance as yf
    import pandas as pd

    from services.regime_classifier import classify

    start = time.perf_counter()
    logger.info("symbol_regime_scan_start")

    # ── Pull union of watchlist + holdings symbols ────────────────────────
    symbols: set[str] = set()
    try:
        wl = db.table("watchlists").select("symbol").execute()
        symbols.update(r["symbol"] for r in (wl.data or []) if r.get("symbol"))
    except Exception as exc:
        logger.warning("watchlist_fetch_failed", error=str(exc))
    try:
        hd = db.table("portfolio_holdings").select("symbol").execute()
        symbols.update(r["symbol"] for r in (hd.data or []) if r.get("symbol"))
    except Exception as exc:
        logger.warning("holdings_fetch_failed", error=str(exc))

    if not symbols:
        logger.info("symbol_regime_scan_no_symbols")
        _write_job_run(
            db,
            job_name="symbol_regime_scan",
            status="success",
            loaded=0,
            duration_ms=int((time.perf_counter() - start) * 1000),
        )
        return {"status": "success", "scanned": 0, "loaded": 0}

    scanned = 0
    loaded = 0
    failed = 0
    rows: list[dict] = []

    # ── Classify each symbol ──────────────────────────────────────────────
    for sym in sorted(symbols):
        scanned += 1
        try:
            df = yf.download(
                sym, period="1y", interval="1d", auto_adjust=True, progress=False
            )
            if df is None or df.empty or len(df) < 60:
                logger.warning("regime_scan_insufficient_data", symbol=sym)
                failed += 1
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            res = classify(df)
            last_ts = df.index[-1]
            if hasattr(last_ts, "tz") and last_ts.tz is None:
                last_ts = last_ts.tz_localize("UTC")
            rows.append(
                {
                    "symbol": sym,
                    "timeframe": "1d",
                    "datetime": last_ts.isoformat(),
                    "regime": res.regime,
                    "regime_score": float(res.regime_score),
                    "adx": res.adx,
                    "ema_alignment": res.ema_alignment,
                    "ema_squeeze_pct": res.ema_squeeze_pct,
                    "bb_width": res.bb_width,
                    "atr_pct": res.atr_pct,
                    "risk_flag": res.risk_flag,
                    "notes": res.notes,
                }
            )
            loaded += 1
        except Exception as exc:
            failed += 1
            logger.warning("regime_scan_failed", symbol=sym, error=str(exc))

    # ── Bulk insert ──────────────────────────────────────────────────────
    if rows:
        try:
            db.table("symbol_regimes").insert(rows).execute()
        except Exception as exc:
            logger.error("regime_scan_insert_failed", error=str(exc))
            _write_job_run(
                db,
                job_name="symbol_regime_scan",
                status="error",
                error_message=str(exc),
                loaded=0,
                duration_ms=int((time.perf_counter() - start) * 1000),
            )
            return {"status": "error", "error": str(exc)}

    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "symbol_regime_scan_done",
        scanned=scanned,
        loaded=loaded,
        failed=failed,
        duration_ms=duration_ms,
    )
    _write_job_run(
        db,
        job_name="symbol_regime_scan",
        status="success",
        loaded=loaded,
        duration_ms=duration_ms,
    )
    return {"status": "success", "scanned": scanned, "loaded": loaded, "failed": failed}


# ── Trading System v2 — Phase F: Signal Journal ETL ─────────────────────────


async def run_signal_scan_and_persist(db) -> dict:
    """Scan Watchlist + holdings for rule-based signals; persist B+ to DB.

    Phase F.3 of Trading System v2. Runs at end-of-day after the symbol
    regime scan so the regime is fresh.
    """
    import yfinance as yf
    import pandas as pd

    from services.regime_classifier import classify
    from services.signal_journal import persist_scan_results
    from services.signal_scorer import score_all
    from services.strategy_router import scan_symbol

    start = time.perf_counter()
    logger.info("signal_scan_persist_start")

    # Build universe — union of all users' watchlist + holdings
    symbols: set[str] = set()
    try:
        wl = db.table("watchlists").select("symbol").execute()
        symbols.update(r["symbol"] for r in (wl.data or []) if r.get("symbol"))
    except Exception as exc:
        logger.warning("watchlist_fetch_failed", error=str(exc))
    try:
        hd = db.table("portfolio_holdings").select("symbol").execute()
        symbols.update(r["symbol"] for r in (hd.data or []) if r.get("symbol"))
    except Exception as exc:
        logger.warning("holdings_fetch_failed", error=str(exc))

    if not symbols:
        logger.info("signal_scan_no_symbols")
        _write_job_run(
            db,
            job_name="signal_scan_persist",
            status="success",
            loaded=0,
            duration_ms=int((time.perf_counter() - start) * 1000),
        )
        return {"status": "success", "scanned": 0, "persisted": 0}

    scan_results: dict[str, list] = {}
    bar_dt = None
    failed = 0
    for sym in sorted(symbols):
        try:
            df = yf.download(
                sym, period="1y", interval="1d", auto_adjust=True, progress=False
            )
            if df is None or df.empty or len(df) < 60:
                failed += 1
                continue
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            regime = classify(df).to_dict()
            cands = scan_symbol(sym, df, regime_override=regime)
            scored = score_all(cands, regime, drop_unscored=True)
            scan_results[sym] = scored
            # Use the latest bar's timestamp as signal time
            if bar_dt is None:
                last_ts = df.index[-1]
                bar_dt = (
                    last_ts.tz_localize("UTC")
                    if hasattr(last_ts, "tz") and last_ts.tz is None
                    else last_ts
                ).to_pydatetime()
        except Exception as exc:
            failed += 1
            logger.warning("scan_symbol_failed", symbol=sym, error=str(exc))

    # Persist B+ grade signals (skip C-grade noise)
    counts = persist_scan_results(db, scan_results, bar_datetime=bar_dt, min_grade="B")

    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info(
        "signal_scan_persist_done",
        scanned=len(symbols),
        persisted=counts["persisted"],
        skipped=counts["skipped"],
        errors=counts["errors"],
        failed_fetches=failed,
        duration_ms=duration_ms,
    )
    _write_job_run(
        db,
        job_name="signal_scan_persist",
        status="success",
        loaded=counts["persisted"],
        duration_ms=duration_ms,
    )
    return {
        "status": "success",
        "scanned": len(symbols),
        **counts,
        "failed_fetches": failed,
    }


async def run_signal_outcome_update(db) -> dict:
    """Walk forward through active signals; mark hit/miss/expired.

    Phase F.4 of Trading System v2. Runs daily after market close.
    """
    from services.signal_journal import update_outcomes

    start = time.perf_counter()
    logger.info("signal_outcome_update_start")
    try:
        result = update_outcomes(db, lookback_days=60, expire_after_days=20)
    except Exception as exc:
        duration_ms = int((time.perf_counter() - start) * 1000)
        logger.error("signal_outcome_update_error", error=str(exc))
        _write_job_run(
            db,
            job_name="signal_outcome_update",
            status="error",
            error_message=str(exc),
            duration_ms=duration_ms,
        )
        return {"status": "error", "error": str(exc)}

    duration_ms = int((time.perf_counter() - start) * 1000)
    logger.info("signal_outcome_update_done", duration_ms=duration_ms, **result)
    _write_job_run(
        db,
        job_name="signal_outcome_update",
        status="success",
        loaded=result["closed"] + result["expired"],
        duration_ms=duration_ms,
    )
    return result


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

    # Market regime: daily at 09:31 ET (30 min after open, after signal data arrives)
    scheduler.add_job(
        run_regime_refresh,
        "cron",
        hour=14,        # 14:31 UTC = 09:31 ET (EST) / 10:31 ET (EDT)
        minute=31,
        timezone="UTC",
        args=[db],
        id="regime_refresh",
        name="Market Regime Refresh (Daily)",
        max_instances=1,
    )

    # Portfolio snapshots: daily at 21:00 UTC (16:00 ET) — market close + 30 min
    scheduler.add_job(
        run_portfolio_snapshots,
        "cron",
        hour=21,
        minute=0,
        timezone="UTC",
        args=[db],
        id="portfolio_snapshots",
        name="Portfolio Daily Snapshots",
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

    # Regime change alert: daily 09:35 ET (14:35 UTC) — after regime refresh
    scheduler.add_job(
        run_regime_change_alert,
        "cron",
        hour=14,
        minute=35,
        timezone="UTC",
        args=[db],
        id="regime_change_alert",
        name="Regime Change Alert",
        max_instances=1,
    )

    # Portfolio drawdown alert: daily 21:10 UTC (16:10 ET) — after portfolio snapshots
    scheduler.add_job(
        run_portfolio_drawdown_alert,
        "cron",
        hour=21,
        minute=10,
        timezone="UTC",
        args=[db],
        id="portfolio_drawdown_alert",
        name="Portfolio Drawdown Alert",
        max_instances=1,
    )

    # Pre-market brief: daily 08:50 ET = 13:50 UTC
    scheduler.add_job(
        run_report_generation,
        "cron",
        hour=13,
        minute=50,
        timezone="UTC",
        args=[db, "premarket"],
        id="report_premarket",
        name="Pre-Market Brief Generation",
        max_instances=1,
    )

    # Closing wrap: daily 16:10 ET = 21:10 UTC
    scheduler.add_job(
        run_report_generation,
        "cron",
        hour=21,
        minute=10,
        timezone="UTC",
        args=[db, "closing"],
        id="report_closing",
        name="Closing Wrap Generation",
        max_instances=1,
    )

    # Weekly review: every Friday 17:00 ET = 22:00 UTC
    scheduler.add_job(
        run_report_generation,
        "cron",
        day_of_week="fri",
        hour=22,
        minute=0,
        timezone="UTC",
        args=[db, "weekly"],
        id="report_weekly",
        name="Weekly Review Generation",
        max_instances=1,
    )

    # Value screener: daily 07:00 ET = 12:00 UTC — before market open
    # Populates value_scores table used by V&M composite scoring
    scheduler.add_job(
        run_value_screener,
        "cron",
        hour=12,
        minute=0,
        timezone="UTC",
        args=[db],
        id="value_screener",
        name="Daily Value Screener (V&M)",
        max_instances=1,
    )

    # Per-symbol regime scan: daily 22:00 UTC (~17:00 ET, after US market close)
    # Classifies Watchlist + holdings symbols into 6 regime states.
    # Trading System v2 — Phase A.4
    scheduler.add_job(
        run_symbol_regime_scan,
        "cron",
        hour=22,
        minute=0,
        timezone="UTC",
        args=[db],
        id="symbol_regime_scan",
        name="Per-Symbol Regime Scan (Trading System v2)",
        max_instances=1,
    )

    # Signal scan + persist: daily 22:30 UTC (after regime scan completes)
    # Scans Watchlist + holdings, runs all 4 strategies, persists B+ signals
    # to strategy_signals table. Trading System v2 — Phase F.3
    scheduler.add_job(
        run_signal_scan_and_persist,
        "cron",
        hour=22,
        minute=30,
        timezone="UTC",
        args=[db],
        id="signal_scan_persist",
        name="Signal Scan + Journal Persist (Trading System v2)",
        max_instances=1,
    )

    # Signal outcome update: daily 23:00 UTC (after signal scan)
    # Walks forward through active signals; marks hit/miss/expired.
    # Trading System v2 — Phase F.4
    scheduler.add_job(
        run_signal_outcome_update,
        "cron",
        hour=23,
        minute=0,
        timezone="UTC",
        args=[db],
        id="signal_outcome_update",
        name="Signal Outcome Update (Trading System v2)",
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
