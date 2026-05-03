"""Factor Snapshot — monthly point-in-time factor values for OOS backtest.

WHY this exists:
    The backtest in factor_research.py uses CURRENT factor values to filter
    stocks, then computes their PAST returns — classic look-ahead bias.

    A true point-in-time backtest needs factor values AS OF each rebalance
    date. We don't have historical fundamental data (yfinance only returns
    TTM/latest), so we can't reconstruct old snapshots. The only fix is:
    snapshot the factors NOW, every month, and accumulate over time.

    After 6 monthly snapshots, the OOS backtest becomes meaningful.
    After 12-24 months, results are robust.

WHAT this snapshots:
    - All 14 raw factors (FACTOR_NAMES from factor_universe)
    - Sector + market_cap meta
    - For ENTIRE current SP500 universe

USAGE:
    snapshot_now(snapshot_date=None) -> dict      # date defaults to today
    get_snapshot_status() -> dict                 # how many snapshots exist
    get_pit_panel(snapshot_date) -> pd.DataFrame  # read PIT factors

Run via:
    - Manual: POST /v1/factors/snapshot/run
    - Auto: scheduler.py monthly cron (1st of month, 22:00 UTC)
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from typing import Any

import pandas as pd

from services.factor_profile import _compute_raw_factors
from services.factor_universe import FACTOR_NAMES
from services.financials_provider import FinancialsError
from services.universe_provider import get_sp500

logger = logging.getLogger(__name__)


# ── In-memory snapshot progress (similar to refresh_universe) ─────────────

_snapshot_state: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "snapshot_date": None,
    "total": 0,
    "completed": 0,
    "persisted": 0,
    "errors": 0,
    "last_symbol": None,
    "duration_s": 0,
}
_snapshot_lock = threading.Lock()


def get_snapshot_progress() -> dict[str, Any]:
    """Snapshot of current snapshot-job progress."""
    with _snapshot_lock:
        snap = dict(_snapshot_state)
    if snap["running"] and snap["completed"] > 0 and snap["started_at"]:
        elapsed = time.time() - snap["started_at"]
        rate = snap["completed"] / elapsed
        remaining = snap["total"] - snap["completed"]
        snap["eta_seconds"] = int(remaining / rate) if rate > 0 else None
        snap["elapsed_s"] = round(elapsed, 1)
    else:
        snap["eta_seconds"] = None
        snap["elapsed_s"] = round(snap.get("duration_s", 0), 1)
    return snap


# ── DB helpers ─────────────────────────────────────────────────────────────

def _get_supabase():
    from supabase import create_client
    from config.settings import get_settings
    s = get_settings()
    if not s.has_supabase_config:
        raise RuntimeError("Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _snapshot_one(sym: str, snapshot_iso: str) -> dict[str, Any]:
    """Compute factors for one symbol and upsert to factor_history."""
    db = _get_supabase()
    try:
        raw = _compute_raw_factors(sym)
        sector = raw.pop("_sector", None)
        from services.financials_provider import get_company_info
        try:
            info = get_company_info(sym)
            market_cap = info.get("marketCap")
        except FinancialsError:
            market_cap = None

        rows = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for fname in FACTOR_NAMES:
            v = raw.get(fname)
            if v is None or (isinstance(v, float) and (v != v)):
                continue
            rows.append({
                "symbol": sym,
                "factor_name": fname,
                "factor_value": float(v),
                "snapshot_date": snapshot_iso,
                "computed_at": now_iso,
                "sector": sector,
                "market_cap": float(market_cap) if market_cap else None,
            })

        if not rows:
            return {"symbol": sym, "status": "no_data"}

        # Upsert on (symbol, factor_name, snapshot_date) PK
        db.table("factor_history").upsert(rows).execute()
        return {"symbol": sym, "status": "persisted"}
    except Exception as exc:
        return {"symbol": sym, "status": "error", "error": str(exc)[:120]}


# ── Public: snapshot the current SP500 universe ─────────────────────────────

def snapshot_now_async(
    snapshot_date: date | None = None,
    *,
    universe: list[str] | None = None,
    max_workers: int = 5,
) -> dict[str, Any]:
    """Kick off background snapshot of SP500 universe with given snapshot_date.

    Args:
        snapshot_date: 'as of' date for this snapshot (defaults to today UTC)
        universe: list of symbols (defaults to current SP500)
        max_workers: concurrent yfinance fetchers (default 5)

    Returns:
        {started: bool, snapshot_date, total, message}
    """
    if snapshot_date is None:
        snapshot_date = datetime.now(timezone.utc).date()
    syms = [s.upper() for s in (universe or get_sp500())]

    with _snapshot_lock:
        if _snapshot_state["running"]:
            return {
                "started": False,
                "message": "Snapshot already in progress",
                "completed": _snapshot_state["completed"],
                "total": _snapshot_state["total"],
            }
        _snapshot_state.update({
            "running": True,
            "started_at": time.time(),
            "snapshot_date": snapshot_date.isoformat(),
            "total": len(syms),
            "completed": 0,
            "persisted": 0,
            "errors": 0,
            "last_symbol": None,
            "duration_s": 0,
        })

    def _worker():
        try:
            snapshot_iso = snapshot_date.isoformat()
            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futures = {
                    ex.submit(_snapshot_one, sym, snapshot_iso): sym
                    for sym in syms
                }
                for fut in as_completed(futures):
                    sym = futures[fut]
                    try:
                        result = fut.result()
                    except Exception as exc:
                        result = {"symbol": sym, "status": "error", "error": str(exc)[:120]}
                    with _snapshot_lock:
                        _snapshot_state["completed"] += 1
                        _snapshot_state["last_symbol"] = sym
                        if result.get("status") == "persisted":
                            _snapshot_state["persisted"] += 1
                        else:
                            _snapshot_state["errors"] += 1
        finally:
            with _snapshot_lock:
                _snapshot_state["running"] = False
                if _snapshot_state["started_at"]:
                    _snapshot_state["duration_s"] = round(
                        time.time() - _snapshot_state["started_at"], 1
                    )

    t = threading.Thread(target=_worker, daemon=True, name="factor-snapshot")
    t.start()

    return {
        "started": True,
        "snapshot_date": snapshot_date.isoformat(),
        "total": len(syms),
        "message": f"Snapshotting {len(syms)} symbols as of {snapshot_date.isoformat()} ({max_workers} workers)",
    }


# ── Status ──────────────────────────────────────────────────────────────────

def get_snapshot_status() -> dict[str, Any]:
    """How many monthly snapshots do we have, and what dates?"""
    db = _get_supabase()
    try:
        # Distinct snapshot_dates (paginate; supabase REST has no DISTINCT).
        # Use momentum_60d as the probe factor — it's technical (present in
        # backfilled snapshots) AND in normal snapshots, so this returns ALL
        # distinct dates regardless of source.
        rows: list[dict] = []
        offset = 0
        while True:
            resp = (
                db.table("factor_history")
                .select("snapshot_date")
                .eq("factor_name", "momentum_60d")
                .order("snapshot_date", desc=True)
                .range(offset, offset + 999)
                .execute()
            )
            batch = resp.data or []
            rows.extend(batch)
            if len(batch) < 1000:
                break
            offset += 1000

        dates = sorted({r["snapshot_date"] for r in rows}, reverse=True)
        total_count = (
            db.table("factor_history").select("symbol", count="exact").execute()
        )

        return {
            "n_snapshots": len(dates),
            "dates": dates[:24],   # show last 24 months
            "latest_snapshot": dates[0] if dates else None,
            "total_rows": total_count.count or 0,
            "ready_for_pit_backtest": len(dates) >= 6,
            "needs_n_more_for_robust": max(0, 12 - len(dates)),
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_pit_panel(snapshot_date: str) -> pd.DataFrame:
    """Load factor snapshot for a specific date as a pivoted DataFrame.
    Columns: factors + sector + market_cap. Rows: symbols.
    """
    db = _get_supabase()
    rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("factor_history")
            .select("symbol,factor_name,factor_value,sector,market_cap")
            .eq("snapshot_date", snapshot_date)
            .range(offset, offset + 999)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000

    if not rows:
        return pd.DataFrame()

    df_long = pd.DataFrame(rows)
    pivoted = df_long.pivot_table(
        index="symbol",
        columns="factor_name",
        values="factor_value",
        aggfunc="first",
    )
    meta = df_long.groupby("symbol")[["sector", "market_cap"]].first()
    return pivoted.join(meta)
