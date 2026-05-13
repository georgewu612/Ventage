"""Multi-role AI trading analysis — zero external framework deps.

Originally wrapped the TauricResearch/TradingAgents framework (7 specialized
LLM agents collaboratively evaluating market conditions). That framework
pulls langchain + langgraph + chainlit + ~30 transitive packages, which
created an unsolvable dependency graph against our existing pinned stack
(fastapi/supabase/pydantic).

Replacement strategy: simulate the 7-agent debate via a SINGLE structured
OpenAI call. GPT-4o plays each role in turn (fundamentals analyst,
technical analyst, sentiment analyst, bull researcher, bear researcher,
risk manager, trader) and returns all reports in one JSON response.

Public interface is preserved:
    TradingAgentsAnalyzer().is_available() -> bool
    TradingAgentsAnalyzer().analyze(symbol, date, language) -> dict | None

Output shape mirrors the original (consumed by stock workbench frontend):
    {
      symbol, date, decision, generated_at, model,
      fundamentals_report, technical_report, sentiment_report,
      news_report, bull_report, bear_report, risk_report,
      trader_decision,
    }

Cost: ~1 OpenAI call (~$0.005-0.01 per analysis with gpt-4o).
Latency: 20-40s typical (model writes ~7 paragraphs of analysis).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import structlog

from config.settings import get_settings

logger = structlog.get_logger()


# ── Prompts ────────────────────────────────────────────────────────────────


_SYSTEM_PROMPT_EN = """You are a multi-role investment committee for a hedge fund. \
For a given stock ticker and date, you simulate the deliberation of seven \
specialized analysts and produce a structured JSON report.

Roles you must perform sequentially in your reasoning, then output each as a \
separate report field:

1. **Fundamentals Analyst** — evaluate financial health, profitability, growth, \
   balance sheet quality. Cite specific metrics where known (P/E, EPS growth, \
   revenue trajectory, margins, debt levels). 3-5 paragraphs, markdown.

2. **Technical Analyst** — evaluate price action, trend structure, key support/\
   resistance, momentum indicators (RSI, MACD), volume pattern, recent chart \
   formations. Comment on the regime (uptrend/downtrend/ranging). 3-5 paragraphs.

3. **Sentiment Analyst** — evaluate market sentiment, options flow, insider \
   activity, social-media buzz, analyst rating revisions. Tone and crowd \
   positioning. 2-3 paragraphs.

4. **News Analyst** — summarize recent material news (earnings, product launches, \
   macro, regulatory). Identify catalysts and risks visible from the news. 2-3 paragraphs.

5. **Bull Researcher** — build the strongest possible bullish case using the above \
   evidence. Include 3-5 specific arguments and a price-target range. Markdown bullets ok.

6. **Bear Researcher** — build the strongest possible bearish case. Include 3-5 \
   specific arguments and a downside-target range. Markdown bullets ok.

7. **Risk Manager** — adjudicate the bull/bear debate. Identify the biggest risk \
   factors (event risk, concentration, valuation). Recommend position sizing and \
   stop-loss philosophy. 2-3 paragraphs.

Then produce the **Trader Decision**: a concise BUY / HOLD / SELL recommendation \
with conviction level (low/medium/high), suggested entry zone, stop-loss area, and \
first profit target. Markdown structured. 1-2 paragraphs.

Finally output a one-line **Decision** field summarizing the call.

Ground rules:
- Be honest about uncertainty. If you don't know a specific number, say so rather \
  than fabricate.
- Cite the actual ticker and current date.
- Output VALID JSON only — no markdown wrapper, no ```json fences.
"""


_SYSTEM_PROMPT_ZH = """你是一家对冲基金的多角色投资委员会。给定股票代码和日期，\
你需要模拟七位专业分析师的讨论，并输出一份结构化 JSON 报告。

请按顺序在内部推理中扮演以下角色，并将每个角色的输出作为独立字段返回：

1. **基本面分析师 (fundamentals_report)** — 评估财务健康度、盈利能力、增长、\
   资产负债表质量。在已知情况下引用具体指标（P/E、EPS 增长率、收入轨迹、毛利率、\
   负债水平）。3-5 段，markdown 格式。

2. **技术分析师 (technical_report)** — 评估价格走势、趋势结构、关键支撑/阻力位、\
   动量指标（RSI、MACD）、量能形态、近期图形。判断当前 regime（上升/下跌/震荡）。\
   3-5 段。

3. **情绪分析师 (sentiment_report)** — 评估市场情绪、期权流向、内部人活动、\
   社交媒体热度、分析师评级变化。基调和散户/机构定位。2-3 段。

4. **新闻分析师 (news_report)** — 总结近期重大新闻（财报、新品、宏观、监管）。\
   识别催化剂与风险。2-3 段。

5. **多头研究员 (bull_report)** — 基于以上证据构建最强的多头论点。3-5 条具体论据 + \
   目标价区间。可用 markdown 项目符号。

6. **空头研究员 (bear_report)** — 构建最强的空头论点。3-5 条具体论据 + 下行目标区间。

7. **风险经理 (risk_report)** — 仲裁多空辩论。识别最大风险因素（事件风险、集中度、\
   估值）。给出仓位建议和止损哲学。2-3 段。

然后给出 **交易员决策 (trader_decision)**：简洁的 BUY / HOLD / SELL 建议，含\
信心等级（低/中/高）、建议买入区间、止损位、第一目标价。1-2 段 markdown。

最后输出一行 **decision** 字段总结结论。

底线规则：
- 对不确定性诚实。不知道具体数字就说不知道，不要编造。
- 在分析中明确引用实际代码和当前日期。
- 只输出**合法的 JSON**，不要 markdown 包装，不要 ```json 围栏。
"""


# JSON schema we expect the model to produce
_OUTPUT_FIELDS = [
    "fundamentals_report",
    "technical_report",
    "sentiment_report",
    "news_report",
    "bull_report",
    "bear_report",
    "risk_report",
    "trader_decision",
    "decision",
]


# ── Analyzer ───────────────────────────────────────────────────────────────


class TradingAgentsAnalyzer:
    """Multi-role investment committee simulated by a single OpenAI call.

    Drop-in replacement for the original TradingAgents framework wrapper —
    same public methods, same output shape, but zero langchain dependencies.
    """

    def __init__(self) -> None:
        self.log = logger.bind(component="trading_agents_sim")
        self.settings = get_settings()
        self._available = bool(self.settings.openai_api_key)
        self._last_error = ""

        if not self._available:
            self.log.warning("trading_agents_sim_no_openai_key")
        else:
            self.log.info(
                "trading_agents_sim_initialized",
                model=self.settings.openai_model or "gpt-4o",
            )

    def is_available(self) -> bool:
        return self._available

    def last_error(self) -> str:
        return self._last_error or "unknown error"

    def analyze(
        self,
        symbol: str,
        date: str | None = None,
        language: str = "en",
    ) -> dict[str, Any] | None:
        """Run simulated multi-role analysis for a symbol.

        Returns a dict matching the original TradingAgents output shape so the
        frontend (Stock Workbench AI Deep Analysis card) needs no changes.
        """
        if not self._available:
            return None

        if not date:
            date = datetime.now(UTC).strftime("%Y-%m-%d")

        symbol = symbol.upper()
        self.log.info(
            "trading_agents_sim_start", symbol=symbol, date=date, language=language
        )

        # Optional grounding: fetch a quick price snapshot from yfinance.
        # Non-fatal if it fails — the model can still produce analysis without it.
        price_context = self._fetch_price_context(symbol)

        try:
            from openai import OpenAI

            client = OpenAI(api_key=self.settings.openai_api_key)
            system_prompt = (
                _SYSTEM_PROMPT_ZH if language == "zh" else _SYSTEM_PROMPT_EN
            )

            user_msg = self._build_user_prompt(
                symbol, date, language, price_context
            )

            response = client.chat.completions.create(
                model=self.settings.openai_model or "gpt-4o",
                temperature=0.3,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_msg},
                ],
                timeout=120,
            )

            raw = response.choices[0].message.content or "{}"
            parsed: dict[str, Any] = json.loads(raw)

            # Build result — preserve all expected fields even if model skipped some
            result: dict[str, Any] = {
                "symbol": symbol,
                "date": date,
                "generated_at": datetime.now(UTC).isoformat(),
                "model": self.settings.openai_model or "gpt-4o",
                "decision": str(parsed.get("decision") or "").strip(),
            }
            for k in _OUTPUT_FIELDS:
                v = parsed.get(k)
                if isinstance(v, str) and v.strip():
                    result[k] = v.strip()

            self.log.info(
                "trading_agents_sim_complete",
                symbol=symbol,
                fields=[k for k in _OUTPUT_FIELDS if k in result],
                tokens_in=getattr(response.usage, "prompt_tokens", None),
                tokens_out=getattr(response.usage, "completion_tokens", None),
            )
            return result

        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)[:300]
            self.log.error("trading_agents_sim_failed", symbol=symbol, error=str(exc))
            return None

    # ── helpers ─────────────────────────────────────────────────────────

    def _fetch_price_context(self, symbol: str) -> dict[str, Any]:
        """Pull a quick price + indicators snapshot to ground the model."""
        try:
            import yfinance as yf

            df = yf.download(
                symbol,
                period="6mo",
                interval="1d",
                progress=False,
                auto_adjust=True,
            )
            if df is None or df.empty:
                return {}
            # Flatten multi-index columns from yfinance
            if hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
                df.columns = df.columns.get_level_values(0)

            last_close = float(df["Close"].iloc[-1])
            high_52w = float(df["High"].max())
            low_52w = float(df["Low"].min())
            prev_close = float(df["Close"].iloc[-2]) if len(df) > 1 else last_close
            change_pct = (last_close - prev_close) / prev_close * 100.0
            avg_vol_20 = float(df["Volume"].tail(20).mean())
            last_vol = float(df["Volume"].iloc[-1])
            vol_ratio = last_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0

            # Simple 20/50 SMAs
            sma20 = float(df["Close"].tail(20).mean())
            sma50 = float(df["Close"].tail(50).mean()) if len(df) >= 50 else sma20

            # Crude RSI
            delta = df["Close"].diff()
            gains = delta.where(delta > 0, 0).rolling(14).mean()
            losses = -delta.where(delta < 0, 0).rolling(14).mean()
            rs = gains.iloc[-1] / losses.iloc[-1] if losses.iloc[-1] > 0 else 0.0
            rsi = 100.0 - (100.0 / (1.0 + rs))

            return {
                "last_close": round(last_close, 2),
                "change_pct_1d": round(change_pct, 2),
                "high_52w": round(high_52w, 2),
                "low_52w": round(low_52w, 2),
                "pct_from_52w_high": round((last_close - high_52w) / high_52w * 100, 2),
                "pct_from_52w_low": round((last_close - low_52w) / low_52w * 100, 2),
                "sma20": round(sma20, 2),
                "sma50": round(sma50, 2),
                "rsi_14": round(float(rsi), 1) if rsi == rsi else None,  # NaN check
                "volume_ratio_20d": round(vol_ratio, 2),
            }
        except Exception as exc:  # noqa: BLE001
            self.log.warning(
                "trading_agents_sim_price_fetch_failed",
                symbol=symbol,
                error=str(exc)[:100],
            )
            return {}

    def _build_user_prompt(
        self,
        symbol: str,
        date: str,
        language: str,
        price_context: dict[str, Any],
    ) -> str:
        if language == "zh":
            base = (
                f"请对 {symbol} 在 {date} 的状态进行完整的七角色投资委员会分析。\n\n"
            )
            if price_context:
                base += (
                    "**价格快照（请引用以下数字，不要编造）：**\n"
                    f"- 最新收盘：${price_context.get('last_close')}\n"
                    f"- 单日涨跌：{price_context.get('change_pct_1d')}%\n"
                    f"- 52 周高/低：${price_context.get('high_52w')} / "
                    f"${price_context.get('low_52w')}\n"
                    f"- 距 52 周高：{price_context.get('pct_from_52w_high')}%\n"
                    f"- 距 52 周低：{price_context.get('pct_from_52w_low')}%\n"
                    f"- SMA20 / SMA50：${price_context.get('sma20')} / "
                    f"${price_context.get('sma50')}\n"
                    f"- RSI(14)：{price_context.get('rsi_14')}\n"
                    f"- 相对 20 日均量：{price_context.get('volume_ratio_20d')}×\n\n"
                )
            base += (
                "输出 JSON，键名严格使用下列字段（不要添加其他键）：\n"
                "fundamentals_report, technical_report, sentiment_report, "
                "news_report, bull_report, bear_report, risk_report, "
                "trader_decision, decision"
            )
            return base

        base = (
            f"Run a full seven-role investment committee analysis on {symbol} "
            f"as of {date}.\n\n"
        )
        if price_context:
            base += (
                "**Price snapshot (cite these numbers, do not fabricate):**\n"
                f"- Last close: ${price_context.get('last_close')}\n"
                f"- 1d change: {price_context.get('change_pct_1d')}%\n"
                f"- 52w high / low: ${price_context.get('high_52w')} / "
                f"${price_context.get('low_52w')}\n"
                f"- vs 52w high: {price_context.get('pct_from_52w_high')}%\n"
                f"- vs 52w low: {price_context.get('pct_from_52w_low')}%\n"
                f"- SMA20 / SMA50: ${price_context.get('sma20')} / "
                f"${price_context.get('sma50')}\n"
                f"- RSI(14): {price_context.get('rsi_14')}\n"
                f"- 20d volume ratio: {price_context.get('volume_ratio_20d')}x\n\n"
            )
        base += (
            "Output JSON with EXACTLY these keys (no others):\n"
            "fundamentals_report, technical_report, sentiment_report, "
            "news_report, bull_report, bear_report, risk_report, "
            "trader_decision, decision"
        )
        return base
