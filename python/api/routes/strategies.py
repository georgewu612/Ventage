"""Quant Lab — strategy backtest endpoints.

POST /v1/strategies/backtest     — run a backtest
GET  /v1/strategies/runs         — list user's runs (requires user_id query param)
GET  /v1/strategies/runs/{id}    — get a specific run + results
GET  /v1/strategies/templates    — list all strategy templates
POST /v1/strategies/match        — AI strategy matching based on risk preference + regime
POST /v1/strategies/walkforward  — walk-forward analysis on a completed backtest run
POST /v1/strategies/sensitivity  — parameter sensitivity analysis
"""

from __future__ import annotations

import asyncio
import json
import numpy as np
from datetime import UTC, datetime
from typing import Any, Literal

import structlog
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from openai import OpenAI
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


class StrategyMatchRequest(BaseModel):
    risk_preference: Literal["conservative", "moderate", "balanced", "aggressive", "speculative"] = Field(
        description="User's risk tolerance"
    )
    max_drawdown_pct: float = Field(ge=1, le=50, description="Maximum acceptable drawdown percentage")


class WalkForwardRequest(BaseModel):
    run_id: str = Field(description="Completed backtest run UUID")
    n_splits: int = Field(default=3, ge=2, le=5, description="Number of time-series splits")
    train_ratio: float = Field(default=0.7, ge=0.5, le=0.85, description="Training window ratio")


class SensitivityRequest(BaseModel):
    run_id: str = Field(description="Completed backtest run UUID")
    param_key: str = Field(description="Parameter name to vary, e.g. 'fast_window'")
    range_min: float = Field(description="Minimum parameter value")
    range_max: float = Field(description="Maximum parameter value")
    steps: int = Field(default=5, ge=3, le=10, description="Number of steps to test")


@router.post("/strategies/match")
def match_strategies(req: StrategyMatchRequest) -> dict[str, Any]:
    """Use AI to recommend strategy templates based on risk preference and current market regime."""
    db = _db()
    settings = get_settings()

    # ── 1. Fetch current regime ─────────────────────────────────────
    regime = "neutral"
    volatility = "normal"
    style = "mixed"
    try:
        regime_res = (
            db.table("market_regime_snapshots")
            .select("regime, volatility, style, recommendation, vix")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
        )
        if regime_res.data:
            snap = regime_res.data[0]
            regime = snap.get("regime", "neutral")
            volatility = snap.get("volatility", "normal")
            style = snap.get("style", "mixed")
    except Exception:
        pass

    # ── 2. Fetch all strategy templates ─────────────────────────────
    templates_res = db.table("strategy_templates").select("*").order("name").execute()
    templates = templates_res.data or []

    if not templates:
        return {
            "regime": regime,
            "volatility": volatility,
            "top_matches": [],
            "excluded": [],
        }

    # ── 3. Call GPT-4o-mini for scoring ─────────────────────────────
    openai_key = getattr(settings, "openai_api_key", None)
    if not openai_key:
        # Fallback: simple rule-based scoring without AI
        scored = _rule_based_match(templates, regime, volatility, req.risk_preference, req.max_drawdown_pct)
        top = [t for t in scored if t["score"] >= 60][:3]
        excluded = [t for t in scored if t["score"] < 60]
        return {"regime": regime, "volatility": volatility, "top_matches": top, "excluded": excluded}

    template_summaries = [
        f"- {t.get('name','?')} (id: {t.get('id','?')}): {t.get('description','')}"
        for t in templates
    ]

    prompt = f"""You are a quantitative strategy advisor. Given the current market environment and user risk profile, score each strategy template from 0-100 for suitability and provide a concise reason.

Current Market Context:
- Regime: {regime} (risk_on = bullish environment, neutral = mixed, risk_off = defensive)
- Volatility: {volatility} (low/normal/high/very_high)
- Style: {style} (growth/value/defensive/cyclical/mixed)

User Risk Profile:
- Risk preference: {req.risk_preference} (conservative/moderate/balanced/aggressive/speculative)
- Maximum acceptable drawdown: {req.max_drawdown_pct}%

Strategy Templates to score:
{chr(10).join(template_summaries)}

Return a JSON object with this exact structure:
{{
  "scores": [
    {{"template_id": "<id>", "name": "<name>", "score": <0-100>, "reason": "<reason in Chinese, ≤80 chars>", "reason_en": "<reason in English, ≤80 chars>"}},
    ...
  ]
}}

Score guidelines:
- 80-100: Highly suitable for current regime + user profile
- 60-79: Moderately suitable with caveats
- 40-59: Marginal, significant caveats
- 0-39: Not recommended for this profile/regime

Return ALL templates scored. Conservative + risk_off → favor low-vol/defensive. Aggressive + risk_on → trend/momentum OK."""

    try:
        client = OpenAI(api_key=openai_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            max_tokens=1000,
            temperature=0.2,
        )
        raw = json.loads(response.choices[0].message.content or "{}")
        scores = raw.get("scores", [])
    except Exception as exc:
        logger.warning("strategy_match_ai_failed", error=str(exc))
        # Fallback to rule-based
        scored = _rule_based_match(templates, regime, volatility, req.risk_preference, req.max_drawdown_pct)
        scores = scored

    # Sort and split
    scores.sort(key=lambda x: x.get("score", 0), reverse=True)
    top_matches = [s for s in scores if s.get("score", 0) >= 60][:3]
    excluded = [s for s in scores if s.get("score", 0) < 60]

    return {
        "regime": regime,
        "volatility": volatility,
        "style": style,
        "top_matches": top_matches,
        "excluded": excluded,
    }


def _rule_based_match(
    templates: list[dict],
    regime: str,
    volatility: str,
    risk_pref: str,
    max_dd: float,
) -> list[dict]:
    """Simple rule-based strategy scoring fallback (no AI)."""
    RISK_RANK = {"conservative": 0, "moderate": 1, "balanced": 2, "aggressive": 3, "speculative": 4}
    risk_rank = RISK_RANK.get(risk_pref, 2)

    # Strategy aggressiveness map (rough categorization)
    STRATEGY_RISK: dict[str, int] = {
        "low_volatility_defense": 0,
        "index_enhancement": 1,
        "value_momentum": 2,
        "trend_following": 2,
        "sma_crossover": 2,
        "rsi_mean_reversion": 2,
        "bollinger_band": 2,
        "macd": 2,
        "momentum_breakout": 3,
        "earnings_event": 3,
        "options_flow": 4,
    }

    scored = []
    for t in templates:
        name_key = t.get("name", "").lower().replace(" ", "_")
        t_risk = STRATEGY_RISK.get(name_key, 2)

        # Base score from risk alignment
        diff = abs(risk_rank - t_risk)
        base_score = max(0, 90 - diff * 25)

        # Regime adjustment
        if regime == "risk_off" and t_risk >= 3:
            base_score -= 25
        elif regime == "risk_on" and t_risk <= 1:
            base_score -= 10
        elif regime == "risk_off" and t_risk <= 1:
            base_score += 10

        # Volatility adjustment
        if volatility in ("high", "very_high") and t_risk >= 3:
            base_score -= 15
        elif volatility == "low" and t_risk <= 1:
            base_score += 5

        score = max(0, min(100, int(base_score)))
        reason = "与当前市场环境和风险偏好匹配" if score >= 60 else "当前市场环境下适配度较低"
        reason_en = "Aligns with current market and risk profile" if score >= 60 else "Low fit for current environment"

        scored.append({
            "template_id": t.get("id", ""),
            "name": t.get("name", ""),
            "score": score,
            "reason": reason,
            "reason_en": reason_en,
        })

    return scored


@router.post("/strategies/walkforward")
async def walkforward_analysis(req: WalkForwardRequest) -> dict[str, Any]:
    """Run walk-forward analysis on a completed backtest to assess consistency and overfitting risk."""
    db = _db()

    # ── 1. Fetch original run info ───────────────────────────────────
    run_res = db.table("strategy_runs").select("*").eq("id", req.run_id).single().execute()
    if not run_res.data:
        raise HTTPException(status_code=404, detail=f"Run not found: {req.run_id}")

    run = run_res.data
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run must be in 'done' status for walk-forward analysis")

    strategy_name = run.get("template_name", "sma_crossover")
    symbol = run.get("symbol", "SPY")
    start_date = run.get("start_date", "2022-01-01")
    end_date = run.get("end_date", "2024-12-31")
    params = run.get("params", {}) or {}

    # ── 2. Split time range into n_splits ────────────────────────────
    from datetime import date as dt_date, timedelta
    start = dt_date.fromisoformat(str(start_date)[:10])
    end = dt_date.fromisoformat(str(end_date)[:10])
    total_days = (end - start).days

    if total_days < 180:
        raise HTTPException(status_code=400, detail="Backtest period too short for walk-forward analysis (need ≥ 180 days)")

    split_days = total_days // req.n_splits
    engine = get_engine("vectorbt")

    splits = []
    train_sharpes: list[float] = []
    test_sharpes: list[float] = []

    for i in range(req.n_splits):
        split_start = start + timedelta(days=i * split_days)
        split_end = start + timedelta(days=(i + 1) * split_days)

        train_end = split_start + timedelta(days=int(split_days * req.train_ratio))
        test_start = train_end
        test_end = split_end

        # Run on training window
        try:
            train_result = await engine.run(
                strategy_name=strategy_name,
                symbol=symbol,
                start_date=split_start.isoformat(),
                end_date=train_end.isoformat(),
                params=params,
            )
            train_sharpe = train_result.sharpe_ratio or 0.0
        except Exception:
            train_sharpe = 0.0

        # Run on test window
        try:
            test_result = await engine.run(
                strategy_name=strategy_name,
                symbol=symbol,
                start_date=test_start.isoformat(),
                end_date=test_end.isoformat(),
                params=params,
            )
            test_sharpe = test_result.sharpe_ratio or 0.0
            test_return = test_result.total_return or 0.0
        except Exception:
            test_sharpe = 0.0
            test_return = 0.0

        train_sharpes.append(train_sharpe)
        test_sharpes.append(test_sharpe)

        splits.append({
            "split": i + 1,
            "train_start": split_start.isoformat(),
            "train_end": train_end.isoformat(),
            "test_start": test_start.isoformat(),
            "test_end": test_end.isoformat(),
            "train_sharpe": round(train_sharpe, 3),
            "test_sharpe": round(test_sharpe, 3),
            "test_return_pct": round(test_return * 100, 2),
        })

    # ── 3. Compute summary metrics ────────────────────────────────────
    avg_train = sum(train_sharpes) / len(train_sharpes) if train_sharpes else 0
    avg_test = sum(test_sharpes) / len(test_sharpes) if test_sharpes else 0

    if avg_train > 0:
        consistency_score = round(max(0, 1 - abs(avg_train - avg_test) / avg_train) * 100, 1)
    else:
        consistency_score = 50.0

    overfitting_risk_score = round(min(100, max(0, (avg_train - avg_test) * 20)), 1)

    return {
        "run_id": req.run_id,
        "symbol": symbol,
        "strategy": strategy_name,
        "n_splits": req.n_splits,
        "splits": splits,
        "avg_train_sharpe": round(avg_train, 3),
        "avg_test_sharpe": round(avg_test, 3),
        "consistency_score": consistency_score,
        "overfitting_risk_score": overfitting_risk_score,
        "interpretation": (
            "稳健" if overfitting_risk_score < 30 else
            "轻度过拟合风险" if overfitting_risk_score < 60 else
            "高度过拟合风险，建议调整参数"
        ),
    }


@router.post("/strategies/sensitivity")
async def sensitivity_analysis(req: SensitivityRequest) -> dict[str, Any]:
    """Test parameter sensitivity by varying a single parameter and measuring Sharpe ratio stability."""
    db = _db()

    run_res = db.table("strategy_runs").select("*").eq("id", req.run_id).single().execute()
    if not run_res.data:
        raise HTTPException(status_code=404, detail=f"Run not found: {req.run_id}")

    run = run_res.data
    if run.get("status") != "done":
        raise HTTPException(status_code=400, detail="Run must be 'done' for sensitivity analysis")

    strategy_name = run.get("template_name", "sma_crossover")
    symbol = run.get("symbol", "SPY")
    start_date = run.get("start_date", "2022-01-01")
    end_date = run.get("end_date", "2024-12-31")
    base_params = dict(run.get("params", {}) or {})

    engine = get_engine("vectorbt")
    step_size = (req.range_max - req.range_min) / (req.steps - 1) if req.steps > 1 else 0

    results = []
    for i in range(req.steps):
        param_val = req.range_min + i * step_size
        test_params = {**base_params, req.param_key: int(param_val) if param_val == int(param_val) else param_val}

        try:
            result = await engine.run(
                strategy_name=strategy_name,
                symbol=symbol,
                start_date=start_date,
                end_date=end_date,
                params=test_params,
            )
            sharpe = result.sharpe_ratio or 0.0
            total_return = result.total_return or 0.0
        except Exception:
            sharpe = 0.0
            total_return = 0.0

        results.append({
            "param_value": round(param_val, 2),
            "sharpe": round(sharpe, 3),
            "total_return_pct": round(total_return * 100, 2),
        })

    sharpes = [r["sharpe"] for r in results]
    sharpe_std = float(np.std(sharpes)) if len(sharpes) > 1 else 0.0

    return {
        "run_id": req.run_id,
        "param_key": req.param_key,
        "results": results,
        "sharpe_std": round(sharpe_std, 3),
        "stability": "stable" if sharpe_std < 0.3 else "moderate" if sharpe_std < 0.7 else "sensitive",
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
