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
