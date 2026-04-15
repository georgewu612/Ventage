"""Technical analysis API — on-demand OHLC + indicators via yfinance."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query

router = APIRouter()

PERIOD_MAP = {
    "1m": "1mo",
    "3m": "3mo",
    "6m": "6mo",
    "1y": "1y",
    "2y": "2y",
}


def _compute_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))


def _compute_macd(
    prices: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = prices.ewm(span=fast, adjust=False).mean()
    ema_slow = prices.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _compute_bollinger(
    prices: pd.Series, period: int = 20, num_std: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    sma = prices.rolling(period).mean()
    std = prices.rolling(period).std()
    upper = sma + num_std * std
    lower = sma - num_std * std
    return upper, sma, lower


def _safe_float(val: Any) -> float | None:
    """Convert numpy/pandas value to Python float, handling NaN."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        f = float(val)
        return None if np.isnan(f) else round(f, 4)
    except (TypeError, ValueError):
        return None


@router.get("/technical/{symbol}")
def get_technical_analysis(
    symbol: str,
    period: str = Query(default="3m", description="1m, 3m, 6m, 1y, 2y"),
) -> dict[str, Any]:
    """Fetch OHLC data and compute technical indicators for a symbol."""
    yf_period = PERIOD_MAP.get(period)
    if not yf_period:
        raise HTTPException(status_code=400, detail=f"Invalid period: {period}. Use: {list(PERIOD_MAP.keys())}")

    try:
        ticker = yf.Ticker(symbol.upper())
        df = ticker.history(period=yf_period, interval="1d")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch data from Yahoo Finance: {exc}") from exc

    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for symbol: {symbol.upper()}")

    close = df["Close"]

    # Compute indicators
    rsi = _compute_rsi(close)
    macd_line, macd_signal, macd_hist = _compute_macd(close)
    bb_upper, bb_mid, bb_lower = _compute_bollinger(close)
    sma_20 = close.rolling(20).mean()
    sma_50 = close.rolling(50).mean()
    ema_12 = close.ewm(span=12, adjust=False).mean()

    # Build OHLC candles array
    candles = []
    for idx, row in df.iterrows():
        ts = int(idx.timestamp())
        candles.append({
            "time": ts,
            "open": _safe_float(row["Open"]),
            "high": _safe_float(row["High"]),
            "low": _safe_float(row["Low"]),
            "close": _safe_float(row["Close"]),
            "volume": int(row["Volume"]) if not np.isnan(row["Volume"]) else 0,
        })

    # Build indicator series (aligned with candles by timestamp)
    indicators: dict[str, list] = {
        "rsi": [],
        "macd_line": [],
        "macd_signal": [],
        "macd_hist": [],
        "bb_upper": [],
        "bb_mid": [],
        "bb_lower": [],
        "sma_20": [],
        "sma_50": [],
        "ema_12": [],
    }

    for idx in df.index:
        ts = int(idx.timestamp())
        for key, series in [
            ("rsi", rsi),
            ("macd_line", macd_line),
            ("macd_signal", macd_signal),
            ("macd_hist", macd_hist),
            ("bb_upper", bb_upper),
            ("bb_mid", bb_mid),
            ("bb_lower", bb_lower),
            ("sma_20", sma_20),
            ("sma_50", sma_50),
            ("ema_12", ema_12),
        ]:
            val = _safe_float(series.get(idx))
            if val is not None:
                indicators[key].append({"time": ts, "value": val})

    # Latest values for summary cards
    latest_close = _safe_float(close.iloc[-1])
    prev_close = _safe_float(close.iloc[-2]) if len(close) > 1 else latest_close
    change = round(latest_close - prev_close, 4) if latest_close and prev_close else 0
    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0

    latest = {
        "price": latest_close,
        "change": change,
        "change_pct": change_pct,
        "rsi": _safe_float(rsi.iloc[-1]),
        "macd": _safe_float(macd_line.iloc[-1]),
        "macd_signal": _safe_float(macd_signal.iloc[-1]),
        "macd_hist": _safe_float(macd_hist.iloc[-1]),
        "sma_20": _safe_float(sma_20.iloc[-1]),
        "sma_50": _safe_float(sma_50.iloc[-1]),
        "bb_upper": _safe_float(bb_upper.iloc[-1]),
        "bb_lower": _safe_float(bb_lower.iloc[-1]),
        "volume": int(df["Volume"].iloc[-1]) if not np.isnan(df["Volume"].iloc[-1]) else 0,
        "high_52w": _safe_float(close.rolling(252).max().iloc[-1]) if len(close) >= 252 else _safe_float(close.max()),
        "low_52w": _safe_float(close.rolling(252).min().iloc[-1]) if len(close) >= 252 else _safe_float(close.min()),
    }

    # Simple technical signal
    signals = []
    if latest["rsi"] is not None:
        if latest["rsi"] > 70:
            signals.append({"indicator": "RSI", "signal": "overbought", "direction": "bearish"})
        elif latest["rsi"] < 30:
            signals.append({"indicator": "RSI", "signal": "oversold", "direction": "bullish"})

    if latest["macd"] is not None and latest["macd_signal"] is not None:
        if latest["macd"] > latest["macd_signal"]:
            signals.append({"indicator": "MACD", "signal": "bullish_crossover", "direction": "bullish"})
        else:
            signals.append({"indicator": "MACD", "signal": "bearish_crossover", "direction": "bearish"})

    if latest["price"] is not None and latest["sma_20"] is not None:
        if latest["price"] > latest["sma_20"]:
            signals.append({"indicator": "SMA20", "signal": "above_sma", "direction": "bullish"})
        else:
            signals.append({"indicator": "SMA20", "signal": "below_sma", "direction": "bearish"})

    if latest["price"] is not None and latest["sma_50"] is not None:
        if latest["price"] > latest["sma_50"]:
            signals.append({"indicator": "SMA50", "signal": "above_sma", "direction": "bullish"})
        else:
            signals.append({"indicator": "SMA50", "signal": "below_sma", "direction": "bearish"})

    return {
        "symbol": symbol.upper(),
        "period": period,
        "candles": candles,
        "indicators": indicators,
        "latest": latest,
        "signals": signals,
    }
