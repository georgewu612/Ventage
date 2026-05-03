"""Factor Universe — full-market factor computation with Supabase cache.

Compute the 6 style factors for an entire universe of stocks (e.g. S&P 100 /
Russell 1000 subset / custom watchlist), cache results in Supabase for 24h,
and expose a DataFrame interface for cross-section research.

Pipeline:
    1. For each symbol, compute raw factor values via factor_profile._compute_raw_factors
    2. Bulk-upsert into `factor_universe` table (24h TTL)
    3. Read fresh rows back as a DataFrame for analysis

This is intentionally **synchronous + sequential**. yfinance has unofficial
rate limits and parallel calls have caused failures in production. Cold runs
take ~3-5 seconds per symbol = ~3-5 minutes for 50 symbols. Subsequent calls
hit cache and return in <1 second.

Public API:
    refresh_universe(symbols, force=False) -> dict       # ETL trigger
    get_universe_panel(symbols=None, factor_names=None) -> pd.DataFrame
    get_default_universe() -> list[str]                  # SP100-ish
"""

from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from services.factor_profile import _compute_raw_factors
from services.financials_provider import FinancialsError

logger = logging.getLogger(__name__)


CACHE_TTL_HOURS = 24

# Original 6 + Phase III 8 new = 14 raw factors
FACTOR_NAMES = [
    # Original 6 (style)
    "value", "quality", "momentum", "size", "low_vol", "low_inv",
    # Phase III: technical / structure (8 new)
    "momentum_60d", "momentum_120d", "breakout_20d", "new_high_52w",
    "volume_spike_5d", "volume_trend_20d", "rs_vs_spy", "sector_strength",
]

# Cluster definitions — only multi-factor clusters (single-member ones
# would duplicate their underlying factor in the UI with no info gain).
CLUSTERS: dict[str, list[str]] = {
    "momentum_cluster": [
        "momentum", "momentum_60d", "momentum_120d", "breakout_20d", "new_high_52w",
    ],
    "volume_cluster": [
        "volume_spike_5d", "volume_trend_20d",
    ],
    "structure_cluster": [
        "rs_vs_spy", "sector_strength",
    ],
}

# Factors that are constant within sector — sector-neutralization would zero
# them out, so we exclude them from sector demean.
SECTOR_CONSTANT_FACTORS = {"sector_strength"}


# ── Default universe: S&P 100-ish (large-cap representatives) ────────────────

DEFAULT_UNIVERSE = [
    # Tech (10)
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "CSCO", "INTC",
    # Communication (6)
    "GOOGL", "META", "NFLX", "T", "VZ", "DIS",
    # Consumer Cyclical (6)
    "AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX",
    # Consumer Defensive (5)
    "WMT", "COST", "PG", "KO", "PEP",
    # Healthcare (8)
    "UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK", "TMO", "ABT",
    # Financials (8) — included for sector breadth even though F-Score N/A
    "JPM", "BAC", "WFC", "GS", "MS", "BLK", "V", "MA",
    # Industrials (6)
    "CAT", "DE", "BA", "HON", "UPS", "GE",
    # Energy (3)
    "XOM", "CVX", "COP",
    # Materials (2)
    "LIN", "SHW",
    # Real Estate (2)
    "PLD", "AMT",
    # Utilities (3)
    "NEE", "DUK", "SO",
]


def get_default_universe() -> list[str]:
    return list(DEFAULT_UNIVERSE)


# ── DB helpers ───────────────────────────────────────────────────────────────

def _get_supabase():
    from supabase import create_client
    from config.settings import get_settings
    s = get_settings()
    if not s.has_supabase_config:
        raise RuntimeError("Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


# ── Refresh / write path ─────────────────────────────────────────────────────

def refresh_universe(
    symbols: list[str] | None = None,
    *,
    force: bool = False,
    db=None,
) -> dict[str, Any]:
    """Compute factor values for `symbols` and upsert to factor_universe.

    Args:
        symbols: list of tickers (default: DEFAULT_UNIVERSE)
        force: if True, recompute even when cache is fresh
        db: optional supabase client (created on demand if None)

    Returns:
        {persisted: int, skipped: int, errors: int, duration_s: float}
    """
    syms = [s.upper() for s in (symbols or DEFAULT_UNIVERSE)]
    if db is None:
        db = _get_supabase()

    t0 = time.time()
    persisted = 0
    skipped = 0
    errors = 0

    # Find symbols whose ALL FACTOR_NAMES are fresh in cache.
    # A symbol is only "fresh" if it has all 14 factor values within TTL —
    # otherwise we recompute (handles the case of newly-added factors).
    fresh_set: set[str] = set()
    if not force:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            resp = (
                db.table("factor_universe")
                .select("symbol,factor_name")
                .gt("expires_at", now_iso)
                .in_("symbol", syms)
                .execute()
            )
            # Build per-symbol set of fresh factor names
            sym_factors: dict[str, set[str]] = {}
            for r in (resp.data or []):
                sym_factors.setdefault(r["symbol"], set()).add(r["factor_name"])
            # Symbol is fresh only if it has every required factor
            required = set(FACTOR_NAMES)
            fresh_set = {
                sym for sym, fnames in sym_factors.items()
                if required.issubset(fnames)
            }
        except Exception as exc:
            logger.warning("Cache probe failed: %s", exc)

    expires_at = datetime.now(timezone.utc) + timedelta(hours=CACHE_TTL_HOURS)
    expires_iso = expires_at.isoformat()

    for sym in syms:
        if sym in fresh_set and not force:
            skipped += 1
            continue

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
                # NaN check
                if v is None or (isinstance(v, float) and (v != v)):
                    continue
                rows.append({
                    "symbol": sym,
                    "factor_name": fname,
                    "factor_value": float(v),
                    "computed_at": now_iso,
                    "expires_at": expires_iso,
                    "sector": sector,
                    "market_cap": float(market_cap) if market_cap else None,
                })

            if rows:
                # Upsert in one round trip
                db.table("factor_universe").upsert(rows).execute()
                persisted += 1
            else:
                errors += 1
                logger.info("No factors computed for %s", sym)
        except Exception as exc:
            errors += 1
            logger.warning("Factor compute failed for %s: %s", sym, exc)

    duration = time.time() - t0
    return {
        "persisted": persisted,
        "skipped_cached": skipped,
        "errors": errors,
        "total": len(syms),
        "duration_s": round(duration, 1),
    }


# ── Background + concurrent refresh (Phase IV: SP500 scale) ─────────────────

_refresh_state: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "universe_name": None,
    "total": 0,
    "completed": 0,
    "persisted": 0,
    "skipped_cached": 0,
    "errors": 0,
    "error_samples": [],
    "last_symbol": None,
    "duration_s": 0,
}
_refresh_lock = threading.Lock()


def get_refresh_progress() -> dict[str, Any]:
    """Snapshot of current background refresh status."""
    with _refresh_lock:
        snapshot = dict(_refresh_state)
    # Compute ETA
    if snapshot["running"] and snapshot["completed"] > 0 and snapshot["started_at"]:
        elapsed = time.time() - snapshot["started_at"]
        rate = snapshot["completed"] / elapsed   # symbols/sec
        remaining = snapshot["total"] - snapshot["completed"]
        eta_seconds = int(remaining / rate) if rate > 0 else None
        snapshot["eta_seconds"] = eta_seconds
        snapshot["elapsed_s"] = round(elapsed, 1)
    else:
        snapshot["eta_seconds"] = None
        snapshot["elapsed_s"] = round(snapshot.get("duration_s", 0), 1)
    return snapshot


def _compute_one(sym: str, fresh_set: set[str], force: bool, expires_iso: str) -> dict[str, Any]:
    """Compute factors for one symbol and persist. Returns status dict."""
    if sym in fresh_set and not force:
        return {"symbol": sym, "status": "skipped"}

    db = _get_supabase()   # each thread gets its own client (supabase-py is thread-safe enough for this)

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
                "computed_at": now_iso,
                "expires_at": expires_iso,
                "sector": sector,
                "market_cap": float(market_cap) if market_cap else None,
            })

        if not rows:
            return {"symbol": sym, "status": "no_data"}

        db.table("factor_universe").upsert(rows).execute()
        return {"symbol": sym, "status": "persisted"}

    except Exception as exc:
        return {"symbol": sym, "status": "error", "error": str(exc)[:120]}


def refresh_universe_async(
    symbols: list[str] | None = None,
    *,
    universe_name: str = "core50",
    force: bool = False,
    max_workers: int = 5,
) -> dict[str, Any]:
    """Kick off a background refresh, return immediately.

    The actual work runs in a daemon thread with `max_workers` concurrent
    yfinance fetches. Poll get_refresh_progress() for status.

    Returns:
        {started: bool, total: int, message: str}
    """
    syms = [s.upper() for s in (symbols or DEFAULT_UNIVERSE)]

    with _refresh_lock:
        if _refresh_state["running"]:
            return {
                "started": False,
                "message": "Refresh already in progress",
                "total": _refresh_state["total"],
                "completed": _refresh_state["completed"],
            }
        # Initialize state
        _refresh_state.update({
            "running": True,
            "started_at": time.time(),
            "universe_name": universe_name,
            "total": len(syms),
            "completed": 0,
            "persisted": 0,
            "skipped_cached": 0,
            "errors": 0,
            "error_samples": [],
            "last_symbol": None,
            "duration_s": 0,
        })

    def _worker():
        try:
            # Probe cache once for fresh symbols
            db = _get_supabase()
            fresh_set: set[str] = set()
            if not force:
                try:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    resp = (
                        db.table("factor_universe")
                        .select("symbol,factor_name")
                        .gt("expires_at", now_iso)
                        .in_("symbol", syms)
                        .execute()
                    )
                    sym_factors: dict[str, set[str]] = {}
                    for r in (resp.data or []):
                        sym_factors.setdefault(r["symbol"], set()).add(r["factor_name"])
                    required = set(FACTOR_NAMES)
                    fresh_set = {
                        s for s, fnames in sym_factors.items()
                        if required.issubset(fnames)
                    }
                except Exception as exc:
                    logger.warning("Cache probe failed: %s", exc)

            expires_at = datetime.now(timezone.utc) + timedelta(hours=CACHE_TTL_HOURS)
            expires_iso = expires_at.isoformat()

            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futures = {
                    ex.submit(_compute_one, sym, fresh_set, force, expires_iso): sym
                    for sym in syms
                }
                for fut in as_completed(futures):
                    sym = futures[fut]
                    try:
                        result = fut.result()
                    except Exception as exc:
                        result = {"symbol": sym, "status": "error", "error": str(exc)[:120]}
                    with _refresh_lock:
                        _refresh_state["completed"] += 1
                        _refresh_state["last_symbol"] = sym
                        status = result.get("status")
                        if status == "persisted":
                            _refresh_state["persisted"] += 1
                        elif status == "skipped":
                            _refresh_state["skipped_cached"] += 1
                        else:
                            _refresh_state["errors"] += 1
                            if len(_refresh_state["error_samples"]) < 10 and result.get("error"):
                                _refresh_state["error_samples"].append(
                                    f"{sym}: {result['error']}"
                                )

        finally:
            with _refresh_lock:
                _refresh_state["running"] = False
                _refresh_state["duration_s"] = round(
                    time.time() - _refresh_state["started_at"], 1
                ) if _refresh_state["started_at"] else 0

    t = threading.Thread(target=_worker, daemon=True, name="factor-refresh")
    t.start()

    return {
        "started": True,
        "total": len(syms),
        "universe_name": universe_name,
        "message": f"Refreshing {len(syms)} symbols in background ({max_workers} workers)",
    }


# ── Read path (analysis) ─────────────────────────────────────────────────────

def winsorize(s: pd.Series, sigma: float = 3.0) -> pd.Series:
    """Clip values to ±sigma standard deviations from the mean."""
    if s.empty or s.std() == 0:
        return s
    mean = s.mean()
    std = s.std()
    return s.clip(lower=mean - sigma * std, upper=mean + sigma * std)


def sector_neutralize(panel: pd.DataFrame, factor_cols: list[str], sector_col: str = "sector") -> pd.DataFrame:
    """Subtract sector mean from each factor (within-sector demean).

    This removes the sector effect so a "Quality" factor measures
    quality WITHIN sector, not "tech is high quality".

    Skips factors in SECTOR_CONSTANT_FACTORS (e.g. sector_strength,
    which is identical for all stocks in the same sector — demean would
    zero it out, destroying the signal).
    """
    if sector_col not in panel.columns:
        return panel
    out = panel.copy()
    for col in factor_cols:
        if col not in out.columns or col in SECTOR_CONSTANT_FACTORS:
            continue
        sector_means = out.groupby(sector_col)[col].transform("mean")
        demeaned = out[col] - sector_means
        # Safety: if demeaning destroyed all variance, restore original
        if demeaned.std() == 0 or pd.isna(demeaned.std()):
            continue
        out[col] = demeaned
    return out


def standardize(panel: pd.DataFrame, factor_cols: list[str]) -> pd.DataFrame:
    """Cross-sectional z-score: (x - mean) / std per column."""
    out = panel.copy()
    for col in factor_cols:
        if col not in out.columns:
            continue
        s = out[col]
        if s.std() > 0:
            out[col] = (s - s.mean()) / s.std()
        else:
            out[col] = 0
    return out


def compute_clusters(panel: pd.DataFrame) -> pd.DataFrame:
    """Add cluster columns = mean of constituent factors (after standardization).

    Should be called AFTER winsorize → sector_neutralize → standardize so all
    factors are on the same z-score scale.
    """
    out = panel.copy()
    for cluster_name, factor_list in CLUSTERS.items():
        cols = [f for f in factor_list if f in out.columns]
        if not cols:
            out[cluster_name] = float("nan")
            continue
        out[cluster_name] = out[cols].mean(axis=1, skipna=True)
    return out


def get_universe_panel(
    symbols: list[str] | None = None,
    factor_names: list[str] | None = None,
    *,
    fresh_only: bool = True,
    transform: str = "raw",
    include_clusters: bool = False,
    db=None,
) -> pd.DataFrame:
    """Read cached factor values into a wide DataFrame.

    Args:
        transform: 'raw' | 'winsorized' | 'sector_neutral' | 'z_score' | 'full_pipeline'
            - raw: as-stored values
            - winsorized: clip ±3σ
            - sector_neutral: winsorize + within-sector demean
            - z_score: winsorize + sector_neutral + cross-section z-score
            - full_pipeline: alias for z_score
        include_clusters: if True, append cluster columns (require z_score transform)

    Returns DataFrame: rows = symbols, columns = factors, plus a 'sector'
    and 'market_cap' meta column.

    Args:
        symbols: filter to these tickers (default: all in cache)
        factor_names: filter to these factors (default: all 6)
        fresh_only: skip rows where expires_at < now
    """
    if db is None:
        db = _get_supabase()

    factors = factor_names or FACTOR_NAMES

    # Pull rows
    query = db.table("factor_universe").select(
        "symbol,factor_name,factor_value,sector,market_cap,expires_at"
    ).in_("factor_name", factors)
    if symbols:
        query = query.in_("symbol", [s.upper() for s in symbols])
    if fresh_only:
        now_iso = datetime.now(timezone.utc).isoformat()
        query = query.gt("expires_at", now_iso)

    resp = query.execute()
    rows = resp.data or []
    if not rows:
        return pd.DataFrame(columns=factors + ["sector", "market_cap"])

    # Pivot long → wide
    df_long = pd.DataFrame(rows)
    pivoted = df_long.pivot_table(
        index="symbol",
        columns="factor_name",
        values="factor_value",
        aggfunc="first",
    )

    # Reattach meta
    meta = (
        df_long.groupby("symbol")[["sector", "market_cap"]].first()
    )
    result = pivoted.join(meta)

    # Ensure all factor columns exist (fill missing with NaN)
    for f in factors:
        if f not in result.columns:
            result[f] = float("nan")

    # Apply transformation pipeline
    if transform != "raw":
        result = winsorize_panel(result, factors)
        if transform in ("sector_neutral", "z_score", "full_pipeline"):
            result = sector_neutralize(result, factors)
        if transform in ("z_score", "full_pipeline"):
            result = standardize(result, factors)

    if include_clusters:
        result = compute_clusters(result)

    # Reorder columns
    base_cols = factors + ["sector", "market_cap"]
    cluster_cols = list(CLUSTERS.keys()) if include_clusters else []
    cols_in_result = base_cols + [c for c in cluster_cols if c in result.columns]
    return result[cols_in_result]


def winsorize_panel(panel: pd.DataFrame, factor_cols: list[str], sigma: float = 3.0) -> pd.DataFrame:
    """Apply winsorize to multiple columns of a panel."""
    out = panel.copy()
    for col in factor_cols:
        if col in out.columns:
            out[col] = winsorize(out[col], sigma=sigma)
    return out


# ── Status ────────────────────────────────────────────────────────────────────

def get_status(db=None) -> dict[str, Any]:
    """Return universe cache statistics."""
    if db is None:
        db = _get_supabase()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        fresh = db.table("factor_universe").select("symbol", count="exact").gt(
            "expires_at", now_iso
        ).execute()
        total = db.table("factor_universe").select("symbol", count="exact").execute()
        return {
            "fresh_rows": fresh.count or 0,
            "total_rows": total.count or 0,
            "cache_ttl_hours": CACHE_TTL_HOURS,
            "factors_per_symbol": len(FACTOR_NAMES),
            "factor_names": FACTOR_NAMES,
        }
    except Exception as exc:
        return {"error": str(exc)}
