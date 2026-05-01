from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from postgrest.exceptions import APIError
from supabase import Client, create_client

from config.settings import get_settings

router = APIRouter()


def _get_supabase_client() -> Client:
    settings = get_settings()
    if not settings.has_supabase_config:
        raise HTTPException(
            status_code=503,
            detail="Supabase environment variables are missing. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _normalize_signal(row: dict[str, Any]) -> dict[str, Any]:
    factors = row.get("factors") if isinstance(row.get("factors"), dict) else {}
    module = row.get("module") or factors.get("module") or row.get("signal_type") or "unknown"
    signal_score = row.get("signal_score")
    if signal_score is None:
        confidence = row.get("confidence")
        signal_score = round(float(confidence) * 100, 2) if confidence is not None else 0

    direction = row.get("direction")
    normalized_signal_type = row.get("signal_type")
    if direction in ("bullish", "bearish"):
        normalized_signal_type = direction

    summary = row.get("summary") or row.get("analysis") or ""

    normalized = dict(row)
    normalized.update(
        {
            "module": module,
            "signal_score": signal_score,
            "summary": summary,
            "signal_type": normalized_signal_type,
        }
    )
    return normalized


@router.get("/signals")
def get_signals(
    symbol: str | None = Query(default=None),
    module: str | None = Query(default=None),
    signal_type: str | None = Query(default=None),
    min_score: int | None = Query(default=None, ge=0, le=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        query = (
            supabase.table("market_signals").select("*").order("created_at", desc=True).limit(1000)
        )

        if symbol:
            query = query.eq("symbol", symbol.upper())

        response = query.execute()
        data = [_normalize_signal(row) for row in (response.data or [])]

        if module:
            data = [row for row in data if str(row.get("module")) == module]
        if signal_type:
            data = [row for row in data if str(row.get("signal_type")) == signal_type]
        if min_score is not None:
            data = [row for row in data if float(row.get("signal_score") or 0) >= min_score]

        total = len(data)
        paged = data[offset : offset + limit]

        return {
            "items": paged,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned": len(paged),
                "total": total,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Failed to fetch signals: {exc}") from exc


@router.get("/signals/summary")
def get_signals_summary() -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        since = datetime.now(UTC) - timedelta(hours=24)

        response = (
            supabase.table("market_signals")
            .select("*")
            .gte("created_at", since.isoformat())
            .execute()
        )
        items = [_normalize_signal(row) for row in (response.data or [])]

        bullish = sum(1 for item in items if item.get("signal_type") == "bullish")
        bearish = sum(1 for item in items if item.get("signal_type") == "bearish")
        neutral = len(items) - bullish - bearish
        scores = [
            item.get("signal_score") for item in items if item.get("signal_score") is not None
        ]
        avg_score = round(sum(scores) / len(scores), 2) if scores else 0

        by_module: dict[str, int] = {}
        by_symbol: dict[str, int] = {}
        for item in items:
            module = item.get("module") or "unknown"
            by_module[module] = by_module.get(module, 0) + 1
            symbol = item.get("symbol") or "unknown"
            by_symbol[symbol] = by_symbol.get(symbol, 0) + 1

        top_symbols = sorted(by_symbol.items(), key=lambda x: x[1], reverse=True)[:5]

        # Put/Call ratio from options_flow (last 24h)
        put_call_ratio: float | None = None
        try:
            opts_resp = (
                supabase.table("options_flow")
                .select("option_type")
                .gte("created_at", since.isoformat())
                .execute()
            )
            opts = opts_resp.data or []
            calls = sum(1 for o in opts if str(o.get("option_type", "")).lower() == "call")
            puts = sum(1 for o in opts if str(o.get("option_type", "")).lower() == "put")
            if calls > 0:
                put_call_ratio = round(puts / calls, 2)
        except Exception:
            pass  # Non-critical — omit ratio if query fails

        return {
            "window": "24h",
            "total_signals": len(items),
            "bullish": bullish,
            "bearish": bearish,
            "neutral": neutral,
            "average_score": avg_score,
            "by_module": by_module,
            "top_symbols": [{"symbol": s, "count": c} for s, c in top_symbols],
            "put_call_ratio": put_call_ratio,
        }
    except HTTPException:
        raise
    except APIError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to build summary: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Failed to build summary: {exc}") from exc


@router.get("/signals/{signal_id}")
def get_signal_by_id(signal_id: str) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        response = (
            supabase.table("market_signals").select("*").eq("id", signal_id).limit(1).execute()
        )
        items = response.data or []
        if not items:
            raise HTTPException(status_code=404, detail="Signal not found")
        return _normalize_signal(items[0])
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Failed to fetch signal: {exc}") from exc


# ── Trading System v2 — Phase F: Signal Journal API ─────────────────────────


@router.get("/signals/journal/history")
def journal_history(
    strategy: str | None = Query(default=None),
    symbol: str | None = Query(default=None),
    grade: str | None = Query(default=None),
    regime: str | None = Query(default=None),
    days: int = Query(default=30, ge=1, le=730),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict[str, Any]:
    """List historical strategy signals with optional filters.

    Joins each signal with its outcome (when available) so the frontend
    can show win/loss inline without a second round-trip.
    """
    from services.signal_journal import query_history

    try:
        db = _get_supabase_client()
        signals = query_history(
            db,
            strategy=strategy,
            symbol=symbol.upper() if symbol else None,
            grade=grade,
            regime=regime,
            days=days,
            limit=limit,
        )
        if not signals:
            return {"count": 0, "signals": []}

        # Bulk-fetch outcomes
        sig_ids = [s["id"] for s in signals]
        outcomes_map: dict[str, dict] = {}
        for i in range(0, len(sig_ids), 50):
            chunk = sig_ids[i : i + 50]
            outs = (
                db.table("signal_outcomes")
                .select("*")
                .in_("signal_id", chunk)
                .execute()
                .data
                or []
            )
            for o in outs:
                outcomes_map[o["signal_id"]] = o

        for s in signals:
            s["outcome"] = outcomes_map.get(s["id"])

        return {"count": len(signals), "signals": signals}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"journal_history failed: {exc}")


@router.get("/signals/journal/stats")
def journal_stats(
    strategy: str | None = Query(default=None),
    regime: str | None = Query(default=None),
    days: int = Query(default=90, ge=1, le=730),
) -> dict[str, Any]:
    """Aggregate hit-rate / avg-R / etc for closed signals."""
    from services.signal_journal import compute_stats

    try:
        db = _get_supabase_client()
        return compute_stats(db, strategy=strategy, regime=regime, days=days)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"journal_stats failed: {exc}")


@router.get("/signals/journal/{signal_id}")
def journal_get_signal(signal_id: str) -> dict[str, Any]:
    """Retrieve a single strategy_signals row + its outcome (if any)."""
    from services.signal_journal import get_signal_with_outcome

    try:
        db = _get_supabase_client()
        result = get_signal_with_outcome(db, signal_id)
        if not result:
            raise HTTPException(status_code=404, detail="signal not found")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"journal_get failed: {exc}")


@router.post("/signals/journal/scan-now")
def journal_scan_now(payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Manual trigger for the daily scan-and-persist job (admin/testing).

    Body (optional):
      {
        "symbols": ["NVDA", "GOOGL", ...],   // override universe
        "min_grade": "C"                      // default "B"
      }

    If no symbols provided, defaults to all users' watchlists + holdings.
    Synchronous — may take 30-60 seconds depending on universe size.
    """
    from services.regime_classifier import classify
    from services.signal_journal import persist_scan_results
    from services.signal_scorer import score_all
    from services.strategy_router import scan_symbol

    import pandas as pd
    import yfinance as yf
    from datetime import datetime, timezone

    payload = payload or {}
    override_symbols = payload.get("symbols")
    min_grade = (payload.get("min_grade") or "B").upper()
    if min_grade not in ("A", "B", "C"):
        min_grade = "B"

    try:
        db = _get_supabase_client()
        symbols: set[str] = set()
        if override_symbols and isinstance(override_symbols, list):
            symbols.update(
                s.upper().strip()
                for s in override_symbols
                if isinstance(s, str) and s.strip()
            )
        else:
            wl = db.table("watchlists").select("symbol").execute()
            symbols.update(r["symbol"] for r in (wl.data or []) if r.get("symbol"))
            hd = db.table("portfolio_holdings").select("symbol").execute()
            symbols.update(r["symbol"] for r in (hd.data or []) if r.get("symbol"))

        if not symbols:
            return {"status": "ok", "scanned": 0, "persisted": 0}

        scan_results: dict[str, list] = {}
        bar_dt = None
        for sym in sorted(symbols):
            try:
                df = yf.download(
                    sym, period="1y", interval="1d", auto_adjust=True, progress=False
                )
                if df is None or df.empty or len(df) < 60:
                    continue
                if isinstance(df.columns, pd.MultiIndex):
                    df.columns = df.columns.get_level_values(0)
                regime = classify(df).to_dict()
                cands = scan_symbol(sym, df, regime_override=regime)
                scored = score_all(cands, regime, drop_unscored=True)
                scan_results[sym] = scored
                if bar_dt is None:
                    last_ts = df.index[-1]
                    bar_dt = (
                        last_ts.tz_localize("UTC")
                        if hasattr(last_ts, "tz") and last_ts.tz is None
                        else last_ts
                    ).to_pydatetime()
            except Exception:
                continue

        counts = persist_scan_results(
            db, scan_results, bar_datetime=bar_dt, min_grade=min_grade
        )

        # Telegram alert for A-grade signals (Phase H.3)
        a_grade_alerts = 0
        if not payload.get("skip_telegram"):
            try:
                from alerting.telegram import TelegramNotifier
                from config.settings import get_settings
                import asyncio

                a_grade = []
                for sym, scored_list in scan_results.items():
                    for s in scored_list:
                        if s.score_grade == "A":
                            a_grade.append(
                                {
                                    "symbol": s.candidate.symbol,
                                    "strategy_name": s.candidate.strategy_name,
                                    "direction": s.candidate.direction,
                                    "score_grade": "A",
                                    "score_total": s.score_total,
                                    "regime_at_signal": s.candidate.market_regime,
                                    "entry_price": s.candidate.entry_price,
                                    "stop_price": s.candidate.stop_price,
                                    "target_1": s.candidate.target_1,
                                    "target_2": s.candidate.target_2,
                                    "pattern_tags": s.candidate.pattern_tags or [],
                                }
                            )

                if a_grade:
                    settings = get_settings()
                    if settings.telegram_bot_token and settings.telegram_chat_id:
                        notifier = TelegramNotifier(
                            bot_token=settings.telegram_bot_token,
                            chat_id=settings.telegram_chat_id,
                        )
                        # Run the async send synchronously
                        loop = asyncio.new_event_loop()
                        try:
                            if len(a_grade) == 1:
                                loop.run_until_complete(
                                    notifier.send_strategy_signal_alert(a_grade[0])
                                )
                            else:
                                loop.run_until_complete(
                                    notifier.send_strategy_signals_batch(a_grade)
                                )
                            a_grade_alerts = len(a_grade)
                        finally:
                            loop.close()
            except Exception:
                pass  # alert failures shouldn't fail the request

        return {
            "status": "ok",
            "scanned": len(symbols),
            "bar_datetime": bar_dt.isoformat() if bar_dt else None,
            **counts,
            "a_grade_alerts_sent": a_grade_alerts,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"scan-now failed: {exc}")


@router.post("/signals/journal/update-outcomes")
def journal_update_outcomes() -> dict[str, Any]:
    """Manual trigger for outcome update (admin/testing)."""
    from services.signal_journal import update_outcomes

    try:
        db = _get_supabase_client()
        return update_outcomes(db, lookback_days=60, expire_after_days=20)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"update-outcomes failed: {exc}")
