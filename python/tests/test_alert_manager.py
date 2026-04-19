"""Tests for the Alert Manager rules engine."""

from alerting.manager import DEFAULT_RULES, AlertRule


class TestAlertRule:
    """Test individual alert rule matching."""

    def test_score_threshold(self):
        rule = AlertRule(name="test", min_score=70)
        assert rule.matches({"signal_score": 80}) is True
        assert rule.matches({"signal_score": 70}) is True
        assert rule.matches({"signal_score": 69}) is False

    def test_direction_filter(self):
        rule = AlertRule(name="test", min_score=0, directions=["bullish", "bearish"])
        assert rule.matches({"signal_score": 50, "direction": "bullish"}) is True
        assert rule.matches({"signal_score": 50, "direction": "bearish"}) is True
        assert rule.matches({"signal_score": 50, "direction": "neutral"}) is False

    def test_module_filter(self):
        rule = AlertRule(name="test", min_score=0, modules=["insider_trades"])
        assert rule.matches({"signal_score": 50, "module": "insider_trades"}) is True
        assert rule.matches({"signal_score": 50, "module": "options_flow"}) is False

    def test_symbol_filter(self):
        rule = AlertRule(name="test", min_score=0, symbols=["AAPL", "TSLA"])
        assert rule.matches({"signal_score": 50, "symbol": "AAPL"}) is True
        assert rule.matches({"signal_score": 50, "symbol": "MSFT"}) is False

    def test_combined_filters(self):
        rule = AlertRule(
            name="test",
            min_score=60,
            directions=["bullish"],
            modules=["insider_trades"],
            symbols=["AAPL"],
        )
        # All conditions met
        assert (
            rule.matches(
                {
                    "signal_score": 70,
                    "direction": "bullish",
                    "module": "insider_trades",
                    "symbol": "AAPL",
                }
            )
            is True
        )

        # Score too low
        assert (
            rule.matches(
                {
                    "signal_score": 50,
                    "direction": "bullish",
                    "module": "insider_trades",
                    "symbol": "AAPL",
                }
            )
            is False
        )

        # Wrong direction
        assert (
            rule.matches(
                {
                    "signal_score": 70,
                    "direction": "bearish",
                    "module": "insider_trades",
                    "symbol": "AAPL",
                }
            )
            is False
        )

    def test_none_filters_match_all(self):
        """None filters should match any value."""
        rule = AlertRule(name="test", min_score=0)
        assert (
            rule.matches(
                {
                    "signal_score": 10,
                    "direction": "neutral",
                    "module": "anything",
                    "symbol": "XYZ",
                }
            )
            is True
        )


class TestDefaultRules:
    """Test default rules configuration."""

    def test_high_confidence_rule(self):
        rule = DEFAULT_RULES[0]
        assert rule.name == "high_confidence"
        assert rule.min_score == 80
        assert rule.matches({"signal_score": 85, "direction": "bullish"}) is True
        assert rule.matches({"signal_score": 85, "direction": "neutral"}) is False
        assert rule.matches({"signal_score": 75, "direction": "bullish"}) is False

    def test_insider_significant_rule(self):
        rule = DEFAULT_RULES[1]
        assert rule.name == "insider_significant"
        assert rule.matches({"signal_score": 65, "module": "insider_trades"}) is True
        assert rule.matches({"signal_score": 65, "module": "options_flow"}) is False

    def test_options_unusual_rule(self):
        rule = DEFAULT_RULES[2]
        assert rule.name == "options_unusual"
        assert rule.matches({"signal_score": 75, "module": "options_flow"}) is True
        assert rule.matches({"signal_score": 65, "module": "options_flow"}) is False
