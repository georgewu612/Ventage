"""Chip Structure Engine — 筹码结构引擎.

实现规范第二部分（筹码结构 / Cost Basis Engine）。

不依赖单一平台的"筹码峰"图形，而是用**通用的 Volume Profile 抽象**：
    - 价格分桶 + 每根 K 线在高低范围内线性分配 volume
    - HVN（高成交节点）= 历史成本密集区 = 主成本区候选
    - LVN（低成交节点）= 真空区，突破方向无阻力

Public API:
    analyze_chip_structure(ohlcv, lookback=180) -> ChipAnalysis

Output fields map directly to strategy_signals 表的筹码列：
    cost_zone_position, overhead_supply_density, below_support_density,
    chip_concentration_score, chip_migration_direction,
    breakout_air_pocket_score, profile_tag, chip_warning, chip_score

回答的问题（规范第 9 节）：
    Q1: 当前价格附近是不是主成本区？           → cost_zone_position
    Q2: 上方套牢压力大不大？                   → overhead_supply_density
    Q3: 下方承接支撑强不强？                   → below_support_density
    Q4: 当前是不是筹码集中后的变盘区域？       → chip_concentration_score
    Q5: 突破后上方是重压区还是筹码真空区？     → breakout_air_pocket_score
    Q6: 主力成本是上移、下移还是横向整理？     → chip_migration_direction
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal

import numpy as np
import pandas as pd

from services.indicators import safe_float

# ── Type definitions ──────────────────────────────────────────────────────────

CostZonePosition = Literal[
    "below_cost_zone",
    "at_lower_edge_of_cost_zone",
    "inside_cost_zone",
    "at_upper_edge_of_cost_zone",
    "above_cost_zone",
]

DensityLevel = Literal["low", "medium", "high"]

MigrationDirection = Literal["rising", "falling", "flat"]


# ── Result dataclass ──────────────────────────────────────────────────────────


@dataclass
class ChipAnalysis:
    """Output of analyze_chip_structure()."""

    # Core 8 fields (per spec 11.x)
    cost_zone_position: CostZonePosition
    overhead_supply_density: DensityLevel
    below_support_density: DensityLevel
    chip_concentration_score: float          # 0-100
    chip_migration_direction: MigrationDirection
    breakout_air_pocket_score: float         # 0-100
    profile_tag: list[str]                    # tags
    chip_warning: list[str]                   # warnings

    # Sub-scores (used for chip_score 6-dim aggregation)
    score_position: float
    score_overhead: float
    score_support: float
    score_concentration: float
    score_migration: float
    score_air_pocket: float

    chip_score: float                         # weighted total 0-100

    # Reference data for visualization & debugging
    cost_zone_low: float | None
    cost_zone_high: float | None
    cost_zone_center: float | None
    poc_price: float | None                   # Point of Control = highest-volume bucket
    notes: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ── Tunable parameters ────────────────────────────────────────────────────────

DEFAULT_LOOKBACK = 180          # bars to build profile (~9 months daily)
DEFAULT_BUCKETS = 50            # price buckets
HVN_STD_MULT = 1.0              # HVN: bucket > mean + 1×std
LVN_STD_MULT = 0.5              # LVN: bucket < mean - 0.5×std
EDGE_TOLERANCE_PCT = 1.5        # ±1.5% considered "at edge of cost zone"
SUPPLY_SCAN_RANGE_PCT = 30.0    # scan upward 30% for overhead supply
SUPPORT_SCAN_RANGE_PCT = 30.0   # scan downward 30% for support
AIR_POCKET_SCAN_PCT = 15.0      # scan upward 15% for air pocket
DENSITY_LOW_PCT = 10.0
DENSITY_HIGH_PCT = 25.0
CONCENTRATION_TARGET_PCT = 80.0  # 80% of cumulative volume defines concentration
MIGRATION_TOLERANCE_PCT = 1.5    # < 1.5% drift = flat


# ── 1. Volume Profile ────────────────────────────────────────────────────────


def _build_volume_profile(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series,
    *,
    n_buckets: int = DEFAULT_BUCKETS,
    price_range: tuple[float, float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Build price-bucketed volume profile.

    For each bar, distribute volume linearly across the price buckets that
    overlap the [low, high] range of that bar (one-bar approximation common
    in volume profile literature; precise tick-level distribution requires
    intraday data we don't have).

    Args:
        high, low, close, volume: aligned pd.Series for the lookback window.
        n_buckets: number of price buckets.
        price_range: optional (min, max) override; defaults to (min low, max high).

    Returns:
        (bucket_centers, bucket_volumes) — both length n_buckets numpy arrays.
    """
    if len(high) == 0:
        return np.zeros(n_buckets), np.zeros(n_buckets)

    if price_range is None:
        p_min = float(low.min())
        p_max = float(high.max())
    else:
        p_min, p_max = price_range

    if p_max <= p_min:
        return np.zeros(n_buckets), np.zeros(n_buckets)

    edges = np.linspace(p_min, p_max, n_buckets + 1)
    centers = (edges[:-1] + edges[1:]) / 2
    bucket_size = (p_max - p_min) / n_buckets
    profile = np.zeros(n_buckets)

    h_arr = high.values.astype(float)
    l_arr = low.values.astype(float)
    v_arr = volume.values.astype(float)

    for i in range(len(h_arr)):
        bar_low = l_arr[i]
        bar_high = h_arr[i]
        bar_vol = v_arr[i]
        if np.isnan(bar_low) or np.isnan(bar_high) or np.isnan(bar_vol) or bar_vol <= 0:
            continue
        if bar_high <= bar_low:
            # Single price bar — concentrate in the bucket containing it
            idx = int(np.clip((bar_low - p_min) / bucket_size, 0, n_buckets - 1))
            profile[idx] += bar_vol
            continue

        # Find bucket indices the bar covers
        lo_idx = int(np.clip((bar_low - p_min) / bucket_size, 0, n_buckets - 1))
        hi_idx = int(np.clip((bar_high - p_min) / bucket_size, 0, n_buckets - 1))

        if lo_idx == hi_idx:
            profile[lo_idx] += bar_vol
        else:
            # Distribute proportionally across covered buckets
            n_covered = hi_idx - lo_idx + 1
            per_bucket = bar_vol / n_covered
            profile[lo_idx : hi_idx + 1] += per_bucket

    return centers, profile


# ── 2. HVN / LVN detection ───────────────────────────────────────────────────


def _identify_hvn_lvn(
    profile: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Identify High/Low Volume Nodes.

    HVN: bucket volume > mean + HVN_STD_MULT × std
    LVN: bucket volume < mean - LVN_STD_MULT × std

    Returns:
        (is_hvn, is_lvn) — boolean arrays of shape (n_buckets,).
    """
    if profile.size == 0 or profile.sum() == 0:
        return np.zeros_like(profile, dtype=bool), np.zeros_like(profile, dtype=bool)

    mean = float(profile.mean())
    std = float(profile.std())
    if std == 0:
        return np.zeros_like(profile, dtype=bool), np.zeros_like(profile, dtype=bool)

    is_hvn = profile > (mean + HVN_STD_MULT * std)
    is_lvn = profile < max(0.0, mean - LVN_STD_MULT * std)
    return is_hvn, is_lvn


def _largest_contiguous_hvn(
    centers: np.ndarray, is_hvn: np.ndarray, profile: np.ndarray
) -> tuple[float, float, float] | None:
    """Find the largest contiguous HVN cluster (= main cost zone).

    Returns:
        (low_price, high_price, total_volume) or None if no HVN.
    """
    if not is_hvn.any():
        return None

    best: tuple[int, int, float] | None = None
    cur_start: int | None = None
    cur_vol = 0.0

    for i, h in enumerate(is_hvn):
        if h:
            if cur_start is None:
                cur_start = i
                cur_vol = 0.0
            cur_vol += float(profile[i])
        else:
            if cur_start is not None:
                if best is None or cur_vol > best[2]:
                    best = (cur_start, i - 1, cur_vol)
                cur_start = None
                cur_vol = 0.0
    if cur_start is not None:
        if best is None or cur_vol > best[2]:
            best = (cur_start, len(is_hvn) - 1, cur_vol)

    if best is None:
        return None
    s, e, vol = best
    return float(centers[s]), float(centers[e]), vol


# ── 3. Cost zone position ────────────────────────────────────────────────────


def _classify_cost_zone_position(
    last_close: float,
    cost_low: float,
    cost_high: float,
) -> CostZonePosition:
    """Classify where the latest close sits relative to the main cost zone."""
    if last_close < cost_low * (1 - EDGE_TOLERANCE_PCT / 100):
        return "below_cost_zone"
    if last_close < cost_low * (1 + EDGE_TOLERANCE_PCT / 100):
        return "at_lower_edge_of_cost_zone"
    if last_close > cost_high * (1 + EDGE_TOLERANCE_PCT / 100):
        return "above_cost_zone"
    if last_close > cost_high * (1 - EDGE_TOLERANCE_PCT / 100):
        return "at_upper_edge_of_cost_zone"
    return "inside_cost_zone"


# ── 4. Overhead supply / Below support density ──────────────────────────────


def _density_in_range(
    centers: np.ndarray,
    is_hvn: np.ndarray,
    last_close: float,
    *,
    direction: str,  # 'up' or 'down'
    range_pct: float,
) -> tuple[DensityLevel, float]:
    """Compute density of HVN buckets within `range_pct` % of last_close.

    Returns (density_level, hvn_pct_in_range).
    """
    if direction == "up":
        lo = last_close
        hi = last_close * (1 + range_pct / 100)
    else:
        lo = last_close * (1 - range_pct / 100)
        hi = last_close

    # Buckets that fall inside [lo, hi]
    in_range = (centers >= lo) & (centers <= hi)
    n_in_range = int(in_range.sum())
    if n_in_range == 0:
        return "low", 0.0

    n_hvn_in_range = int((is_hvn & in_range).sum())
    pct = n_hvn_in_range / n_in_range * 100

    if pct < DENSITY_LOW_PCT:
        return "low", pct
    if pct < DENSITY_HIGH_PCT:
        return "medium", pct
    return "high", pct


# ── 5. Chip concentration ────────────────────────────────────────────────────


def _chip_concentration(profile: np.ndarray) -> float:
    """Score how concentrated the volume distribution is (0-100).

    Algorithm: find the smallest contiguous range of buckets that captures
    `CONCENTRATION_TARGET_PCT`% of cumulative volume. Fewer buckets = higher
    concentration = higher score.

    Uses a sliding-window minimum to find the tightest 80% range.
    """
    if profile.size == 0 or profile.sum() == 0:
        return 0.0

    n = len(profile)
    total = profile.sum()
    target = total * CONCENTRATION_TARGET_PCT / 100

    # Sliding window expand: find smallest window covering target volume
    best_window = n
    for i in range(n):
        cum = 0.0
        for j in range(i, n):
            cum += profile[j]
            if cum >= target:
                window = j - i + 1
                if window < best_window:
                    best_window = window
                break

    # Map window size to score: tight = high score
    # If 80% fits in 5 buckets out of 50 → very concentrated → ~95
    # If it takes 30 buckets → spread out → ~30
    # Use logarithmic / inverse mapping
    ratio = best_window / n  # 0..1
    # 100 when ratio approaches 0; 30 when ratio = 0.6
    score = max(0.0, 100 * (1 - ratio) ** 1.5)
    return min(100.0, score)


# ── 6. Cost migration direction ──────────────────────────────────────────────


def _cost_migration(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series,
) -> tuple[MigrationDirection, float | None, float | None]:
    """Compare main cost-zone center between earlier/later halves of lookback.

    Returns (direction, earlier_center, later_center).
    """
    n = len(close)
    if n < 60:
        return "flat", None, None

    mid = n // 2
    centers_a, profile_a = _build_volume_profile(
        high.iloc[:mid], low.iloc[:mid], close.iloc[:mid], volume.iloc[:mid]
    )
    centers_b, profile_b = _build_volume_profile(
        high.iloc[mid:], low.iloc[mid:], close.iloc[mid:], volume.iloc[mid:]
    )

    if profile_a.sum() == 0 or profile_b.sum() == 0:
        return "flat", None, None

    is_hvn_a, _ = _identify_hvn_lvn(profile_a)
    is_hvn_b, _ = _identify_hvn_lvn(profile_b)

    cz_a = _largest_contiguous_hvn(centers_a, is_hvn_a, profile_a)
    cz_b = _largest_contiguous_hvn(centers_b, is_hvn_b, profile_b)

    if cz_a is None or cz_b is None:
        return "flat", None, None

    center_a = (cz_a[0] + cz_a[1]) / 2
    center_b = (cz_b[0] + cz_b[1]) / 2

    drift_pct = (center_b - center_a) / center_a * 100 if center_a > 0 else 0
    if drift_pct > MIGRATION_TOLERANCE_PCT:
        return "rising", center_a, center_b
    if drift_pct < -MIGRATION_TOLERANCE_PCT:
        return "falling", center_a, center_b
    return "flat", center_a, center_b


# ── 7. Breakout air pocket ──────────────────────────────────────────────────


def _air_pocket_score(
    centers: np.ndarray,
    is_lvn: np.ndarray,
    last_close: float,
) -> float:
    """Score 'air pocket' above current price (0-100).

    More LVN buckets in [last_close, last_close × 1.15] = clearer path upward = higher score.
    """
    lo = last_close
    hi = last_close * (1 + AIR_POCKET_SCAN_PCT / 100)
    in_range = (centers >= lo) & (centers <= hi)
    n_in_range = int(in_range.sum())
    if n_in_range == 0:
        return 50.0  # no buckets in range — neutral

    n_lvn = int((is_lvn & in_range).sum())
    pct = n_lvn / n_in_range
    # Linear: 0% LVN → 0 score, 100% LVN → 100 score
    return min(100.0, pct * 100)


# ── 8. Tag generation ────────────────────────────────────────────────────────


def _generate_tags_and_warnings(
    position: CostZonePosition,
    overhead: DensityLevel,
    support: DensityLevel,
    migration: MigrationDirection,
    air_pocket_score: float,
    concentration: float,
    last_close: float,
    cost_low: float | None,
    cost_high: float | None,
) -> tuple[list[str], list[str]]:
    """Emit profile_tag and chip_warning lists per spec 11.7-11.8."""
    tags: list[str] = []
    warnings: list[str] = []

    # Tags based on position
    if position == "above_cost_zone":
        tags.append("breakout_into_air_pocket" if air_pocket_score > 60 else "above_cost_zone")
    if position == "inside_cost_zone":
        tags.append("inside_balance_area")
    if position == "at_upper_edge_of_cost_zone":
        tags.append("near_major_hvn")
    if position == "at_lower_edge_of_cost_zone":
        tags.append("retest_of_cost_zone")

    # Density tags
    if overhead == "high":
        tags.append("rejection_at_supply_zone" if position == "above_cost_zone" else "near_major_hvn")
        warnings.append("trapped_supply_overhead")
    if support == "high":
        tags.append("support_from_cost_cluster")

    # Migration tags
    if migration == "rising":
        tags.append("cost_zone_rising")

    # Concentration
    if concentration > 70:
        tags.append("chip_concentration_high")

    # Air pocket
    if air_pocket_score > 70:
        tags.append("breakout_into_air_pocket")
    elif air_pocket_score < 20 and position != "above_cost_zone":
        tags.append("breakout_into_heavy_supply")

    # Warnings
    if position == "above_cost_zone" and overhead == "low" and air_pocket_score < 30:
        warnings.append("breakout_into_heavy_supply")
    if support == "low" and position in ("at_lower_edge_of_cost_zone", "below_cost_zone"):
        warnings.append("weak_support_below")
    if position == "above_cost_zone" and cost_high:
        # Stretched check: 15% above cost zone top
        if last_close > cost_high * 1.15:
            warnings.append("stretched_far_from_cost_area")
    if cost_low is None or cost_high is None:
        warnings.append("no_clear_cost_support")

    # Deduplicate
    tags = list(dict.fromkeys(tags))
    warnings = list(dict.fromkeys(warnings))
    return tags, warnings


# ── 9. Scoring ───────────────────────────────────────────────────────────────


def _score_position(position: CostZonePosition) -> float:
    """Score 0-20 based on price position vs cost zone.

    Bullish-friendly:
      above_cost_zone with strong support → highest
      at_lower_edge → second highest (potential bounce)
      inside_cost_zone → neutral
      below_cost_zone → low
    """
    return {
        "above_cost_zone": 20.0,
        "at_upper_edge_of_cost_zone": 16.0,
        "inside_cost_zone": 12.0,
        "at_lower_edge_of_cost_zone": 14.0,
        "below_cost_zone": 6.0,
    }.get(position, 10.0)


def _score_overhead(overhead: DensityLevel) -> float:
    """Score 0-20: less overhead supply = higher score."""
    return {"low": 20.0, "medium": 12.0, "high": 5.0}.get(overhead, 10.0)


def _score_support(support: DensityLevel) -> float:
    """Score 0-20: more support density = higher score."""
    return {"low": 6.0, "medium": 13.0, "high": 20.0}.get(support, 10.0)


def _score_concentration_norm(concentration: float) -> float:
    """Normalize 0-100 raw concentration → 0-15 sub-score."""
    return min(15.0, concentration / 100 * 15)


def _score_migration(migration: MigrationDirection) -> float:
    """Score 0-15: rising > flat > falling."""
    return {"rising": 15.0, "flat": 9.0, "falling": 4.0}.get(migration, 9.0)


def _score_air_pocket_norm(air_pocket: float) -> float:
    """Normalize 0-100 raw air-pocket score → 0-10 sub-score."""
    return min(10.0, air_pocket / 100 * 10)


# ── Public API ──────────────────────────────────────────────────────────────


def analyze_chip_structure(
    ohlcv: pd.DataFrame,
    *,
    lookback: int = DEFAULT_LOOKBACK,
    n_buckets: int = DEFAULT_BUCKETS,
) -> ChipAnalysis:
    """Full chip structure analysis for the latest bar of `ohlcv`.

    Args:
        ohlcv: DataFrame with columns High, Low, Close, Volume. Needs
            ≥ `lookback` bars for proper profile.
        lookback: Number of bars to build the profile on (default 180 ≈ 9 mo).
        n_buckets: Number of price buckets (default 50).

    Returns:
        ChipAnalysis dataclass. All fields JSON-serializable.
    """
    if ohlcv is None or ohlcv.empty:
        return _empty_result(reason="empty_ohlcv")

    required = ["High", "Low", "Close", "Volume"]
    if not all(c in ohlcv.columns for c in required):
        return _empty_result(reason="missing_ohlcv_columns")

    n = len(ohlcv)
    if n < 30:
        return _empty_result(reason="insufficient_bars")

    # Use last `lookback` bars (or all if fewer)
    window = ohlcv.iloc[-lookback:] if n > lookback else ohlcv
    high = window["High"].astype(float)
    low = window["Low"].astype(float)
    close = window["Close"].astype(float)
    volume = window["Volume"].astype(float)

    last_close = float(close.iloc[-1])

    # ── 1. Build profile ──────────────────────────────────────────────────
    centers, profile = _build_volume_profile(
        high, low, close, volume, n_buckets=n_buckets
    )

    if profile.sum() == 0:
        return _empty_result(reason="zero_total_volume")

    # ── 2. HVN/LVN ────────────────────────────────────────────────────────
    is_hvn, is_lvn = _identify_hvn_lvn(profile)

    # POC = single highest-volume bucket
    poc_idx = int(np.argmax(profile))
    poc_price = float(centers[poc_idx])

    # Main cost zone = largest contiguous HVN cluster
    cz = _largest_contiguous_hvn(centers, is_hvn, profile)
    if cz is None:
        # Fallback: use ±5% around POC
        cz_low = poc_price * 0.95
        cz_high = poc_price * 1.05
        cz_volume = float(profile[poc_idx])
    else:
        cz_low, cz_high, cz_volume = cz

    cz_center = (cz_low + cz_high) / 2

    # ── 3. Position ────────────────────────────────────────────────────────
    position = _classify_cost_zone_position(last_close, cz_low, cz_high)

    # ── 4. Density ─────────────────────────────────────────────────────────
    overhead, overhead_pct = _density_in_range(
        centers, is_hvn, last_close, direction="up", range_pct=SUPPLY_SCAN_RANGE_PCT
    )
    support, support_pct = _density_in_range(
        centers, is_hvn, last_close, direction="down", range_pct=SUPPORT_SCAN_RANGE_PCT
    )

    # ── 5. Concentration ───────────────────────────────────────────────────
    concentration = _chip_concentration(profile)

    # ── 6. Migration ───────────────────────────────────────────────────────
    migration, mig_a, mig_b = _cost_migration(high, low, close, volume)

    # ── 7. Air pocket ──────────────────────────────────────────────────────
    air_pocket = _air_pocket_score(centers, is_lvn, last_close)

    # ── 8. Tags & warnings ─────────────────────────────────────────────────
    tags, warnings = _generate_tags_and_warnings(
        position, overhead, support, migration,
        air_pocket, concentration, last_close, cz_low, cz_high,
    )

    # ── 9. Scoring (6 dimensions, sum to 100) ──────────────────────────────
    score_pos = _score_position(position)
    score_oh = _score_overhead(overhead)
    score_sup = _score_support(support)
    score_conc = _score_concentration_norm(concentration)
    score_mig = _score_migration(migration)
    score_ap = _score_air_pocket_norm(air_pocket)
    total = score_pos + score_oh + score_sup + score_conc + score_mig + score_ap

    return ChipAnalysis(
        cost_zone_position=position,
        overhead_supply_density=overhead,
        below_support_density=support,
        chip_concentration_score=round(concentration, 1),
        chip_migration_direction=migration,
        breakout_air_pocket_score=round(air_pocket, 1),
        profile_tag=tags,
        chip_warning=warnings,
        score_position=round(score_pos, 1),
        score_overhead=round(score_oh, 1),
        score_support=round(score_sup, 1),
        score_concentration=round(score_conc, 1),
        score_migration=round(score_mig, 1),
        score_air_pocket=round(score_ap, 1),
        chip_score=round(min(100.0, total), 1),
        cost_zone_low=safe_float(cz_low),
        cost_zone_high=safe_float(cz_high),
        cost_zone_center=safe_float(cz_center),
        poc_price=safe_float(poc_price),
        notes={
            "lookback_bars": int(min(lookback, n)),
            "n_buckets": n_buckets,
            "n_hvn_buckets": int(is_hvn.sum()),
            "n_lvn_buckets": int(is_lvn.sum()),
            "overhead_pct_in_range": round(overhead_pct, 1),
            "support_pct_in_range": round(support_pct, 1),
            "earlier_cost_center": safe_float(mig_a),
            "later_cost_center": safe_float(mig_b),
        },
    )


def _empty_result(reason: str) -> ChipAnalysis:
    """Return a neutral ChipAnalysis when input is invalid."""
    return ChipAnalysis(
        cost_zone_position="inside_cost_zone",
        overhead_supply_density="medium",
        below_support_density="medium",
        chip_concentration_score=0.0,
        chip_migration_direction="flat",
        breakout_air_pocket_score=0.0,
        profile_tag=[],
        chip_warning=["no_clear_cost_support"],
        score_position=0.0,
        score_overhead=0.0,
        score_support=0.0,
        score_concentration=0.0,
        score_migration=0.0,
        score_air_pocket=0.0,
        chip_score=0.0,
        cost_zone_low=None,
        cost_zone_high=None,
        cost_zone_center=None,
        poc_price=None,
        notes={"error": reason},
    )
