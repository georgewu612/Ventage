"""Telegram Bot notification sender.

Sends formatted alert messages to a configured Telegram chat.
Uses the Bot API directly via httpx (no telegram library needed).

Setup:
1. Create a bot via @BotFather → get TELEGRAM_BOT_TOKEN
2. Add the bot to a group or start a DM → get TELEGRAM_CHAT_ID
3. Set both in .env
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

# Module display names in Chinese
_MODULE_NAMES = {
    "options_flow": "期权异动",
    "insider_trades": "内部人交易",
    "market_sentiment": "市场情绪",
    "dark_pool": "暗池订单",
}

_DIRECTION_LABELS = {
    "bullish": ("🟢", "↑", "看涨"),
    "bearish": ("🔴", "↓", "看跌"),
    "neutral": ("🟡", "→", "中性"),
}


class TelegramNotifier:
    """Sends messages to Telegram via Bot API."""

    BASE_URL = "https://api.telegram.org/bot{token}"

    def __init__(self, bot_token: str, chat_id: str) -> None:
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.api_url = self.BASE_URL.format(token=bot_token)
        self.log = logger.bind(component="telegram")

    async def send_message(self, text: str, parse_mode: str = "HTML") -> bool:
        """Send a text message to the configured chat."""
        if not self.bot_token or not self.chat_id:
            self.log.warning("telegram_not_configured")
            return False

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.post(
                    f"{self.api_url}/sendMessage",
                    json={
                        "chat_id": self.chat_id,
                        "text": text,
                        "parse_mode": parse_mode,
                        "disable_web_page_preview": True,
                    },
                )
                resp.raise_for_status()
                self.log.info("message_sent", chat_id=self.chat_id)
                return True
            except Exception as exc:
                self.log.error("send_failed", error=str(exc))
                return False

    async def send_signal_alert(self, signal: dict[str, Any]) -> bool:
        """Send a formatted signal alert."""
        text = self._format_signal(signal)
        return await self.send_message(text)

    async def send_batch_alert(self, signals: list[dict[str, Any]]) -> bool:
        """Send a summary of multiple signals in one message."""
        if not signals:
            return False

        lines = [f"<b>🔔 {len(signals)} 条新信号</b>\n"]
        for sig in signals[:10]:  # Max 10 per message to avoid length limits
            lines.append(self._format_signal_compact(sig))

        if len(signals) > 10:
            lines.append(f"\n... 以及另外 {len(signals) - 10} 条")

        return await self.send_message("\n".join(lines))

    def _format_signal(self, signal: dict[str, Any]) -> str:
        """Format a single signal as a rich Telegram message (Chinese)."""
        direction = signal.get("direction", "neutral")
        emoji, arrow, label = _DIRECTION_LABELS.get(direction, ("⚪", "→", "未知"))

        symbol = signal.get("symbol", "???")
        score = signal.get("signal_score", 0)
        confidence = signal.get("confidence", 0)
        module = signal.get("module", "unknown")
        module_cn = _MODULE_NAMES.get(module, module)
        analysis = signal.get("analysis", "") or signal.get("summary", "")

        # Score bar visualization
        filled = int(score / 10)
        bar = "█" * filled + "░" * (10 - filled)

        # Confidence display
        if isinstance(confidence, float) and confidence <= 1.0:
            conf_str = f"{confidence:.0%}"
        else:
            conf_str = f"{int(confidence)}%"

        lines = [
            f"{emoji} <b>${symbol}</b> {arrow} {label}",
            f"评分：[{bar}] {score:.0f}/100",
            f"置信度：{conf_str}",
            f"模块：{module_cn}",
        ]

        if analysis:
            short = analysis[:200] + "..." if len(analysis) > 200 else analysis
            lines.append(f"\n<i>{short}</i>")

        lines.append("\n<i>⚠️ 仅供参考，不构成投资建议</i>")
        return "\n".join(lines)

    def _format_signal_compact(self, signal: dict[str, Any]) -> str:
        """Format a signal as a compact one-line summary (Chinese)."""
        direction = signal.get("direction", "neutral")
        emoji = _DIRECTION_LABELS.get(direction, ("⚪",))[0]
        symbol = signal.get("symbol", "???")
        score = signal.get("signal_score", 0)
        module = signal.get("module", "")
        module_cn = _MODULE_NAMES.get(module, module)

        return f"{emoji} <b>${symbol}</b> {score:.0f}分 — {module_cn}"

    # ── Trading System v2 — Strategy Signal alerts ───────────────────────

    async def send_strategy_signal_alert(self, sig: dict[str, Any]) -> bool:
        """Send a rich alert for a rule-based strategy_signals row.

        Expected fields: symbol, strategy_name, direction, score_grade,
        score_total, entry_price, stop_price, target_1, target_2,
        regime_at_signal, pattern_tags.
        """
        text = self._format_strategy_signal(sig)
        return await self.send_message(text)

    async def send_strategy_signals_batch(
        self, sigs: list[dict[str, Any]]
    ) -> bool:
        """Send a batched summary of A-grade strategy signals."""
        if not sigs:
            return False
        lines = [f"<b>🎯 {len(sigs)} 个 A 级策略信号</b>\n"]
        for s in sigs[:10]:
            lines.append(self._format_strategy_signal_compact(s))
        if len(sigs) > 10:
            lines.append(f"\n...另 {len(sigs) - 10} 条")
        return await self.send_message("\n".join(lines))

    @staticmethod
    def _strategy_zh(name: str) -> str:
        return {
            "trend_pullback_breakout": "顺势回调突破",
            "wyckoff_liquidity_sweep": "流动性扫荡",
            "ema_squeeze_launch": "EMA 蓄势启动",
            "bollinger_extreme_reversion": "布林极值回归",
        }.get(name, name)

    @staticmethod
    def _regime_zh(name: str) -> str:
        return {
            "strong_uptrend": "强趋势↑",
            "strong_downtrend": "强趋势↓",
            "squeeze_breakout_setup": "蓄势突破",
            "ranging": "震荡",
            "exhaustion_reversal": "衰竭",
            "elevated_event_risk": "事件风险",
        }.get(name, name)

    def _format_strategy_signal(self, sig: dict[str, Any]) -> str:
        """Rich alert for a single A-grade strategy signal."""
        direction = sig.get("direction", "long")
        dir_emoji = "📈" if direction == "long" else "📉"
        dir_label = "做多" if direction == "long" else "做空"
        grade = sig.get("score_grade", "?")
        grade_emoji = {"A": "🏆", "B": "🥈", "C": "🥉"}.get(grade, "")

        symbol = sig.get("symbol", "?")
        score = sig.get("score_total") or 0
        strat = self._strategy_zh(sig.get("strategy_name", ""))
        regime = self._regime_zh(sig.get("regime_at_signal", ""))

        entry = sig.get("entry_price")
        stop = sig.get("stop_price")
        t1 = sig.get("target_1")
        t2 = sig.get("target_2")

        # R:R
        rr_str = ""
        try:
            risk = abs(float(entry) - float(stop))
            if risk > 0:
                if direction == "long":
                    r1 = (float(t1) - float(entry)) / risk if t1 else 0
                    r2 = (float(t2) - float(entry)) / risk if t2 else 0
                else:
                    r1 = (float(entry) - float(t1)) / risk if t1 else 0
                    r2 = (float(entry) - float(t2)) / risk if t2 else 0
                rr_str = f"\n💎 R:R = <code>{r1:.1f}R / {r2:.1f}R</code>"
        except (TypeError, ValueError):
            pass

        tags = sig.get("pattern_tags") or []
        tags_str = " · ".join(tags[:3]) if tags else ""

        lines = [
            f"{grade_emoji} <b>{grade} 级信号</b>  {dir_emoji} <b>${symbol}</b> {dir_label}",
            f"📊 评分: <b>{float(score):.1f}/100</b> · {strat}",
            f"🌐 状态: {regime}",
            "",
            f"🎯 入场: <code>${float(entry):.2f}</code>",
            f"🛑 止损: <code>${float(stop):.2f}</code>",
            f"🎯 T1:   <code>${float(t1):.2f}</code>" if t1 else "",
            f"🎯 T2:   <code>${float(t2):.2f}</code>" if t2 else "",
        ]
        if rr_str:
            lines.append(rr_str.lstrip("\n"))
        if tags_str:
            lines.append(f"🏷 {tags_str}")
        lines.append("")
        lines.append(
            "<i>* 规则化策略信号，仅供参考。</i>"
        )
        return "\n".join(line for line in lines if line is not None)

    def _format_strategy_signal_compact(self, sig: dict[str, Any]) -> str:
        direction = sig.get("direction", "long")
        emoji = "📈" if direction == "long" else "📉"
        symbol = sig.get("symbol", "?")
        score = sig.get("score_total") or 0
        strat = self._strategy_zh(sig.get("strategy_name", ""))
        try:
            entry = float(sig.get("entry_price"))
            return (
                f"{emoji} <b>${symbol}</b> {float(score):.0f}分 · "
                f"{strat} · 入<code>${entry:.2f}</code>"
            )
        except (TypeError, ValueError):
            return f"{emoji} <b>${symbol}</b> {float(score):.0f}分 · {strat}"
