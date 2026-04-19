from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from postgrest.exceptions import APIError
from supabase import Client, create_client

from config.settings import get_settings

router = APIRouter()


def _get_supabase_client() -> Client:
    settings = get_settings()
    if not settings.has_supabase_config:
        raise HTTPException(
            status_code=503,
            detail="Supabase environment variables are missing. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def _normalize_signal(row: dict[str, Any]) -> dict[str, Any]:
    factors = row.get("factors") if isinstance(row.get("factors"), dict) else {}
    module = row.get("module") or factors.get("module") or row.get("signal_type") or "unknown"
    signal_score = row.get("signal_score")
    if signal_score is None:
        confidence = row.get("confidence")
        signal_score = round(float(confidence) * 100, 2) if confidence is not None else 0

    direction = row.get("direction")
    normalized_signal_type = row.get("signal_type")
    if direction in ("bullish", "bearish"):
        normalized_signal_type = direction

    summary = row.get("summary") or row.get("analysis") or ""

    normalized = dict(row)
    normalized.update(
        {
            "module": module,
            "signal_score": signal_score,
            "summary": summary,
            "signal_type": normalized_signal_type,
        }
    )
    return normalized


@router.get("/signals")
def get_signals(
    symbol: str | None = Query(default=None),
    module: str | None = Query(default=None),
    signal_type: str | None = Query(default=None),
    min_score: int | None = Query(default=None, ge=0, le=100),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        query = (
            supabase.table("market_signals").select("*").order("created_at", desc=True).limit(1000)
        )

        if symbol:
            query = query.eq("symbol", symbol.upper())

        response = query.execute()
        data = [_normalize_signal(row) for row in (response.data or [])]

        if module:
            data = [row for row in data if str(row.get("module")) == module]
        if signal_type:
            data = [row for row in data if str(row.get("signal_type")) == signal_type]
        if min_score is not None:
            data = [row for row in data if float(row.get("signal_score") or 0) >= min_score]

        total = len(data)
        paged = data[offset : offset + limit]

        return {
            "items": paged,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned": len(paged),
                "total": total,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Failed to fetch signals: {exc}") from exc


@router.get("/signals/summary")
def get_signals_summary() -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        since = datetime.now(UTC) - timedelta(hours=24)

        response = (
            supabase.table("market_signals")
            .select("*")
            .gte("created_at", since.isoformat())
            .execute()
        )
        items = [_normalize_signal(row) for row in (response.data or [])]

        bullish = sum(1 for item in items if item.get("signal_type") == "bullish")
        bearish = sum(1 for item in items if item.get("signal_type") == "bearish")
        neutral = len(items) - bullish - bearish
        scores = [
            item.get("signal_score") for item in items if item.get("signal_score") is not None
        ]
        avg_score = round(sum(scores) / len(scores), 2) if scores else 0

        by_module: dict[str, int] = {}
        by_symbol: dict[str, int] = {}
        for item in items:
            module = item.get("module") or "unknown"
            by_module[module] = by_module.get(module, 0) + 1
            symbol = item.get("symbol") or "unknown"
            by_symbol[symbol] = by_symbol.get(symbol, 0) + 1

        top_symbols = sorted(by_symbol.items(), key=lambda x: x[1], reverse=True)[:5]

        # Put/Call ratio from options_flow (last 24h)
        put_call_ratio: float | None = None
        try:
            opts_resp = (
                supabase.table("options_flow")
                .select("option_type")
                .gte("created_at", since.isoformat())
                .execute()
            )
            opts = opts_resp.data or []
            calls = sum(1 for o in opts if str(o.get("option_type", "")).lower() == "call")
            puts = sum(1 for o in opts if str(o.get("option_type", "")).lower() == "put")
            if calls > 0:
                put_call_ratio = round(puts / calls, 2)
        except Exception:
            pass  # Non-critical — omit ratio if query fails

        return {
            "window": "24h",
            "total_signals": len(items),
            "bullish": bullish,
            "bearish": bearish,
            "neutral": neutral,
            "average_score": avg_score,
            "by_module": by_module,
            "top_symbols": [{"symbol": s, "count": c} for s, c in top_symbols],
            "put_call_ratio": put_call_ratio,
        }
    except HTTPException:
        raise
    except APIError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to build summary: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Failed to build summary: {exc}") from exc


@router.get("/signals/{signal_id}")
def get_signal_by_id(signal_id: str) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        response = (
            supabase.table("market_signals").select("*").eq("id", signal_id).limit(1).execute()
        )
        items = response.data or []
        if not items:
            raise HTTPException(status_code=404, detail="Signal not found")
        return _normalize_signal(items[0])
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise HTTPException(status_code=500, detail=f"Failed to fetch signal: {exc}") from exc
