from __future__ import annotations

from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from supabase import Client, create_client

from alerting.manager import AlertManager
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


class AlertTriggerResponse(BaseModel):
    evaluated: int
    matched: int
    sent: int
    errors: list[str]


@router.get("/alerts/test")
async def test_telegram() -> dict[str, Any]:
    """Send a test message to verify Telegram configuration."""
    settings = get_settings()
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        raise HTTPException(
            status_code=503,
            detail="Telegram 未配置，请设置 TELEGRAM_BOT_TOKEN 和 TELEGRAM_CHAT_ID 环境变量",
        )

    from alerting.telegram import TelegramNotifier

    notifier = TelegramNotifier(settings.telegram_bot_token, settings.telegram_chat_id)
    success = await notifier.send_message(
        "🔔 <b>Ventage 告警系统测试</b>\n\n"
        "✅ Telegram 连接正常！\n"
        "📊 告警系统已就绪，将在检测到高分信号时自动推送。\n\n"
        "<i>这是一条测试消息，非真实信号告警。</i>"
    )

    if not success:
        raise HTTPException(status_code=500, detail="测试消息发送失败，请检查 Bot Token 和 Chat ID 是否正确")

    return {"ok": True, "message": "测试消息已发送，请检查 Telegram"}


@router.post("/alerts/trigger", response_model=AlertTriggerResponse)
async def trigger_alerts() -> AlertTriggerResponse:
    """Manually trigger alert evaluation and notification."""
    try:
        supabase = _get_supabase_client()
        manager = AlertManager(supabase)
        result = await manager.evaluate_and_notify()
        return AlertTriggerResponse(**result)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to trigger alerts: {exc}") from exc


class AlertHistoryItem(BaseModel):
    id: str
    symbol: str
    module: str
    signal_score: float | None
    direction: str | None
    sent_at: str
    channel: str | None


class AlertHistoryResponse(BaseModel):
    total: int
    items: list[AlertHistoryItem]


@router.get("/alerts/history")
def get_alert_history(
    symbol: Optional[str] = Query(default=None),
    module: Optional[str] = Query(default=None),
    direction: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Get recent alert history with optional filters."""
    try:
        supabase = _get_supabase_client()
        query = (
            supabase.table("alert_history")
            .select("*")
            .order("sent_at", desc=True)
            .limit(1000)
        )
        if symbol:
            query = query.eq("symbol", symbol.upper())
        if module:
            query = query.eq("module", module)
        if direction:
            query = query.eq("direction", direction)

        rows = query.execute().data or []
        total = len(rows)
        sliced = rows[offset : offset + limit]
        return {
            "items": [
                {
                    "id": str(r.get("id")),
                    "symbol": r.get("symbol", ""),
                    "module": r.get("module", ""),
                    "signal_score": r.get("signal_score"),
                    "direction": r.get("direction"),
                    "sent_at": str(r.get("sent_at", "")),
                    "channel": r.get("channel"),
                }
                for r in sliced
            ],
            "pagination": {
                "limit": limit,
                "offset": offset,
                "returned": len(sliced),
                "total": total,
            },
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to get alert history: {exc}") from exc
