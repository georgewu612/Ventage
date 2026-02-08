"""
Data models for Ventage database entities
"""
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class MarketSignal(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    signal_type: Literal["technical", "fundamental", "sentiment", "composite"]
    direction: Literal["bullish", "bearish", "neutral"]
    confidence: Decimal
    analysis: str | None = None
    factors: dict | None = None
    valid_until: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class OptionsFlow(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    option_type: Literal["call", "put"]
    strike: Decimal
    expiration: date
    premium: Decimal
    volume: int
    open_interest: int | None = None
    implied_volatility: Decimal | None = None
    unusual_score: Decimal | None = None
    trade_type: Literal["sweep", "block", "split"] | None = None
    sentiment: Literal["bullish", "bearish"] | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class DarkPoolOrder(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    price: Decimal
    size: int
    exchange: str | None = None
    trade_time: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class EarningsForecast(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    report_date: date
    fiscal_quarter: str | None = None
    predicted_eps: Decimal | None = None
    actual_eps: Decimal | None = None
    consensus_eps: Decimal | None = None
    predicted_revenue: Decimal | None = None
    actual_revenue: Decimal | None = None
    consensus_revenue: Decimal | None = None
    surprise_pct: Decimal | None = None
    prediction_confidence: Decimal | None = None
    created_at: datetime = Field(default_factory=datetime.now)
    updated_at: datetime = Field(default_factory=datetime.now)


class MarketSentiment(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    source: Literal["reddit", "twitter", "news", "stocktwits"]
    sentiment_score: Decimal | None = None
    magnitude: Decimal | None = None
    volume: int | None = None
    keywords: dict | None = None
    sample_posts: dict | None = None
    analysis_window: Literal["1h", "4h", "24h"] | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class InsiderTrade(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str
    insider_name: str
    insider_title: str | None = None
    relationship: str | None = None
    trade_type: Literal["BUY", "SELL", "GIFT"]
    shares: int
    price: Decimal | None = None
    value: Decimal | None = None
    shares_owned_after: int | None = None
    filing_date: date
    transaction_date: date | None = None
    sec_form: str | None = None
    footnotes: str | None = None
    created_at: datetime = Field(default_factory=datetime.now)


class PutCallRatio(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    symbol: str | None = None
    ratio: Decimal
    put_volume: int
    call_volume: int
    date: date
    ratio_type: Literal["equity", "index", "total"] | None = None
    percentile: Decimal | None = None
    created_at: datetime = Field(default_factory=datetime.now)
