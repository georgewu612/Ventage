"""AI-powered analysis report endpoints."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from supabase import Client, create_client

from agents.ai_analyst import AIAnalyst
from config.settings import get_settings

try:
    from agents.trading_agents import TradingAgentsAnalyzer
except Exception:
    TradingAgentsAnalyzer = None  # type: ignore[assignment,misc]

router = APIRouter()


def _get_supabase_client() -> Client:
    settings = get_settings()
    if not settings.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/reports/daily")
def get_daily_report() -> dict[str, Any]:
    """Generate an AI-powered daily market summary report."""
    supabase = _get_supabase_client()
    analyst = AIAnalyst(supabase)

    if not analyst.is_available():
        raise HTTPException(
            status_code=503,
            detail="OpenAI API not configured. Set OPENAI_API_KEY environment variable.",
        )

    report = analyst.generate_daily_report()
    if not report:
        raise HTTPException(
            status_code=404, detail="No market data available for report generation"
        )

    return report


@router.get("/reports/signal/{signal_id}")
def get_signal_analysis(signal_id: str) -> dict[str, Any]:
    """Generate AI analysis for a specific market signal."""
    supabase = _get_supabase_client()
    analyst = AIAnalyst(supabase)

    if not analyst.is_available():
        raise HTTPException(
            status_code=503,
            detail="OpenAI API not configured. Set OPENAI_API_KEY environment variable.",
        )

    # Fetch the signal
    try:
        result = supabase.table("market_signals").select("*").eq("id", signal_id).single().execute()
        signal = result.data
    except Exception:
        raise HTTPException(status_code=404, detail=f"Signal not found: {signal_id}")

    if not signal:
        raise HTTPException(status_code=404, detail=f"Signal not found: {signal_id}")

    analysis = analyst.analyze_signal(signal)
    if not analysis:
        raise HTTPException(status_code=500, detail="Failed to generate analysis")

    return {
        "signal_id": signal_id,
        "symbol": signal.get("symbol"),
        "direction": signal.get("direction"),
        "signal_score": signal.get("signal_score"),
        "model": analyst.model,
        **analysis,  # spread structured AIAnalysisOutput fields
    }


@router.get("/reports/analyze")
def analyze_symbol_signals(
    symbol: str = Query(..., description="Stock symbol to analyze"),
) -> dict[str, Any]:
    """Generate AI analysis for all recent signals of a given symbol."""
    supabase = _get_supabase_client()
    analyst = AIAnalyst(supabase)

    if not analyst.is_available():
        raise HTTPException(
            status_code=503,
            detail="OpenAI API not configured. Set OPENAI_API_KEY environment variable.",
        )

    from datetime import datetime, timedelta

    cutoff = (datetime.now(UTC) - timedelta(hours=24)).isoformat()

    result = (
        supabase.table("market_signals")
        .select("*")
        .eq("symbol", symbol.upper())
        .gte("created_at", cutoff)
        .order("signal_score", desc=True)
        .limit(5)
        .execute()
    )

    signals = result.data or []
    if not signals:
        raise HTTPException(status_code=404, detail=f"No recent signals found for {symbol.upper()}")

    analyses = []
    for sig in signals:
        ai_output = analyst.analyze_signal(sig)
        entry: dict[str, Any] = {
            "signal_id": sig.get("id"),
            "module": sig.get("module"),
            "direction": sig.get("direction"),
            "signal_score": sig.get("signal_score"),
            "original_analysis": sig.get("analysis"),
        }
        if ai_output:
            entry.update(ai_output)  # spread structured AIAnalysisOutput fields
        analyses.append(entry)

    return {
        "symbol": symbol.upper(),
        "count": len(analyses),
        "analyses": analyses,
        "model": analyst.model,
    }


# ── Desk Consensus Analysis ────────────────────────────────────────


@router.get("/reports/desk/{symbol}")
async def get_desk_consensus(symbol: str) -> dict[str, Any]:
    """Generate a multi-desk consensus analysis for the given stock symbol.

    Aggregates signals, options flow, insider trades, dark pool, sentiment, and
    the current market regime into a single structured DeskConsensus verdict.
    May take 10–20 s on first call (LLM inference).
    """
    supabase = _get_supabase_client()
    analyst = AIAnalyst(supabase)

    if not analyst.is_available():
        raise HTTPException(
            status_code=503,
            detail="OpenAI API not configured. Set OPENAI_API_KEY environment variable.",
        )

    result = await analyst.analyze_desk(symbol.upper())
    if not result:
        raise HTTPException(
            status_code=500,
            detail=f"Desk analysis failed for {symbol.upper()}. Check server logs.",
        )

    return {
        "symbol": symbol.upper(),
        "model": analyst.model,
        **result,
    }


# ── TradingAgents multi-agent analysis ─────────────────────────────

# Singleton instance (heavy init, reuse across requests)
_ta_analyzer: TradingAgentsAnalyzer | None = None


def _get_ta_analyzer() -> Any:
    global _ta_analyzer
    if _ta_analyzer is None and TradingAgentsAnalyzer is not None:
        _ta_analyzer = TradingAgentsAnalyzer()
    return _ta_analyzer


@router.get("/reports/multi-agent/{symbol}")
def get_multi_agent_analysis(
    symbol: str,
    date: str | None = Query(
        default=None, description="Analysis date (YYYY-MM-DD), defaults to today"
    ),
    language: str = Query(
        default="en", description="Response language: 'zh' for Chinese, 'en' for English"
    ),
) -> dict[str, Any]:
    """Run TradingAgents multi-agent analysis for a symbol.

    Deploys 7 specialized AI agents (analysts, researchers, trader, risk manager)
    to collaboratively evaluate market conditions and produce a trading decision.
    """
    analyzer = _get_ta_analyzer()

    if analyzer is None or not analyzer.is_available():
        raise HTTPException(
            status_code=503,
            detail="TradingAgents not available. Ensure OPENAI_API_KEY and ALPHAVANTAGE_API_KEY are configured, and tradingagents is installed.",
        )

    result = analyzer.analyze(symbol, date, language=language)
    if not result:
        err = analyzer.last_error() if hasattr(analyzer, "last_error") else "unknown error"
        raise HTTPException(
            status_code=500,
            detail=f"Multi-agent analysis failed for {symbol.upper()}: {err}",
        )

    return result


# ── Pre-market / Midday / Closing / Weekly report endpoints ────────────────────


def _db() -> Client:
    s = get_settings()
    if not s.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _openai_json(prompt: str) -> dict[str, Any]:
    """Call GPT-4o-mini and return parsed JSON dict."""
    from openai import OpenAI  # noqa: PLC0415

    s = get_settings()
    if not s.openai_api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")
    client = OpenAI(api_key=s.openai_api_key)
    resp = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.4,
        max_tokens=800,
    )
    return json.loads(resp.choices[0].message.content)


def _regime_context(db: Client) -> str:
    rows = (
        db.table("market_regime_snapshots")
        .select("regime,volatility,vix,breadth,recommendation,chief_summary_en")
        .order("generated_at", desc=True)
        .limit(1)
        .execute()
        .data
        or [{}]
    )
    r = rows[0]
    return (
        f"Regime={r.get('regime','unknown')}, VIX={r.get('vix','?')}, "
        f"Volatility={r.get('volatility','?')}, Breadth={r.get('breadth','?')}, "
        f"Recommendation={r.get('recommendation','?')}"
    )


def _top_signals(db: Client, hours: int = 24, limit: int = 5) -> str:
    cutoff = (datetime.now(UTC) - timedelta(hours=hours)).isoformat()
    rows = (
        db.table("market_signals")
        .select("symbol,direction,confidence,analysis")
        .gte("created_at", cutoff)
        .order("confidence", desc=True)
        .limit(limit)
        .execute()
        .data
        or []
    )
    if not rows:
        return "No recent signals."
    return "\n".join(
        f"- {r['symbol']} {r['direction']} score={round(float(r['confidence'])*100)}"
        for r in rows
    )


@router.get("/reports/premarket")
def get_premarket_brief() -> dict[str, Any]:
    """Generate a pre-market brief for today's session."""
    db = _db()
    regime = _regime_context(db)
    signals = _top_signals(db, hours=18, limit=5)
    prompt = f"""You are a pre-market briefing analyst. Return ONLY valid JSON.

Today's market regime: {regime}
Key signals from overnight: {signals}

Return JSON:
{{
  "title": "Pre-Market Brief — <date>",
  "title_zh": "盘前简报 — <date>",
  "key_watchpoints": ["<3-4 key things to watch today in English>"],
  "key_watchpoints_zh": ["<3-4 件今日重点关注事项（中文）>"],
  "opening_bias": "bullish" | "bearish" | "neutral",
  "strategy_focus": "<1 sentence strategy suggestion in English>",
  "strategy_focus_zh": "<1句操作建议（中文）>",
  "risk_note": "<1 key risk to watch in English>",
  "risk_note_zh": "<1个主要风险（中文）>",
  "generated_at": "<ISO datetime>"
}}"""
    result = _openai_json(prompt)
    result.setdefault("generated_at", datetime.now(UTC).isoformat())
    result.setdefault("report_type", "premarket")
    return result


@router.get("/reports/midday")
def get_midday_check() -> dict[str, Any]:
    """Generate a midday market check."""
    db = _db()
    regime = _regime_context(db)
    signals = _top_signals(db, hours=6, limit=5)
    prompt = f"""You are a midday market analyst. Return ONLY valid JSON.

Current market regime: {regime}
Morning signals: {signals}

Return JSON:
{{
  "title": "Midday Check",
  "title_zh": "盘中检查",
  "morning_summary": "<2 sentences on morning market action in English>",
  "morning_summary_zh": "<2句上午行情回顾（中文）>",
  "flow_observation": "<capital flow observation in English>",
  "flow_observation_zh": "<资金流向观察（中文）>",
  "strategy_adjustment": "maintain" | "reduce" | "add",
  "strategy_note": "<1 sentence on whether to adjust positions>",
  "strategy_note_zh": "<1句仓位调整建议（中文）>",
  "generated_at": "<ISO datetime>"
}}"""
    result = _openai_json(prompt)
    result.setdefault("generated_at", datetime.now(UTC).isoformat())
    result.setdefault("report_type", "midday")
    return result


@router.get("/reports/closing")
def get_closing_wrap() -> dict[str, Any]:
    """Generate an end-of-day closing wrap."""
    db = _db()
    regime = _regime_context(db)
    signals = _top_signals(db, hours=8, limit=5)
    prompt = f"""You are a closing market analyst. Return ONLY valid JSON.

Today's regime: {regime}
Today's signals: {signals}

Return JSON:
{{
  "title": "Closing Wrap",
  "title_zh": "收盘总结",
  "session_summary": "<2 sentences on today's session in English>",
  "session_summary_zh": "<2句今日行情总结（中文）>",
  "signal_performance": "<how signals performed today in English>",
  "signal_performance_zh": "<今日信号表现（中文）>",
  "tomorrow_watchlist": ["<3 symbols or themes to watch tomorrow>"],
  "tomorrow_watchlist_zh": ["<明日关注的3个标的或主题>"],
  "overnight_risk": "<key overnight risk in English>",
  "overnight_risk_zh": "<隔夜主要风险（中文）>",
  "generated_at": "<ISO datetime>"
}}"""
    result = _openai_json(prompt)
    result.setdefault("generated_at", datetime.now(UTC).isoformat())
    result.setdefault("report_type", "closing")
    return result


@router.get("/reports/weekly")
def get_weekly_review() -> dict[str, Any]:
    """Generate a weekly review and next-week outlook."""
    db = _db()
    regime = _regime_context(db)
    signals = _top_signals(db, hours=168, limit=8)
    prompt = f"""You are a weekly market strategist. Return ONLY valid JSON.

This week's regime: {regime}
Key signals this week: {signals}

Return JSON:
{{
  "title": "Weekly Review",
  "title_zh": "周度回顾",
  "week_summary": "<2-3 sentences on this week's market in English>",
  "week_summary_zh": "<2-3句本周行情总结（中文）>",
  "strategy_performance": "<how trend/momentum strategies fared this week>",
  "strategy_performance_zh": "<本周策略表现（中文）>",
  "regime_shift": true | false,
  "regime_note": "<1 sentence on regime stability>",
  "regime_note_zh": "<1句体制稳定性评估（中文）>",
  "next_week_themes": ["<3 themes to watch next week in English>"],
  "next_week_themes_zh": ["<下周3个关注主题（中文）>"],
  "generated_at": "<ISO datetime>"
}}"""
    result = _openai_json(prompt)
    result.setdefault("generated_at", datetime.now(UTC).isoformat())
    result.setdefault("report_type", "weekly")
    return result
