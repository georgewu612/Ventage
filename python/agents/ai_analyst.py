"""AI Analyst — generates natural-language analysis reports using OpenAI.

Design principle (from CLAUDE.md):
  - AI ONLY summarizes and analyzes — it NEVER computes numbers
  - ALL numbers are pre-calculated by code and passed to AI as context
  - Uses Structured Outputs to prevent hallucination
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from openai import OpenAI
from pydantic import BaseModel, Field
from supabase import Client

from agents.models import AIAnalysisOutput
from config.settings import get_settings

logger = structlog.get_logger()


# ── Structured Output Schemas ──────────────────────────────────────


class DailyReport(BaseModel):
    """AI-generated daily market summary report."""

    market_overview: str = Field(
        max_length=300,
        description="今日市场整体概况",
    )
    top_bullish: str = Field(
        max_length=400,
        description="最值得关注的看多信号分析",
    )
    top_bearish: str = Field(
        max_length=400,
        description="最值得关注的看空信号分析",
    )
    unusual_activity: str = Field(
        max_length=300,
        description="异常活动总结（期权异动、大额内部交易等）",
    )
    risk_warning: str = Field(
        max_length=200,
        description="风险提示",
    )


# ── AI Analyst ─────────────────────────────────────────────────────


class AIAnalyst:
    """Uses OpenAI to generate natural-language market analysis."""

    def __init__(self, db: Client) -> None:
        self.db = db
        self.log = logger.bind(component="ai_analyst")
        self.settings = get_settings()

        if not self.settings.has_openai_config:
            self.client = None
            self.log.warning("openai_not_configured", hint="Set OPENAI_API_KEY env var")
        else:
            self.client = OpenAI(api_key=self.settings.openai_api_key)

    @property
    def model(self) -> str:
        return self.settings.openai_model

    def is_available(self) -> bool:
        return self.client is not None

    # ── Signal-level Analysis ──────────────────────────────────────

    def analyze_signal(self, signal: dict[str, Any]) -> dict[str, Any] | None:
        """Generate structured AI analysis for a single market signal.

        Returns an AIAnalysisOutput dict, or None if AI is unavailable.
        """
        if not self.is_available():
            return None

        # Build context with pre-calculated data (AI MUST NOT compute)
        context = self._build_signal_context(signal)

        try:
            response = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 Ventage 金融分析助手。根据提供的市场数据生成结构化分析报告。\n"
                            "规则：\n"
                            "1. 只使用提供的数字，绝不自己计算任何数值\n"
                            "2. 引用数据时使用原始值（如评分、置信度等直接引用）\n"
                            "3. 分析要简洁专业，每条证据不超过 80 字\n"
                            "4. risk_level 根据综合风险选择：low/medium/high/very_high\n"
                            "5. confidence_score 参考信号置信度字段，不要自己估算\n"
                            "6. 所有文字使用中文"
                        ),
                    },
                    {"role": "user", "content": context},
                ],
                response_format=AIAnalysisOutput,
                temperature=0.3,
            )

            analysis = response.choices[0].message.parsed
            if analysis is None:
                return None

            self.log.info(
                "signal_analyzed",
                symbol=signal.get("symbol"),
                module=signal.get("module"),
                tokens=response.usage.total_tokens if response.usage else 0,
            )
            return analysis.model_dump()

        except Exception as exc:
            self.log.error("signal_analysis_failed", error=str(exc), symbol=signal.get("symbol"))
            return None

    # ── Daily Summary Report ───────────────────────────────────────

    def generate_daily_report(self) -> dict[str, Any] | None:
        """Generate a daily market summary report from all recent signals.

        Returns a dict with report sections, or None if AI is unavailable.
        """
        if not self.is_available():
            return None

        # Fetch recent signals and data
        context = self._build_daily_context()
        if not context:
            self.log.warning("no_data_for_daily_report")
            return None

        try:
            response = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 Ventage 每日市场报告生成器。\n"
                            "根据今日所有市场信号数据，生成一份简洁的每日分析报告。\n"
                            "规则：\n"
                            "1. 只使用提供的数字，绝不自己计算\n"
                            "2. 重点突出异常信号和高置信度信号\n"
                            "3. 分析要简洁专业，每个部分不超过3句话\n"
                            "4. 必须包含风险提示和免责声明\n"
                            "5. 使用中文回答"
                        ),
                    },
                    {"role": "user", "content": context},
                ],
                response_format=DailyReport,
                temperature=0.3,
            )

            report = response.choices[0].message.parsed
            if report is None:
                return None

            result = {
                "market_overview": report.market_overview,
                "top_bullish": report.top_bullish,
                "top_bearish": report.top_bearish,
                "unusual_activity": report.unusual_activity,
                "risk_warning": report.risk_warning,
                "generated_at": datetime.now(UTC).isoformat(),
                "model": self.model,
                "tokens": response.usage.total_tokens if response.usage else 0,
            }

            self.log.info(
                "daily_report_generated",
                tokens=result["tokens"],
            )
            return result

        except Exception as exc:
            self.log.error("daily_report_failed", error=str(exc))
            return None

    # ── Context Builders ───────────────────────────────────────────

    def _build_signal_context(self, signal: dict[str, Any]) -> str:
        """Build pre-calculated data context for a single signal."""
        symbol = signal.get("symbol", "UNKNOWN")
        module = signal.get("module", "")
        direction = signal.get("direction", "neutral")
        score = signal.get("signal_score", 0)
        factors = signal.get("factors", {})
        analysis = signal.get("analysis", "")

        # Format factors
        factor_lines = []
        for key, val in factors.items():
            if isinstance(val, dict):
                factor_lines.append(
                    f"  - {val.get('label', key)}: {val.get('value', 0)}/{val.get('max', 100)}"
                )

        context = f"""请分析以下市场信号（所有数字已由系统计算，直接引用即可）：

## 信号概况
- 股票代码: ${symbol}
- 信号来源: {module}
- 方向: {direction}
- 综合评分: {score}/100
- 置信度: {signal.get("confidence", 0)}

## 评分因子（系统计算）
{chr(10).join(factor_lines) if factor_lines else "  无详细因子"}

## 原始数据摘要
{analysis}

请根据以上数据生成分析报告。"""

        return context

    def _build_daily_context(self) -> str | None:
        """Build context from all recent signals for daily report."""
        cutoff = (datetime.now(UTC) - timedelta(hours=24)).isoformat()

        # Fetch recent signals
        result = (
            self.db.table("market_signals")
            .select(
                "symbol, direction, confidence, signal_type, module, signal_score, analysis, factors"
            )
            .gte("created_at", cutoff)
            .order("signal_score", desc=True)
            .limit(50)
            .execute()
        )

        signals = result.data or []
        if not signals:
            return None

        # Categorize
        bullish = [s for s in signals if s.get("direction") == "bullish"]
        bearish = [s for s in signals if s.get("direction") == "bearish"]
        neutral = [s for s in signals if s.get("direction") == "neutral"]

        # Build signal summaries
        def _signal_summary(sig: dict) -> str:
            return (
                f"  - ${sig['symbol']} [{sig.get('module', '')}] "
                f"评分:{sig.get('signal_score', 0)} "
                f"置信度:{sig.get('confidence', 0)} "
                f"| {sig.get('analysis', '')}"
            )

        bullish_text = "\n".join(_signal_summary(s) for s in bullish[:10]) or "  无"
        bearish_text = "\n".join(_signal_summary(s) for s in bearish[:10]) or "  无"

        # Fetch some unusual options data
        options_result = (
            self.db.table("options_flow")
            .select("symbol, option_type, strike, premium, volume, trade_type")
            .gte("created_at", cutoff)
            .order("premium", desc=True)
            .limit(10)
            .execute()
        )
        options = options_result.data or []
        options_text = ""
        for o in options[:5]:
            premium = o.get("premium", 0)
            if premium >= 1_000_000:
                premium_str = f"${premium / 1_000_000:.1f}M"
            elif premium >= 1000:
                premium_str = f"${premium / 1000:.0f}K"
            else:
                premium_str = f"${premium:.0f}"
            options_text += (
                f"  - ${o['symbol']} {o.get('option_type', '').upper()} "
                f"${o.get('strike', 0)} {o.get('trade_type', '')} "
                f"权利金:{premium_str} 成交量:{o.get('volume', 0):,}\n"
            )

        # Fetch insider trades
        insider_result = (
            self.db.table("insider_trades")
            .select("symbol, insider_name, insider_title, trade_type, value, shares")
            .gte("filing_date", cutoff[:10])
            .order("value", desc=True)
            .limit(10)
            .execute()
        )
        insiders = insider_result.data or []
        insider_text = ""
        for i in insiders[:5]:
            value = i.get("value") or 0
            insider_text += (
                f"  - ${i['symbol']} {i.get('insider_name', '')} "
                f"({i.get('insider_title', '')}) "
                f"{i.get('trade_type', '')} "
                f"${value:,.0f} ({i.get('shares', 0):,}股)\n"
            )

        context = f"""请根据以下今日市场数据生成每日报告（所有数字已由系统计算）：

## 今日信号统计
- 看多信号: {len(bullish)} 个
- 看空信号: {len(bearish)} 个
- 中性信号: {len(neutral)} 个
- 总信号数: {len(signals)} 个

## 看多信号（按评分排序）
{bullish_text}

## 看空信号（按评分排序）
{bearish_text}

## 大额期权异动（按权利金排序）
{options_text or "  无数据"}

## 重要内部交易
{insider_text or "  无数据"}

请生成每日市场分析报告。"""

        return context
