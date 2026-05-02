"""Quant Lab — factor analysis endpoints.

GET  /v1/factors                    — list all factor definitions
POST /v1/factors/score              — score a symbol on all technical factors
POST /v1/factors/correlation        — compute factor correlation matrix for a symbol
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import structlog
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from supabase import Client, create_client

from config.settings import get_settings

logger = structlog.get_logger()
router = APIRouter()


def _db() -> Client:
    s = get_settings()
    if not s.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _download(symbol: str, period: str = "1y") -> pd.DataFrame:
    df = yf.download(symbol, period=period, auto_adjust=True, progress=False)
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No price data for {symbol}")
    # Flatten MultiIndex if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _safe(v) -> float:
    try:
        f = float(v)
        return 0.0 if (np.isnan(f) or np.isinf(f)) else round(f, 4)
    except Exception:
        return 0.0


# ── Factor calculation helpers ────────────────────────────────────────────────


def _calc_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def _score_factors(df: pd.DataFrame) -> dict[str, float]:
    close = df["Close"].squeeze()
    volume = df["Volume"].squeeze() if "Volume" in df.columns else None

    rsi = _calc_rsi(close, 14)
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    std20 = close.rolling(20).std()

    # RSI(14)
    rsi_val = _safe(rsi.iloc[-1])

    # SMA 20/50 cross (pct distance)
    sma_cross = _safe((sma20.iloc[-1] - sma50.iloc[-1]) / sma50.iloc[-1] * 100)

    # Volume ratio (requires volume data)
    vol_ratio = 0.0
    if volume is not None and not volume.empty:
        avg_vol = volume.rolling(20).mean()
        if _safe(avg_vol.iloc[-1]) > 0:
            vol_ratio = _safe(volume.iloc[-1] / avg_vol.iloc[-1])

    # 20-day price momentum
    if len(close) >= 21:
        mom20 = _safe((close.iloc[-1] / close.iloc[-21] - 1) * 100)
    else:
        mom20 = 0.0

    # 20-day annualised volatility
    returns = close.pct_change().dropna()
    vol20 = _safe(returns.rolling(20).std().iloc[-1] * np.sqrt(252) * 100)

    # Bollinger band position (0 = lower band, 1 = upper band)
    upper = sma20 + 2 * std20
    lower = sma20 - 2 * std20
    band_range = upper - lower
    bb_pos = _safe((close - lower).iloc[-1] / band_range.iloc[-1]) if _safe(band_range.iloc[-1]) > 0 else 0.5

    return {
        "rsi_14": rsi_val,
        "sma_20_50_cross": sma_cross,
        "volume_ratio": vol_ratio,
        "price_momentum_20": mom20,
        "volatility_20": vol20,
        "bb_position": bb_pos,
    }


def _factor_series(df: pd.DataFrame) -> dict[str, pd.Series]:
    close = df["Close"].squeeze()
    volume = df["Volume"].squeeze() if "Volume" in df.columns else pd.Series(dtype=float)

    rsi = _calc_rsi(close, 14)
    sma20 = close.rolling(20).mean()
    sma50 = close.rolling(50).mean()
    std20 = close.rolling(20).std()

    momentum20 = close.pct_change(20) * 100
    returns = close.pct_change()
    volatility20 = returns.rolling(20).std() * np.sqrt(252) * 100

    upper = sma20 + 2 * std20
    lower = sma20 - 2 * std20
    bb_pos = (close - lower) / (upper - lower)

    series: dict[str, pd.Series] = {
        "rsi_14": rsi,
        "price_momentum_20": momentum20,
        "volatility_20": volatility20,
        "bb_position": bb_pos,
    }

    sma_cross = (sma20 - sma50) / sma50 * 100
    series["sma_20_50_cross"] = sma_cross

    if not volume.empty:
        avg_vol = volume.rolling(20).mean()
        series["volume_ratio"] = volume / avg_vol

    return series


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/factors")
def list_factors() -> list[dict[str, Any]]:
    """Return all factor definitions from the DB."""
    db = _db()
    result = db.table("factor_definitions").select("*").order("category, name").execute()
    return result.data or []


class ScoreRequest(BaseModel):
    symbol: str
    period: str = "1y"   # yfinance period string


@router.post("/factors/score")
def score_symbol(req: ScoreRequest) -> dict[str, Any]:
    """Compute all technical factor scores for a given symbol."""
    log = logger.bind(symbol=req.symbol)
    try:
        df = _download(req.symbol.upper(), req.period)
        scores = _score_factors(df)
        close = df["Close"].squeeze()
        last_price = _safe(float(close.iloc[-1]))
        last_date = str(close.index[-1])[:10]

        log.info("factors_scored", symbol=req.symbol)
        return {
            "symbol": req.symbol.upper(),
            "last_price": last_price,
            "last_date": last_date,
            "period": req.period,
            "factors": scores,
        }
    except HTTPException:
        raise
    except Exception as exc:
        log.error("factor_score_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


class CorrelationRequest(BaseModel):
    symbol: str
    period: str = "2y"


@router.post("/factors/correlation")
def factor_correlation(req: CorrelationRequest) -> dict[str, Any]:
    """Compute factor-to-factor and factor-to-forward-return correlation matrix."""
    log = logger.bind(symbol=req.symbol)
    try:
        df = _download(req.symbol.upper(), req.period)
        series_map = _factor_series(df)

        # Add 5-day forward return as target
        close = df["Close"].squeeze()
        series_map["fwd_return_5d"] = close.pct_change(5).shift(-5) * 100

        factor_df = pd.DataFrame(series_map).dropna()
        corr_matrix = factor_df.corr().round(3)

        # Convert to JSON-friendly nested dict
        corr_dict = corr_matrix.to_dict()

        log.info("correlation_computed", symbol=req.symbol, rows=len(factor_df))
        return {
            "symbol": req.symbol.upper(),
            "period": req.period,
            "factors": list(corr_matrix.columns),
            "correlation": corr_dict,
        }
    except HTTPException:
        raise
    except Exception as exc:
        log.error("correlation_failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ── Factor Profile (6-dim style exposure radar) ──────────────────────────────


@router.get("/factors/profile/{symbol}")
def get_factor_profile(symbol: str) -> dict[str, Any]:
    """Compute 6-dimension factor exposure profile for a stock.

    Returns each factor's raw value + percentile vs peer universe + interpretation.
    Factors: Value / Quality / Momentum / Size / Low Vol / Low Investment.
    Peer universe: ~50 large-cap representatives across all sectors.

    First call may take 30-60 seconds (cold peer cache).
    Subsequent calls return in <100ms (24h cache).
    """
    from services.factor_profile import compute_factor_profile
    from services.financials_provider import FinancialsError

    try:
        result = compute_factor_profile(symbol.upper())
        return result.to_dict()
    except FinancialsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        detail = f"Factor profile failed: {exc} | {' | '.join(tb)}"
        raise HTTPException(status_code=500, detail=detail[:500])
