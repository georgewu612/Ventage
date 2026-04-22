"""Quant Lab — strategy backtest endpoints.

POST /v1/strategies/backtest     — run a backtest
GET  /v1/strategies/runs         — list user's runs (requires user_id query param)
GET  /v1/strategies/runs/{id}    — get a specific run + results
GET  /v1/strategies/templates    — list all strategy templates
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel, Field
from supabase import Client, create_client

from config.settings import get_settings
from services.backtest_engine import get_engine

logger = structlog.get_logger()
router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────


def _db() -> Client:
    s = get_settings()
    if not s.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


# ── Request / Response models ─────────────────────────────────────────────────


class BacktestRequest(BaseModel):
    user_id: str = Field(description="Supabase user UUID")
    template_name: str = Field(description="Strategy key, e.g. 'sma_crossover'")
    template_id: str | None = Field(default=None, description="Optional template UUID")
    symbol: str = Field(description="Stock ticker, e.g. 'NVDA'")
    start_date: str = Field(description="ISO date, e.g. '2022-01-01'")
    end_date: str = Field(description="ISO date, e.g. '2024-12-31'")
    params: dict = Field(default_factory=dict, description="Strategy parameters")
    engine: str = Field(default="vectorbt", description="Backtest engine to use")


# ── Background task ───────────────────────────────────────────────────────────


async def _run_backtest(run_id: str, request: BacktestRequest) -> None:
    """Execute the backtest and persist results (runs in background)."""
    db = _db()
    log = logger.bind(run_id=run_id, strategy=request.template_name, symbol=request.symbol)

    try:
        # Mark as running
        db.table("strategy_runs").update({"status": "running"}).eq("id", run_id).execute()

        engine = get_engine(request.engine)
        result = await engine.run(
            strategy_name=request.template_name,
            symbol=request.symbol.upper(),
            start_date=request.start_date,
            end_date=request.end_date,
            params=request.params,
        )

        if result.error:
            db.table("strategy_runs").update({
                "status": "failed",
                "error_msg": result.error,
                "finished_at": datetime.now(UTC).isoformat(),
            }).eq("id", run_id).execute()
            log.error("backtest_failed", error=result.error)
            return

        # Persist backtest_results
        equity_data = [{"date": p.date, "value": p.value} for p in result.equity_curve]
        db.table("backtest_results").insert({
            "run_id": run_id,
            "total_return": result.total_return,
            "annualized_return": result.annualized_return,
            "sharpe_ratio": result.sharpe_ratio,
            "max_drawdown": result.max_drawdown,
            "win_rate": result.win_rate,
            "total_trades": result.total_trades,
            "profit_factor": result.profit_factor,
            "equity_curve": equity_data,
        }).execute()

        # Persist top trades (limit to 200 to avoid DB bloat)
        if result.trades:
            trades_data = [
                {
                    "run_id": run_id,
                    "entry_date": t.entry_date,
                    "exit_date": t.exit_date,
                    "side": t.side,
                    "entry_price": t.entry_price,
                    "exit_price": t.exit_price,
                    "quantity": t.quantity,
                    "pnl": t.pnl,
                    "pnl_pct": t.pnl_pct,
                }
                for t in result.trades[:200]
            ]
            db.table("backtest_trades").insert(trades_data).execute()

        # Mark run as done
        db.table("strategy_runs").update({
            "status": "done",
            "finished_at": datetime.now(UTC).isoformat(),
        }).eq("id", run_id).execute()

        log.info("backtest_persisted", total_return=result.total_return)

    except Exception as exc:
        log.error("backtest_task_failed", error=str(exc))
        try:
            db.table("strategy_runs").update({
                "status": "failed",
                "error_msg": str(exc)[:500],
                "finished_at": datetime.now(UTC).isoformat(),
            }).eq("id", run_id).execute()
        except Exception:
            pass


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.get("/strategies/templates")
def list_templates() -> list[dict[str, Any]]:
    """Return all built-in strategy templates."""
    db = _db()
    result = db.table("strategy_templates").select("*").order("name").execute()
    return result.data or []


@router.post("/strategies/backtest")
async def start_backtest(
    req: BacktestRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Start a backtest run asynchronously.

    Returns immediately with a run_id. Poll GET /strategies/runs/{id} for status.
    """
    db = _db()

    # Create the run record
    run_data = {
        "user_id": req.user_id,
        "template_name": req.template_name,
        "template_id": req.template_id,
        "symbol": req.symbol.upper(),
        "start_date": req.start_date,
        "end_date": req.end_date,
        "params": req.params,
        "status": "pending",
    }
    run_result = db.table("strategy_runs").insert(run_data).execute()
    run_id = run_result.data[0]["id"]

    # Kick off background task
    background_tasks.add_task(_run_backtest, run_id, req)

    return {
        "run_id": run_id,
        "status": "pending",
        "message": "Backtest started. Poll GET /v1/strategies/runs/{run_id} for results.",
    }


@router.get("/strategies/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    """Get a specific backtest run with its results."""
    db = _db()

    run_result = db.table("strategy_runs").select("*").eq("id", run_id).single().execute()
    if not run_result.data:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")

    run = run_result.data

    # Fetch results if done
    results_data = None
    trades_data = []
    if run.get("status") == "done":
        res = db.table("backtest_results").select("*").eq("run_id", run_id).single().execute()
        if res.data:
            results_data = res.data

        trades_res = (
            db.table("backtest_trades")
            .select("*")
            .eq("run_id", run_id)
            .order("entry_date")
            .limit(100)
            .execute()
        )
        trades_data = trades_res.data or []

    return {
        "run": run,
        "results": results_data,
        "trades": trades_data,
    }


@router.get("/strategies/runs")
def list_runs(
    user_id: str = Query(..., description="Supabase user UUID"),
    limit: int = Query(default=20, le=50),
) -> list[dict[str, Any]]:
    """List a user's backtest runs, newest first."""
    db = _db()
    result = (
        db.table("strategy_runs")
        .select("id, template_name, symbol, start_date, end_date, status, created_at, finished_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return result.data or []
