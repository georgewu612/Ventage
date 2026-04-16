"""AI-powered analysis report endpoints."""

from __future__ import annotations

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
        raise HTTPException(status_code=404, detail="No market data available for report generation")

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
        result = (
            supabase.table("market_signals")
            .select("*")
            .eq("id", signal_id)
            .single()
            .execute()
        )
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
        "ai_analysis": analysis,
        "model": analyst.model,
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

    from datetime import datetime, timedelta, timezone

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

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
        ai_text = analyst.analyze_signal(sig)
        analyses.append({
            "signal_id": sig.get("id"),
            "module": sig.get("module"),
            "direction": sig.get("direction"),
            "signal_score": sig.get("signal_score"),
            "original_analysis": sig.get("analysis"),
            "ai_analysis": ai_text,
        })

    return {
        "symbol": symbol.upper(),
        "count": len(analyses),
        "analyses": analyses,
        "model": analyst.model,
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
    date: str | None = Query(default=None, description="Analysis date (YYYY-MM-DD), defaults to today"),
    language: str = Query(default="en", description="Response language: 'zh' for Chinese, 'en' for English"),
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
