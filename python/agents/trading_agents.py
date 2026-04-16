"""TradingAgents integration — multi-agent AI trading analysis.

Wraps the TradingAgents framework (https://github.com/TauricResearch/TradingAgents)
which deploys 7 specialized LLM agents (analysts, researchers, trader, risk manager)
to collaboratively evaluate market conditions.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

import structlog

from config.settings import get_settings

logger = structlog.get_logger()


class TradingAgentsAnalyzer:
    """Wrapper around the TradingAgents multi-agent framework."""

    def __init__(self) -> None:
        self.log = logger.bind(component="trading_agents")
        self.settings = get_settings()
        self._graph = None
        self._available = False

        self._init_graph()

    def _init_graph(self) -> None:
        """Initialize TradingAgents graph (lazy, only if dependencies available)."""
        try:
            # Ensure API keys are set in env (TradingAgents reads from env)
            if self.settings.openai_api_key:
                os.environ.setdefault("OPENAI_API_KEY", self.settings.openai_api_key)
            if self.settings.alphavantage_api_key:
                os.environ.setdefault("ALPHAVANTAGE_API_KEY", self.settings.alphavantage_api_key)

            if not self.settings.openai_api_key:
                self.log.warning("trading_agents_no_openai_key")
                return
            if not self.settings.alphavantage_api_key:
                self.log.warning("trading_agents_no_alphavantage_key")
                return

            from tradingagents.default_config import TradingAgentsConfig
            from tradingagents.graph.trading_graph import TradingAgentsGraph

            config = TradingAgentsConfig(
                llm_provider="openai",
                deep_think_llm=self.settings.openai_model or "gpt-4o-mini",
                quick_think_llm=self.settings.openai_model or "gpt-4o-mini",
                max_debate_rounds=1,       # Keep costs low
                max_risk_discuss_rounds=1,
                max_recur_limit=150,       # 7 agents need many graph steps
            )

            self._graph = TradingAgentsGraph(debug=False, config=config)
            self._available = True
            self.log.info("trading_agents_initialized", model=self.settings.openai_model)

        except ImportError:
            self.log.warning("trading_agents_not_installed", hint="pip install tradingagents")
        except Exception as exc:
            self.log.error("trading_agents_init_failed", error=str(exc))

    def is_available(self) -> bool:
        return self._available

    def analyze(self, symbol: str, date: str | None = None) -> dict[str, Any] | None:
        """Run multi-agent analysis for a symbol.

        Args:
            symbol: Stock ticker (e.g., "NVDA")
            date: Analysis date in YYYY-MM-DD format (defaults to today)

        Returns:
            Dict with decision and agent insights, or None on failure.
        """
        if not self._available:
            return None

        if not date:
            date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        self.log.info("trading_agents_analyzing", symbol=symbol, date=date)

        try:
            state, decision = self._graph.propagate(symbol.upper(), date)

            # Extract structured result
            result = {
                "symbol": symbol.upper(),
                "date": date,
                "decision": decision if isinstance(decision, str) else str(decision),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "model": self.settings.openai_model,
            }

            # state is an AgentState Pydantic object — extract via attribute access
            def _get(attr: str) -> str | None:
                val = getattr(state, attr, None)
                if val is None:
                    return None
                return val if isinstance(val, str) else str(val)

            # Top-level analyst reports
            if v := _get("fundamentals_report"):
                result["fundamentals_report"] = v
            if v := _get("sentiment_report"):
                result["sentiment_report"] = v
            if v := _get("news_report"):
                result["news_report"] = v
            if v := _get("market_report"):  # technical/market report
                result["technical_report"] = v

            # Bull/bear debate from investment_debate_state
            invest = getattr(state, "investment_debate_state", None)
            if invest:
                if v := getattr(invest, "bull_history", None):
                    result["bull_report"] = v if isinstance(v, str) else str(v)
                if v := getattr(invest, "bear_history", None):
                    result["bear_report"] = v if isinstance(v, str) else str(v)

            # Risk debate
            risk = getattr(state, "risk_debate_state", None)
            if risk:
                if v := getattr(risk, "judge_decision", None):
                    result["risk_report"] = v if isinstance(v, str) else str(v)

            # Trader decision
            if v := _get("trader_investment_plan"):
                result["trader_decision"] = v
            elif v := _get("investment_plan"):
                result["trader_decision"] = v

            self.log.info(
                "trading_agents_completed",
                symbol=symbol,
                decision_length=len(result.get("decision", "")),
            )
            return result

        except Exception as exc:
            self.log.error("trading_agents_failed", symbol=symbol, error=str(exc))
            self._last_error = str(exc)
            return None

    def last_error(self) -> str:
        return getattr(self, "_last_error", "unknown error")
