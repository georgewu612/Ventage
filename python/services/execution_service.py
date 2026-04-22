"""Execution service — paper trading simulation with IBKR hook points.

Architecture:
  ExecutionService (abstract base)
  ├── PaperTradingService   ← active now (in-DB simulation, no broker needed)
  └── IBKRService           ← future (requires IB Gateway / TWS running locally)

All order state is persisted in `paper_orders` Supabase table so the
frontend can poll without keeping server-side state.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

import structlog
import yfinance as yf

logger = structlog.get_logger()

OrderSide = Literal["buy", "sell"]
OrderType = Literal["market", "limit", "stop"]
OrderStatus = Literal["pending", "filled", "cancelled", "rejected"]


@dataclass
class Order:
    order_id: str
    user_id: str
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: float
    limit_price: float | None
    stop_price: float | None
    status: OrderStatus
    fill_price: float | None
    filled_at: str | None
    created_at: str
    notes: str | None = None


@dataclass
class OrderResult:
    success: bool
    order_id: str | None = None
    fill_price: float | None = None
    error: str | None = None


class ExecutionService(ABC):
    @abstractmethod
    async def submit_order(
        self,
        user_id: str,
        symbol: str,
        side: OrderSide,
        order_type: OrderType,
        quantity: float,
        limit_price: float | None = None,
        stop_price: float | None = None,
        notes: str | None = None,
    ) -> OrderResult:
        ...

    @abstractmethod
    async def cancel_order(self, order_id: str, user_id: str) -> bool:
        ...

    @abstractmethod
    async def list_orders(self, user_id: str, limit: int = 50) -> list[Order]:
        ...


class PaperTradingService(ExecutionService):
    """Simulated paper trading — fills market orders instantly at last price."""

    def __init__(self, db) -> None:
        self.db = db
        self.log = logger.bind(component="paper_trading")

    def _last_price(self, symbol: str) -> float | None:
        try:
            ticker = yf.Ticker(symbol)
            hist = ticker.history(period="1d")
            if hist.empty:
                return None
            return float(hist["Close"].iloc[-1])
        except Exception:
            return None

    async def submit_order(
        self,
        user_id: str,
        symbol: str,
        side: OrderSide,
        order_type: OrderType,
        quantity: float,
        limit_price: float | None = None,
        stop_price: float | None = None,
        notes: str | None = None,
    ) -> OrderResult:
        now = datetime.now(UTC).isoformat()
        symbol = symbol.upper()

        # Market orders fill instantly at last price
        fill_price = None
        status: OrderStatus = "pending"
        filled_at = None

        if order_type == "market":
            price = self._last_price(symbol)
            if price is None:
                row = self._insert_order(
                    user_id, symbol, side, order_type, quantity,
                    limit_price, stop_price, "rejected", None, None, notes, now,
                )
                return OrderResult(success=False, order_id=row["id"], error=f"Could not fetch price for {symbol}")
            fill_price = price
            status = "filled"
            filled_at = now

        row = self._insert_order(
            user_id, symbol, side, order_type, quantity,
            limit_price, stop_price, status, fill_price, filled_at, notes, now,
        )
        self.log.info("order_submitted", symbol=symbol, side=side, status=status, fill=fill_price)
        return OrderResult(success=True, order_id=row["id"], fill_price=fill_price)

    def _insert_order(
        self, user_id, symbol, side, order_type, quantity,
        limit_price, stop_price, status, fill_price, filled_at, notes, now,
    ) -> dict:
        result = self.db.table("paper_orders").insert({
            "user_id": user_id,
            "symbol": symbol,
            "side": side,
            "order_type": order_type,
            "quantity": quantity,
            "limit_price": limit_price,
            "stop_price": stop_price,
            "status": status,
            "fill_price": fill_price,
            "filled_at": filled_at,
            "notes": notes,
            "created_at": now,
        }).execute()
        return result.data[0]

    async def cancel_order(self, order_id: str, user_id: str) -> bool:
        result = (
            self.db.table("paper_orders")
            .update({"status": "cancelled"})
            .eq("id", order_id)
            .eq("user_id", user_id)
            .eq("status", "pending")
            .execute()
        )
        return bool(result.data)

    async def list_orders(self, user_id: str, limit: int = 50) -> list[Order]:
        result = (
            self.db.table("paper_orders")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        orders = []
        for row in result.data or []:
            orders.append(Order(
                order_id=row["id"],
                user_id=row["user_id"],
                symbol=row["symbol"],
                side=row["side"],
                order_type=row["order_type"],
                quantity=row["quantity"],
                limit_price=row.get("limit_price"),
                stop_price=row.get("stop_price"),
                status=row["status"],
                fill_price=row.get("fill_price"),
                filled_at=row.get("filled_at"),
                created_at=row["created_at"],
                notes=row.get("notes"),
            ))
        return orders


class IBKRService(ExecutionService):
    """IBKR TWS / IB Gateway integration — not yet implemented.

    To activate: install `ib_insync`, start IB Gateway locally,
    then replace the NotImplementedError bodies with real TWS calls.
    """

    async def submit_order(self, *args, **kwargs) -> OrderResult:
        raise NotImplementedError("IBKR integration not yet implemented. Use PaperTradingService.")

    async def cancel_order(self, order_id: str, user_id: str) -> bool:
        raise NotImplementedError

    async def list_orders(self, user_id: str, limit: int = 50) -> list[Order]:
        raise NotImplementedError


def get_execution_service(db, mode: str = "paper") -> ExecutionService:
    """Factory — returns the requested execution service."""
    if mode == "paper":
        return PaperTradingService(db)
    if mode == "ibkr":
        return IBKRService()
    raise ValueError(f"Unknown execution mode: {mode!r}")
