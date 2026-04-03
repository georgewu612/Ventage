"""Alert Manager — rules engine that decides which signals trigger alerts.

Evaluates signals against configurable rules and sends notifications
via Telegram. Tracks sent alerts to avoid duplicates.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from supabase import Client

from alerting.telegram import TelegramNotifier
from config.settings import get_settings

logger = structlog.get_logger()


class AlertRule:
    """A single alert rule with conditions."""

    def __init__(
        self,
        name: str,
        min_score: float = 70,
        directions: list[str] | None = None,
        modules: list[str] | None = None,
        symbols: list[str] | None = None,
    ) -> None:
        self.name = name
        self.min_score = min_score
        self.directions = directions  # None = all directions
        self.modules = modules  # None = all modules
        self.symbols = symbols  # None = all symbols

    def matches(self, signal: dict[str, Any]) -> bool:
        """Check if a signal matches this rule."""
        score = signal.get("signal_score", 0)
        if score < self.min_score:
            return False

        if self.directions:
            if signal.get("direction") not in self.directions:
                return False

        if self.modules:
            if signal.get("module") not in self.modules:
                return False

        if self.symbols:
            if signal.get("symbol") not in self.symbols:
                return False

        return True


# Default alert rules
DEFAULT_RULES = [
    AlertRule(
        name="high_confidence",
        min_score=80,
        directions=["bullish", "bearish"],
    ),
    AlertRule(
        name="insider_significant",
        min_score=60,
        modules=["insider_trades"],
    ),
    AlertRule(
        name="options_unusual",
        min_score=70,
        modules=["options_flow"],
    ),
]


class AlertManager:
    """Manages alert evaluation, deduplication, and delivery."""

    # Don't re-alert for the same symbol+module within this window
    DEDUP_WINDOW_HOURS = 4

    def __init__(self, db: Client) -> None:
        self.db = db
        self.log = logger.bind(component="alert_manager")
        self.rules = DEFAULT_RULES

        settings = get_settings()
        self.notifier: TelegramNotifier | None = None
        if settings.telegram_bot_token and settings.telegram_chat_id:
            self.notifier = TelegramNotifier(
                bot_token=settings.telegram_bot_token,
                chat_id=settings.telegram_chat_id,
            )

    async def evaluate_and_notify(self) -> dict[str, Any]:
        """Check recent signals against rules and send alerts."""
        result = {
            "evaluated": 0,
            "matched": 0,
            "sent": 0,
            "errors": [],
        }

        # Get recent signals (last hour, to catch new ones)
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        try:
            resp = (
                self.db.table("market_signals")
                .select("*")
                .gte("created_at", cutoff)
                .order("signal_score", desc=True)
                .limit(100)
                .execute()
            )
            signals = resp.data or []
        except Exception as exc:
            self.log.error("fetch_signals_failed", error=str(exc))
            result["errors"].append(str(exc))
            return result

        result["evaluated"] = len(signals)

        # Get recently sent alerts for deduplication
        sent_keys = await self._get_recent_alert_keys()

        # Evaluate each signal against rules
        to_alert: list[dict[str, Any]] = []
        for signal in signals:
            dedup_key = f"{signal.get('symbol')}|{signal.get('module')}"
            if dedup_key in sent_keys:
                continue

            for rule in self.rules:
                if rule.matches(signal):
                    to_alert.append(signal)
                    break  # One match is enough

        result["matched"] = len(to_alert)

        if not to_alert:
            self.log.info("no_alerts_triggered", evaluated=len(signals))
            return result

        # Send notifications
        if self.notifier:
            if len(to_alert) == 1:
                success = await self.notifier.send_signal_alert(to_alert[0])
            else:
                success = await self.notifier.send_batch_alert(to_alert)

            if success:
                result["sent"] = len(to_alert)
                # Record sent alerts
                await self._record_sent_alerts(to_alert)
            else:
                result["errors"].append("telegram_send_failed")
        else:
            self.log.info("telegram_not_configured", matched=len(to_alert))

        return result

    async def _get_recent_alert_keys(self) -> set[str]:
        """Get dedup keys for recently sent alerts."""
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=self.DEDUP_WINDOW_HOURS)
        ).isoformat()

        try:
            resp = (
                self.db.table("alert_history")
                .select("symbol, module")
                .gte("sent_at", cutoff)
                .execute()
            )
            rows = resp.data or []
            return {f"{r['symbol']}|{r['module']}" for r in rows}
        except Exception:
            # Table might not exist yet — return empty set
            return set()

    async def _record_sent_alerts(self, signals: list[dict[str, Any]]) -> None:
        """Record sent alerts for deduplication."""
        records = []
        for sig in signals:
            records.append({
                "symbol": sig.get("symbol"),
                "module": sig.get("module"),
                "signal_score": sig.get("signal_score"),
                "direction": sig.get("direction"),
                "sent_at": datetime.now(timezone.utc).isoformat(),
            })

        try:
            self.db.table("alert_history").insert(records).execute()
        except Exception as exc:
            self.log.warning("record_alert_failed", error=str(exc))
