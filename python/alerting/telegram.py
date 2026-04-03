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

        lines = [f"<b>🔔 {len(signals)} New Signals</b>\n"]
        for sig in signals[:10]:  # Max 10 per message to avoid length limits
            lines.append(self._format_signal_compact(sig))

        if len(signals) > 10:
            lines.append(f"\n... and {len(signals) - 10} more")

        return await self.send_message("\n".join(lines))

    def _format_signal(self, signal: dict[str, Any]) -> str:
        """Format a single signal as a rich Telegram message."""
        direction = signal.get("direction", "neutral")
        emoji = {"bullish": "🟢", "bearish": "🔴", "neutral": "🟡"}.get(direction, "⚪")
        arrow = {"bullish": "↑", "bearish": "↓", "neutral": "→"}.get(direction, "→")

        symbol = signal.get("symbol", "???")
        score = signal.get("signal_score", 0)
        confidence = signal.get("confidence", 0)
        module = signal.get("module", "unknown")
        signal_type = signal.get("signal_type", "")
        analysis = signal.get("analysis", "")

        # Score bar visualization
        filled = int(score / 10)
        bar = "█" * filled + "░" * (10 - filled)

        lines = [
            f"{emoji} <b>${symbol}</b> {arrow} {direction.upper()}",
            f"Score: [{bar}] {score:.0f}/100",
            f"Confidence: {confidence:.0%}" if isinstance(confidence, float) else f"Confidence: {confidence}%",
            f"Module: {module} | Type: {signal_type}",
        ]

        if analysis:
            # Truncate long analysis
            short = analysis[:200] + "..." if len(analysis) > 200 else analysis
            lines.append(f"\n<i>{short}</i>")

        return "\n".join(lines)

    def _format_signal_compact(self, signal: dict[str, Any]) -> str:
        """Format a signal as a compact one-line summary."""
        direction = signal.get("direction", "neutral")
        emoji = {"bullish": "🟢", "bearish": "🔴", "neutral": "🟡"}.get(direction, "⚪")
        symbol = signal.get("symbol", "???")
        score = signal.get("signal_score", 0)
        module = signal.get("module", "")

        return f"{emoji} <b>${symbol}</b> {score:.0f}pts — {module}"
