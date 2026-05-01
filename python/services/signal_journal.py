"""Signal Journal — persist scored signals + track outcomes.

This module is the bridge between the in-memory ScoredSignal output of
strategy_router/signal_scorer and the database tables `strategy_signals` +
`signal_outcomes`.

Public API:
    persist_scored_signal(db, scored, ohlcv_datetime) -> str | None
        Insert a scored signal. Returns signal_id, or None if dedup hit
        (same symbol/strategy/date already in DB) or below grade threshold.

    persist_scan_results(db, scan_results, min_grade) -> dict
        Bulk-insert all signals from a scan_universe() output.

    query_history(db, *, strategy, symbol, grade, regime, days, limit) -> list
        Retrieve historical signals with optional filters.

    update_outcomes(db, *, lookback_days) -> dict
        For every active signal in the last N days, fetch fresh OHLCV and
        check if T1/T2/stop has been hit. Updates signal_outcomes + flips
        strategy_signals.status accordingly.

    compute_stats(db, *, strategy, regime, days) -> dict
        Aggregate hit-rate / avg-R / etc over a time window.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import structlog

from services.signal_scorer import ScoredSignal

logger = structlog.get_logger()

# ── Persistence ─────────────────────────────────────────────────────────────


def _scored_to_row(scored: ScoredSignal, ohlcv_datetime: datetime) -> dict:
    """Convert a ScoredSignal → dict matching strategy_signals columns."""
    c = scored.candidate
    # Ensure datetime is timezone-aware UTC
    if ohlcv_datetime.tzinfo is None:
        ohlcv_datetime = ohlcv_datetime.replace(tzinfo=timezone.utc)
    signal_date = ohlcv_datetime.date().isoformat()
    return {
        "symbol": c.symbol,
        "timeframe": "1d",
        "datetime": ohlcv_datetime.isoformat(),
        "signal_date": signal_date,
        "strategy_name": c.strategy_name,
        "regime_at_signal": c.market_regime,
        "direction": c.direction,
        # Scores
        "score_total": float(scored.score_total),
        "score_grade": scored.score_grade,
        "score_market": float(scored.score_market),
        "score_position": float(scored.score_position),
        "score_pattern": float(scored.score_pattern),
        "score_volume": float(scored.score_volume),
        "score_chip": float(scored.score_chip),
        "score_rr": float(scored.score_rr),
        # Trade plan
        "entry_price": float(c.entry_price),
        "stop_price": float(c.stop_price),
        "target_1": float(c.target_1) if c.target_1 is not None else None,
        "target_2": float(c.target_2) if c.target_2 is not None else None,
        "trailing_rule": c.trailing_rule,
        "invalidation_rule": c.invalidation_reason,
        "secondary_entry": bool(c.secondary_entry),
        # Embedded analyses
        "pattern_tags": list(c.pattern_tags or []),
        "raw_features": c.raw_features or {},
        "volume_analysis": c.volume_analysis,
        "chip_analysis": c.chip_analysis,
        # Lifecycle
        "status": "active",
        "notes": c.notes or {},
    }


def persist_scored_signal(
    db,
    scored: ScoredSignal,
    ohlcv_datetime: datetime,
    *,
    min_grade: str = "B",
) -> str | None:
    """Persist a single scored signal to DB.

    Args:
        db: supabase client.
        scored: ScoredSignal output of signal_scorer.score_candidate.
        ohlcv_datetime: timestamp of the bar that triggered the signal.
        min_grade: 'A' / 'B' / 'C' — only persist signals at-or-above this
            grade (default 'B' to keep journal lean — change to 'C' if you
            want to record everything).

    Returns:
        signal_id (UUID string) on success, None if dedup hit / wrong grade.
    """
    grade_order = {"A": 3, "B": 2, "C": 1}
    if scored.score_grade is None:
        return None
    if grade_order.get(scored.score_grade, 0) < grade_order.get(min_grade, 0):
        return None

    row = _scored_to_row(scored, ohlcv_datetime)
    try:
        result = db.table("strategy_signals").insert(row).execute()
        rows = result.data or []
        if rows:
            return rows[0]["id"]
        return None
    except Exception as exc:
        # Dedup violation (uniq_strategy_signals_per_day) is expected when
        # ETL runs twice in a day — log and move on.
        msg = str(exc).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            return None
        logger.warning(
            "signal_persist_failed",
            symbol=scored.candidate.symbol,
            strategy=scored.candidate.strategy_name,
            error=str(exc),
        )
        return None


def persist_scan_results(
    db,
    scan_results: dict[str, list[ScoredSignal]],
    *,
    bar_datetime: datetime | None = None,
    min_grade: str = "B",
) -> dict:
    """Bulk-persist a router scan output.

    Args:
        db: supabase client.
        scan_results: {symbol: [ScoredSignal, ...]} from
            scoring helpers (router output post-score_all).
        bar_datetime: timestamp of the bar (defaults to now-utc).
        min_grade: filter threshold.

    Returns:
        {persisted: int, skipped: int, errors: int}.
    """
    if bar_datetime is None:
        bar_datetime = datetime.now(timezone.utc)

    persisted = 0
    skipped = 0
    errors = 0

    for symbol, scored_list in scan_results.items():
        for scored in scored_list:
            try:
                sid = persist_scored_signal(
                    db, scored, bar_datetime, min_grade=min_grade
                )
                if sid:
                    persisted += 1
                else:
                    skipped += 1
            except Exception as exc:
                errors += 1
                logger.warning(
                    "scan_persist_error", symbol=symbol, error=str(exc)
                )

    return {"persisted": persisted, "skipped": skipped, "errors": errors}


# ── Query ───────────────────────────────────────────────────────────────────


def query_history(
    db,
    *,
    strategy: str | None = None,
    symbol: str | None = None,
    grade: str | None = None,
    regime: str | None = None,
    days: int = 30,
    limit: int = 100,
) -> list[dict]:
    """Fetch historical signals with optional filters."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    q = db.table("strategy_signals").select("*").gte("datetime", cutoff)
    if strategy:
        q = q.eq("strategy_name", strategy)
    if symbol:
        q = q.eq("symbol", symbol.upper())
    if grade:
        q = q.eq("score_grade", grade)
    if regime:
        q = q.eq("regime_at_signal", regime)
    q = q.order("datetime", desc=True).limit(limit)

    try:
        return q.execute().data or []
    except Exception as exc:
        logger.warning("query_history_failed", error=str(exc))
        return []


def get_signal_with_outcome(db, signal_id: str) -> dict | None:
    """Retrieve a single signal + its outcome (if any)."""
    try:
        sig = (
            db.table("strategy_signals")
            .select("*")
            .eq("id", signal_id)
            .limit(1)
            .execute()
            .data
        )
        if not sig:
            return None
        outcome = (
            db.table("signal_outcomes")
            .select("*")
            .eq("signal_id", signal_id)
            .limit(1)
            .execute()
            .data
        )
        result = sig[0]
        result["outcome"] = outcome[0] if outcome else None
        return result
    except Exception as exc:
        logger.warning("get_signal_failed", id=signal_id, error=str(exc))
        return None


# ── Outcome tracking ─────────────────────────────────────────────────────────


def _evaluate_outcome(
    signal: dict, ohlcv_after: pd.DataFrame
) -> dict | None:
    """Walk forward through `ohlcv_after` and decide which level was hit first.

    Returns dict matching signal_outcomes columns, or None if still open.
    """
    if ohlcv_after.empty:
        return None

    direction = signal["direction"]
    entry = float(signal["entry_price"])
    stop = float(signal["stop_price"])
    t1 = float(signal["target_1"]) if signal.get("target_1") else None
    t2 = float(signal["target_2"]) if signal.get("target_2") else None

    risk = abs(entry - stop)
    if risk <= 0:
        return None

    high = ohlcv_after["High"].astype(float)
    low = ohlcv_after["Low"].astype(float)

    mfe_r = 0.0
    mae_r = 0.0

    for i in range(len(ohlcv_after)):
        bar_high = float(high.iloc[i])
        bar_low = float(low.iloc[i])
        bar_dt = ohlcv_after.index[i]

        if direction == "long":
            # Excursion in R units
            adverse = (entry - bar_low) / risk
            favorable = (bar_high - entry) / risk
            mae_r = max(mae_r, adverse)
            mfe_r = max(mfe_r, favorable)

            # Order check: assume worst-case (intra-bar can't tell sequence
            # — be conservative: if bar's low touched stop, treat as stop).
            if bar_low <= stop:
                return _outcome_row(
                    signal,
                    exit_price=stop,
                    exit_dt=bar_dt,
                    reason="stop",
                    bars=i + 1,
                    mfe_r=mfe_r,
                    mae_r=mae_r,
                    risk=risk,
                )
            if t2 and bar_high >= t2:
                return _outcome_row(
                    signal,
                    exit_price=t2,
                    exit_dt=bar_dt,
                    reason="target_2",
                    bars=i + 1,
                    mfe_r=mfe_r,
                    mae_r=mae_r,
                    risk=risk,
                )
            if t1 and bar_high >= t1:
                return _outcome_row(
                    signal,
                    exit_price=t1,
                    exit_dt=bar_dt,
                    reason="target_1",
                    bars=i + 1,
                    mfe_r=mfe_r,
                    mae_r=mae_r,
                    risk=risk,
                )
        else:  # short
            adverse = (bar_high - entry) / risk
            favorable = (entry - bar_low) / risk
            mae_r = max(mae_r, adverse)
            mfe_r = max(mfe_r, favorable)

            if bar_high >= stop:
                return _outcome_row(
                    signal,
                    exit_price=stop,
                    exit_dt=bar_dt,
                    reason="stop",
                    bars=i + 1,
                    mfe_r=mfe_r,
                    mae_r=mae_r,
                    risk=risk,
                )
            if t2 and bar_low <= t2:
                return _outcome_row(
                    signal,
                    exit_price=t2,
                    exit_dt=bar_dt,
                    reason="target_2",
                    bars=i + 1,
                    mfe_r=mfe_r,
                    mae_r=mae_r,
                    risk=risk,
                )
            if t1 and bar_low <= t1:
                return _outcome_row(
                    signal,
                    exit_price=t1,
                    exit_dt=bar_dt,
                    reason="target_1",
                    bars=i + 1,
                    mfe_r=mfe_r,
                    mae_r=mae_r,
                    risk=risk,
                )

    # Still open after lookback window
    return None


def _outcome_row(
    signal: dict,
    *,
    exit_price: float,
    exit_dt,
    reason: str,
    bars: int,
    mfe_r: float,
    mae_r: float,
    risk: float,
) -> dict:
    entry = float(signal["entry_price"])
    direction = signal["direction"]
    if direction == "long":
        pnl = exit_price - entry
    else:
        pnl = entry - exit_price
    pnl_r = pnl / risk if risk > 0 else 0
    pnl_pct = pnl / entry * 100 if entry > 0 else 0
    return {
        "signal_id": signal["id"],
        "entry_datetime": signal["datetime"],
        "exit_datetime": pd.Timestamp(exit_dt).isoformat(),
        "entry_executed_price": float(entry),
        "exit_executed_price": float(round(exit_price, 4)),
        "pnl": float(round(pnl, 4)),
        "pnl_r": float(round(pnl_r, 3)),
        "pnl_pct": float(round(pnl_pct, 3)),
        "mfe": float(round(mfe_r, 3)),
        "mae": float(round(mae_r, 3)),
        "exit_reason": reason,
        "bars_held": int(bars),
        "followed_rules": True,
    }


def update_outcomes(
    db,
    *,
    lookback_days: int = 60,
    expire_after_days: int = 20,
) -> dict:
    """For every active signal in the last `lookback_days`, fetch fresh OHLCV
    and check if T1/T2/stop has been hit. Mark expired if older than
    `expire_after_days` and still open."""
    import yfinance as yf

    cutoff = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()
    try:
        active = (
            db.table("strategy_signals")
            .select("*")
            .eq("status", "active")
            .gte("datetime", cutoff)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        logger.warning("update_outcomes_fetch_failed", error=str(exc))
        return {"checked": 0, "closed": 0, "expired": 0, "still_open": 0}

    closed = 0
    expired = 0
    still_open = 0

    for sig in active:
        try:
            sym = sig["symbol"]
            sig_date = pd.Timestamp(sig["datetime"]).tz_convert("UTC")
            # Pull data from sig_date onwards
            df = yf.download(
                sym,
                start=sig_date.strftime("%Y-%m-%d"),
                period=None,
                interval="1d",
                auto_adjust=True,
                progress=False,
            )
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)
            if df is None or df.empty:
                continue

            # Skip the bar of signal itself — outcome based on subsequent bars
            df_after = df.iloc[1:] if len(df) > 1 else df.iloc[0:0]

            outcome = _evaluate_outcome(sig, df_after)
            if outcome:
                # Insert outcome (or update on conflict)
                try:
                    db.table("signal_outcomes").upsert(
                        outcome, on_conflict="signal_id"
                    ).execute()
                except Exception as exc:
                    logger.warning("outcome_upsert_failed", id=sig["id"], error=str(exc))
                    continue
                # Flip signal status
                new_status = (
                    "closed"
                    if outcome["exit_reason"] in ("target_1", "target_2", "stop", "trailing")
                    else "invalidated"
                )
                db.table("strategy_signals").update({"status": new_status}).eq(
                    "id", sig["id"]
                ).execute()
                closed += 1
            else:
                # Check expiration
                age_days = (
                    datetime.now(timezone.utc) - pd.Timestamp(sig["datetime"]).to_pydatetime()
                ).days
                if age_days > expire_after_days:
                    db.table("strategy_signals").update({"status": "expired"}).eq(
                        "id", sig["id"]
                    ).execute()
                    expired += 1
                else:
                    still_open += 1
        except Exception as exc:
            logger.warning(
                "outcome_check_failed", id=sig.get("id"), error=str(exc)
            )

    return {
        "checked": len(active),
        "closed": closed,
        "expired": expired,
        "still_open": still_open,
    }


# ── Stats ───────────────────────────────────────────────────────────────────


def compute_stats(
    db,
    *,
    strategy: str | None = None,
    regime: str | None = None,
    days: int = 90,
) -> dict:
    """Aggregate win-rate / avg-R / etc for closed signals.

    Returns:
        {
            total: int,
            closed: int,
            wins: int (pnl_r > 0),
            losses: int (pnl_r ≤ 0),
            win_rate: float (0-1),
            avg_r: float,
            avg_winner_r: float,
            avg_loser_r: float,
            best_r: float,
            worst_r: float,
            by_grade: {A: {...}, B: {...}, C: {...}},
            by_strategy: {...},
        }
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        # Join via two queries (Supabase Python client doesn't easily JOIN)
        sigs = db.table("strategy_signals").select("*").gte("datetime", cutoff)
        if strategy:
            sigs = sigs.eq("strategy_name", strategy)
        if regime:
            sigs = sigs.eq("regime_at_signal", regime)
        signals = sigs.execute().data or []
        sig_ids = [s["id"] for s in signals]
        if not sig_ids:
            return {"total": 0, "closed": 0, "wins": 0, "losses": 0, "win_rate": 0,
                    "avg_r": 0, "avg_winner_r": 0, "avg_loser_r": 0,
                    "best_r": 0, "worst_r": 0,
                    "by_grade": {}, "by_strategy": {}}

        # Fetch outcomes in chunks (Supabase has IN limit ~50)
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
    except Exception as exc:
        logger.warning("compute_stats_failed", error=str(exc))
        return {"total": 0, "closed": 0, "wins": 0, "losses": 0, "win_rate": 0,
                "avg_r": 0, "avg_winner_r": 0, "avg_loser_r": 0,
                "best_r": 0, "worst_r": 0,
                "by_grade": {}, "by_strategy": {}}

    closed_outcomes = [o for o in outcomes_map.values() if o.get("pnl_r") is not None]
    pnl_rs = [float(o["pnl_r"]) for o in closed_outcomes]
    wins = [r for r in pnl_rs if r > 0]
    losses = [r for r in pnl_rs if r <= 0]

    def _agg(rs: list[float]) -> dict:
        if not rs:
            return {"count": 0, "wins": 0, "losses": 0, "win_rate": 0,
                    "avg_r": 0, "avg_winner_r": 0, "avg_loser_r": 0}
        ws = [r for r in rs if r > 0]
        ls = [r for r in rs if r <= 0]
        return {
            "count": len(rs),
            "wins": len(ws),
            "losses": len(ls),
            "win_rate": round(len(ws) / len(rs), 3) if rs else 0,
            "avg_r": round(sum(rs) / len(rs), 3),
            "avg_winner_r": round(sum(ws) / len(ws), 3) if ws else 0,
            "avg_loser_r": round(sum(ls) / len(ls), 3) if ls else 0,
        }

    # Group by grade and strategy
    by_grade: dict[str, list[float]] = {"A": [], "B": [], "C": []}
    by_strategy: dict[str, list[float]] = {}
    for s in signals:
        out = outcomes_map.get(s["id"])
        if not out or out.get("pnl_r") is None:
            continue
        r = float(out["pnl_r"])
        if s["score_grade"] in by_grade:
            by_grade[s["score_grade"]].append(r)
        by_strategy.setdefault(s["strategy_name"], []).append(r)

    return {
        "total": len(signals),
        "closed": len(closed_outcomes),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(pnl_rs), 3) if pnl_rs else 0,
        "avg_r": round(sum(pnl_rs) / len(pnl_rs), 3) if pnl_rs else 0,
        "avg_winner_r": round(sum(wins) / len(wins), 3) if wins else 0,
        "avg_loser_r": round(sum(losses) / len(losses), 3) if losses else 0,
        "best_r": round(max(pnl_rs), 3) if pnl_rs else 0,
        "worst_r": round(min(pnl_rs), 3) if pnl_rs else 0,
        "by_grade": {k: _agg(v) for k, v in by_grade.items()},
        "by_strategy": {k: _agg(v) for k, v in by_strategy.items()},
    }
