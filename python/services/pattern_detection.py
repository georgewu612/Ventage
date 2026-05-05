"""Cai Sen 蔡森《多空轉折一手抓》 chart pattern detection engine.

Implements 12 chart patterns from the book with measured-move targets
("等幅滿足計算"), pattern quality scoring, and time-symmetry checking.

12 Patterns (book TOC order):
    Bullish (long entry):
        1. detect_w_bottom              — W底
        2. detect_failed_breakdown      — 破底翻
        3. detect_w_bottom_with_failed_breakdown — 破底翻 W 底
        4. detect_falling_flag          — 下傾旗形
        5. detect_head_shoulders_bottom — 頭肩底
        6. detect_converging_triangle_bottom — 收斂三角形底部
    Bearish (short entry):
        7. detect_m_top                 — M 頭
        8. detect_rising_flag           — 上攬旗形
        9. detect_failed_breakout       — 假突破
       10. detect_head_shoulders_top    — 頭肩頂
       11. detect_failed_breakout_hs_top — 假突破（頭肩頂）
       12. detect_converging_triangle_top — 收斂三角形頂部

Universal trading plan (book invariant):
    entry  = neckline breakout point
    stop   = entry × (1 ± 0.06)              # 5-7% midpoint
    target_1 = entry ± measured_move          # equal-projection from pattern height
    target_2 = entry ± 2 × measured_move      # second-wave projection
    invalidation = price returns through neckline (status='broken')

Output: PatternMatch dataclass mirroring strategy_signals' pattern fields.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

import numpy as np
import pandas as pd


# ── Constants ──────────────────────────────────────────────────────────────

DEFAULT_SWING_K = 5            # fractal lookback (left/right bars)
DEFAULT_STOP_PCT = 0.06        # 6% stop (5-7% book midpoint)
DEFAULT_NECKLINE_TOL = 0.03    # max 3% slope to count as horizontal neckline
DEFAULT_BREAKOUT_VOL_MULT = 1.3  # vol vs prior 5-day avg → "with volume"
MIN_BARS = 60                  # min OHLCV history for any detector


# ── Data classes ───────────────────────────────────────────────────────────


@dataclass
class SwingPoint:
    """A local high or low identified by fractal logic."""

    idx: int                   # iloc index in ohlcv
    date: pd.Timestamp
    price: float
    role: str = ""             # "left_low" / "head" / "neckline_break" etc.


@dataclass
class PatternMatch:
    """Output of every detector. Maps to strategy_signals pattern_* columns."""

    # Identity
    pattern_name: str          # 中文 e.g. "W底"
    pattern_name_en: str       # e.g. "w_bottom"
    direction: Literal["long", "short"]

    # Geometry
    pattern_start_date: pd.Timestamp
    pattern_end_date: pd.Timestamp
    pivot_points: list[dict]   # serialized SwingPoint snapshots
    neckline_price: float
    neckline_date: pd.Timestamp

    # Trading plan (universal book formula)
    entry_price: float         # neckline breakout point
    stop_price: float          # entry × (1 ± stop_pct)
    target_1: float            # 1st measured-move target
    target_2: float | None     # 2nd measured-move target (where applicable)
    invalidation_price: float  # neckline-return failure point
    measured_move_pct: float   # (target_1 - entry) / entry

    # Quality scores (each 0-100)
    pattern_quality_score: float
    time_symmetry_score: float
    volume_confirmation: bool  # bool: did breakout bar have volume

    # Status
    status: Literal["forming", "confirmed", "broken"]
    # forming = not yet broken neckline; confirmed = broke and held;
    # broken = was active but neckline retest failed

    def to_dict(self) -> dict:
        d = asdict(self)
        # Convert timestamps to ISO strings for JSON
        for key in ("pattern_start_date", "pattern_end_date", "neckline_date"):
            v = d.get(key)
            if isinstance(v, pd.Timestamp):
                d[key] = v.isoformat()
        for p in d.get("pivot_points", []):
            v = p.get("date")
            if isinstance(v, pd.Timestamp):
                p["date"] = v.isoformat()
        return d


# ── Shared primitives ──────────────────────────────────────────────────────


def find_swing_highs(ohlcv: pd.DataFrame, k: int = DEFAULT_SWING_K) -> list[SwingPoint]:
    """Return swing-high points: bars where High is the max within ±k bars."""
    high = ohlcv["High"].astype(float).values
    n = len(high)
    points: list[SwingPoint] = []
    for i in range(k, n - k):
        window = high[i - k : i + k + 1]
        if high[i] == window.max() and high[i] > window[k - 1] and high[i] >= window[k + 1]:
            # tie-break: only mark if strictly above the bar before
            points.append(
                SwingPoint(
                    idx=i,
                    date=ohlcv.index[i],
                    price=float(high[i]),
                )
            )
    return points


def find_swing_lows(ohlcv: pd.DataFrame, k: int = DEFAULT_SWING_K) -> list[SwingPoint]:
    """Return swing-low points: bars where Low is the min within ±k bars."""
    low = ohlcv["Low"].astype(float).values
    n = len(low)
    points: list[SwingPoint] = []
    for i in range(k, n - k):
        window = low[i - k : i + k + 1]
        if low[i] == window.min() and low[i] < window[k - 1] and low[i] <= window[k + 1]:
            points.append(
                SwingPoint(
                    idx=i,
                    date=ohlcv.index[i],
                    price=float(low[i]),
                )
            )
    return points


def neckline_slope(p1: SwingPoint, p2: SwingPoint) -> float:
    """Return abs slope (price-pct per bar) between two swing points."""
    bars = max(p2.idx - p1.idx, 1)
    return abs(p2.price - p1.price) / max(p1.price, 1e-9) / bars


def horizontal_neckline(
    p1: SwingPoint, p2: SwingPoint, tol: float = DEFAULT_NECKLINE_TOL
) -> bool:
    """Two swing points form a roughly horizontal neckline if % diff ≤ tol."""
    return abs(p2.price - p1.price) / max(p1.price, 1e-9) <= tol


def time_symmetry_score(left_days: int, right_days: int) -> float:
    """Score 0-100 based on how close left/right durations match."""
    if left_days <= 0 or right_days <= 0:
        return 0.0
    short, long_ = (left_days, right_days) if left_days <= right_days else (right_days, left_days)
    ratio = short / long_  # 0..1
    # ratio=1 → 100; ratio=0.5 → 50; ratio=0.3 → 30
    return float(round(100.0 * ratio, 1))


def volume_at_breakout(
    ohlcv: pd.DataFrame, break_idx: int, lookback: int = 5, mult: float = DEFAULT_BREAKOUT_VOL_MULT
) -> bool:
    """True if volume[break_idx] >= mult × mean(volume[break_idx-lookback:break_idx])."""
    if break_idx < lookback or break_idx >= len(ohlcv):
        return False
    vol = ohlcv["Volume"].astype(float).values
    prior = vol[break_idx - lookback : break_idx]
    if len(prior) == 0 or prior.mean() == 0:
        return False
    return bool(vol[break_idx] >= mult * prior.mean())


def latest_close(ohlcv: pd.DataFrame) -> float:
    return float(ohlcv["Close"].astype(float).iloc[-1])


def build_pivot_dicts(points: list[SwingPoint]) -> list[dict]:
    return [
        {"date": p.date, "price": p.price, "role": p.role, "idx": p.idx} for p in points
    ]


def _make_match(
    *,
    pattern_name: str,
    pattern_name_en: str,
    direction: str,
    pivots: list[SwingPoint],
    neckline_price: float,
    neckline_date: pd.Timestamp,
    entry_price: float,
    target_1: float,
    target_2: float | None,
    invalidation_price: float,
    pattern_quality_score: float,
    time_sym_score: float,
    volume_conf: bool,
    status: str,
    stop_pct: float = DEFAULT_STOP_PCT,
) -> PatternMatch:
    """Helper: build PatternMatch with universal stop + measured_move_pct."""
    if direction == "long":
        stop_price = entry_price * (1.0 - stop_pct)
    else:
        stop_price = entry_price * (1.0 + stop_pct)
    measured_move_pct = (target_1 - entry_price) / max(entry_price, 1e-9)
    return PatternMatch(
        pattern_name=pattern_name,
        pattern_name_en=pattern_name_en,
        direction=direction,  # type: ignore[arg-type]
        pattern_start_date=pivots[0].date,
        pattern_end_date=pivots[-1].date,
        pivot_points=build_pivot_dicts(pivots),
        neckline_price=float(neckline_price),
        neckline_date=neckline_date,
        entry_price=float(entry_price),
        stop_price=float(stop_price),
        target_1=float(target_1),
        target_2=float(target_2) if target_2 is not None else None,
        invalidation_price=float(invalidation_price),
        measured_move_pct=float(measured_move_pct),
        pattern_quality_score=float(round(pattern_quality_score, 1)),
        time_symmetry_score=float(round(time_sym_score, 1)),
        volume_confirmation=bool(volume_conf),
        status=status,  # type: ignore[arg-type]
    )


def _classify_status(
    ohlcv: pd.DataFrame,
    neckline_price: float,
    direction: str,
    break_idx: int | None,
) -> str:
    """Determine 'forming' / 'confirmed' / 'broken' based on price vs neckline."""
    last_close = latest_close(ohlcv)
    if break_idx is None:
        # No breakout yet
        return "forming"
    # Breakout has occurred; check if neckline retest failed
    if direction == "long":
        # Confirmed if last_close stays above neckline; broken if fell back below
        return "confirmed" if last_close > neckline_price else "broken"
    # short
    return "confirmed" if last_close < neckline_price else "broken"


# ── Pattern 1: W 底 (W-bottom / Double Bottom) ─────────────────────────────


def detect_w_bottom(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """Detect W-bottom (双底).

    Geometry:
        Two swing lows (left_low, right_low) of similar price
        + One swing high between them (neckline pivot)
        + Breakout above the neckline
    Target: neckline + (neckline - min(left_low, right_low))
    """
    if len(ohlcv) < MIN_BARS:
        return None

    lows = find_swing_lows(ohlcv)
    highs = find_swing_highs(ohlcv)
    if len(lows) < 2 or len(highs) < 1:
        return None

    # Use the two most recent swing lows
    right_low = lows[-1]
    left_low = lows[-2]
    if right_low.idx - left_low.idx < 14:  # must span ≥14 bars
        return None

    # Find swing high between them = neckline reference
    middle_highs = [h for h in highs if left_low.idx < h.idx < right_low.idx]
    if not middle_highs:
        return None
    middle_high = max(middle_highs, key=lambda h: h.price)

    # Two lows must be within 5% of each other
    low_diff_pct = abs(right_low.price - left_low.price) / max(left_low.price, 1e-9)
    if low_diff_pct > 0.07:  # 7% tolerance (slightly more permissive)
        return None

    neckline = middle_high.price
    pattern_low = min(left_low.price, right_low.price)
    pattern_height = neckline - pattern_low
    if pattern_height / pattern_low < 0.10:  # need ≥10% height
        return None

    # Breakout: any close after right_low > neckline
    closes = ohlcv["Close"].astype(float).values
    break_idx = None
    for i in range(right_low.idx + 1, len(closes)):
        if closes[i] > neckline:
            break_idx = i
            break

    entry_price = neckline
    target_1 = neckline + pattern_height
    target_2 = target_1 + pattern_height
    invalidation = neckline * 0.97  # close back ≥3% below neckline

    # Quality scoring
    score = 0.0
    score += 30.0 * (1.0 - low_diff_pct / 0.07)   # tighter low equality → higher
    nl_slope = neckline_slope(middle_high, middle_high)  # single point: skip
    score += 25.0  # neckline always treated as horizontal here (single high)
    bottom_span_days = (right_low.date - left_low.date).days
    score += 20.0 * min(bottom_span_days / 30.0, 1.0)
    # Right-side volume contraction
    vol = ohlcv["Volume"].astype(float).values
    left_vol = vol[max(left_low.idx - 5, 0) : left_low.idx + 1].mean()
    right_vol = vol[max(right_low.idx - 5, 0) : right_low.idx + 1].mean()
    if left_vol > 0 and right_vol < left_vol:
        score += 15.0
    # Overall amplitude
    if pattern_height / pattern_low >= 0.15:
        score += 10.0
    pattern_quality = min(score, 100.0)

    # Time symmetry: bars from left_low to middle_high vs middle_high to right_low
    left_dur = middle_high.idx - left_low.idx
    right_dur = right_low.idx - middle_high.idx
    time_sym = time_symmetry_score(left_dur, right_dur)

    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, neckline, "long", break_idx)

    pivots = [
        SwingPoint(left_low.idx, left_low.date, left_low.price, "left_low"),
        SwingPoint(middle_high.idx, middle_high.date, middle_high.price, "neckline"),
        SwingPoint(right_low.idx, right_low.date, right_low.price, "right_low"),
    ]

    return _make_match(
        pattern_name="W底",
        pattern_name_en="w_bottom",
        direction="long",
        pivots=pivots,
        neckline_price=neckline,
        neckline_date=middle_high.date,
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


# ── Pattern 2: M 頭 (M-top / Double Top) ───────────────────────────────────


def detect_m_top(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """Mirror of W-bottom — two swing highs of similar price with valley between."""
    if len(ohlcv) < MIN_BARS:
        return None

    highs = find_swing_highs(ohlcv)
    lows = find_swing_lows(ohlcv)
    if len(highs) < 2 or len(lows) < 1:
        return None

    right_high = highs[-1]
    left_high = highs[-2]
    if right_high.idx - left_high.idx < 14:
        return None

    middle_lows = [low for low in lows if left_high.idx < low.idx < right_high.idx]
    if not middle_lows:
        return None
    middle_low = min(middle_lows, key=lambda low: low.price)

    high_diff_pct = abs(right_high.price - left_high.price) / max(left_high.price, 1e-9)
    if high_diff_pct > 0.07:
        return None

    neckline = middle_low.price
    pattern_top = max(left_high.price, right_high.price)
    pattern_height = pattern_top - neckline
    if pattern_height / pattern_top < 0.10:
        return None

    closes = ohlcv["Close"].astype(float).values
    break_idx = None
    for i in range(right_high.idx + 1, len(closes)):
        if closes[i] < neckline:
            break_idx = i
            break

    entry_price = neckline
    target_1 = neckline - pattern_height
    target_2 = target_1 - pattern_height
    invalidation = neckline * 1.03

    score = 0.0
    score += 30.0 * (1.0 - high_diff_pct / 0.07)
    score += 25.0
    top_span_days = (right_high.date - left_high.date).days
    score += 20.0 * min(top_span_days / 30.0, 1.0)
    vol = ohlcv["Volume"].astype(float).values
    left_vol = vol[max(left_high.idx - 5, 0) : left_high.idx + 1].mean()
    right_vol = vol[max(right_high.idx - 5, 0) : right_high.idx + 1].mean()
    if left_vol > 0 and right_vol < left_vol:
        score += 15.0  # vol divergence (right top with less vol = distribution sign)
    if pattern_height / pattern_top >= 0.15:
        score += 10.0
    pattern_quality = min(score, 100.0)

    left_dur = middle_low.idx - left_high.idx
    right_dur = right_high.idx - middle_low.idx
    time_sym = time_symmetry_score(left_dur, right_dur)

    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, neckline, "short", break_idx)

    pivots = [
        SwingPoint(left_high.idx, left_high.date, left_high.price, "left_high"),
        SwingPoint(middle_low.idx, middle_low.date, middle_low.price, "neckline"),
        SwingPoint(right_high.idx, right_high.date, right_high.price, "right_high"),
    ]

    return _make_match(
        pattern_name="M頭",
        pattern_name_en="m_top",
        direction="short",
        pivots=pivots,
        neckline_price=neckline,
        neckline_date=middle_low.date,
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


# ── Pattern 3: 破底翻 (Failed Breakdown / Bull) ────────────────────────────


def detect_failed_breakdown(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """Failed Breakdown — price briefly breaks below a consolidation support,
    then quickly recaptures it (主力清洗浮筹).

    Conditions:
        - Sideways consolidation with clear support level (≥20 bars)
        - Brief penetration of support (≤5% below)
        - Recovery: price closes back above support within ≤5 bars
        - Volume on breakdown < volume on recovery (no real selling)
    """
    if len(ohlcv) < MIN_BARS:
        return None

    high = ohlcv["High"].astype(float).values
    low = ohlcv["Low"].astype(float).values
    close = ohlcv["Close"].astype(float).values
    vol = ohlcv["Volume"].astype(float).values
    n = len(ohlcv)

    # Look back 60 bars for consolidation
    window = 60
    look_low = low[-window:]
    look_high = high[-window:]
    look_close = close[-window:]

    # Define support as 20-bar rolling-min over the consolidation segment
    # Pick the most-touched level: take 10th percentile of lows in window
    support = float(np.percentile(look_low, 10))
    upper_edge = float(np.percentile(look_high, 90))

    # Need ≥20 bars where close stayed in [support, upper_edge] (consolidation)
    in_range = (look_close >= support * 0.98) & (look_close <= upper_edge * 1.02)
    if in_range.sum() < 20:
        return None

    # Breakdown: find a bar where low dipped below support by ≤5%
    breakdown_idx = None
    for i in range(n - 15, n):
        if low[i] < support * 0.98 and low[i] >= support * 0.93:
            breakdown_idx = i
            break
    if breakdown_idx is None:
        return None

    # Recovery: must close back above support within ≤5 bars
    recovery_idx = None
    for j in range(breakdown_idx, min(breakdown_idx + 6, n)):
        if close[j] > support:
            recovery_idx = j
            break
    if recovery_idx is None:
        return None
    if recovery_idx == n - 1:
        # latest bar is the recovery; entry on breakout of upper_edge
        pass

    # Volume check: breakdown vol vs recovery vol
    breakdown_vol = float(vol[breakdown_idx])
    recovery_vol = float(vol[recovery_idx])
    vol_clean = breakdown_vol < recovery_vol  # smart-money buying back

    # Entry = upper_edge (consolidation top); breakout above = trigger
    entry_price = upper_edge
    pattern_height = upper_edge - support
    if pattern_height / support < 0.05:
        return None

    target_1 = upper_edge + pattern_height
    target_2 = target_1 + pattern_height
    invalidation = support * 0.97

    # Did we already break upper_edge?
    break_idx = None
    for i in range(recovery_idx + 1, n):
        if close[i] > upper_edge:
            break_idx = i
            break

    score = 0.0
    # Breakdown depth quality (shallow = good)
    depth_pct = (support - low[breakdown_idx]) / support
    score += 25.0 * (1.0 - min(depth_pct / 0.05, 1.0))
    # Volume cleanliness
    if vol_clean:
        score += 25.0
    # Consolidation length
    score += 20.0 * min(in_range.sum() / 40.0, 1.0)
    # Recovery promptness
    score += 20.0 * (1.0 - (recovery_idx - breakdown_idx) / 5.0)
    # Trend position: prefer not at all-time-high
    if close[-1] < look_high.max() * 0.9:
        score += 10.0
    pattern_quality = min(score, 100.0)

    time_sym = 100.0 if abs(in_range.sum() - 30) <= 10 else 70.0

    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, upper_edge, "long", break_idx)

    breakdown_dt = ohlcv.index[breakdown_idx]
    recovery_dt = ohlcv.index[recovery_idx]
    upper_idx = int(np.argmax(look_high)) + (n - window)
    upper_dt = ohlcv.index[upper_idx]

    pivots = [
        SwingPoint(upper_idx, upper_dt, upper_edge, "upper_edge"),
        SwingPoint(breakdown_idx, breakdown_dt, float(low[breakdown_idx]), "breakdown_low"),
        SwingPoint(recovery_idx, recovery_dt, float(close[recovery_idx]), "recovery"),
    ]

    return _make_match(
        pattern_name="破底翻",
        pattern_name_en="failed_breakdown",
        direction="long",
        pivots=pivots,
        neckline_price=upper_edge,
        neckline_date=upper_dt,
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


# ── Pattern 4: 假突破 (Failed Breakout / Bear) ─────────────────────────────


def detect_failed_breakout(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """Failed Breakout — price briefly breaks above resistance then drops back.

    Mirror of failed_breakdown.
    """
    if len(ohlcv) < MIN_BARS:
        return None

    high = ohlcv["High"].astype(float).values
    low = ohlcv["Low"].astype(float).values
    close = ohlcv["Close"].astype(float).values
    vol = ohlcv["Volume"].astype(float).values
    n = len(ohlcv)

    window = 60
    look_low = low[-window:]
    look_high = high[-window:]
    look_close = close[-window:]

    resistance = float(np.percentile(look_high, 90))
    lower_edge = float(np.percentile(look_low, 10))

    in_range = (look_close >= lower_edge * 0.98) & (look_close <= resistance * 1.02)
    if in_range.sum() < 20:
        return None

    breakout_idx = None
    for i in range(n - 15, n):
        if high[i] > resistance * 1.02 and high[i] <= resistance * 1.07:
            breakout_idx = i
            break
    if breakout_idx is None:
        return None

    # Failure: close back below resistance within ≤5 bars
    failure_idx = None
    for j in range(breakout_idx, min(breakout_idx + 6, n)):
        if close[j] < resistance:
            failure_idx = j
            break
    if failure_idx is None:
        return None

    breakout_vol = float(vol[breakout_idx])
    failure_vol = float(vol[failure_idx])
    vol_clean = breakout_vol < failure_vol

    entry_price = lower_edge
    pattern_height = resistance - lower_edge
    if pattern_height / lower_edge < 0.05:
        return None

    target_1 = lower_edge - pattern_height
    target_2 = target_1 - pattern_height
    invalidation = resistance * 1.03

    break_idx = None
    for i in range(failure_idx + 1, n):
        if close[i] < lower_edge:
            break_idx = i
            break

    score = 0.0
    overshoot_pct = (high[breakout_idx] - resistance) / resistance
    score += 25.0 * (1.0 - min(overshoot_pct / 0.07, 1.0))
    if vol_clean:
        score += 25.0
    score += 20.0 * min(in_range.sum() / 40.0, 1.0)
    score += 20.0 * (1.0 - (failure_idx - breakout_idx) / 5.0)
    if close[-1] > look_low.min() * 1.1:
        score += 10.0
    pattern_quality = min(score, 100.0)

    time_sym = 100.0 if abs(in_range.sum() - 30) <= 10 else 70.0
    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, lower_edge, "short", break_idx)

    breakout_dt = ohlcv.index[breakout_idx]
    failure_dt = ohlcv.index[failure_idx]
    lower_idx = int(np.argmin(look_low)) + (n - window)
    lower_dt = ohlcv.index[lower_idx]

    pivots = [
        SwingPoint(lower_idx, lower_dt, lower_edge, "lower_edge"),
        SwingPoint(breakout_idx, breakout_dt, float(high[breakout_idx]), "breakout_high"),
        SwingPoint(failure_idx, failure_dt, float(close[failure_idx]), "failure"),
    ]

    return _make_match(
        pattern_name="假突破",
        pattern_name_en="failed_breakout",
        direction="short",
        pivots=pivots,
        neckline_price=lower_edge,
        neckline_date=lower_dt,
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


# ── Pattern 5: 破底翻 W 底 (W-bottom with Failed Breakdown) ────────────────


def detect_w_bottom_with_failed_breakdown(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """A combined pattern: W-bottom in which the right low briefly broke
    the left low (failed breakdown) and then reversed up.

    Higher conviction than vanilla W-bottom.
    """
    if len(ohlcv) < MIN_BARS:
        return None

    lows = find_swing_lows(ohlcv)
    highs = find_swing_highs(ohlcv)
    if len(lows) < 2 or len(highs) < 1:
        return None

    right_low = lows[-1]
    left_low = lows[-2]
    if right_low.idx - left_low.idx < 14:
        return None

    # Right low MUST be slightly below left low (failed breakdown signature)
    if right_low.price >= left_low.price:
        return None
    breakdown_pct = (left_low.price - right_low.price) / left_low.price
    if breakdown_pct > 0.05:
        return None  # too deep — not a "fake" breakdown

    middle_highs = [h for h in highs if left_low.idx < h.idx < right_low.idx]
    if not middle_highs:
        return None
    middle_high = max(middle_highs, key=lambda h: h.price)

    neckline = middle_high.price
    pattern_low = right_low.price
    pattern_height = neckline - pattern_low
    if pattern_height / pattern_low < 0.10:
        return None

    closes = ohlcv["Close"].astype(float).values
    break_idx = None
    for i in range(right_low.idx + 1, len(closes)):
        if closes[i] > neckline:
            break_idx = i
            break

    entry_price = neckline
    target_1 = neckline + pattern_height
    target_2 = target_1 + pattern_height
    invalidation = neckline * 0.97

    score = 70.0  # base bonus for compound pattern
    if breakdown_pct < 0.03:
        score += 15.0
    bottom_span_days = (right_low.date - left_low.date).days
    score += 15.0 * min(bottom_span_days / 30.0, 1.0)
    pattern_quality = min(score, 100.0)

    left_dur = middle_high.idx - left_low.idx
    right_dur = right_low.idx - middle_high.idx
    time_sym = time_symmetry_score(left_dur, right_dur)

    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, neckline, "long", break_idx)

    pivots = [
        SwingPoint(left_low.idx, left_low.date, left_low.price, "left_low"),
        SwingPoint(middle_high.idx, middle_high.date, middle_high.price, "neckline"),
        SwingPoint(right_low.idx, right_low.date, right_low.price, "right_low_failed_breakdown"),
    ]

    return _make_match(
        pattern_name="破底翻W底",
        pattern_name_en="w_bottom_with_failed_breakdown",
        direction="long",
        pivots=pivots,
        neckline_price=neckline,
        neckline_date=middle_high.date,
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


# ── Pattern 6 & 7: 頭肩底 / 頂 ──────────────────────────────────────────────


def _detect_hs_generic(
    ohlcv: pd.DataFrame, *, bullish: bool
) -> PatternMatch | None:
    """Generic head-and-shoulders detector. bullish=True → H&S bottom."""
    if len(ohlcv) < MIN_BARS:
        return None

    if bullish:
        pivots = find_swing_lows(ohlcv)
        opp = find_swing_highs(ohlcv)
        if len(pivots) < 3 or len(opp) < 2:
            return None
        # last 3 swing lows = left shoulder, head, right shoulder
        ls, head, rs = pivots[-3], pivots[-2], pivots[-1]
        if not (ls.price > head.price < rs.price):
            return None
        # head must be lower than both shoulders
        if head.price >= min(ls.price, rs.price):
            return None
    else:
        pivots = find_swing_highs(ohlcv)
        opp = find_swing_lows(ohlcv)
        if len(pivots) < 3 or len(opp) < 2:
            return None
        ls, head, rs = pivots[-3], pivots[-2], pivots[-1]
        if not (ls.price < head.price > rs.price):
            return None
        if head.price <= max(ls.price, rs.price):
            return None

    # Need ≥21 bars total
    if rs.idx - ls.idx < 21:
        return None
    # Shoulder symmetry: ±15%
    sh_diff = abs(rs.price - ls.price) / max(ls.price, 1e-9)
    if sh_diff > 0.15:
        return None
    # Head prominence: ≥5% beyond shoulder average
    sh_avg = (ls.price + rs.price) / 2.0
    head_prom = abs(head.price - sh_avg) / sh_avg
    if head_prom < 0.05:
        return None

    # Neckline = the two opposite-pivots between (ls→head) and (head→rs)
    nl_left = [p for p in opp if ls.idx < p.idx < head.idx]
    nl_right = [p for p in opp if head.idx < p.idx < rs.idx]
    if not nl_left or not nl_right:
        return None
    if bullish:
        # bottoms: necklines are on top → take highs
        nl_l = max(nl_left, key=lambda p: p.price)
        nl_r = max(nl_right, key=lambda p: p.price)
    else:
        nl_l = min(nl_left, key=lambda p: p.price)
        nl_r = min(nl_right, key=lambda p: p.price)

    # Neckline as average of two anchor pivots (works for sloped necklines too)
    neckline = (nl_l.price + nl_r.price) / 2.0

    head_to_neck = abs(neckline - head.price)
    if head_to_neck / max(head.price, 1e-9) < 0.05:
        return None

    closes = ohlcv["Close"].astype(float).values
    break_idx = None
    for i in range(rs.idx + 1, len(closes)):
        if bullish and closes[i] > neckline:
            break_idx = i
            break
        if not bullish and closes[i] < neckline:
            break_idx = i
            break

    entry_price = neckline
    if bullish:
        target_1 = neckline + head_to_neck
        target_2 = target_1 + head_to_neck
        invalidation = neckline * 0.97
        direction = "long"
    else:
        target_1 = neckline - head_to_neck
        target_2 = target_1 - head_to_neck
        invalidation = neckline * 1.03
        direction = "short"

    # Quality scoring
    score = 0.0
    score += 25.0 * (1.0 - min(sh_diff / 0.15, 1.0))      # shoulder symmetry
    score += 25.0 * min(head_prom / 0.10, 1.0)            # head prominence
    nl_diff_pct = abs(nl_r.price - nl_l.price) / max(nl_l.price, 1e-9)
    score += 25.0 * (1.0 - min(nl_diff_pct / 0.05, 1.0))  # neckline horizontality
    left_dur = head.idx - ls.idx
    right_dur = rs.idx - head.idx
    time_sym = time_symmetry_score(left_dur, right_dur)
    score += 15.0 * (time_sym / 100.0)
    # Volume diminishing: head_vol < ls_vol AND rs_vol < head_vol = bullish sign
    vol = ohlcv["Volume"].astype(float).values
    ls_vol = vol[max(ls.idx - 3, 0) : ls.idx + 1].mean()
    head_vol = vol[max(head.idx - 3, 0) : head.idx + 1].mean()
    rs_vol = vol[max(rs.idx - 3, 0) : rs.idx + 1].mean()
    if rs_vol < head_vol < ls_vol:
        score += 10.0
    pattern_quality = min(score, 100.0)

    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, neckline, direction, break_idx)

    pp = [
        SwingPoint(ls.idx, ls.date, ls.price, "left_shoulder"),
        SwingPoint(nl_l.idx, nl_l.date, nl_l.price, "neckline_left"),
        SwingPoint(head.idx, head.date, head.price, "head"),
        SwingPoint(nl_r.idx, nl_r.date, nl_r.price, "neckline_right"),
        SwingPoint(rs.idx, rs.date, rs.price, "right_shoulder"),
    ]

    return _make_match(
        pattern_name="頭肩底" if bullish else "頭肩頂",
        pattern_name_en="head_shoulders_bottom" if bullish else "head_shoulders_top",
        direction=direction,
        pivots=pp,
        neckline_price=neckline,
        neckline_date=nl_r.date,
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


def detect_head_shoulders_bottom(ohlcv: pd.DataFrame) -> PatternMatch | None:
    return _detect_hs_generic(ohlcv, bullish=True)


def detect_head_shoulders_top(ohlcv: pd.DataFrame) -> PatternMatch | None:
    return _detect_hs_generic(ohlcv, bullish=False)


# ── Pattern 8: 假突破（頭肩頂）H&S Top with Failed Breakout ─────────────────


def detect_failed_breakout_hs_top(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """H&S top where right shoulder briefly broke above left shoulder
    creating a failed-breakout signature, then collapsed.
    """
    base = _detect_hs_generic(ohlcv, bullish=False)
    if base is None:
        return None

    # Check that right shoulder briefly exceeded left shoulder
    pp = base.pivot_points
    ls = next((p for p in pp if p["role"] == "left_shoulder"), None)
    rs = next((p for p in pp if p["role"] == "right_shoulder"), None)
    if ls is None or rs is None:
        return None
    if rs["price"] <= ls["price"]:
        return None
    overshoot_pct = (rs["price"] - ls["price"]) / ls["price"]
    if overshoot_pct > 0.05:
        return None  # not a "fake" overshoot

    # Boost quality
    boosted = base.pattern_quality_score + 10.0
    base.pattern_name = "假突破頭肩頂"
    base.pattern_name_en = "failed_breakout_hs_top"
    base.pattern_quality_score = float(round(min(boosted, 100.0), 1))
    return base


# ── Pattern 9 & 10: 旗形 (Flag) ─────────────────────────────────────────────


def _detect_flag(ohlcv: pd.DataFrame, *, bullish: bool) -> PatternMatch | None:
    """Flag pattern: a sharp move ("pole") followed by a brief
    counter-trend consolidation ("flag"), then resumption.

    bullish=True → falling-flag (下傾旗形, after up-pole, expects continuation up).
    bullish=False → rising-flag (上攬旗形, after down-pole, expects continuation down).
    """
    if len(ohlcv) < MIN_BARS:
        return None

    high = ohlcv["High"].astype(float).values
    low = ohlcv["Low"].astype(float).values
    close = ohlcv["Close"].astype(float).values
    n = len(ohlcv)

    # Find the pole: a strong move within last 30-60 bars
    pole_lookback_max = 60
    pole_min_pct = 0.20  # ≥20% impulse move
    pole_lookback_min = 5

    best_pole = None  # (start_idx, end_idx, magnitude)
    for plen in range(pole_lookback_min, pole_lookback_max):
        for end in range(n - 25, n):
            start = end - plen
            if start < 0:
                break
            if bullish:
                magnitude = (close[end] - close[start]) / max(close[start], 1e-9)
                if magnitude >= pole_min_pct and (best_pole is None or magnitude > best_pole[2]):
                    best_pole = (start, end, magnitude)
            else:
                magnitude = (close[start] - close[end]) / max(close[start], 1e-9)
                if magnitude >= pole_min_pct and (best_pole is None or magnitude > best_pole[2]):
                    best_pole = (start, end, magnitude)
    if best_pole is None:
        return None

    pole_start, pole_end, pole_magnitude = best_pole

    # Flag: 5-20 bars consolidation after pole_end
    flag_start = pole_end + 1
    flag_end = n - 1
    flag_len = flag_end - flag_start
    if flag_len < 5 or flag_len > 25:
        return None

    flag_high = float(high[flag_start : flag_end + 1].max())
    flag_low = float(low[flag_start : flag_end + 1].min())
    flag_range = flag_high - flag_low

    # Flag must be small relative to pole (counter-trend retracement)
    pole_range = abs(close[pole_end] - close[pole_start])
    if flag_range > pole_range * 0.5:
        return None  # too wide; not a flag

    if bullish:
        entry_price = flag_high
        target_1 = flag_high + pole_range
        target_2 = target_1 + pole_range
        invalidation = flag_low * 0.98
        direction = "long"
    else:
        entry_price = flag_low
        target_1 = flag_low - pole_range
        target_2 = target_1 - pole_range
        invalidation = flag_high * 1.02
        direction = "short"

    closes_after_flag = close[flag_end:]  # only the latest bar
    break_idx = flag_end if (
        (bullish and close[-1] > flag_high) or (not bullish and close[-1] < flag_low)
    ) else None

    # Quality
    score = 0.0
    score += 25.0 * min(pole_magnitude / 0.30, 1.0)
    score += 25.0 * (1.0 - flag_range / max(pole_range, 1e-9))
    score += 20.0 * min(flag_len / 15.0, 1.0)
    # Volume contraction during flag
    vol = ohlcv["Volume"].astype(float).values
    pole_avg_vol = vol[pole_start : pole_end + 1].mean()
    flag_avg_vol = vol[flag_start : flag_end + 1].mean()
    if pole_avg_vol > 0 and flag_avg_vol < pole_avg_vol:
        score += 20.0
    score += 10.0  # default: assume slight counter-slope ok
    pattern_quality = min(score, 100.0)

    time_sym = 60.0  # flag has no inherent left/right symmetry
    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, entry_price, direction, break_idx)

    pp = [
        SwingPoint(pole_start, ohlcv.index[pole_start], float(close[pole_start]), "pole_start"),
        SwingPoint(pole_end, ohlcv.index[pole_end], float(close[pole_end]), "pole_end"),
        SwingPoint(flag_end, ohlcv.index[flag_end], float(close[flag_end]), "flag_end"),
    ]

    return _make_match(
        pattern_name="下傾旗形" if bullish else "上攬旗形",
        pattern_name_en="falling_flag" if bullish else "rising_flag",
        direction=direction,
        pivots=pp,
        neckline_price=entry_price,
        neckline_date=ohlcv.index[flag_end],
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


def detect_falling_flag(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """下傾旗形：上漲主升段後的下傾整理 (continuation pattern, long)."""
    return _detect_flag(ohlcv, bullish=True)


def detect_rising_flag(ohlcv: pd.DataFrame) -> PatternMatch | None:
    """上攬旗形：下跌主跌段後的上攬整理 (continuation pattern, short)."""
    return _detect_flag(ohlcv, bullish=False)


# ── Pattern 11 & 12: 收斂三角形 (Converging Triangle) ──────────────────────


def _detect_triangle(ohlcv: pd.DataFrame, *, bullish: bool) -> PatternMatch | None:
    """Converging triangle: highs declining, lows rising (or same level),
    forming a wedge. Breakout direction determines bullish/bearish.
    """
    if len(ohlcv) < MIN_BARS:
        return None

    highs = find_swing_highs(ohlcv)
    lows = find_swing_lows(ohlcv)
    if len(highs) < 2 or len(lows) < 2:
        return None

    # Require ≥2 swing highs declining + ≥2 swing lows rising in last 60 bars
    recent_window = 60
    n = len(ohlcv)
    cutoff = n - recent_window

    rh = [h for h in highs if h.idx >= cutoff]
    rl = [low for low in lows if low.idx >= cutoff]
    if len(rh) < 2 or len(rl) < 2:
        return None

    # Highs declining
    h_slope = (rh[-1].price - rh[0].price) / max(rh[-1].idx - rh[0].idx, 1)
    # Lows rising
    l_slope = (rl[-1].price - rl[0].price) / max(rl[-1].idx - rl[0].idx, 1)

    if not (h_slope < 0 and l_slope > 0):
        return None

    # Triangle longest leg = first high − first low (book formula)
    longest_leg = abs(rh[0].price - rl[0].price)
    if longest_leg / rh[0].price < 0.10:
        return None  # too small

    # Compute current upper / lower edges by extrapolating
    last_idx = n - 1
    upper_edge = rh[-1].price + h_slope * (last_idx - rh[-1].idx)
    lower_edge = rl[-1].price + l_slope * (last_idx - rl[-1].idx)

    # Bias: bullish = bottom triangle (we look for upside breakout);
    # bearish = top triangle (downside breakout)
    closes = ohlcv["Close"].astype(float).values
    break_idx = None
    if bullish:
        for i in range(rl[-1].idx + 1, n):
            extrapolated_upper = rh[-1].price + h_slope * (i - rh[-1].idx)
            if closes[i] > extrapolated_upper:
                break_idx = i
                break
        entry_price = upper_edge
        target_1 = upper_edge + longest_leg
        target_2 = target_1 + longest_leg
        invalidation = lower_edge
        direction = "long"
    else:
        for i in range(rh[-1].idx + 1, n):
            extrapolated_lower = rl[-1].price + l_slope * (i - rl[-1].idx)
            if closes[i] < extrapolated_lower:
                break_idx = i
                break
        entry_price = lower_edge
        target_1 = lower_edge - longest_leg
        target_2 = target_1 - longest_leg
        invalidation = upper_edge
        direction = "short"

    score = 0.0
    score += 30.0 * min((len(rh) + len(rl)) / 6.0, 1.0)  # ≥4 pivots → 30
    convergence = abs(h_slope) + abs(l_slope)
    score += 25.0 * min(convergence * 100.0, 1.0)        # decent angle
    span_days = (rh[-1].date - rh[0].date).days
    score += 20.0 * min(span_days / 30.0, 1.0)
    vol = ohlcv["Volume"].astype(float).values
    early_vol = vol[cutoff : cutoff + 20].mean() if cutoff + 20 < n else 0.0
    late_vol = vol[max(n - 20, 0) :].mean()
    if early_vol > 0 and late_vol < early_vol:
        score += 15.0
    # Position of breakout in triangle (1/2-3/4 zone)
    score += 10.0
    pattern_quality = min(score, 100.0)

    time_sym = 60.0  # triangles aren't strictly symmetric
    vol_conf = volume_at_breakout(ohlcv, break_idx) if break_idx else False
    status = _classify_status(ohlcv, entry_price, direction, break_idx)

    pp = [
        SwingPoint(rh[0].idx, rh[0].date, rh[0].price, "first_high"),
        SwingPoint(rl[0].idx, rl[0].date, rl[0].price, "first_low"),
        SwingPoint(rh[-1].idx, rh[-1].date, rh[-1].price, "last_high"),
        SwingPoint(rl[-1].idx, rl[-1].date, rl[-1].price, "last_low"),
    ]

    return _make_match(
        pattern_name="收斂三角形底部" if bullish else "收斂三角形頂部",
        pattern_name_en="converging_triangle_bottom" if bullish else "converging_triangle_top",
        direction=direction,
        pivots=pp,
        neckline_price=entry_price,
        neckline_date=ohlcv.index[last_idx],
        entry_price=entry_price,
        target_1=target_1,
        target_2=target_2,
        invalidation_price=invalidation,
        pattern_quality_score=pattern_quality,
        time_sym_score=time_sym,
        volume_conf=vol_conf,
        status=status,
    )


def detect_converging_triangle_bottom(ohlcv: pd.DataFrame) -> PatternMatch | None:
    return _detect_triangle(ohlcv, bullish=True)


def detect_converging_triangle_top(ohlcv: pd.DataFrame) -> PatternMatch | None:
    return _detect_triangle(ohlcv, bullish=False)


# ── Public detector registry ────────────────────────────────────────────────


ALL_DETECTORS = [
    detect_w_bottom,
    detect_m_top,
    detect_failed_breakdown,
    detect_failed_breakout,
    detect_w_bottom_with_failed_breakdown,
    detect_head_shoulders_bottom,
    detect_head_shoulders_top,
    detect_failed_breakout_hs_top,
    detect_falling_flag,
    detect_rising_flag,
    detect_converging_triangle_bottom,
    detect_converging_triangle_top,
]


PATTERN_NAME_MAP = {
    "w_bottom": "W底",
    "m_top": "M頭",
    "failed_breakdown": "破底翻",
    "failed_breakout": "假突破",
    "w_bottom_with_failed_breakdown": "破底翻W底",
    "head_shoulders_bottom": "頭肩底",
    "head_shoulders_top": "頭肩頂",
    "failed_breakout_hs_top": "假突破頭肩頂",
    "falling_flag": "下傾旗形",
    "rising_flag": "上攬旗形",
    "converging_triangle_bottom": "收斂三角形底部",
    "converging_triangle_top": "收斂三角形頂部",
}


def detect_all_patterns(
    ohlcv: pd.DataFrame, *, min_quality: float = 0.0
) -> list[PatternMatch]:
    """Run every detector and return all non-broken matches above threshold."""
    out: list[PatternMatch] = []
    for d in ALL_DETECTORS:
        try:
            m = d(ohlcv)
        except Exception:  # noqa: BLE001 — defensive
            continue
        if m is None:
            continue
        if m.status == "broken":
            continue
        if m.pattern_quality_score < min_quality:
            continue
        out.append(m)
    # Sort by quality desc
    out.sort(key=lambda x: x.pattern_quality_score, reverse=True)
    return out


def detect_best_pattern_for_direction(
    ohlcv: pd.DataFrame, direction: str, *, min_quality: float = 60.0
) -> PatternMatch | None:
    """Return the highest-quality pattern matching the given direction.

    Used by existing 4 strategies in Phase H-4 to inject measured-move targets.
    """
    matches = detect_all_patterns(ohlcv, min_quality=min_quality)
    matches = [m for m in matches if m.direction == direction]
    return matches[0] if matches else None
