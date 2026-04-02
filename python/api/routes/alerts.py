from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from supabase import Client, create_client

from config.settings import get_settings

router = APIRouter()

Direction = Literal["bullish", "bearish", "neutral"]


class AlertPreviewRequest(BaseModel):
    min_score: float = Field(default=70, ge=0, le=100)
    directions: list[Direction] = Field(default_factory=lambda: ["bullish", "bearish"])
    modules: list[str] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=100)


class AlertCandidate(BaseModel):
    id: str
    symbol: str
    module: str
    signal_type: str
    signal_score: float
    summary: str
    created_at: str
    reasons: list[str]


class AlertPreviewResponse(BaseModel):
    total_candidates: int
    threshold: float
    directions: list[Direction]
    modules: list[str]
    candidates: list[AlertCandidate]


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
    if direction in ("bullish", "bearish", "neutral"):
        normalized_signal_type = direction

    summary = row.get("summary") or row.get("analysis") or ""

    normalized = dict(row)
    normalized.update(
        {
            "module": str(module),
            "signal_score": float(signal_score),
            "summary": str(summary),
            "signal_type": str(normalized_signal_type),
        }
    )
    return normalized


@router.post("/alerts/preview", response_model=AlertPreviewResponse)
def preview_alerts(payload: AlertPreviewRequest) -> AlertPreviewResponse:
    try:
        supabase = _get_supabase_client()
        rows = (
            supabase.table("market_signals")
            .select("*")
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
            .data
            or []
        )

        normalized = [_normalize_signal(row) for row in rows]
        filtered: list[AlertCandidate] = []

        for row in normalized:
            score = float(row.get("signal_score") or 0)
            signal_type = str(row.get("signal_type") or "")
            module = str(row.get("module") or "unknown")

            if score < payload.min_score:
                continue
            if payload.directions and signal_type not in payload.directions:
                continue
            if payload.modules and module not in payload.modules:
                continue

            reasons = [f"score >= {payload.min_score}", f"direction={signal_type}"]
            if payload.modules:
                reasons.append(f"module in {payload.modules}")

            filtered.append(
                AlertCandidate(
                    id=str(row.get("id")),
                    symbol=str(row.get("symbol") or ""),
                    module=module,
                    signal_type=signal_type,
                    signal_score=score,
                    summary=str(row.get("summary") or ""),
                    created_at=str(row.get("created_at") or ""),
                    reasons=reasons,
                )
            )

            if len(filtered) >= payload.limit:
                break

        return AlertPreviewResponse(
            total_candidates=len(filtered),
            threshold=payload.min_score,
            directions=payload.directions,
            modules=payload.modules,
            candidates=filtered,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to preview alerts: {exc}") from exc
