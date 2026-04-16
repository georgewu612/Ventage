"""Signal Engine — generates trading signals from ETL data.

Analyzes insider trades, options flow, and sentiment data to produce
unified market signals with confidence scores and direction.

Design principle: ALL numbers come from code calculations, never from AI.
AI is only used for generating natural-language summaries.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import structlog
from supabase import Client

from agents.ai_analyst import AIAnalyst

logger = structlog.get_logger()


class SignalEngine:
    """Generates market signals from collected data sources."""

    def __init__(self, db: Client) -> None:
        self.db = db
        self.log = logger.bind(component="signal_engine")
        self.ai_analyst = AIAnalyst(db)

    async def generate_all(self) -> list[dict[str, Any]]:
        """Run all signal generators and return combined results."""
        signals: list[dict[str, Any]] = []

        generators = [
            self._insider_signals,
            self._options_signals,
            self._sentiment_signals,
        ]

        for gen in generators:
            try:
                result = gen()
                signals.extend(result)
            except Exception as exc:
                self.log.error("generator_failed", generator=gen.__name__, error=str(exc))

        # Deduplicate by symbol+module (keep highest score)
        deduped = self._deduplicate(signals)

        # Enhance high-score signals with AI analysis
        ai_enhanced = 0
        if self.ai_analyst.is_available():
            for sig in deduped:
                if sig.get("signal_score", 0) >= 60:  # Only enhance significant signals
                    ai_text = self.ai_analyst.analyze_signal(sig)
                    if ai_text:
                        sig["analysis"] = ai_text
                        ai_enhanced += 1

        # Save to database
        loaded = self._save_signals(deduped)
        self.log.info("signals_generated", total=len(deduped), loaded=loaded, ai_enhanced=ai_enhanced)

        return deduped

    def _insider_signals(self) -> list[dict[str, Any]]:
        """Generate signals from insider trading activity."""
        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

        result = (
            self.db.table("insider_trades")
            .select("symbol, trade_type, shares, value, insider_name, insider_title, filing_date")
            .gte("filing_date", cutoff[:10])
            .order("filing_date", desc=True)
            .limit(200)
            .execute()
        )

        trades = result.data or []
        if not trades:
            return []

        # Group trades by symbol
        by_symbol: dict[str, list[dict]] = {}
        for t in trades:
            by_symbol.setdefault(t["symbol"], []).append(t)

        signals = []
        for symbol, symbol_trades in by_symbol.items():
            buys = [t for t in symbol_trades if t["trade_type"] == "BUY"]
            sells = [t for t in symbol_trades if t["trade_type"] == "SELL"]

            total_buy_value = sum(t.get("value") or 0 for t in buys)
            total_sell_value = sum(t.get("value") or 0 for t in sells)
            total_buy_shares = sum(t.get("shares") or 0 for t in buys)
            total_sell_shares = sum(t.get("shares") or 0 for t in sells)

            # Direction: net buy = bullish, net sell = bearish
            net_value = total_buy_value - total_sell_value
            if net_value > 0:
                direction = "bullish"
            elif net_value < 0:
                direction = "bearish"
            else:
                direction = "neutral"

            # Confidence based on trade count and value
            trade_count = len(symbol_trades)
            value_score = min(50, int(abs(net_value) / 100_000))  # $100K = 1 point, max 50
            count_score = min(30, trade_count * 5)  # 6 trades = max 30
            # Bonus for C-suite insiders
            executive_trades = [
                t for t in symbol_trades
                if any(title in (t.get("insider_title") or "").upper()
                       for title in ["CEO", "CFO", "COO", "CTO", "PRESIDENT", "CHAIRMAN"])
            ]
            exec_score = min(20, len(executive_trades) * 10)

            confidence = min(100, value_score + count_score + exec_score)
            # Normalize to 0-1
            confidence_decimal = round(confidence / 100, 2)

            # Build analysis summary (no AI, just formatted facts)
            buy_summary = f"{len(buys)} buys (${total_buy_value:,.0f})" if buys else ""
            sell_summary = f"{len(sells)} sells (${total_sell_value:,.0f})" if sells else ""
            parts = [p for p in [buy_summary, sell_summary] if p]
            names = list({t.get("insider_name", "Unknown") for t in symbol_trades[:3]})
            name_str = ", ".join(names[:2])
            analysis = f"Insider activity: {'; '.join(parts)}. Key insiders: {name_str}."

            signals.append({
                "id": str(uuid.uuid4()),
                "symbol": symbol,
                "direction": direction,
                "confidence": confidence_decimal,
                "signal_type": "insider_activity",
                "module": "insider_trades",
                "signal_score": confidence,
                "analysis": analysis,
                "factors": {
                    "value_score": {"value": value_score, "max": 50, "label": "交易金额"},
                    "count_score": {"value": count_score, "max": 30, "label": "交易笔数"},
                    "exec_score": {"value": exec_score, "max": 20, "label": "高管级别"},
                },
                "valid_until": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(),
            })

        return signals

    def _options_signals(self) -> list[dict[str, Any]]:
        """Generate signals from unusual options activity."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

        result = (
            self.db.table("options_flow")
            .select("symbol, option_type, strike, premium, volume, open_interest, unusual_score, trade_type")
            .gte("created_at", cutoff)
            .order("unusual_score", desc=True)
            .limit(200)
            .execute()
        )

        options = result.data or []
        if not options:
            return []

        # Group by symbol
        by_symbol: dict[str, list[dict]] = {}
        for o in options:
            by_symbol.setdefault(o["symbol"], []).append(o)

        signals = []
        for symbol, symbol_options in by_symbol.items():
            calls = [o for o in symbol_options if o["option_type"] == "call"]
            puts = [o for o in symbol_options if o["option_type"] == "put"]

            call_premium = sum(o.get("premium") or 0 for o in calls)
            put_premium = sum(o.get("premium") or 0 for o in puts)
            call_volume = sum(o.get("volume") or 0 for o in calls)
            put_volume = sum(o.get("volume") or 0 for o in puts)

            # Put/call ratio for direction
            total_volume = call_volume + put_volume
            if total_volume == 0:
                continue

            pc_ratio = put_volume / call_volume if call_volume > 0 else 2.0

            if pc_ratio < 0.7:
                direction = "bullish"
            elif pc_ratio > 1.3:
                direction = "bearish"
            else:
                direction = "neutral"

            # Score based on unusual activity
            avg_unusual = sum(o.get("unusual_score") or 0 for o in symbol_options) / len(symbol_options)
            sweep_count = sum(1 for o in symbol_options if o.get("trade_type") == "SWEEP")

            volume_score = min(30, int(total_volume / 1000))
            unusual_base = min(40, int(avg_unusual * 0.4))
            sweep_bonus = min(30, sweep_count * 10)

            confidence = min(100, volume_score + unusual_base + sweep_bonus)
            confidence_decimal = round(confidence / 100, 2)

            total_premium = call_premium + put_premium
            analysis = (
                f"Options flow: {len(calls)} calls (${call_premium:,.0f}), "
                f"{len(puts)} puts (${put_premium:,.0f}). "
                f"P/C ratio: {pc_ratio:.2f}. "
                f"Avg unusual score: {avg_unusual:.0f}."
            )

            signals.append({
                "id": str(uuid.uuid4()),
                "symbol": symbol,
                "direction": direction,
                "confidence": confidence_decimal,
                "signal_type": "unusual_options",
                "module": "options_flow",
                "signal_score": confidence,
                "analysis": analysis,
                "factors": {
                    "volume_score": {"value": volume_score, "max": 30, "label": "成交量"},
                    "unusual_base": {"value": unusual_base, "max": 40, "label": "异常度"},
                    "sweep_bonus": {"value": sweep_bonus, "max": 30, "label": "扫单加分"},
                },
                "valid_until": (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat(),
            })

        return signals

    def _sentiment_signals(self) -> list[dict[str, Any]]:
        """Generate signals from market sentiment data."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

        result = (
            self.db.table("market_sentiment")
            .select("symbol, sentiment_score, magnitude, volume, source")
            .gte("created_at", cutoff)
            .order("created_at", desc=True)
            .limit(200)
            .execute()
        )

        sentiments = result.data or []
        if not sentiments:
            return []

        # Group by symbol
        by_symbol: dict[str, list[dict]] = {}
        for s in sentiments:
            by_symbol.setdefault(s["symbol"], []).append(s)

        signals = []
        for symbol, symbol_sentiments in by_symbol.items():
            scores = [s["sentiment_score"] for s in symbol_sentiments if s.get("sentiment_score") is not None]
            if not scores:
                continue

            avg_score = sum(scores) / len(scores)
            total_volume = sum(s.get("volume") or 0 for s in symbol_sentiments)
            avg_magnitude = sum(s.get("magnitude") or 0 for s in symbol_sentiments) / len(symbol_sentiments)

            if avg_score > 0.2:
                direction = "bullish"
            elif avg_score < -0.2:
                direction = "bearish"
            else:
                direction = "neutral"

            # Confidence from score strength, volume, and magnitude
            score_strength = min(40, int(abs(avg_score) * 40))
            volume_score = min(30, int(total_volume / 500))
            magnitude_score = min(30, int(avg_magnitude * 30))

            confidence = min(100, score_strength + volume_score + magnitude_score)
            confidence_decimal = round(confidence / 100, 2)

            sources = list({s.get("source", "unknown") for s in symbol_sentiments})
            analysis = (
                f"Sentiment avg: {avg_score:.2f} from {len(symbol_sentiments)} sources "
                f"({', '.join(sources)}). "
                f"Total volume: {total_volume:,}. Magnitude: {avg_magnitude:.2f}."
            )

            signals.append({
                "id": str(uuid.uuid4()),
                "symbol": symbol,
                "direction": direction,
                "confidence": confidence_decimal,
                "signal_type": "social_sentiment",
                "module": "market_sentiment",
                "signal_score": confidence,
                "analysis": analysis,
                "factors": {
                    "score_strength": {"value": score_strength, "max": 40, "label": "情绪强度"},
                    "volume_score": {"value": volume_score, "max": 30, "label": "讨论量"},
                    "magnitude_score": {"value": magnitude_score, "max": 30, "label": "波动幅度"},
                },
                "valid_until": (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat(),
            })

        return signals

    def _deduplicate(self, signals: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Keep highest-scoring signal per symbol+module combination."""
        best: dict[str, dict[str, Any]] = {}
        for sig in signals:
            key = f"{sig['symbol']}|{sig['module']}"
            existing = best.get(key)
            if not existing or (sig.get("signal_score", 0) > existing.get("signal_score", 0)):
                best[key] = sig
        return list(best.values())

    def _save_signals(self, signals: list[dict[str, Any]]) -> int:
        """Save generated signals to the market_signals table."""
        if not signals:
            return 0

        # Prepare records for insertion (remove id, let DB generate)
        records = []
        for sig in signals:
            records.append({
                "symbol": sig["symbol"],
                "direction": sig["direction"],
                "confidence": sig["confidence"],
                "signal_type": sig["signal_type"],
                "module": sig["module"],
                "signal_score": sig["signal_score"],
                "analysis": sig.get("analysis"),
                "factors": sig.get("factors"),
                "valid_until": sig.get("valid_until"),
            })

        try:
            result = self.db.table("market_signals").insert(records).execute()
            return len(result.data) if result.data else 0
        except Exception as exc:
            self.log.error("save_signals_failed", error=str(exc))
            return 0
