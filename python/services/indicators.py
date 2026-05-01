"""Shared technical indicator library for the Ventage trading system.

All functions are pure pandas/numpy implementations — no external TA library
dependency. Used by:
  - regime_classifier.py    (per-symbol regime detection)
  - strategies/*            (4 spec strategies + 6 Quant Lab templates)
  - volume_engine.py        (volume analysis)
  - chip_structure.py       (Volume Profile / cost basis)
  - api/routes/technical.py (workbench technical levels endpoint)

Naming convention: snake_case, returns pandas Series aligned to input index.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ── Trend & Momentum ──────────────────────────────────────────────────────────


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Relative Strength Index (Wilder).

    Smoothing here uses simple rolling mean, matching the existing implementation
    in api/routes/technical.py. For Wilder's exponential smoothing, swap rolling
    for ewm(alpha=1/period, adjust=False).
    """
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    return 100 - (100 / (1 + rs))


def macd(
    close: pd.Series,
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """MACD line, signal line, histogram."""
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def bollinger(
    close: pd.Series, period: int = 20, num_std: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Bollinger Bands: (upper, middle, lower)."""
    middle = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = middle + num_std * std
    lower = middle - num_std * std
    return upper, middle, lower


def ema(close: pd.Series, period: int) -> pd.Series:
    """Exponential moving average."""
    return close.ewm(span=period, adjust=False).mean()


def sma(close: pd.Series, period: int) -> pd.Series:
    """Simple moving average."""
    return close.rolling(period).mean()


# ── Volatility ────────────────────────────────────────────────────────────────


def true_range(high: pd.Series, low: pd.Series, close: pd.Series) -> pd.Series:
    """True Range = max(H-L, |H - prev_close|, |L - prev_close|)."""
    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()
    return pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)


def atr(
    high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14
) -> pd.Series:
    """Average True Range (Wilder's smoothing via ewm)."""
    tr = true_range(high, low, close)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


# ── Strength / Direction ──────────────────────────────────────────────────────


def adx(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    period: int = 14,
) -> tuple[pd.Series, pd.Series, pd.Series]:
    """Average Directional Index. Returns (DI+, DI-, ADX).

    ADX > 25 → trending market
    ADX < 20 → ranging market
    """
    # Directional movement
    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = pd.Series(
        np.where((up_move > down_move) & (up_move > 0), up_move, 0.0),
        index=high.index,
    )
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0),
        index=high.index,
    )

    # Smoothed True Range
    tr = true_range(high, low, close)
    atr_smooth = tr.ewm(alpha=1 / period, adjust=False).mean()

    # Smoothed DM → DI
    plus_di = 100 * plus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr_smooth.replace(
        0, np.nan
    )
    minus_di = 100 * minus_dm.ewm(alpha=1 / period, adjust=False).mean() / atr_smooth.replace(
        0, np.nan
    )

    # DX → ADX
    dx = 100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan)
    adx_line = dx.ewm(alpha=1 / period, adjust=False).mean()
    return plus_di, minus_di, adx_line


def stochastic(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    k_period: int = 14,
    d_period: int = 3,
) -> tuple[pd.Series, pd.Series]:
    """Stochastic oscillator. Returns (%K, %D).

    %K > 80 → overbought
    %K < 20 → oversold
    """
    lowest_low = low.rolling(k_period).min()
    highest_high = high.rolling(k_period).max()
    range_ = (highest_high - lowest_low).replace(0, np.nan)
    k = 100 * (close - lowest_low) / range_
    d = k.rolling(d_period).mean()
    return k, d


# ── Helpers ───────────────────────────────────────────────────────────────────


def safe_float(val) -> float | None:
    """Convert numpy/pandas value to Python float, handling NaN.

    Mirrors api/routes/technical.py::_safe_float so callers can use one helper.
    """
    if val is None:
        return None
    try:
        if isinstance(val, float) and np.isnan(val):
            return None
        f = float(val)
        return None if np.isnan(f) else round(f, 4)
    except (TypeError, ValueError):
        return None


def ema_alignment(
    e13: pd.Series, e34: pd.Series, e55: pd.Series, tolerance_pct: float = 0.0
) -> str:
    """Classify the latest EMA alignment.

    Returns one of: 'bullish' (13>34>55), 'bearish' (13<34<55), or 'tangled'
    (mixed / overlapping within tolerance).
    """
    if len(e13) == 0 or e13.isna().all():
        return "tangled"
    a, b, c = float(e13.iloc[-1]), float(e34.iloc[-1]), float(e55.iloc[-1])
    if any(np.isnan(v) for v in (a, b, c)):
        return "tangled"

    # Allow a small tolerance band so micro-overlaps don't flap classification
    band = max(abs(a), abs(b), abs(c)) * tolerance_pct / 100
    if a > b + band and b > c + band:
        return "bullish"
    if a < b - band and b < c - band:
        return "bearish"
    return "tangled"


def ema_squeeze_pct(
    e13: pd.Series, e34: pd.Series, e55: pd.Series
) -> float | None:
    """Max pairwise relative distance between EMA13/34/55 at the last bar.

    Used by regime_classifier and ema_squeeze_launch strategy to detect
    "EMAs tangled" / squeeze-setup state. Lower number = tighter squeeze.

    Returns max(|13-34|, |34-55|, |13-55|) / mean(13,34,55) × 100 (%).
    """
    if len(e13) == 0:
        return None
    a, b, c = float(e13.iloc[-1]), float(e34.iloc[-1]), float(e55.iloc[-1])
    if any(np.isnan(v) for v in (a, b, c)):
        return None
    mean = (a + b + c) / 3
    if mean == 0:
        return None
    return float(max(abs(a - b), abs(b - c), abs(a - c)) / mean * 100)


def bb_width(upper: pd.Series, middle: pd.Series, lower: pd.Series) -> pd.Series:
    """Bollinger band width as percentage of middle: (upper - lower) / middle × 100."""
    return (upper - lower) / middle.replace(0, np.nan) * 100
