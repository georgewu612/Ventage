"""
Mock data generator for Ventage
Generates realistic test data for all database tables
"""
import random
from datetime import date, datetime, timedelta
from decimal import Decimal

from python.etl.models import (
    DarkPoolOrder,
    EarningsForecast,
    InsiderTrade,
    MarketSentiment,
    MarketSignal,
    OptionsFlow,
    PutCallRatio,
)

# Common stock symbols
SYMBOLS = ["AAPL", "NVDA", "TSLA", "META", "MSFT", "GOOGL", "AMZN", "AMD", "COIN", "PLTR"]

# Insider names
INSIDERS = [
    ("Tim Cook", "CEO"),
    ("Jensen Huang", "CEO"),
    ("Elon Musk", "CEO"),
    ("Mark Zuckerberg", "CEO"),
    ("Satya Nadella", "CEO"),
    ("Sundar Pichai", "CEO"),
    ("Andy Jassy", "CEO"),
    ("Lisa Su", "CEO"),
]


def generate_market_signals(count: int = 10) -> list[MarketSignal]:
    """Generate mock market signals"""
    signals = []
    for _ in range(count):
        direction = random.choice(["bullish", "bearish", "neutral"])
        confidence = Decimal(str(random.uniform(0.5, 0.95)))
        
        signal = MarketSignal(
            symbol=random.choice(SYMBOLS),
            signal_type=random.choice(["technical", "fundamental", "sentiment", "composite"]),
            direction=direction,
            confidence=confidence,
            analysis=f"AI analysis suggests {direction} trend with {float(confidence)*100:.0f}% confidence",
            factors={
                "technical": random.uniform(0.3, 0.9),
                "fundamental": random.uniform(0.3, 0.9),
                "sentiment": random.uniform(0.3, 0.9),
            },
            valid_until=datetime.now() + timedelta(days=random.randint(1, 7)),
        )
        signals.append(signal)
    return signals


def generate_options_flow(count: int = 15) -> list[OptionsFlow]:
    """Generate mock options flow data"""
    flows = []
    for _ in range(count):
        symbol = random.choice(SYMBOLS)
        option_type = random.choice(["call", "put"])
        
        flow = OptionsFlow(
            symbol=symbol,
            option_type=option_type,
            strike=Decimal(str(random.randint(100, 500))),
            expiration=date.today() + timedelta(days=random.randint(7, 90)),
            premium=Decimal(str(random.randint(10000, 5000000))),
            volume=random.randint(100, 10000),
            open_interest=random.randint(500, 50000),
            implied_volatility=Decimal(str(random.uniform(0.2, 0.8))),
            unusual_score=Decimal(str(random.uniform(50, 100))),
            trade_type=random.choice(["sweep", "block", "split"]),
            sentiment="bullish" if option_type == "call" else "bearish",
        )
        flows.append(flow)
    return flows


def generate_dark_pool_orders(count: int = 10) -> list[DarkPoolOrder]:
    """Generate mock dark pool orders"""
    orders = []
    for _ in range(count):
        order = DarkPoolOrder(
            symbol=random.choice(SYMBOLS),
            price=Decimal(str(random.uniform(100, 500))),
            size=random.randint(10000, 500000),
            exchange=random.choice(["UBS", "Credit Suisse", "Goldman Sachs", "MS Pool"]),
            trade_time=datetime.now() - timedelta(hours=random.randint(0, 24)),
        )
        orders.append(order)
    return orders


def generate_earnings_forecasts(count: int = 5) -> list[EarningsForecast]:
    """Generate mock earnings forecasts"""
    forecasts = []
    for _ in range(count):
        predicted_eps = Decimal(str(random.uniform(1, 10)))
        consensus_eps = Decimal(str(random.uniform(1, 10)))
        
        forecast = EarningsForecast(
            symbol=random.choice(SYMBOLS),
            report_date=date.today() + timedelta(days=random.randint(1, 30)),
            fiscal_quarter=f"Q{random.randint(1, 4)} 2026",
            predicted_eps=predicted_eps,
            consensus_eps=consensus_eps,
            predicted_revenue=Decimal(str(random.randint(1000000, 50000000))),
            consensus_revenue=Decimal(str(random.randint(1000000, 50000000))),
            prediction_confidence=Decimal(str(random.uniform(0.6, 0.9))),
        )
        forecasts.append(forecast)
    return forecasts


def generate_market_sentiment(count: int = 10) -> list[MarketSentiment]:
    """Generate mock market sentiment data"""
    sentiments = []
    for _ in range(count):
        sentiment = MarketSentiment(
            symbol=random.choice(SYMBOLS),
            source=random.choice(["reddit", "twitter", "news", "stocktwits"]),
            sentiment_score=Decimal(str(random.uniform(-1, 1))),
            magnitude=Decimal(str(random.uniform(0.3, 1))),
            volume=random.randint(100, 10000),
            keywords={"bullish": random.randint(10, 100), "moon": random.randint(5, 50)},
            sample_posts={"post1": "Sample post content", "post2": "Another post"},
            analysis_window=random.choice(["1h", "4h", "24h"]),
        )
        sentiments.append(sentiment)
    return sentiments


def generate_insider_trades(count: int = 8) -> list[InsiderTrade]:
    """Generate mock insider trades"""
    trades = []
    for _ in range(count):
        insider_name, insider_title = random.choice(INSIDERS)
        trade_type = random.choice(["BUY", "SELL"])
        shares = random.randint(1000, 100000)
        price = Decimal(str(random.uniform(100, 500)))
        
        trade = InsiderTrade(
            symbol=random.choice(SYMBOLS),
            insider_name=insider_name,
            insider_title=insider_title,
            relationship="Officer",
            trade_type=trade_type,
            shares=shares,
            price=price,
            value=Decimal(str(shares * float(price))),
            shares_owned_after=random.randint(100000, 5000000),
            filing_date=date.today() - timedelta(days=random.randint(0, 30)),
            transaction_date=date.today() - timedelta(days=random.randint(0, 30)),
            sec_form="Form 4",
        )
        trades.append(trade)
    return trades


def generate_put_call_ratios(count: int = 5) -> list[PutCallRatio]:
    """Generate mock put/call ratios"""
    ratios = []
    for _ in range(count):
        put_volume = random.randint(10000, 100000)
        call_volume = random.randint(10000, 100000)
        
        ratio = PutCallRatio(
            symbol=random.choice(SYMBOLS + [None]),  # None for market-wide
            ratio=Decimal(str(put_volume / call_volume)),
            put_volume=put_volume,
            call_volume=call_volume,
            date=date.today() - timedelta(days=random.randint(0, 7)),
            ratio_type=random.choice(["equity", "index", "total"]),
            percentile=Decimal(str(random.uniform(10, 90))),
        )
        ratios.append(ratio)
    return ratios
