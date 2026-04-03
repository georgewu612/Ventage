"""Tests for the Signal Engine."""

from unittest.mock import MagicMock, patch

import pytest

from agents.signal_engine import SignalEngine


class MockQueryBuilder:
    """Mock Supabase query builder chain."""

    def __init__(self, data=None):
        self._data = data or []

    def select(self, *args, **kwargs):
        return self

    def gte(self, *args, **kwargs):
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def insert(self, records):
        self._inserted = records
        return self

    def execute(self):
        result = MagicMock()
        if hasattr(self, "_inserted"):
            result.data = self._inserted
        else:
            result.data = self._data
        return result


class MockDB:
    """Mock Supabase client with configurable table data."""

    def __init__(self, table_data=None):
        self._table_data = table_data or {}

    def table(self, name):
        return MockQueryBuilder(self._table_data.get(name, []))


class TestSignalEngineInsider:
    """Test insider signal generation."""

    def test_bullish_signal_from_net_buy(self):
        """Net buy activity should produce bullish signal."""
        db = MockDB({
            "insider_trades": [
                {"symbol": "AAPL", "trade_type": "BUY", "shares": 10000, "value": 1500000,
                 "insider_name": "Tim Cook", "insider_title": "CEO", "filing_date": "2026-04-01"},
                {"symbol": "AAPL", "trade_type": "BUY", "shares": 5000, "value": 750000,
                 "insider_name": "Luca Maestri", "insider_title": "CFO", "filing_date": "2026-04-02"},
            ],
            "market_signals": [],
        })
        engine = SignalEngine(db)
        signals = engine._insider_signals()

        assert len(signals) == 1
        assert signals[0]["symbol"] == "AAPL"
        assert signals[0]["direction"] == "bullish"
        assert signals[0]["module"] == "insider_trades"
        assert signals[0]["confidence"] > 0

    def test_bearish_signal_from_net_sell(self):
        """Net sell activity should produce bearish signal."""
        db = MockDB({
            "insider_trades": [
                {"symbol": "TSLA", "trade_type": "SELL", "shares": 50000, "value": 5000000,
                 "insider_name": "Insider A", "insider_title": "VP", "filing_date": "2026-04-01"},
            ],
        })
        engine = SignalEngine(db)
        signals = engine._insider_signals()

        assert len(signals) == 1
        assert signals[0]["direction"] == "bearish"

    def test_ceo_trades_boost_confidence(self):
        """CEO/CFO trades should get higher confidence via exec_score."""
        db_exec = MockDB({
            "insider_trades": [
                {"symbol": "AAPL", "trade_type": "BUY", "shares": 1000, "value": 100000,
                 "insider_name": "Tim Cook", "insider_title": "CEO", "filing_date": "2026-04-01"},
            ],
        })
        db_normal = MockDB({
            "insider_trades": [
                {"symbol": "AAPL", "trade_type": "BUY", "shares": 1000, "value": 100000,
                 "insider_name": "John Doe", "insider_title": "VP Sales", "filing_date": "2026-04-01"},
            ],
        })
        exec_signals = SignalEngine(db_exec)._insider_signals()
        normal_signals = SignalEngine(db_normal)._insider_signals()

        assert exec_signals[0]["signal_score"] > normal_signals[0]["signal_score"]

    def test_empty_data_returns_no_signals(self):
        """No insider data should return empty list."""
        db = MockDB({"insider_trades": []})
        engine = SignalEngine(db)
        signals = engine._insider_signals()
        assert signals == []

    def test_multiple_symbols(self):
        """Should generate separate signals per symbol."""
        db = MockDB({
            "insider_trades": [
                {"symbol": "AAPL", "trade_type": "BUY", "shares": 1000, "value": 100000,
                 "insider_name": "A", "insider_title": "", "filing_date": "2026-04-01"},
                {"symbol": "MSFT", "trade_type": "SELL", "shares": 2000, "value": 200000,
                 "insider_name": "B", "insider_title": "", "filing_date": "2026-04-01"},
            ],
        })
        engine = SignalEngine(db)
        signals = engine._insider_signals()
        symbols = {s["symbol"] for s in signals}
        assert symbols == {"AAPL", "MSFT"}


class TestSignalEngineOptions:
    """Test options signal generation."""

    def test_bullish_from_call_heavy(self):
        """High call volume vs puts should be bullish."""
        db = MockDB({
            "options_flow": [
                {"symbol": "NVDA", "option_type": "call", "strike": 500, "premium": 1000000,
                 "volume": 5000, "open_interest": 1000, "unusual_score": 80, "trade_type": "SWEEP"},
                {"symbol": "NVDA", "option_type": "put", "strike": 400, "premium": 100000,
                 "volume": 500, "open_interest": 2000, "unusual_score": 30, "trade_type": "TRADE"},
            ],
        })
        engine = SignalEngine(db)
        signals = engine._options_signals()

        assert len(signals) == 1
        assert signals[0]["direction"] == "bullish"

    def test_bearish_from_put_heavy(self):
        """High put volume vs calls should be bearish."""
        db = MockDB({
            "options_flow": [
                {"symbol": "TSLA", "option_type": "put", "strike": 200, "premium": 2000000,
                 "volume": 8000, "open_interest": 1000, "unusual_score": 90, "trade_type": "SWEEP"},
                {"symbol": "TSLA", "option_type": "call", "strike": 300, "premium": 50000,
                 "volume": 500, "open_interest": 5000, "unusual_score": 10, "trade_type": "TRADE"},
            ],
        })
        engine = SignalEngine(db)
        signals = engine._options_signals()

        assert len(signals) == 1
        assert signals[0]["direction"] == "bearish"

    def test_empty_options_returns_empty(self):
        db = MockDB({"options_flow": []})
        assert SignalEngine(db)._options_signals() == []


class TestSignalEngineSentiment:
    """Test sentiment signal generation."""

    def test_bullish_sentiment(self):
        """Strong positive sentiment should be bullish."""
        db = MockDB({
            "market_sentiment": [
                {"symbol": "AAPL", "sentiment_score": 0.8, "magnitude": 0.9,
                 "volume": 5000, "source": "reddit"},
            ],
        })
        signals = SignalEngine(db)._sentiment_signals()
        assert len(signals) == 1
        assert signals[0]["direction"] == "bullish"

    def test_bearish_sentiment(self):
        """Strong negative sentiment should be bearish."""
        db = MockDB({
            "market_sentiment": [
                {"symbol": "META", "sentiment_score": -0.6, "magnitude": 0.7,
                 "volume": 3000, "source": "twitter"},
            ],
        })
        signals = SignalEngine(db)._sentiment_signals()
        assert signals[0]["direction"] == "bearish"

    def test_neutral_sentiment(self):
        """Mixed sentiment should be neutral."""
        db = MockDB({
            "market_sentiment": [
                {"symbol": "GOOGL", "sentiment_score": 0.1, "magnitude": 0.3,
                 "volume": 1000, "source": "reddit"},
            ],
        })
        signals = SignalEngine(db)._sentiment_signals()
        assert signals[0]["direction"] == "neutral"

    def test_null_scores_skipped(self):
        """Records with null sentiment_score should be skipped."""
        db = MockDB({
            "market_sentiment": [
                {"symbol": "AMD", "sentiment_score": None, "magnitude": None,
                 "volume": 100, "source": "reddit"},
            ],
        })
        signals = SignalEngine(db)._sentiment_signals()
        assert signals == []


class TestSignalEngineDedup:
    """Test deduplication logic."""

    def test_keeps_highest_score(self):
        engine = SignalEngine(MockDB())
        signals = [
            {"symbol": "AAPL", "module": "insider_trades", "signal_score": 50, "direction": "bullish"},
            {"symbol": "AAPL", "module": "insider_trades", "signal_score": 80, "direction": "bullish"},
            {"symbol": "AAPL", "module": "options_flow", "signal_score": 60, "direction": "bearish"},
        ]
        deduped = engine._deduplicate(signals)
        assert len(deduped) == 2

        insider = next(s for s in deduped if s["module"] == "insider_trades")
        assert insider["signal_score"] == 80
