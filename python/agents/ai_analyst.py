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

from agents.models import AIAnalysisOutput, DeskConsensus
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
                            "6. conclusion 字段使用中文\n"
                            "7. conclusion_en 字段必须使用英文，是 conclusion 的英文版本"
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

    # ── Desk Consensus Analysis ────────────────────────────────────

    async def analyze_desk(self, symbol: str) -> dict[str, Any] | None:
        """Generate a multi-desk DeskConsensus for the given symbol.

        Aggregates signals, options flow, insider trades, dark pool, sentiment,
        and the latest market regime into a single structured verdict.
        Returns a DeskConsensus dict, or None if AI is unavailable.
        """
        if not self.is_available():
            return None

        context = await self._build_desk_context(symbol)

        try:
            response = self.client.beta.chat.completions.parse(
                model=self.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是 Ventage 机构研究部首席策略师。你需要代表四个分析台（Technical / Flow / Event / Risk）"
                            "对单只股票给出统一的多台联席共识报告。\n"
                            "规则：\n"
                            "1. 所有数字已由系统提供，直接引用，绝不自行计算\n"
                            "2. 每个分析台观点独立、简洁，不超过 3 句话\n"
                            "3. final_action 必须是以下之一：strong_buy / buy / hold / watch / sell / strong_sell / avoid\n"
                            "4. strategy_fit 最多 4 个，只选择与当前信号最相关的策略\n"
                            "5. conclusion 和 conclusion_en 要保持一致，一句话点出核心判断\n"
                            "6. 中文字段使用中文，英文字段使用英文\n"
                            "7. supporting_evidence_en / risk_evidence_en / invalidation_conditions_en 必须是对应中文字段的英文翻译，逐条对应\n"
                            "7. 本报告仅供研究参考，不构成投资建议"
                        ),
                    },
                    {"role": "user", "content": context},
                ],
                response_format=DeskConsensus,
                temperature=0.25,
            )

            desk = response.choices[0].message.parsed
            if desk is None:
                return None

            self.log.info(
                "desk_analyzed",
                symbol=symbol,
                action=desk.final_action,
                conviction=desk.conviction,
                tokens=response.usage.total_tokens if response.usage else 0,
            )
            return desk.model_dump()

        except Exception as exc:
            self.log.error("desk_analysis_failed", error=str(exc), symbol=symbol)
            return None

    async def _build_desk_context(self, symbol: str) -> str:
        """Aggregate all data sources for the given symbol into a prompt context."""
        cutoff_48h = (datetime.now(UTC) - timedelta(hours=48)).isoformat()
        cutoff_7d  = (datetime.now(UTC) - timedelta(days=7)).isoformat()
        sym = symbol.upper()

        # ── 1. Market regime ──────────────────────────────────────
        regime_text = "N/A"
        try:
            r = (
                self.db.table("market_regime_snapshots")
                .select("regime,volatility,breadth,style,recommendation,vix,spy_vs_200ma_pct,chief_summary_en")
                .order("generated_at", desc=True)
                .limit(1)
                .execute()
            )
            if r.data:
                rg = r.data[0]
                regime_text = (
                    f"Regime={rg['regime']} | Vol={rg['volatility']} | "
                    f"Breadth={rg['breadth']} | Style={rg['style']} | "
                    f"Rec={rg['recommendation']} | VIX={rg.get('vix', 'N/A')} | "
                    f"SPY_vs_200MA={rg.get('spy_vs_200ma_pct', 'N/A')}%\n"
                    f"  Summary: {rg.get('chief_summary_en', '')}"
                )
        except Exception:
            pass

        # ── 2. Market signals (48h) ───────────────────────────────
        signals_text = "No signals"
        try:
            r = (
                self.db.table("market_signals")
                .select("direction,signal_score,confidence,module,analysis")
                .eq("symbol", sym)
                .gte("created_at", cutoff_48h)
                .order("signal_score", desc=True)
                .limit(5)
                .execute()
            )
            sigs = r.data or []
            if sigs:
                lines = [
                    f"  [{s['module']}] {s['direction']} score={s['signal_score']} "
                    f"conf={s['confidence']} | {s.get('analysis', '')}"
                    for s in sigs
                ]
                signals_text = "\n".join(lines)
        except Exception:
            pass

        # ── 3. Options flow (48h) ─────────────────────────────────
        options_text = "No data"
        try:
            r = (
                self.db.table("options_flow")
                .select("option_type,strike,expiry,premium,volume,trade_type,sentiment")
                .eq("symbol", sym)
                .gte("created_at", cutoff_48h)
                .order("premium", desc=True)
                .limit(5)
                .execute()
            )
            opts = r.data or []
            if opts:
                lines = []
                for o in opts:
                    p = o.get("premium", 0) or 0
                    p_str = f"${p/1e6:.2f}M" if p >= 1e6 else f"${p/1e3:.0f}K"
                    lines.append(
                        f"  {o['option_type'].upper()} ${o.get('strike')} exp={o.get('expiry')} "
                        f"prem={p_str} vol={o.get('volume',0):,} type={o.get('trade_type','')} "
                        f"sentiment={o.get('sentiment','')}"
                    )
                options_text = "\n".join(lines)
        except Exception:
            pass

        # ── 4. Insider trades (7d) ────────────────────────────────
        insider_text = "No data"
        try:
            r = (
                self.db.table("insider_trades")
                .select("insider_name,insider_title,trade_type,value,shares,filing_date")
                .eq("symbol", sym)
                .gte("filing_date", cutoff_7d[:10])
                .order("value", desc=True)
                .limit(5)
                .execute()
            )
            ins = r.data or []
            if ins:
                lines = [
                    f"  {i.get('insider_name','')} ({i.get('insider_title','')}) "
                    f"{i.get('trade_type','')} ${(i.get('value') or 0):,.0f} "
                    f"({(i.get('shares') or 0):,}sh) filed={i.get('filing_date','')}"
                    for i in ins
                ]
                insider_text = "\n".join(lines)
        except Exception:
            pass

        # ── 5. Dark pool (48h) ────────────────────────────────────
        darkpool_text = "No data"
        try:
            r = (
                self.db.table("dark_pool_orders")
                .select("price,size,notional,side,exchange")
                .eq("symbol", sym)
                .gte("created_at", cutoff_48h)
                .order("notional", desc=True)
                .limit(5)
                .execute()
            )
            dp = r.data or []
            if dp:
                lines = [
                    f"  {d.get('side','')} size={d.get('size',0):,} "
                    f"@ ${d.get('price',0)} notional=${(d.get('notional') or 0)/1e6:.2f}M "
                    f"exch={d.get('exchange','')}"
                    for d in dp
                ]
                darkpool_text = "\n".join(lines)
        except Exception:
            pass

        # ── 6. Sentiment (48h) ────────────────────────────────────
        sentiment_text = "No data"
        try:
            r = (
                self.db.table("market_sentiment")
                .select("sentiment_score,mention_count,bullish_count,bearish_count,source")
                .eq("symbol", sym)
                .gte("created_at", cutoff_48h)
                .order("created_at", desc=True)
                .limit(3)
                .execute()
            )
            sent = r.data or []
            if sent:
                lines = [
                    f"  [{s.get('source','')}] score={s.get('sentiment_score',0):.2f} "
                    f"mentions={s.get('mention_count',0)} bull={s.get('bullish_count',0)} "
                    f"bear={s.get('bearish_count',0)}"
                    for s in sent
                ]
                sentiment_text = "\n".join(lines)
        except Exception:
            pass

        # ── 7. Strategy templates (for fit scoring reference) ─────
        strategy_names = "Momentum Breakout, Low Volatility Defense, SMA Crossover, RSI Mean Reversion"
        try:
            r = (
                self.db.table("strategy_templates")
                .select("name,name_zh,category")
                .limit(8)
                .execute()
            )
            tmpl = r.data or []
            if tmpl:
                strategy_names = ", ".join(
                    f"{t['name']} ({t['name_zh']})" for t in tmpl
                )
        except Exception:
            pass

        return f"""请对 ${sym} 生成多台联席共识报告（Desk Consensus）。
所有数字已由系统提供，直接引用即可，不要自行计算。

## 宏观市场环境
{regime_text}

## 市场信号（近48小时，按评分排序）
{signals_text}

## 期权异动（近48小时，按权利金排序）
{options_text}

## 内部人交易（近7日）
{insider_text}

## 暗池大单（近48小时）
{darkpool_text}

## 社交媒体情绪（近48小时）
{sentiment_text}

## 可用策略模板（用于 strategy_fit 评分）
{strategy_names}

请综合以上全部数据，生成 DeskConsensus 报告，涵盖四个分析台的观点及最终结论。"""

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
