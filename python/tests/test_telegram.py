"""Tests for the Telegram notifier."""

from alerting.telegram import TelegramNotifier


class TestMessageFormatting:
    """Test message formatting (no network calls)."""

    def setup_method(self):
        self.notifier = TelegramNotifier(bot_token="fake", chat_id="123")

    def test_format_bullish_signal(self):
        signal = {
            "symbol": "AAPL",
            "direction": "bullish",
            "signal_score": 85,
            "confidence": 0.85,
            "module": "insider_trades",
            "signal_type": "insider_activity",
            "analysis": "Strong buy activity from CEO.",
        }
        msg = self.notifier._format_signal(signal)
        assert "$AAPL" in msg
        assert "BULLISH" in msg
        assert "85" in msg
        assert "insider_trades" in msg

    def test_format_bearish_signal(self):
        signal = {
            "symbol": "TSLA",
            "direction": "bearish",
            "signal_score": 70,
            "confidence": 0.70,
            "module": "options_flow",
            "signal_type": "unusual_options",
            "analysis": "",
        }
        msg = self.notifier._format_signal(signal)
        assert "BEARISH" in msg
        assert "🔴" in msg

    def test_format_compact(self):
        signal = {
            "symbol": "NVDA",
            "direction": "bullish",
            "signal_score": 90,
            "module": "options_flow",
        }
        msg = self.notifier._format_signal_compact(signal)
        assert "$NVDA" in msg
        assert "90" in msg
        assert "🟢" in msg

    def test_long_analysis_truncated(self):
        signal = {
            "symbol": "AAPL",
            "direction": "neutral",
            "signal_score": 50,
            "confidence": 0.5,
            "module": "sentiment",
            "signal_type": "social",
            "analysis": "x" * 300,
        }
        msg = self.notifier._format_signal(signal)
        assert "..." in msg
        assert len(msg) < 500

    def test_score_bar_visualization(self):
        signal = {
            "symbol": "AAPL",
            "direction": "bullish",
            "signal_score": 80,
            "confidence": 0.8,
            "module": "test",
            "signal_type": "test",
            "analysis": "",
        }
        msg = self.notifier._format_signal(signal)
        assert "█" in msg
        assert "░" in msg

    def test_not_configured_returns_empty_token(self):
        notifier = TelegramNotifier(bot_token="", chat_id="")
        # Should be flagged as not configured
        assert not notifier.bot_token
