"""Market environment endpoints — Regime Engine API.

Routes:
    GET  /v1/market/regime         — Latest snapshot from DB
    POST /v1/market/regime/refresh — Trigger recompute (admin / cron)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from supabase import Client, create_client

from config.settings import get_settings

router = APIRouter()


def _get_supabase_client() -> Client:
    settings = get_settings()
    if not settings.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/market/regime")
def get_latest_regime() -> dict[str, Any]:
    """Return the most recent market regime snapshot from DB."""
    db = _get_supabase_client()
    try:
        result = (
            db.table("market_regime_snapshots")
            .select("*")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DB query failed: {exc}")

    rows = result.data or []
    if not rows:
        raise HTTPException(
            status_code=404,
            detail="No regime snapshot found. Call POST /v1/market/regime/refresh first.",
        )
    return rows[0]


@router.post("/market/regime/refresh")
async def refresh_regime() -> dict[str, Any]:
    """Trigger a fresh regime computation and persist it to DB.

    Intended for admin use and the daily ETL scheduler.
    Downloads market data from yfinance (may take ~5–10 s).
    """
    db = _get_supabase_client()

    from services.regime_engine import RegimeEngine

    engine = RegimeEngine(db)
    try:
        snapshot = await engine.compute_and_save()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Regime computation failed: {exc}")

    return {
        "status": "ok",
        "regime": snapshot.regime,
        "volatility": snapshot.volatility,
        "breadth": snapshot.breadth,
        "style": snapshot.style,
        "recommendation": snapshot.recommendation,
        "confidence": snapshot.confidence,
        "vix": snapshot.vix,
        "spy_vs_200ma_pct": snapshot.spy_vs_200ma_pct,
        "generated_at": snapshot.generated_at,
    }


# ── Per-symbol regime (Trading System v2) ────────────────────────────────────


@router.get("/regime/symbol/{symbol}")
def get_symbol_regime(symbol: str, fresh: bool = False) -> dict[str, Any]:
    """Per-symbol 6-state regime classification.

    By default returns the most recent snapshot from `symbol_regimes` (written
    by the daily ETL job). Pass `?fresh=true` to recompute on demand using
    yfinance (slower, ~3-5 s).

    Args:
        symbol: Ticker (case-insensitive).
        fresh: If True, recompute live and skip DB cache.
    """
    sym = symbol.upper()
    db = _get_supabase_client()

    if not fresh:
        try:
            result = (
                db.table("symbol_regimes")
                .select("*")
                .eq("symbol", sym)
                .eq("timeframe", "1d")
                .order("datetime", desc=True)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"DB query failed: {exc}")

        rows = result.data or []
        if rows:
            return {**rows[0], "source": "db_cache"}

    # Cache miss or fresh=true → compute on the fly
    import pandas as pd
    import yfinance as yf

    from services.regime_classifier import classify

    try:
        df = yf.download(
            sym, period="1y", interval="1d", auto_adjust=True, progress=False
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"yfinance failed: {exc}")

    if df is None or df.empty or len(df) < 60:
        raise HTTPException(
            status_code=404,
            detail=f"Insufficient data for {sym} (need ≥60 daily bars)",
        )
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    res = classify(df)
    last_ts = df.index[-1]
    last_ts_str = (
        last_ts.tz_localize("UTC").isoformat()
        if hasattr(last_ts, "tz") and last_ts.tz is None
        else last_ts.isoformat()
    )

    return {
        "symbol": sym,
        "timeframe": "1d",
        "datetime": last_ts_str,
        "regime": res.regime,
        "regime_score": res.regime_score,
        "adx": res.adx,
        "ema_alignment": res.ema_alignment,
        "ema_squeeze_pct": res.ema_squeeze_pct,
        "bb_width": res.bb_width,
        "atr_pct": res.atr_pct,
        "risk_flag": res.risk_flag,
        "notes": res.notes,
        "source": "live_compute",
    }
