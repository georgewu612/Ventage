from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
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


def _paginate(items: list[dict[str, Any]], limit: int, offset: int) -> dict[str, Any]:
    total = len(items)
    sliced = items[offset : offset + limit]
    return {
        "items": sliced,
        "pagination": {
            "limit": limit,
            "offset": offset,
            "returned": len(sliced),
            "total": total,
        },
    }


@router.get("/options-flow")
def get_options_flow(
    symbol: Optional[str] = Query(default=None),
    option_type: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        query = supabase.table("options_flow").select("*").order("created_at", desc=True).limit(1000)
        if symbol:
            query = query.eq("symbol", symbol.upper())
        if option_type:
            query = query.eq("option_type", option_type.lower())

        rows = query.execute().data or []
        return _paginate(rows, limit, offset)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch options flow: {exc}") from exc


@router.get("/insider-trades")
def get_insider_trades(
    symbol: Optional[str] = Query(default=None),
    trade_type: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        query = supabase.table("insider_trades").select("*").order("filing_date", desc=True).limit(1000)
        if symbol:
            query = query.eq("symbol", symbol.upper())
        if trade_type:
            query = query.eq("trade_type", trade_type.upper())

        rows = query.execute().data or []
        return _paginate(rows, limit, offset)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch insider trades: {exc}") from exc


@router.get("/market-sentiment")
def get_market_sentiment(
    symbol: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    try:
        supabase = _get_supabase_client()
        query = supabase.table("market_sentiment").select("*").order("created_at", desc=True).limit(1000)
        if symbol:
            query = query.eq("symbol", symbol.upper())
        if source:
            query = query.eq("source", source.lower())

        rows = query.execute().data or []
        return _paginate(rows, limit, offset)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch market sentiment: {exc}") from exc
