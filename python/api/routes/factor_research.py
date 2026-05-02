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
    """Recompute factor values for the universe and persist to factor_universe.

    Cold run: 3-5 min for 50 symbols. Use force=true to bypass cache.
    """
    from services.factor_universe import refresh_universe as _refresh

    req = req or RefreshRequest()
    try:
        return _refresh(symbols=req.symbols, force=req.force)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Refresh failed: {exc}")


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
