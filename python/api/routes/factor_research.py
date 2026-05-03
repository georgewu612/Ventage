"""Factor Research API — academic-grade factor analysis endpoints.

Endpoints:
    POST /v1/factors/research/refresh         — recompute universe cache
    GET  /v1/factors/research/status          — universe cache stats
    GET  /v1/factors/research/panel           — read cached factor panel
    POST /v1/factors/research/sort            — cross-section sort + decile analysis
    POST /v1/factors/research/fama-macbeth    — FM regression with NW adjustment
    POST /v1/factors/research/backtest        — long-short factor portfolio
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()


# ── Request models ───────────────────────────────────────────────────────────

class RefreshRequest(BaseModel):
    symbols: list[str] | None = None
    force: bool = False
    universe: str = "core50"   # 'core50' (59 large-cap) | 'sp500' (~500)
    max_workers: int = 5
    background: bool = True    # if True, returns immediately + use /progress to poll


class SortRequest(BaseModel):
    factor_name: Literal["value", "quality", "momentum", "size", "low_vol", "low_inv"]
    n_bins: int = Field(default=10, ge=3, le=20)
    lookback_months: int = Field(default=12, ge=3, le=60)
    symbols: list[str] | None = None


class FMRequest(BaseModel):
    factor_names: list[str] | None = None
    lookback_months: int = Field(default=24, ge=6, le=60)
    newey_west_lags: int = Field(default=6, ge=1, le=12)
    symbols: list[str] | None = None


class BacktestRequest(BaseModel):
    factor_name: Literal["value", "quality", "momentum", "size", "low_vol", "low_inv"]
    long_pct: float = Field(default=0.20, ge=0.05, le=0.50)
    short_pct: float = Field(default=0.20, ge=0.05, le=0.50)
    lookback_months: int = Field(default=24, ge=6, le=60)
    symbols: list[str] | None = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/factors/research/refresh")
def refresh_universe(req: RefreshRequest | None = None) -> dict[str, Any]:
    """Refresh factor values for a universe.

    Modes:
        background=True (default): kick off async refresh, return immediately.
            Poll GET /factors/research/progress for status.
            5 concurrent workers; cold S&P 500 ≈ 5-10 min.
        background=False: synchronous (legacy), blocks until done.
            Only safe for small universes (<60 symbols) due to API timeout.

    Universe options:
        'core50' — 59 hand-picked large caps across 11 sectors (default)
        'sp500'  — ~500 S&P 500 components from Wikipedia (or fallback list)
    """
    from services.factor_universe import (
        refresh_universe as _refresh_sync,
        refresh_universe_async as _refresh_async,
    )
    from services.universe_provider import get_universe

    req = req or RefreshRequest()

    # Resolve universe to symbol list
    symbols = req.symbols
    if symbols is None:
        try:
            symbols = get_universe(req.universe)   # type: ignore[arg-type]
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    try:
        if req.background:
            return _refresh_async(
                symbols=symbols,
                universe_name=req.universe,
                force=req.force,
                max_workers=req.max_workers,
            )
        else:
            return _refresh_sync(symbols=symbols, force=req.force)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {exc}")


@router.get("/factors/research/progress")
def get_refresh_progress() -> dict[str, Any]:
    """Snapshot of current refresh progress (for UI polling).

    Returns:
        running (bool), total, completed, persisted, skipped_cached, errors,
        last_symbol, error_samples, eta_seconds, elapsed_s
    """
    from services.factor_universe import get_refresh_progress as _progress

    return _progress()


@router.get("/factors/research/status")
def get_status() -> dict[str, Any]:
    """Return universe cache size and freshness stats."""
    from services.factor_universe import get_status as _status, get_default_universe

    try:
        s = _status()
        s["default_universe_size"] = len(get_default_universe())
        return s
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/factors/research/panel")
def get_panel(
    fresh_only: bool = Query(default=True),
) -> dict[str, Any]:
    """Read the cached factor panel as a wide table.

    Returns: {symbols: [...], factors: {name: [vals]}, sectors: [...], market_caps: [...]}
    """
    from services.factor_universe import get_universe_panel

    try:
        df = get_universe_panel(fresh_only=fresh_only)
        if df.empty:
            return {"symbols": [], "factors": {}, "sectors": [], "market_caps": []}

        return {
            "symbols": df.index.tolist(),
            "factors": {
                col: [
                    None if v is None or (isinstance(v, float) and v != v) else float(v)
                    for v in df[col].tolist()
                ]
                for col in df.columns if col not in ("sector", "market_cap")
            },
            "sectors": df["sector"].fillna("Unknown").tolist(),
            "market_caps": [
                None if v is None or (isinstance(v, float) and v != v) else float(v)
                for v in df["market_cap"].tolist()
            ],
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Panel read failed: {exc}")


@router.post("/factors/research/sort")
def cross_section_sort(req: SortRequest) -> dict[str, Any]:
    """Sort universe into bins by factor value, compute average returns per bin.

    Returns H-L spread + Newey-West-adjusted t-stat + Spearman monotonicity.
    """
    from services.factor_research import cross_section_sort as _sort

    try:
        result = _sort(
            symbols=req.symbols,
            factor_name=req.factor_name,
            n_bins=req.n_bins,
            lookback_months=req.lookback_months,
        )
        return result.to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        raise HTTPException(status_code=500, detail=f"Sort failed: {exc} | {' | '.join(tb)}"[:500])


@router.post("/factors/research/fama-macbeth")
def fama_macbeth(req: FMRequest) -> dict[str, Any]:
    """Fama-MacBeth regression: monthly cross-section regressions then time-series mean.

    Newey-West HAC standard errors handle autocorrelation up to `newey_west_lags`.
    Significant factor: |t-stat| ≥ 2.0 (book Section 4.2 threshold).
    """
    from services.factor_research import fama_macbeth_regression as _fm

    try:
        result = _fm(
            symbols=req.symbols,
            factor_names=req.factor_names,
            lookback_months=req.lookback_months,
            newey_west_lags=req.newey_west_lags,
        )
        return result.to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        raise HTTPException(status_code=500, detail=f"FM failed: {exc} | {' | '.join(tb)}"[:500])


# ── Stock Screener endpoint ───────────────────────────────────────────────


class ScreenerCondition(BaseModel):
    factor: str                                              # raw factor or cluster name
    op: Literal[">=", ">", "<=", "<", "==", "!="]
    value: float


class ScreenerRequest(BaseModel):
    conditions: list[ScreenerCondition] = []
    sector_filter: list[str] | None = None
    min_market_cap: float | None = None    # USD, e.g. 20_000_000_000 for $20B
    sort_by: str | None = None             # column name to sort by
    sort_desc: bool = True
    limit: int = Field(default=50, ge=1, le=500)


@router.post("/factors/screener")
def screen_stocks(req: ScreenerRequest) -> dict[str, Any]:
    """Filter SP500 universe by user-defined factor conditions.

    Returns matching stocks with all their (raw + cluster) factor values.
    Applies conditions in order — each narrows the result set.

    Operators: >= > <= < == !=
    Factor names: any of the 14 raw factors + 3 clusters + 'market_cap'.
    """
    from services.factor_universe import (
        CLUSTERS,
        FACTOR_NAMES,
        get_universe_panel,
    )
    import pandas as pd

    try:
        panel = get_universe_panel(transform="raw", include_clusters=True)
        if panel.empty:
            raise HTTPException(
                status_code=400,
                detail="Factor universe cache is empty. Refresh first.",
            )

        df = panel.copy()
        applied: list[dict[str, Any]] = []
        valid_factors = set(FACTOR_NAMES) | set(CLUSTERS.keys()) | {"market_cap"}

        # Apply each condition
        for cond in req.conditions:
            if cond.factor not in valid_factors:
                applied.append({"condition": cond.dict(), "matched": "invalid_factor"})
                continue
            if cond.factor not in df.columns:
                applied.append({"condition": cond.dict(), "matched": "factor_missing"})
                continue
            col = df[cond.factor]
            before = len(df)
            if cond.op == ">=":
                df = df[col >= cond.value]
            elif cond.op == ">":
                df = df[col > cond.value]
            elif cond.op == "<=":
                df = df[col <= cond.value]
            elif cond.op == "<":
                df = df[col < cond.value]
            elif cond.op == "==":
                df = df[col == cond.value]
            elif cond.op == "!=":
                df = df[col != cond.value]
            applied.append({
                "condition": cond.dict(),
                "before": before,
                "after": len(df),
                "filtered_out": before - len(df),
            })

        # Sector filter
        if req.sector_filter and "sector" in df.columns:
            df = df[df["sector"].isin(req.sector_filter)]

        # Min market cap
        if req.min_market_cap is not None and "market_cap" in df.columns:
            df = df[df["market_cap"] >= req.min_market_cap]

        # Sort
        if req.sort_by and req.sort_by in df.columns:
            df = df.sort_values(req.sort_by, ascending=not req.sort_desc, na_position="last")
        else:
            # Default: sort by market cap desc
            if "market_cap" in df.columns:
                df = df.sort_values("market_cap", ascending=False, na_position="last")

        # Limit results
        df = df.head(req.limit)

        # Build response
        results = []
        for idx, row in df.iterrows():
            factor_dict = {}
            for col in df.columns:
                if col in ("sector", "market_cap"):
                    continue
                v = row[col]
                if pd.notna(v):
                    factor_dict[col] = float(v)
                else:
                    factor_dict[col] = None
            results.append({
                "symbol": idx,
                "sector": row.get("sector"),
                "market_cap": float(row["market_cap"]) if pd.notna(row.get("market_cap")) else None,
                "factors": factor_dict,
            })

        return {
            "matched": len(df),
            "total_in_universe": int(len(panel)),
            "applied_conditions": applied,
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        raise HTTPException(status_code=500, detail=f"Screener failed: {exc} | {' | '.join(tb)}"[:500])


# ── Factor Snapshot endpoints (Phase V — point-in-time data accumulation) ──


class SnapshotRequest(BaseModel):
    snapshot_date: str | None = None    # ISO date string; defaults to today UTC
    universe: list[str] | None = None    # defaults to current SP500
    max_workers: int = 5


@router.post("/factors/snapshot/run")
def run_snapshot(req: SnapshotRequest | None = None) -> dict[str, Any]:
    """Kick off a background snapshot of current factor values.

    Saves to factor_history table with the given snapshot_date (defaults today).
    Used to accumulate point-in-time data for true OOS backtesting.

    Run this monthly (1st of month). After ~6 monthly snapshots, true PIT
    backtest becomes meaningful.

    Returns immediately. Poll /v1/factors/snapshot/progress for status.
    """
    from datetime import date as _date
    from services.factor_snapshot import snapshot_now_async

    req = req or SnapshotRequest()
    snap_date = None
    if req.snapshot_date:
        try:
            snap_date = _date.fromisoformat(req.snapshot_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid snapshot_date (use YYYY-MM-DD)")

    try:
        return snapshot_now_async(
            snapshot_date=snap_date,
            universe=req.universe,
            max_workers=req.max_workers,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Snapshot failed: {exc}")


@router.get("/factors/snapshot/progress")
def get_snapshot_progress_endpoint() -> dict[str, Any]:
    """Snapshot job progress (for UI polling)."""
    from services.factor_snapshot import get_snapshot_progress
    return get_snapshot_progress()


@router.get("/factors/snapshot/status")
def get_snapshot_status_endpoint() -> dict[str, Any]:
    """How many monthly snapshots do we have? Latest date? Ready for PIT backtest?"""
    from services.factor_snapshot import get_snapshot_status
    return get_snapshot_status()


# ── Screener Backtest endpoint ────────────────────────────────────────────


class ScreenerBacktestRequest(BaseModel):
    symbols: list[str]                       # the screened-out symbols
    lookback_months: int = Field(default=24, ge=3, le=60)
    benchmark: str = "SPY"                   # for alpha calculation


@router.post("/factors/screener/backtest")
def screener_backtest(req: ScreenerBacktestRequest) -> dict[str, Any]:
    """Backtest holding the screened set equal-weight for the past N months.

    IMPORTANT — methodological honesty:
    This is a 'held this CURRENT set for past N months' backtest, NOT a
    point-in-time monthly re-screen. We don't have historical factor
    snapshots, so we can't truly rebalance based on past factor values.

    What this DOES tell you:
        - Would the current screened set have done well historically?
        - How does it compare to SPY?
        - What's the Sharpe / max drawdown if you'd bought-and-held this set?

    What this DOESN'T tell you:
        - True monthly rebalancing performance (membership would change)
        - Out-of-sample alpha (we know the current results)

    Use this to sanity-check that your screen condition produces a set
    that would have performed well in recent past — but DO NOT take the
    Sharpe number as a forward-looking estimate.
    """
    import math
    import numpy as np
    import pandas as pd
    from services.financials_provider import get_price_history

    if not req.symbols:
        raise HTTPException(status_code=400, detail="No symbols provided")

    period = f"{max(req.lookback_months + 3, 12)}mo"

    # Pull monthly returns for each symbol + benchmark
    rets_map: dict[str, pd.Series] = {}
    failed: list[str] = []
    for sym in req.symbols + [req.benchmark]:
        try:
            hist = get_price_history(sym, period=period)
            if hist is None or hist.empty:
                failed.append(sym)
                continue
            monthly = hist["Close"].resample("ME").last().pct_change().dropna()
            if not monthly.empty:
                rets_map[sym] = monthly.tail(req.lookback_months)
        except Exception:
            failed.append(sym)

    bench_ret = rets_map.pop(req.benchmark, None)
    if bench_ret is None:
        raise HTTPException(status_code=502, detail=f"Benchmark {req.benchmark} not available")

    if not rets_map:
        raise HTTPException(status_code=400, detail="No symbol returns available")

    # Equal-weight portfolio: mean of available returns each period
    rets_df = pd.DataFrame(rets_map)
    portfolio_ret = rets_df.mean(axis=1, skipna=True).dropna()
    bench_ret = bench_ret.reindex(portfolio_ret.index).fillna(0)

    n = len(portfolio_ret)
    if n < 3:
        raise HTTPException(status_code=400, detail=f"Only {n} months of return data — need ≥3")

    # Stats
    mean_m = float(portfolio_ret.mean())
    std_m = float(portfolio_ret.std())
    annualized_return = mean_m * 12
    annualized_vol = std_m * math.sqrt(12)
    sharpe = annualized_return / annualized_vol if annualized_vol > 0 else 0.0
    win_rate = float((portfolio_ret > 0).mean())

    # Cumulative
    cum_port = (1 + portfolio_ret).cumprod()
    cum_bench = (1 + bench_ret).cumprod()
    peak = cum_port.expanding().max()
    drawdown = (cum_port - peak) / peak
    max_dd = float(-drawdown.min()) if not drawdown.empty else 0.0

    # Alpha vs benchmark
    excess = portfolio_ret - bench_ret
    alpha_annual = float(excess.mean()) * 12
    excess_vol = float(excess.std()) * math.sqrt(12)
    info_ratio = alpha_annual / excess_vol if excess_vol > 0 else 0.0

    # Build curve points
    curve = []
    for date in cum_port.index:
        curve.append({
            "date": date.strftime("%Y-%m"),
            "portfolio": float(round(cum_port.loc[date], 4)),
            "benchmark": float(round(cum_bench.loc[date], 4)),
        })

    return {
        "n_symbols": len(rets_map),
        "n_failed": len(failed),
        "failed_symbols": failed[:10],
        "n_periods": n,
        "lookback_months": req.lookback_months,
        "benchmark": req.benchmark,
        "annualized_return_pct": round(annualized_return * 100, 2),
        "annualized_vol_pct": round(annualized_vol * 100, 2),
        "sharpe_ratio": round(sharpe, 2),
        "max_drawdown_pct": round(max_dd * 100, 2),
        "win_rate_pct": round(win_rate * 100, 1),
        "alpha_vs_benchmark_annual_pct": round(alpha_annual * 100, 2),
        "information_ratio": round(info_ratio, 2),
        "cumulative_curve": curve,
        "warning": (
            "Held current set for past N months (not a true point-in-time re-screen). "
            "DO NOT extrapolate Sharpe to forward returns."
        ),
    }


# ── IC Analysis endpoints (Phase III) ─────────────────────────────────────


class ICRequest(BaseModel):
    factor_name: str
    horizon_days: int = Field(default=20, ge=5, le=120)
    lookback_months: int = Field(default=24, ge=6, le=60)
    sector_neutral: bool = True


@router.post("/factors/research/ic")
def compute_ic(req: ICRequest) -> dict[str, Any]:
    """Compute Information Coefficient (IC) time series for one factor.

    IC_t = Spearman(factor_at_t, return_t→t+horizon).
    Reports IC mean, std, IR, hit rate, t-stat, decay across longer horizons.

    Significance threshold: |t| ≥ 2.0 → factor predicts forward returns.
    """
    from services.ic_analysis import compute_ic as _compute

    try:
        result = _compute(
            req.factor_name,
            horizon_days=req.horizon_days,
            lookback_months=req.lookback_months,
            sector_neutral=req.sector_neutral,
        )
        return result.to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        raise HTTPException(status_code=500, detail=f"IC failed: {exc} | {' | '.join(tb)}"[:500])


@router.get("/factors/research/ic/all")
def compute_all_ic(
    horizon_days: int = Query(default=20, ge=5, le=120),
    lookback_months: int = Query(default=24, ge=6, le=60),
    sector_neutral: bool = Query(default=True),
    include_clusters: bool = Query(default=True),
) -> dict[str, Any]:
    """Run IC analysis for ALL factors (and clusters). Used by factor health banner.

    Returns a summary dict ranked by |IC IR|. Long-running endpoint
    (~30 seconds for 14 factors + 7 clusters).
    """
    from services.ic_analysis import compute_all_factors_ic

    try:
        return compute_all_factors_ic(
            horizon_days=horizon_days,
            lookback_months=lookback_months,
            sector_neutral=sector_neutral,
            include_clusters=include_clusters,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"IC batch failed: {exc}")


@router.post("/factors/research/backtest")
def long_short_backtest(req: BacktestRequest) -> dict[str, Any]:
    """Long-short factor portfolio backtest.

    Long top `long_pct` symbols, short bottom `short_pct`, equal-weighted.
    Returns Sharpe, max drawdown, win rate, cumulative equity curve.
    """
    from services.factor_research import long_short_backtest as _bt

    try:
        result = _bt(
            symbols=req.symbols,
            factor_name=req.factor_name,
            long_pct=req.long_pct,
            short_pct=req.short_pct,
            lookback_months=req.lookback_months,
        )
        return result.to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        raise HTTPException(status_code=500, detail=f"Backtest failed: {exc} | {' | '.join(tb)}"[:500])
