"""Factor Backfill — historical reconstruction of TECHNICAL factors.

Computes 10-of-14 factors at past month-end dates for every SP500 stock,
using only price/volume data that was available at each historical date
(no look-ahead). Saves to factor_history table for use by PIT backtest.

WHY only technical factors?
    Fundamental factors (value, quality, size, low_inv) require
    point-in-time financial statements with restatement timestamps.
    yfinance only gives us LATEST statements — using them retroactively
    causes restatement bias. We accept this limitation and backfill
    only what we can do correctly.

WHAT 10 factors get backfilled:
    momentum, momentum_60d, momentum_120d, breakout_20d, new_high_52w,
    low_vol, volume_spike_5d, volume_trend_20d, rs_vs_spy, sector_strength

EFFICIENCY:
    For each stock, fetch full 5y price history ONCE.
    Then slice to each month-end and compute factors locally.
    500 SP500 × 1 yfinance call = ~500 API calls total.
    With 5 concurrent workers: ~3-5 minutes for full backfill.

Public API:
    backfill_universe_async(lookback_months=24, ...) -> dict
    get_backfill_progress() -> dict
"""

from __future__ import annotations

import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf

from services.factor_profile import SECTOR_ETF_MAP
from services.financials_provider import FinancialsError, get_company_info
from services.universe_provider import get_sp500

logger = logging.getLogger(__name__)


# ── 10 technical factors recoverable from price history ───────────────────

TECHNICAL_FACTORS = [
    "momentum",          # 12-1m return
    "momentum_60d",
    "momentum_120d",
    "breakout_20d",
    "new_high_52w",
    "low_vol",
    "volume_spike_5d",
    "volume_trend_20d",
    "rs_vs_spy",
    "sector_strength",
]

# Minimum trailing days needed before a factor can be computed.
# Snapshots without ≥252 days of history are skipped (low_vol + new_high_52w need it).
MIN_HISTORY_DAYS = 252


# ── In-memory progress tracking ──────────────────────────────────────────

_backfill_state: dict[str, Any] = {
    "running": False,
    "started_at": None,
    "lookback_months": 0,
    "total_symbols": 0,
    "completed_symbols": 0,
    "persisted_rows": 0,
    "errors": 0,
    "last_symbol": None,
    "duration_s": 0,
}
_backfill_lock = threading.Lock()


def get_backfill_progress() -> dict[str, Any]:
    with _backfill_lock:
        snap = dict(_backfill_state)
    if snap["running"] and snap["completed_symbols"] > 0 and snap["started_at"]:
        elapsed = time.time() - snap["started_at"]
        rate = snap["completed_symbols"] / elapsed
        remaining = snap["total_symbols"] - snap["completed_symbols"]
        snap["eta_seconds"] = int(remaining / rate) if rate > 0 else None
        snap["elapsed_s"] = round(elapsed, 1)
    else:
        snap["eta_seconds"] = None
        snap["elapsed_s"] = round(snap.get("duration_s", 0), 1)
    return snap


# ── DB ────────────────────────────────────────────────────────────────────

def _get_supabase():
    from supabase import create_client
    from config.settings import get_settings
    s = get_settings()
    if not s.has_supabase_config:
        raise RuntimeError("Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


# ── Per-snapshot factor computation (sliced to historical date) ──────────

def _compute_technical_at(
    hist: pd.DataFrame,
    spy_hist: pd.DataFrame,
    sector_hist: pd.DataFrame | None,
    as_of: pd.Timestamp,
) -> dict[str, float]:
    """Compute the 10 technical factors using only price data ≤ as_of date.

    Returns dict of factor → value. Skips factors that would require
    more history than available.
    """
    # Slice each frame to data ≤ as_of (inclusive)
    p = hist[hist.index <= as_of]
    spy = spy_hist[spy_hist.index <= as_of]
    sec = sector_hist[sector_hist.index <= as_of] if sector_hist is not None else None

    if len(p) < MIN_HISTORY_DAYS:
        return {}    # not enough history at this point in time
    if len(spy) < 60:
        return {}

    out: dict[str, float] = {}

    close = p["Close"].astype(float)
    high = p["High"].astype(float)
    low = p["Low"].astype(float)
    volume = p["Volume"].astype(float) if "Volume" in p.columns else None

    # 1. Momentum 12-1m (skip last month to avoid reversal)
    try:
        out["momentum"] = float(close.iloc[-21] / close.iloc[-252]) - 1
    except (IndexError, ZeroDivisionError):
        pass

    # 2. Momentum 60d
    try:
        out["momentum_60d"] = float(close.iloc[-1] / close.iloc[-60]) - 1
    except (IndexError, ZeroDivisionError):
        pass

    # 3. Momentum 120d
    try:
        if len(close) >= 120:
            out["momentum_120d"] = float(close.iloc[-1] / close.iloc[-120]) - 1
    except (IndexError, ZeroDivisionError):
        pass

    # 4. Breakout 20d
    try:
        prior_high = float(high.iloc[-21:-1].max())
        if prior_high > 0:
            out["breakout_20d"] = float(close.iloc[-1] / prior_high) - 1
    except (IndexError, ValueError):
        pass

    # 5. 52w new high
    try:
        window_high = float(high.iloc[-252:].max())
        window_low = float(low.iloc[-252:].min())
        if window_high > window_low:
            out["new_high_52w"] = (float(close.iloc[-1]) - window_low) / (
                window_high - window_low
            )
    except (IndexError, ValueError):
        pass

    # 6. Low Vol
    try:
        returns = close.pct_change().dropna()
        if len(returns) >= 252:
            vol = float(returns.rolling(252).std().iloc[-1] * math.sqrt(252))
            out["low_vol"] = -vol
    except (ValueError, KeyError):
        pass

    # 7. Volume spike 5d
    if volume is not None and len(volume) >= 25:
        try:
            recent = float(volume.iloc[-5:].mean())
            base = float(volume.iloc[-25:-5].mean())
            if base > 0:
                out["volume_spike_5d"] = recent / base
        except (ValueError, KeyError):
            pass

    # 8. Volume trend 20d (log slope)
    if volume is not None and len(volume) >= 20:
        try:
            v = volume.iloc[-20:]
            v = v[v > 0]
            if len(v) >= 10:
                logv = np.log(v.values)
                slope = np.polyfit(np.arange(len(logv)), logv, 1)[0]
                out["volume_trend_20d"] = float(slope)
        except (ValueError, np.linalg.LinAlgError):
            pass

    # 9. RS vs SPY
    if "momentum_60d" in out:
        try:
            spy_60d = float(spy["Close"].iloc[-1] / spy["Close"].iloc[-60]) - 1
            out["rs_vs_spy"] = out["momentum_60d"] - spy_60d
        except (IndexError, ZeroDivisionError):
            pass

    # 10. Sector strength
    if sec is not None and len(sec) >= 60:
        try:
            etf_60d = float(sec["Close"].iloc[-1] / sec["Close"].iloc[-60]) - 1
            spy_60d = float(spy["Close"].iloc[-1] / spy["Close"].iloc[-60]) - 1
            out["sector_strength"] = etf_60d - spy_60d
        except (IndexError, ZeroDivisionError):
            pass

    return out


def _backfill_one_symbol(
    sym: str,
    month_end_dates: list[pd.Timestamp],
    spy_hist: pd.DataFrame,
    sector_etf_cache: dict[str, pd.DataFrame],
) -> dict[str, Any]:
    """Compute and persist all month-end snapshots for one symbol."""
    db = _get_supabase()
    try:
        # Fetch full 5y history (single yfinance call)
        ticker = yf.Ticker(sym)
        hist = ticker.history(period="5y", auto_adjust=True)
        if hist is None or hist.empty:
            return {"symbol": sym, "status": "no_history"}
        # Strip timezone for naive comparison with month-end timestamps
        if hist.index.tz is not None:
            hist.index = hist.index.tz_localize(None)

        # Get sector → ETF
        try:
            info = get_company_info(sym)
            sector = info.get("sector")
            market_cap = info.get("marketCap")
        except FinancialsError:
            sector = None
            market_cap = None

        sector_etf = SECTOR_ETF_MAP.get(sector or "", None)
        sector_hist = sector_etf_cache.get(sector_etf) if sector_etf else None

        # Compute factors at each month-end
        rows = []
        now_iso = datetime.now(timezone.utc).isoformat()
        for me in month_end_dates:
            factors = _compute_technical_at(hist, spy_hist, sector_hist, me)
            for fname, fval in factors.items():
                if fval is None or (isinstance(fval, float) and (fval != fval)):
                    continue
                rows.append({
                    "symbol": sym,
                    "factor_name": fname,
                    "factor_value": float(fval),
                    "snapshot_date": me.date().isoformat(),
                    "computed_at": now_iso,
                    "sector": sector,
                    "market_cap": float(market_cap) if market_cap else None,
                })

        if not rows:
            return {"symbol": sym, "status": "no_factors_computed"}

        # Batch upsert in chunks of 500 (Supabase row limit per request)
        for i in range(0, len(rows), 500):
            chunk = rows[i:i + 500]
            db.table("factor_history").upsert(chunk).execute()

        return {"symbol": sym, "status": "persisted", "rows": len(rows)}
    except Exception as exc:
        return {"symbol": sym, "status": "error", "error": str(exc)[:120]}


# ── Public: backfill the universe ─────────────────────────────────────────

def backfill_universe_async(
    lookback_months: int = 24,
    *,
    universe: list[str] | None = None,
    max_workers: int = 5,
) -> dict[str, Any]:
    """Kick off background backfill of technical factors.

    Args:
        lookback_months: number of monthly snapshots to compute (default 24)
        universe: list of symbols (defaults to SP500)
        max_workers: concurrent yfinance fetchers (default 5)

    Returns:
        {started: bool, total: int, message: str}
    """
    syms = [s.upper() for s in (universe or get_sp500())]

    # Build month-end target dates (most recent N months)
    today = pd.Timestamp.utcnow().tz_localize(None).normalize()
    month_ends = pd.date_range(end=today, periods=lookback_months, freq="ME")
    # Drop any that are after today
    month_ends = [me for me in month_ends if me <= today]

    with _backfill_lock:
        if _backfill_state["running"]:
            return {
                "started": False,
                "message": "Backfill already in progress",
                "completed_symbols": _backfill_state["completed_symbols"],
                "total_symbols": _backfill_state["total_symbols"],
            }
        _backfill_state.update({
            "running": True,
            "started_at": time.time(),
            "lookback_months": lookback_months,
            "total_symbols": len(syms),
            "completed_symbols": 0,
            "persisted_rows": 0,
            "errors": 0,
            "last_symbol": None,
            "duration_s": 0,
        })

    def _worker():
        try:
            # Pre-fetch SPY (shared by all symbols)
            try:
                spy_hist = yf.Ticker("SPY").history(period="5y", auto_adjust=True)
                if spy_hist.index.tz is not None:
                    spy_hist.index = spy_hist.index.tz_localize(None)
            except Exception as exc:
                logger.error("SPY fetch failed in backfill: %s", exc)
                with _backfill_lock:
                    _backfill_state["errors"] = len(syms)
                return

            # Pre-fetch all sector ETFs (shared)
            sector_etf_cache: dict[str, pd.DataFrame] = {}
            for etf in set(SECTOR_ETF_MAP.values()):
                try:
                    eh = yf.Ticker(etf).history(period="5y", auto_adjust=True)
                    if eh.index.tz is not None:
                        eh.index = eh.index.tz_localize(None)
                    sector_etf_cache[etf] = eh
                except Exception as exc:
                    logger.warning("Sector ETF %s fetch failed: %s", etf, exc)

            # Backfill each symbol concurrently
            with ThreadPoolExecutor(max_workers=max_workers) as ex:
                futures = {
                    ex.submit(_backfill_one_symbol, sym, month_ends, spy_hist, sector_etf_cache): sym
                    for sym in syms
                }
                for fut in as_completed(futures):
                    sym = futures[fut]
                    try:
                        result = fut.result()
                    except Exception as exc:
                        result = {"symbol": sym, "status": "error", "error": str(exc)[:120]}
                    with _backfill_lock:
                        _backfill_state["completed_symbols"] += 1
                        _backfill_state["last_symbol"] = sym
                        if result.get("status") == "persisted":
                            _backfill_state["persisted_rows"] += result.get("rows", 0)
                        else:
                            _backfill_state["errors"] += 1
        finally:
            with _backfill_lock:
                _backfill_state["running"] = False
                if _backfill_state["started_at"]:
                    _backfill_state["duration_s"] = round(
                        time.time() - _backfill_state["started_at"], 1
                    )

    t = threading.Thread(target=_worker, daemon=True, name="factor-backfill")
    t.start()

    return {
        "started": True,
        "lookback_months": lookback_months,
        "n_month_ends": len(month_ends),
        "total_symbols": len(syms),
        "message": (
            f"Backfilling {len(month_ends)} month-end snapshots for "
            f"{len(syms)} symbols ({max_workers} workers, ~3-5 min)"
        ),
    }
