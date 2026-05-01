"""Volume Engine — 成交量引擎.

实现规范第 5 节"成交量引擎核心判断逻辑"，作为所有策略的全局过滤器、加分项、
降级项和风险提示项。

Public API:
    analyze_volume(ohlcv, context=None) -> VolumeAnalysis

Output fields are designed to map directly to strategy_signals table columns:
    volume_state, relative_volume_5/20, volume_pattern_tag, volume_warning,
    volume_score, volume_confirmed

The engine is purely descriptive — it does NOT decide whether a signal is
valid. Strategies consume the analysis and decide weighting themselves.

Implementation principles:
    - All booleans coerced to native Python `bool` (FastAPI JSON safety)
    - All floats rounded via safe_float
    - Pure functions, no global state
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal, TypedDict

import numpy as np
import pandas as pd

from services.indicators import safe_float

# ── Type definitions ──────────────────────────────────────────────────────────

VolumeState = Literal["very_low", "low", "normal", "elevated", "high", "climax"]


class VolumeContext(TypedDict, total=False):
    """Optional context the strategy passes in to enable context-specific tags.

    All fields are optional. If omitted, only general tags are emitted.
    """

    signal_type: Literal["breakout", "pullback", "sweep", "trend", "reversal"]
    regime: str  # e.g. 'strong_uptrend', 'ranging', etc.
    key_level: float  # the support/resistance/breakout level being tested
    direction: Literal["long", "short"]
    impulse_avg_volume: float  # avg volume of the prior impulse leg (策略 1)


# ── Result dataclass ──────────────────────────────────────────────────────────


@dataclass
class VolumeAnalysis:
    """Output of analyze_volume()."""

    volume_state: VolumeState
    relative_volume_5: float | None  # today's volume / 5-day avg
    relative_volume_20: float | None  # today's volume / 20-day avg
    price_volume_relation: str  # 'up_with_vol' / 'up_without_vol' / 'down_with_vol' / ...
    stage_rhythm_health: str  # 'healthy' / 'unhealthy' / 'unclear'
    breakout_quality: str | None  # 'high' / 'low' / None
    exhaustion_signal: str | None  # 'bullish_exhaustion' / 'bearish_exhaustion' / None
    pullback_quality: str | None  # 'healthy_pullback' / 'unhealthy_pullback' / None
    volume_pattern_tag: list[str]
    volume_warning: list[str]

    # Sub-scores (0-100 each)
    score_state: float
    score_rhythm: float
    score_breakout_pullback: float
    score_relation: float
    score_exhaustion_risk: float

    volume_score: float  # weighted total 0-100
    volume_confirmed: bool

    # Debug / explainability
    notes: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ── Tunable thresholds ────────────────────────────────────────────────────────

# Relative volume bands for volume_state classification
RV_VERY_LOW = 0.7
RV_LOW = 0.9
RV_NORMAL_HI = 1.2
RV_ELEVATED_HI = 1.5
RV_HIGH_HI = 2.0
# ≥ 2.0 → climax

# Body-to-range ratio considered "strong body"
STRONG_BODY = 0.6
# Upper-shadow as fraction of full range — >0.30 is "long upper shadow"
LONG_SHADOW = 0.30


# ── 1. Relative volume + state classification ─────────────────────────────────


def _relative_volume(volume: pd.Series, period: int) -> float | None:
    """today's volume / mean(last `period` excluding today)."""
    if volume is None or len(volume) < period + 1:
        return None
    today = float(volume.iloc[-1])
    avg = float(volume.iloc[-period - 1 : -1].mean())
    if avg <= 0:
        return None
    return round(today / avg, 4)


def _classify_volume_state(rv20: float | None) -> VolumeState:
    """Map relative volume (vs 20-day avg) to a categorical state."""
    if rv20 is None:
        return "normal"
    if rv20 < RV_VERY_LOW:
        return "very_low"
    if rv20 < RV_LOW:
        return "low"
    if rv20 < RV_NORMAL_HI:
        return "normal"
    if rv20 < RV_ELEVATED_HI:
        return "elevated"
    if rv20 < RV_HIGH_HI:
        return "high"
    return "climax"


# ── 2. Price-volume relation ─────────────────────────────────────────────────


def _price_volume_relation(
    close: pd.Series, volume: pd.Series, rv20: float | None
) -> tuple[str, list[str]]:
    """Identify one of the 6 spec relations + emit relevant tags."""
    if len(close) < 2 or rv20 is None:
        return "unclear", []
    today_close = float(close.iloc[-1])
    prev_close = float(close.iloc[-2])
    today_open = (
        float(close.iloc[-2])  # we don't have open, use prev close as proxy for now
        if len(close) >= 2
        else today_close
    )

    price_up = today_close > prev_close
    vol_up = rv20 > 1.2  # 1.2× is the "elevated" threshold

    tags: list[str] = []

    if price_up and vol_up:
        relation = "up_with_volume"
        tags.append("bullish_accumulation")
    elif price_up and not vol_up:
        relation = "up_without_volume"
    elif not price_up and not vol_up:
        relation = "down_without_volume"
    elif not price_up and vol_up:
        relation = "down_with_volume"
        tags.append("bearish_distribution")
    else:
        relation = "unclear"

    return relation, tags


def _detect_high_vol_no_progress(
    close: pd.Series,
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    rv20: float | None,
) -> str | None:
    """放量不涨 (distribution warning) / 放量跌不动 (absorption warning)."""
    if rv20 is None or rv20 < 1.5 or len(close) < 1:
        return None

    today_close = float(close.iloc[-1])
    today_open = float(open_.iloc[-1])
    today_high = float(high.iloc[-1])
    today_low = float(low.iloc[-1])
    full_range = today_high - today_low
    if full_range <= 0:
        return None

    body = abs(today_close - today_open)
    body_ratio = body / full_range
    upper_shadow = today_high - max(today_close, today_open)
    lower_shadow = min(today_close, today_open) - today_low
    upper_ratio = upper_shadow / full_range
    lower_ratio = lower_shadow / full_range

    # 放量不涨：放量但实体小 + 长上影
    if body_ratio < 0.4 and upper_ratio > 0.30 and today_close <= today_open * 1.005:
        return "high_vol_no_progress"

    # 放量跌不动：放量阴线但长下影 + 收盘接近开盘
    if (
        body_ratio < 0.4
        and lower_ratio > 0.30
        and abs(today_close - today_open) / today_open < 0.01
    ):
        return "high_vol_absorbed"

    return None


# ── 3. Stage volume rhythm ────────────────────────────────────────────────────


def _split_recent_into_segments(
    n: int, lookback: int = 30
) -> tuple[tuple[int, int], tuple[int, int], tuple[int, int]] | None:
    """Compute (start, end_exclusive) integer index ranges for impulse / consolidation / breakout.

    Heuristic:
      - breakout = last 3 bars
      - consolidation = bars from impulse_end → breakout_start
      - impulse = ~lookback/2 bars before consolidation
    """
    if n < lookback:
        return None
    breakout_start = n - 3
    impulse_end = breakout_start - max(5, lookback // 3)
    impulse_start = max(0, impulse_end - lookback // 2)

    if impulse_end <= impulse_start:
        return None
    return (
        (impulse_start, impulse_end),
        (impulse_end, breakout_start),
        (breakout_start, n),
    )


def _stage_rhythm(
    close: pd.Series, volume: pd.Series, rv20: float | None
) -> tuple[str, list[str], list[str]]:
    """Classify volume rhythm across impulse / consolidation / breakout segments.

    Returns (health, tags, warnings).
    Healthy bull: impulse-heavy → dryup → expand again at breakout
    Unhealthy: any of the异常 patterns from spec 5.3
    """
    n = len(close)
    segs = _split_recent_into_segments(n)
    if segs is None or len(volume) < 30:
        return "unclear", [], []

    (i_a, i_b), (c_a, c_b), (b_a, b_b) = segs
    if i_b <= i_a or c_b <= c_a or b_b <= b_a:
        return "unclear", [], []

    impulse_vol = float(volume.iloc[i_a:i_b].mean())
    cons_vol = float(volume.iloc[c_a:c_b].mean())
    breakout_vol = float(volume.iloc[b_a:b_b].mean())

    if impulse_vol <= 0:
        return "unclear", [], []

    # Compare ratios
    impulse_to_cons = cons_vol / impulse_vol  # < 1 means dryup (healthy)
    breakout_to_cons = breakout_vol / cons_vol if cons_vol > 0 else 0  # > 1 means expansion

    tags: list[str] = []
    warnings: list[str] = []

    healthy = (
        impulse_to_cons < 0.85  # consolidation dries up
        and breakout_to_cons > 1.2  # breakout expands
    )

    if healthy:
        return "healthy", ["healthy_trend_volume", "pullback_dryup"], []

    # ── Unhealthy patterns ────────────────────────────────────────────────
    if impulse_to_cons < 0.85 and breakout_to_cons < 1.0:
        # Consolidation dried up but no breakout volume
        warnings.append("breakout_without_volume")
        return "unhealthy", [], warnings
    if impulse_to_cons > 1.0:
        # Consolidation has MORE volume than impulse — bad sign
        warnings.append("consolidation_heavier_than_impulse")
        return "unhealthy", [], warnings

    return "unclear", [], []


# ── 4. Breakout quality ──────────────────────────────────────────────────────


def _breakout_quality(
    close: pd.Series,
    open_: pd.Series,
    high: pd.Series,
    low: pd.Series,
    volume: pd.Series,
    rv20: float | None,
    key_level: float | None,
) -> tuple[str | None, list[str], list[str]]:
    """Judge whether the latest bar is a high- or low-quality breakout.

    Requires `key_level` from context (e.g. resistance line) to evaluate.
    Returns (quality, tags, warnings).
    """
    if key_level is None or len(close) < 1 or rv20 is None:
        return None, [], []

    today_close = float(close.iloc[-1])
    today_open = float(open_.iloc[-1])
    today_high = float(high.iloc[-1])
    today_low = float(low.iloc[-1])
    full_range = today_high - today_low
    if full_range <= 0:
        return None, [], []

    body = abs(today_close - today_open)
    body_ratio = body / full_range
    upper_shadow = today_high - max(today_close, today_open)
    upper_ratio = upper_shadow / full_range

    closed_above = today_close > key_level
    intraday_above = today_high > key_level

    tags: list[str] = []
    warnings: list[str] = []

    if not closed_above:
        if intraday_above:
            warnings.append("intraday_breakout_failed_to_close")
        return "low", tags, warnings

    # Closed above key level → score quality
    if rv20 >= 1.3 and body_ratio >= STRONG_BODY and upper_ratio < LONG_SHADOW:
        tags.append("breakout_volume")
        return "high", tags, warnings

    # Closed above but quality issues
    if rv20 < 1.1:
        warnings.append("breakout_without_volume")
    if upper_ratio >= LONG_SHADOW:
        warnings.append("breakout_with_long_upper_shadow")
    if body_ratio < 0.4:
        warnings.append("weak_breakout")

    return "low" if warnings else "high", tags, warnings


# ── 5. Exhaustion detection ──────────────────────────────────────────────────


def _exhaustion(
    close: pd.Series,
    high: pd.Series,
    low: pd.Series,
    volume: pd.Series,
    rv20: float | None,
) -> tuple[str | None, list[str], list[str]]:
    """Detect bullish/bearish exhaustion patterns.

    Bullish exhaustion: high price + climax volume + price推进 stalls / long upper shadow
    Bearish exhaustion: low price + climax volume + price drop stalls / long lower shadow
    """
    if rv20 is None or rv20 < 1.5 or len(close) < 20:
        return None, [], []

    today_close = float(close.iloc[-1])
    today_high = float(high.iloc[-1])
    today_low = float(low.iloc[-1])
    full_range = today_high - today_low
    if full_range <= 0:
        return None, [], []

    upper_shadow = today_high - today_close
    lower_shadow = today_close - today_low
    upper_ratio = upper_shadow / full_range
    lower_ratio = lower_shadow / full_range

    # Where is today vs recent range?
    recent_high = float(high.iloc[-20:].max())
    recent_low = float(low.iloc[-20:].min())
    near_high = today_close >= recent_high * 0.97
    near_low = today_close <= recent_low * 1.03

    # Body shrinkage relative to recent: small body in climax volume = stalling
    today_body = abs(today_close - float(close.iloc[-2])) if len(close) >= 2 else 0
    avg_body = float((close.diff().abs().iloc[-20:]).mean())
    body_shrink = avg_body > 0 and today_body < avg_body * 0.7

    if near_high and (upper_ratio > LONG_SHADOW or body_shrink):
        return (
            "bullish_exhaustion",
            ["climactic_reversal"],
            ["expanding_volume_against_position"],
        )
    if near_low and (lower_ratio > LONG_SHADOW or body_shrink):
        return (
            "bearish_exhaustion",
            ["absorption_volume", "climactic_reversal"],
            [],
        )

    return None, [], []


# ── 6. Pullback quality ──────────────────────────────────────────────────────


def _pullback_quality(
    close: pd.Series,
    volume: pd.Series,
    context: VolumeContext | None,
) -> tuple[str | None, list[str], list[str]]:
    """Score recent pullback (3-7 bar shallow drop) volume health.

    Healthy pullback: dropping prices + declining volume + small bodies
    Unhealthy: dropping with INCREASING volume (distribution)
    """
    if context is None or context.get("signal_type") != "pullback" or len(close) < 10:
        return None, [], []

    # Look at last 5 bars assumed to be pullback
    pb_close = close.iloc[-5:]
    pb_vol = volume.iloc[-5:]
    if len(pb_close) < 5 or len(pb_vol) < 5:
        return None, [], []

    earlier_avg_vol = float(volume.iloc[-15:-5].mean()) if len(volume) >= 15 else None
    pb_avg_vol = float(pb_vol.mean())
    if earlier_avg_vol is None or earlier_avg_vol <= 0:
        return None, [], []

    vol_ratio = pb_avg_vol / earlier_avg_vol
    price_change = (
        float(pb_close.iloc[-1]) - float(pb_close.iloc[0])
    ) / float(pb_close.iloc[0])

    direction = context.get("direction", "long")
    is_dropping = price_change < 0 if direction == "long" else price_change > 0

    if is_dropping and vol_ratio < 0.85:
        return "healthy_pullback", ["pullback_dryup"], []

    if is_dropping and vol_ratio > 1.1:
        return "unhealthy_pullback", [], ["pullback_on_heavy_volume"]

    return None, [], []


# ── 7. Scoring formula ───────────────────────────────────────────────────────


def _score_state(volume_state: VolumeState, rv20: float | None) -> float:
    """Score volume state — full marks for elevated/high without being climactic."""
    if rv20 is None:
        return 7.0
    if volume_state == "elevated":
        return 15.0
    if volume_state == "high":
        return 13.0
    if volume_state == "normal":
        return 10.0
    if volume_state == "climax":
        return 8.0  # climax can be either reversal signal or unsustainable
    if volume_state == "low":
        return 6.0
    return 3.0  # very_low


def _score_rhythm(rhythm_health: str) -> float:
    if rhythm_health == "healthy":
        return 25.0
    if rhythm_health == "unhealthy":
        return 5.0
    return 12.0  # unclear


def _score_breakout_pullback(
    breakout_quality: str | None, pullback_quality: str | None
) -> float:
    if breakout_quality == "high":
        return 25.0
    if breakout_quality == "low":
        return 5.0
    if pullback_quality == "healthy_pullback":
        return 22.0
    if pullback_quality == "unhealthy_pullback":
        return 5.0
    return 12.0  # no breakout/pullback context


def _score_relation(relation: str) -> float:
    """20 pts max — healthy direction-volume agreement."""
    if relation in ("up_with_volume", "down_without_volume"):
        return 20.0  # bullish: up with vol confirms; down without vol = harmless
    if relation == "down_with_volume":
        return 6.0
    if relation == "up_without_volume":
        return 12.0
    return 10.0


def _score_exhaustion_risk(exhaustion_signal: str | None) -> float:
    """15 pts max. No exhaustion = full marks. Exhaustion present = penalty."""
    if exhaustion_signal == "bullish_exhaustion":
        return 3.0  # strong warning for longs
    if exhaustion_signal == "bearish_exhaustion":
        return 3.0  # strong warning for shorts
    return 15.0


# ── Public API ───────────────────────────────────────────────────────────────


def analyze_volume(
    ohlcv: pd.DataFrame,
    context: VolumeContext | None = None,
) -> VolumeAnalysis:
    """Full volume analysis for the latest bar of `ohlcv`.

    Args:
        ohlcv: DataFrame with columns Open, High, Low, Close, Volume. At least
            30 bars required for full rhythm analysis. Latest bar is the one
            being analyzed.
        context: Optional dict providing signal type / regime / key level so
            the engine can emit context-specific tags (breakout quality,
            pullback quality).

    Returns:
        VolumeAnalysis dataclass. All fields are JSON-serializable.
    """
    if ohlcv is None or ohlcv.empty:
        return _empty_result(reason="empty_ohlcv")

    required = ["Open", "High", "Low", "Close", "Volume"]
    if not all(c in ohlcv.columns for c in required):
        return _empty_result(reason="missing_ohlcv_columns")

    open_ = ohlcv["Open"].astype(float)
    high = ohlcv["High"].astype(float)
    low = ohlcv["Low"].astype(float)
    close = ohlcv["Close"].astype(float)
    volume = ohlcv["Volume"].astype(float)

    # ── 1. Volume state ────────────────────────────────────────────────────
    rv5 = _relative_volume(volume, 5)
    rv20 = _relative_volume(volume, 20)
    state = _classify_volume_state(rv20)

    # ── 2. Price-volume relation ───────────────────────────────────────────
    relation, relation_tags = _price_volume_relation(close, volume, rv20)
    no_progress = _detect_high_vol_no_progress(close, open_, high, low, rv20)

    # ── 3. Stage rhythm ────────────────────────────────────────────────────
    rhythm, rhythm_tags, rhythm_warnings = _stage_rhythm(close, volume, rv20)

    # ── 4. Breakout quality ────────────────────────────────────────────────
    key_level = context.get("key_level") if context else None
    breakout_q, breakout_tags, breakout_warnings = _breakout_quality(
        close, open_, high, low, volume, rv20, key_level
    )

    # ── 5. Exhaustion ──────────────────────────────────────────────────────
    exhaustion_sig, exhaustion_tags, exhaustion_warnings = _exhaustion(
        close, high, low, volume, rv20
    )

    # ── 6. Pullback quality ────────────────────────────────────────────────
    pullback_q, pullback_tags, pullback_warnings = _pullback_quality(
        close, volume, context
    )

    # ── Aggregate tags & warnings ──────────────────────────────────────────
    tags = (
        relation_tags
        + rhythm_tags
        + (breakout_tags or [])
        + (exhaustion_tags or [])
        + (pullback_tags or [])
    )
    warnings_list = (
        rhythm_warnings
        + (breakout_warnings or [])
        + (exhaustion_warnings or [])
        + (pullback_warnings or [])
    )
    if no_progress == "high_vol_no_progress":
        warnings_list.append("repeated_high_volume_stall")
        tags.append("bearish_distribution")
    elif no_progress == "high_vol_absorbed":
        tags.append("absorption_volume")

    # Deduplicate while preserving order
    tags = list(dict.fromkeys(tags))
    warnings_list = list(dict.fromkeys(warnings_list))

    # ── Scoring ────────────────────────────────────────────────────────────
    score_state = _score_state(state, rv20)
    score_rhythm = _score_rhythm(rhythm)
    score_bp = _score_breakout_pullback(breakout_q, pullback_q)
    score_rel = _score_relation(relation)
    score_exh = _score_exhaustion_risk(exhaustion_sig)
    total = score_state + score_rhythm + score_bp + score_rel + score_exh

    # volume_confirmed: total >= 65 AND no critical warning
    critical_warnings = {
        "breakout_without_volume",
        "breakout_with_long_upper_shadow",
        "weak_breakout",
        "pullback_on_heavy_volume",
        "expanding_volume_against_position",
    }
    has_critical = any(w in critical_warnings for w in warnings_list)
    confirmed = bool(total >= 65 and not has_critical)

    return VolumeAnalysis(
        volume_state=state,
        relative_volume_5=safe_float(rv5),
        relative_volume_20=safe_float(rv20),
        price_volume_relation=relation,
        stage_rhythm_health=rhythm,
        breakout_quality=breakout_q,
        exhaustion_signal=exhaustion_sig,
        pullback_quality=pullback_q,
        volume_pattern_tag=tags,
        volume_warning=warnings_list,
        score_state=round(score_state, 1),
        score_rhythm=round(score_rhythm, 1),
        score_breakout_pullback=round(score_bp, 1),
        score_relation=round(score_rel, 1),
        score_exhaustion_risk=round(score_exh, 1),
        volume_score=round(min(100.0, total), 1),
        volume_confirmed=confirmed,
        notes={
            "rv5": safe_float(rv5),
            "rv20": safe_float(rv20),
            "high_vol_no_progress": no_progress,
            "context_applied": dict(context) if context else None,
        },
    )


def _empty_result(reason: str) -> VolumeAnalysis:
    """Return a neutral VolumeAnalysis when input is invalid."""
    return VolumeAnalysis(
        volume_state="normal",
        relative_volume_5=None,
        relative_volume_20=None,
        price_volume_relation="unclear",
        stage_rhythm_health="unclear",
        breakout_quality=None,
        exhaustion_signal=None,
        pullback_quality=None,
        volume_pattern_tag=[],
        volume_warning=[],
        score_state=0.0,
        score_rhythm=0.0,
        score_breakout_pullback=0.0,
        score_relation=0.0,
        score_exhaustion_risk=0.0,
        volume_score=0.0,
        volume_confirmed=False,
        notes={"error": reason},
    )
