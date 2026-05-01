"""Risk Engine API — position sizing & exposure check.

Endpoints:
    POST /v1/risk/position-size   — single signal position calculator
    GET  /v1/risk/exposure        — current portfolio exposure summary
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

router = APIRouter()


# ── Request models ────────────────────────────────────────────────────────────

class PositionSizeRequest(BaseModel):
    symbol: str
    grade: str                          # A / B / C
    strategy_name: str
    direction: str = "long"             # long / short
    entry_price: float
    stop_price: float
    target_1: float | None = None
    target_2: float | None = None
    account_size: float = 100_000.0     # 默认 10 万美元
    risk_preference: Literal["conservative", "moderate", "aggressive"] = "moderate"
    existing_exposure_pct: float = 0.0  # 0.0-1.0，当前已用敞口


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_supabase():
    from supabase import create_client
    from config.settings import get_settings
    s = get_settings()
    if not s.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/risk/position-size")
def position_size(req: PositionSizeRequest) -> dict[str, Any]:
    """Calculate suggested position size for a single signal.

    Returns shares, dollar risk, R:R ratios, and any risk warnings.
    All inputs are supplied by the caller (no DB lookup needed).
    """
    from services.risk_engine import calculate_position

    try:
        result = calculate_position(
            symbol=req.symbol.upper(),
            grade=req.grade,
            strategy_name=req.strategy_name,
            direction=req.direction,
            entry_price=req.entry_price,
            stop_price=req.stop_price,
            target_1=req.target_1,
            target_2=req.target_2,
            account_size=req.account_size,
            risk_preference=req.risk_preference,
            existing_exposure_pct=req.existing_exposure_pct,
        )
        return result.to_dict()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"position-size failed: {exc}")


@router.get("/risk/exposure")
def get_exposure(
    account_size: float = Query(default=100_000.0, ge=1_000),
    risk_preference: str = Query(default="moderate"),
) -> dict[str, Any]:
    """Return current portfolio exposure summary based on active strategy signals.

    Pulls all 'active' strategy_signals from the DB and computes total
    risk-weighted exposure vs the user's account size + risk preference.
    """
    from services.risk_engine import check_exposure, RiskPreference

    pref: RiskPreference = risk_preference if risk_preference in ("conservative", "moderate", "aggressive") else "moderate"  # type: ignore[assignment]

    try:
        db = _get_supabase()
        resp = (
            db.table("strategy_signals")
            .select("score_grade,entry_price,stop_price,strategy_name,symbol")
            .eq("status", "active")
            .execute()
        )
        active = resp.data or []
        result = check_exposure(
            active_signals=active,
            account_size=account_size,
            risk_preference=pref,
        )
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"exposure check failed: {exc}")


@router.post("/risk/position-size/from-signal/{signal_id}")
def position_size_from_signal(
    signal_id: str,
    account_size: float = Query(default=100_000.0, ge=1_000),
    risk_preference: str = Query(default="moderate"),
) -> dict[str, Any]:
    """Fetch a strategy_signals row by ID and compute position sizing automatically.

    Convenience endpoint so the frontend only needs the signal ID + account params.
    """
    from services.risk_engine import calculate_position, RiskPreference

    pref: RiskPreference = risk_preference if risk_preference in ("conservative", "moderate", "aggressive") else "moderate"  # type: ignore[assignment]

    try:
        db = _get_supabase()
        resp = (
            db.table("strategy_signals")
            .select("*")
            .eq("id", signal_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Signal not found")

        sig = rows[0]
        result = calculate_position(
            symbol=sig.get("symbol", ""),
            grade=sig.get("score_grade") or "C",
            strategy_name=sig.get("strategy_name") or "",
            direction=sig.get("direction") or "long",
            entry_price=float(sig.get("entry_price") or 0),
            stop_price=float(sig.get("stop_price") or 0),
            target_1=float(sig["target_1"]) if sig.get("target_1") else None,
            target_2=float(sig["target_2"]) if sig.get("target_2") else None,
            account_size=account_size,
            risk_preference=pref,
        )
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"position-size-from-signal failed: {exc}")


# ── Trade Manager endpoints ───────────────────────────────────────────────────

@router.get("/risk/exit-plan/{signal_id}")
def get_exit_plan(signal_id: str) -> dict[str, Any]:
    """Return the full 4-type exit plan for a strategy signal.

    Does NOT need current price data — the plan is generated from the
    signal's entry / stop / targets alone.
    """
    from services.trade_manager import get_exit_plan as _get_exit_plan

    try:
        db = _get_supabase()
        resp = (
            db.table("strategy_signals")
            .select("*")
            .eq("id", signal_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Signal not found")
        plan = _get_exit_plan(rows[0])
        return plan.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"exit-plan failed: {exc}")


@router.get("/risk/exit-evaluate/{signal_id}")
def evaluate_exit(signal_id: str) -> dict[str, Any]:
    """Evaluate the current exit status of a signal using live OHLCV data.

    Fetches the signal from DB, downloads fresh OHLCV since signal_date,
    runs the 4-type exit evaluation, and returns status + recommended action.
    """
    import pandas as pd
    import yfinance as yf
    from services.trade_manager import evaluate_exit as _evaluate_exit

    try:
        db = _get_supabase()
        resp = (
            db.table("strategy_signals")
            .select("*")
            .eq("id", signal_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            raise HTTPException(status_code=404, detail="Signal not found")

        sig = rows[0]
        symbol = sig.get("symbol", "")
        signal_date = sig.get("signal_date") or sig.get("datetime") or sig.get("created_at")

        # Download OHLCV from signal date to today
        df = yf.download(
            symbol,
            start=str(signal_date)[:10] if signal_date else None,
            period="3mo" if not signal_date else None,
            interval="1d",
            auto_adjust=True,
            progress=False,
        )
        if df is None or df.empty:
            raise HTTPException(status_code=502, detail=f"Could not fetch OHLCV for {symbol}")

        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)

        result = _evaluate_exit(sig, df, entry_bar_index=0)
        return result.to_dict()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"exit-evaluate failed: {exc}")
