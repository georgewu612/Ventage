from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from supabase import Client, create_client

from config.settings import get_settings

router = APIRouter()


def _get_supabase_client() -> Client:
    settings = get_settings()
    if not settings.has_supabase_config:
        raise HTTPException(
            status_code=503,
            detail="Supabase environment variables are missing.",
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


@router.get("/market-news")
def get_market_news(
    channel: str | None = Query(default=None),
    importance: int | None = Query(default=None, ge=1),
    symbol: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Fetch market news from WallStreetCN and other sources."""
    try:
        supabase = _get_supabase_client()
        query = (
            supabase.table("market_news").select("*").order("published_at", desc=True).limit(500)
        )

        if importance:
            query = query.gte("importance", importance)

        rows = query.execute().data or []

        # Filter by channel (JSONB array contains)
        if channel:
            rows = [r for r in rows if channel in (r.get("channels") or [])]

        # Filter by symbol (JSONB array contains)
        if symbol:
            sym_upper = symbol.upper()
            rows = [r for r in rows if sym_upper in (r.get("symbols") or [])]

        return _paginate(rows, limit, offset)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch market news: {exc}") from exc
