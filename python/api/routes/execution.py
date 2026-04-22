"""Execution layer API — paper trading order management.

POST /v1/execution/order        — submit an order
DELETE /v1/execution/order/{id} — cancel a pending order
GET  /v1/execution/orders       — list orders for a user
GET  /v1/execution/positions    — aggregate filled orders into positions
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from supabase import Client, create_client

from config.settings import get_settings
from services.execution_service import get_execution_service

logger = structlog.get_logger()
router = APIRouter()


def _db() -> Client:
    s = get_settings()
    if not s.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


class OrderRequest(BaseModel):
    user_id: str
    symbol: str
    side: str            # "buy" | "sell"
    order_type: str      # "market" | "limit" | "stop"
    quantity: float
    limit_price: float | None = None
    stop_price: float | None = None
    notes: str | None = None
    mode: str = "paper"  # "paper" | "ibkr"


@router.post("/execution/order")
async def submit_order(req: OrderRequest) -> dict[str, Any]:
    db = _db()
    svc = get_execution_service(db, req.mode)
    result = await svc.submit_order(
        user_id=req.user_id,
        symbol=req.symbol,
        side=req.side,          # type: ignore[arg-type]
        order_type=req.order_type,  # type: ignore[arg-type]
        quantity=req.quantity,
        limit_price=req.limit_price,
        stop_price=req.stop_price,
        notes=req.notes,
    )
    if not result.success:
        raise HTTPException(status_code=400, detail=result.error or "Order failed")
    return {
        "order_id": result.order_id,
        "fill_price": result.fill_price,
        "status": "filled" if result.fill_price else "pending",
    }


@router.delete("/execution/order/{order_id}")
async def cancel_order(
    order_id: str,
    user_id: str = Query(...),
    mode: str = Query(default="paper"),
) -> dict[str, Any]:
    db = _db()
    svc = get_execution_service(db, mode)
    cancelled = await svc.cancel_order(order_id, user_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Order not found or already filled/cancelled")
    return {"cancelled": order_id}


@router.get("/execution/orders")
async def list_orders(
    user_id: str = Query(...),
    limit: int = Query(default=50, le=200),
    mode: str = Query(default="paper"),
) -> list[dict[str, Any]]:
    db = _db()
    svc = get_execution_service(db, mode)
    orders = await svc.list_orders(user_id, limit)
    return [
        {
            "order_id": o.order_id,
            "symbol": o.symbol,
            "side": o.side,
            "order_type": o.order_type,
            "quantity": o.quantity,
            "limit_price": o.limit_price,
            "stop_price": o.stop_price,
            "status": o.status,
            "fill_price": o.fill_price,
            "filled_at": o.filled_at,
            "created_at": o.created_at,
            "notes": o.notes,
        }
        for o in orders
    ]


@router.get("/execution/positions")
async def paper_positions(user_id: str = Query(...)) -> dict[str, Any]:
    """Compute net paper positions from filled orders."""
    db = _db()
    result = (
        db.table("paper_orders")
        .select("symbol, side, quantity, fill_price, filled_at")
        .eq("user_id", user_id)
        .eq("status", "filled")
        .execute()
    )
    orders = result.data or []

    # Aggregate net position per symbol
    positions: dict[str, dict] = {}
    for o in orders:
        sym = o["symbol"]
        qty = float(o["quantity"])
        price = float(o["fill_price"] or 0)
        if o["side"] == "buy":
            if sym not in positions:
                positions[sym] = {"symbol": sym, "quantity": 0.0, "cost_basis": 0.0, "trades": 0}
            pos = positions[sym]
            # Weighted average cost
            total_cost = pos["cost_basis"] * pos["quantity"] + price * qty
            pos["quantity"] += qty
            pos["cost_basis"] = total_cost / pos["quantity"] if pos["quantity"] > 0 else 0
            pos["trades"] += 1
        elif sym in positions:
            positions[sym]["quantity"] -= qty
            positions[sym]["trades"] += 1
            if positions[sym]["quantity"] <= 0:
                del positions[sym]

    return {
        "positions": list(positions.values()),
        "count": len(positions),
    }
