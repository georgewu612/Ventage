"""Per-symbol regime classifier (6 states).

Implements规范第 5 节 "市场状态识别引擎":
  - strong_uptrend         强趋势上涨
  - strong_downtrend       强趋势下跌
  - squeeze_breakout_setup 启动/蓄势突破
  - ranging                区间震荡
  - exhaustion_reversal    趋势衰竭/转折
  - elevated_event_risk    事件高风险（外部事件叠加）

Public API:
    classify(ohlcv, *, event_risk=False) -> RegimeResult

Output is meant to be persisted into the `symbol_regimes` table and consumed
by strategy_router.py to decide which strategies are eligible.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Literal

import numpy as np
import pandas as pd

from services.indicators import (
    adx as adx_fn,
    atr as atr_fn,
    bb_width as bb_width_fn,
    bollinger,
    ema,
    ema_alignment,
    ema_squeeze_pct,
    macd as macd_fn,
    rsi as rsi_fn,
    safe_float,
    sma,
)

Regime = Literal[
    "strong_uptrend",
    "strong_downtrend",
    "squeeze_breakout_setup",
    "ranging",
    "exhaustion_reversal",
    "elevated_event_risk",
]


# ── Tunable thresholds ────────────────────────────────────────────────────────

ADX_TREND_MIN = 25.0       # ADX above this → trending
ADX_RANGE_MAX = 20.0       # ADX below this → ranging
SQUEEZE_EMA_PCT = 4.0      # max EMA13/34/55 dispersion for squeeze (%)
SQUEEZE_BB_WIDTH_PCT = 6.0 # BB width below this for squeeze (%)
ATR_DECLINE_LOOKBACK = 20  # bars to compare ATR decline


# ── Result type ───────────────────────────────────────────────────────────────


@dataclass
class RegimeResult:
    regime: Regime
    regime_score: float          # 0-100 confidence in the classification
    adx: float | None
    ema_alignment: str           # 'bullish' / 'bearish' / 'tangled'
    ema_squeeze_pct: float | None
    bb_width: float | None
    atr_pct: float | None        # ATR as % of close
    risk_flag: str | None        # 'elevated_event_risk' or None
    notes: dict                  # debug/observability fields

    def to_dict(self) -> dict:
        return asdict(self)


# ── Helpers ───────────────────────────────────────────────────────────────────


def _last(series: pd.Series) -> float | None:
    """Return the last non-NaN value as a float, or None."""
    if series is None or len(series) == 0:
        return None
    val = series.dropna()
    if len(val) == 0:
        return None
    return float(val.iloc[-1])


def _is_higher_highs_lows(close: pd.Series, lookback: int = 30) -> bool:
    """Recent price action makes higher swing highs and higher lows."""
    if len(close) < lookback * 2:
        return False
    first_half = close.iloc[-lookback * 2 : -lookback]
    second_half = close.iloc[-lookback:]
    return (
        second_half.max() > first_half.max() and second_half.min() > first_half.min()
    )


def _is_lower_highs_lows(close: pd.Series, lookback: int = 30) -> bool:
    """Recent price action makes lower swing highs and lower lows."""
    if len(close) < lookback * 2:
        return False
    first_half = close.iloc[-lookback * 2 : -lookback]
    second_half = close.iloc[-lookback:]
    return (
        second_half.max() < first_half.max() and second_half.min() < first_half.min()
    )


def _atr_declining(atr_series: pd.Series, lookback: int = ATR_DECLINE_LOOKBACK) -> bool:
    """ATR has been declining over the last `lookback` bars (volatility compression)."""
    if len(atr_series.dropna()) < lookback:
        return False
    recent = atr_series.dropna().iloc[-lookback:]
    return float(recent.iloc[-1]) < float(recent.iloc[0])


def _bearish_divergence(close: pd.Series, rsi: pd.Series, lookback: int = 20) -> bool:
    """Price makes higher highs but RSI makes lower highs over `lookback` bars."""
    if len(close) < lookback or rsi is None or len(rsi.dropna()) < lookback:
        return False
    c = close.iloc[-lookback:]
    r = rsi.iloc[-lookback:]
    # Compare halves
    mid = lookback // 2
    price_first_max = float(c.iloc[:mid].max())
    price_last_max = float(c.iloc[mid:].max())
    rsi_first_max = float(r.iloc[:mid].max())
    rsi_last_max = float(r.iloc[mid:].max())
    return price_last_max > price_first_max and rsi_last_max < rsi_first_max


def _bullish_divergence(close: pd.Series, rsi: pd.Series, lookback: int = 20) -> bool:
    """Price makes lower lows but RSI makes higher lows over `lookback` bars."""
    if len(close) < lookback or rsi is None or len(rsi.dropna()) < lookback:
        return False
    c = close.iloc[-lookback:]
    r = rsi.iloc[-lookback:]
    mid = lookback // 2
    price_first_min = float(c.iloc[:mid].min())
    price_last_min = float(c.iloc[mid:].min())
    rsi_first_min = float(r.iloc[:mid].min())
    rsi_last_min = float(r.iloc[mid:].min())
    return price_last_min < price_first_min and rsi_last_min > rsi_first_min


# ── Main classifier ───────────────────────────────────────────────────────────


def classify(
    ohlcv: pd.DataFrame,
    *,
    event_risk: bool = False,
) -> RegimeResult:
    """Classify the latest bar of `ohlcv` into one of 6 regimes.

    Args:
        ohlcv: DataFrame with columns High, Low, Close, Volume. Index should be
            DatetimeIndex. Needs at least 200 bars for reliable classification
            (uses 200-day MA).
        event_risk: External flag — set True if symbol is within ±2 days of
            earnings/FOMC/CPI/NFP. Forces regime to elevated_event_risk and
            tags risk_flag.

    Returns:
        RegimeResult with regime, score, all indicator snapshots, and notes.
    """
    if ohlcv is None or ohlcv.empty:
        return RegimeResult(
            regime="ranging",
            regime_score=0.0,
            adx=None,
            ema_alignment="tangled",
            ema_squeeze_pct=None,
            bb_width=None,
            atr_pct=None,
            risk_flag=None,
            notes={"error": "empty_ohlcv"},
        )

    high = ohlcv["High"].astype(float)
    low = ohlcv["Low"].astype(float)
    close = ohlcv["Close"].astype(float)

    # Compute all indicators once
    e13 = ema(close, 13)
    e34 = ema(close, 34)
    e55 = ema(close, 55)
    ma50 = sma(close, 50)
    ma200 = sma(close, 200)
    bb_u, bb_m, bb_l = bollinger(close, 20, 2.0)
    bb_w = bb_width_fn(bb_u, bb_m, bb_l)
    atr_series = atr_fn(high, low, close, 14)
    _, _, adx_line = adx_fn(high, low, close, 14)
    rsi_series = rsi_fn(close, 14)

    # Snapshot scalars
    last_close = _last(close)
    last_adx = _last(adx_line)
    last_e13, last_e34, last_e55 = _last(e13), _last(e34), _last(e55)
    last_ma50, last_ma200 = _last(ma50), _last(ma200)
    last_bb_w = _last(bb_w)
    last_atr = _last(atr_series)
    atr_pct = (last_atr / last_close * 100) if last_atr and last_close else None
    align = ema_alignment(e13, e34, e55)
    sqz_pct = ema_squeeze_pct(e13, e34, e55)

    # NOTE: All boolean values stored in `notes` MUST be coerced to native Python
    # `bool` (not numpy.bool_) so the dict is JSON-serializable by FastAPI.
    notes: dict = {
        "last_close": safe_float(last_close),
        "above_ma200": (
            bool(last_close > last_ma200) if last_close and last_ma200 else None
        ),
        "ma50_above_ma200": (
            bool(last_ma50 > last_ma200) if last_ma50 and last_ma200 else None
        ),
    }

    # ── 0. External event-risk override ──────────────────────────────────────
    if event_risk:
        return RegimeResult(
            regime="elevated_event_risk",
            regime_score=100.0,
            adx=safe_float(last_adx),
            ema_alignment=align,
            ema_squeeze_pct=safe_float(sqz_pct),
            bb_width=safe_float(last_bb_w),
            atr_pct=safe_float(atr_pct),
            risk_flag="elevated_event_risk",
            notes={**notes, "reason": "external_event_calendar_flag"},
        )

    # ── 1. Strong uptrend candidates ─────────────────────────────────────────
    # Required: trending ADX + bullish EMA alignment + price above EMA34
    # Required (when MA200 available): MA50 > MA200
    # Optional (score boost): higher highs and higher lows
    has_hh_hl = _is_higher_highs_lows(close)
    is_strong_uptrend = (
        last_adx is not None
        and last_adx > ADX_TREND_MIN
        and align == "bullish"
        and last_close is not None
        and last_e34 is not None
        and last_close > last_e34
        and (
            last_ma50 is None
            or last_ma200 is None
            or last_ma50 > last_ma200
        )
    )

    # ── 2. Strong downtrend candidates ───────────────────────────────────────
    has_lh_ll = _is_lower_highs_lows(close)
    is_strong_downtrend = (
        last_adx is not None
        and last_adx > ADX_TREND_MIN
        and align == "bearish"
        and last_close is not None
        and last_e34 is not None
        and last_close < last_e34
        and (
            last_ma50 is None
            or last_ma200 is None
            or last_ma50 < last_ma200
        )
    )

    # ── 3. Squeeze / breakout setup ──────────────────────────────────────────
    is_squeeze = (
        sqz_pct is not None
        and sqz_pct < SQUEEZE_EMA_PCT
        and last_bb_w is not None
        and last_bb_w < SQUEEZE_BB_WIDTH_PCT
        and _atr_declining(atr_series)
    )

    # ── 4. Exhaustion / reversal candidates ──────────────────────────────────
    # Long uptrend with bearish divergence, OR long downtrend with bullish divergence
    has_bear_div = _bearish_divergence(close, rsi_series)
    has_bull_div = _bullish_divergence(close, rsi_series)
    is_exhaustion = (
        (is_strong_uptrend and has_bear_div)
        or (is_strong_downtrend and has_bull_div)
        # Also: ADX rolling over from high
        or (
            last_adx is not None
            and last_adx > 20
            and len(adx_line.dropna()) > 5
            and float(adx_line.dropna().iloc[-5]) > last_adx + 5
            and (has_bear_div or has_bull_div)
        )
    )

    # ── 5. Ranging ────────────────────────────────────────────────────────────
    is_ranging = (
        last_adx is not None
        and last_adx < ADX_RANGE_MAX
        and not is_squeeze  # squeeze is a special ranging
    )

    # ── Decide regime (priority order) ──────────────────────────────────────
    # Priority: exhaustion > squeeze > strong trends > ranging
    # Rationale: exhaustion is the most actionable transition signal; squeeze is
    # a specific high-value setup; strong trends supersede generic ranging.
    if is_exhaustion:
        regime: Regime = "exhaustion_reversal"
        score = 75.0 + (10 if has_bear_div else 0) + (10 if has_bull_div else 0)
    elif is_squeeze:
        regime = "squeeze_breakout_setup"
        # Higher score for tighter squeeze
        score = 60 + max(0, (SQUEEZE_EMA_PCT - (sqz_pct or 0)) * 5)
    elif is_strong_uptrend:
        regime = "strong_uptrend"
        # Base 60 + ADX boost up to 30 + HH/HL boost 10
        base = 60 + min(30, (last_adx - ADX_TREND_MIN) * 1.5) if last_adx else 60
        score = base + (10 if has_hh_hl else 0)
    elif is_strong_downtrend:
        regime = "strong_downtrend"
        base = 60 + min(30, (last_adx - ADX_TREND_MIN) * 1.5) if last_adx else 60
        score = base + (10 if has_lh_ll else 0)
    elif is_ranging:
        regime = "ranging"
        score = 60 + (ADX_RANGE_MAX - (last_adx or 20)) * 2
    else:
        # Transitional / neutral — default to ranging with low confidence
        regime = "ranging"
        score = 40.0

    notes.update(
        {
            "is_strong_uptrend": bool(is_strong_uptrend),
            "is_strong_downtrend": bool(is_strong_downtrend),
            "is_squeeze": bool(is_squeeze),
            "is_exhaustion": bool(is_exhaustion),
            "is_ranging": bool(is_ranging),
            "has_higher_highs_lows": bool(has_hh_hl),
            "has_lower_highs_lows": bool(has_lh_ll),
            "has_bearish_divergence": bool(has_bear_div),
            "has_bullish_divergence": bool(has_bull_div),
        }
    )

    return RegimeResult(
        regime=regime,
        regime_score=round(min(100.0, max(0.0, score)), 1),
        adx=safe_float(last_adx),
        ema_alignment=align,
        ema_squeeze_pct=safe_float(sqz_pct),
        bb_width=safe_float(last_bb_w),
        atr_pct=safe_float(atr_pct),
        risk_flag=None,
        notes=notes,
    )
