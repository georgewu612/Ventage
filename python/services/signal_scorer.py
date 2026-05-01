"""Signal Scorer — 6-dimension weighted aggregation + A/B/C grading.

实现规范第 16 节"最终信号总评分":

    市场状态评分：20  ← regime_score × strategy-fit weight
    价格结构评分：20  ← entry / stop placement quality + chip_zone position
    动量评分：    15  ← strategy-specific pattern strength
    成交量评分：  20  ← volume_engine.volume_score normalized
    筹码结构评分：15  ← chip_structure.chip_score normalized
    风报比评分：  10  ← (T1 - entry) / (entry - stop) ratio
    ─────────────
    总分：       100

    A 级 ≥80
    B 级 65-79
    C 级 <65

事件风险期：所有等级降一级（A→B, B→C, C→不显示）

Public API:
    score_candidate(candidate, regime) -> SignalCandidate (with score fields populated)
    score_all(candidates, regime) -> list[SignalCandidate]
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from services.strategies.base import SignalCandidate

Grade = Literal["A", "B", "C"]


# ── Regime → strategy fit weight (规范第 6 节) ────────────────────────────────

# Map (regime, strategy) → fit weight. 1.0 = primary fit, 0.7 = supporting,
# 0.5 = allowed-but-suboptimal. Strategies not listed for a regime are 0
# (filtered out by router anyway).
STRATEGY_FIT: dict[tuple[str, str], float] = {
    # strong_uptrend
    ("strong_uptrend", "trend_pullback_breakout"): 1.0,
    ("strong_uptrend", "ema_squeeze_launch"): 0.7,
    # strong_downtrend
    ("strong_downtrend", "trend_pullback_breakout"): 1.0,
    ("strong_downtrend", "wyckoff_liquidity_sweep"): 0.7,
    # squeeze_breakout_setup
    ("squeeze_breakout_setup", "ema_squeeze_launch"): 1.0,
    ("squeeze_breakout_setup", "trend_pullback_breakout"): 0.5,
    # ranging
    ("ranging", "bollinger_extreme_reversion"): 1.0,
    ("ranging", "wyckoff_liquidity_sweep"): 0.8,
    # exhaustion_reversal
    ("exhaustion_reversal", "wyckoff_liquidity_sweep"): 1.0,
    ("exhaustion_reversal", "bollinger_extreme_reversion"): 0.6,
}


# ── Per-dimension scoring (sub-scores) ───────────────────────────────────────


def _score_market(candidate: SignalCandidate, regime: dict) -> float:
    """Score the regime fit. Max 20."""
    regime_name = regime.get("regime", "")
    regime_score = float(regime.get("regime_score") or 0)  # 0-100
    fit = STRATEGY_FIT.get((regime_name, candidate.strategy_name), 0.0)
    # Base = (regime_score / 100) × fit × 20
    return round(regime_score / 100 * fit * 20, 1)


def _score_position(candidate: SignalCandidate) -> float:
    """Score entry placement quality + chip-zone position. Max 20."""
    # Two components: stop-to-entry distance reasonableness (10) + chip context (10)
    entry = candidate.entry_price
    stop = candidate.stop_price
    if entry <= 0:
        return 5.0
    risk_pct = abs(entry - stop) / entry * 100  # in percent

    # Risk distance: too tight (<1%) is fragile, too wide (>10%) is bad R/R.
    # Sweet spot: 2-5% gives 10/10. Outside that range, taper down.
    if 2.0 <= risk_pct <= 5.0:
        dist_score = 10.0
    elif 1.0 <= risk_pct < 2.0 or 5.0 < risk_pct <= 7.0:
        dist_score = 7.0
    elif 0.5 <= risk_pct < 1.0 or 7.0 < risk_pct <= 10.0:
        dist_score = 4.0
    else:
        dist_score = 2.0

    # Chip context: prefer entry inside or near key cost zone for longs
    chip = candidate.chip_analysis or {}
    pos = chip.get("cost_zone_position", "inside_cost_zone")
    direction = candidate.direction
    chip_score = 5.0  # neutral default

    if direction == "long":
        if pos == "above_cost_zone":
            chip_score = 9.0  # broke out — good for trend continuation
        elif pos == "at_lower_edge_of_cost_zone":
            chip_score = 10.0  # buying the dip — best
        elif pos == "inside_cost_zone":
            chip_score = 7.0
        elif pos == "at_upper_edge_of_cost_zone":
            chip_score = 6.0
        else:  # below_cost_zone — bad for long
            chip_score = 2.0
    else:  # short
        if pos == "below_cost_zone":
            chip_score = 9.0
        elif pos == "at_upper_edge_of_cost_zone":
            chip_score = 10.0
        elif pos == "inside_cost_zone":
            chip_score = 7.0
        else:
            chip_score = 3.0

    return round(dist_score + chip_score, 1)


def _score_pattern(candidate: SignalCandidate) -> float:
    """Score the strategy-specific pattern strength. Max 15.

    Each strategy interprets its raw_features differently to grade the
    pattern's textbook quality.
    """
    raw = candidate.raw_features or {}
    name = candidate.strategy_name

    if name == "trend_pullback_breakout":
        # Bigger impulse + shallower retrace = better flag pattern
        impulse = float(raw.get("impulse_pct") or 0)
        retrace = float(raw.get("pullback_retrace") or 1)
        body = float(raw.get("body_ratio") or 0)
        # Impulse component: 5%→3, 10%→6, 20%+→9
        impulse_score = min(9, impulse * 0.6)
        # Retrace: 30%→4, 50%→2, 60%+→1
        retrace_score = max(1, 5 - retrace * 6)
        # Body: 0.45→1, 0.7+→2
        body_score = min(2, max(0, (body - 0.4) * 7))
        return round(min(15, impulse_score + retrace_score + body_score), 1)

    if name == "wyckoff_liquidity_sweep":
        # Deeper pierce + bigger reversal candle + RV20 boost = stronger setup
        pierce = float(raw.get("pierce_pct") or 0)
        rv20 = float(raw.get("rv20") or 0)
        body = float(raw.get("body_ratio") or 0)
        shadow = float(
            raw.get("lower_shadow_ratio") or raw.get("upper_shadow_ratio") or 0
        )
        divergence_bonus = (
            2.0
            if (raw.get("has_bullish_divergence") or raw.get("has_bearish_divergence"))
            else 0.0
        )
        # pierce 0.3%→2, 0.8%→4, 1.5%+→6
        pierce_score = min(6, pierce * 4)
        # RV20 1.0→2, 1.5→4, 2.0+→5
        rv_score = min(5, max(2, (rv20 - 1) * 4))
        # Reversal candle (shadow) 0.4→1.5, 0.6+→2
        shadow_score = min(2, max(0, (shadow - 0.3) * 7))
        return round(
            min(15, pierce_score + rv_score + shadow_score + divergence_bonus), 1
        )

    if name == "ema_squeeze_launch":
        # Tighter avg squeeze + MACD cross + first-buy-not-second = strongest
        sqz = float(raw.get("avg_squeeze_pct") or 5)
        rv20 = float(raw.get("rv20") or 0)
        macd_x = bool(raw.get("macd_cross_up"))
        is_first = bool(raw.get("is_first_buy"))
        # tighter is better: 1.5%→6, 3%→4, 5%→2
        sqz_score = max(0, 6 - sqz)
        rv_score = min(5, max(0, (rv20 - 0.8) * 5))
        macd_bonus = 2 if macd_x else 0
        first_bonus = 2 if is_first else 1  # secondary still credible
        return round(min(15, sqz_score + rv_score + macd_bonus + first_bonus), 1)

    if name == "bollinger_extreme_reversion":
        # Double-confirmation (stoch + rsi) and BB not expanding = textbook
        rsi_v = float(raw.get("rsi") or 50)
        stoch_k = float(raw.get("stoch_k") or 50)
        body = float(raw.get("body_ratio") or 0)
        bbw_now = float(raw.get("bb_width_now") or 1)
        bbw_5 = float(raw.get("bb_width_5_ago") or 1)

        if candidate.direction == "long":
            rsi_score = max(0, min(5, (35 - rsi_v) / 35 * 5)) if rsi_v < 35 else 0
            stoch_score = max(0, min(4, (20 - stoch_k) / 20 * 4)) if stoch_k < 20 else 0
        else:
            rsi_score = max(0, min(5, (rsi_v - 65) / 35 * 5)) if rsi_v > 65 else 0
            stoch_score = (
                max(0, min(4, (stoch_k - 80) / 20 * 4)) if stoch_k > 80 else 0
            )

        body_score = min(3, body * 5)  # bigger body = stronger reversal candle
        # If bands are TIGHTENING that's even better (stable range)
        bbw_score = 3 if bbw_5 > 0 and bbw_now <= bbw_5 else 1
        return round(min(15, rsi_score + stoch_score + body_score + bbw_score), 1)

    return 7.5  # default mid-score for unknown strategies


def _score_volume(candidate: SignalCandidate) -> float:
    """Map volume_engine.volume_score (0-100) → 0-20."""
    v = candidate.volume_analysis or {}
    raw = float(v.get("volume_score") or 0)
    return round(raw / 100 * 20, 1)


def _score_chip(candidate: SignalCandidate) -> float:
    """Map chip_structure.chip_score (0-100) → 0-15."""
    c = candidate.chip_analysis or {}
    raw = float(c.get("chip_score") or 0)
    return round(raw / 100 * 15, 1)


def _score_rr(candidate: SignalCandidate) -> float:
    """Risk/reward ratio score using weighted T1+T2 (scale-out simulation).

    Assumes user exits 50% at T1 and 50% at T2 (规范第 10.3 节分批止盈模板).
    Effective reward = 0.5×(T1−entry) + 0.5×(T2−entry).
    Max 10.
    """
    entry = candidate.entry_price
    stop = candidate.stop_price
    t1 = candidate.target_1
    t2 = candidate.target_2

    if t1 is None or entry == stop:
        return 3.0

    if candidate.direction == "long":
        risk = entry - stop
        reward_t1 = t1 - entry
        reward_t2 = (t2 - entry) if t2 is not None else reward_t1
    else:
        risk = stop - entry
        reward_t1 = entry - t1
        reward_t2 = (entry - t2) if t2 is not None else reward_t1

    if risk <= 0:
        return 3.0

    blended_reward = 0.5 * reward_t1 + 0.5 * reward_t2
    rr = blended_reward / risk

    # Tightened bands: blended-RR is roughly average of T1 (≈1) and T2 (≈3),
    # so a clean strategy should hit 2.0+ easily.
    # 1.0 → 5 / 1.5 → 7 / 2.0 → 8 / 2.5 → 9 / 3.0+ → 10
    if rr >= 3.0:
        return 10.0
    if rr >= 2.5:
        return 9.0
    if rr >= 2.0:
        return 8.0
    if rr >= 1.5:
        return 7.0
    if rr >= 1.0:
        return 5.0
    return 2.0


# ── Grade boundaries ─────────────────────────────────────────────────────────


def _grade(total: float, event_risk: bool = False) -> Grade | None:
    """Map total score → A/B/C, or None if event-risk降级 drops it below C.

    Per spec: 事件风险期 → 全部降一级 (A→B, B→C, C→不显示).
    """
    if event_risk:
        # Shift thresholds up by 1 grade
        if total >= 90:
            return "A"
        if total >= 75:
            return "B"
        if total >= 60:
            return "C"
        return None
    # Normal
    if total >= 80:
        return "A"
    if total >= 65:
        return "B"
    if total >= 50:
        return "C"
    return None  # too weak to display


# ── Public API ───────────────────────────────────────────────────────────────


@dataclass
class ScoredSignal:
    """SignalCandidate + final scoring fields. Ready to be persisted to
    strategy_signals table or returned to the frontend."""

    candidate: SignalCandidate
    score_market: float
    score_position: float
    score_pattern: float
    score_volume: float
    score_chip: float
    score_rr: float
    score_total: float
    score_grade: Grade | None
    score_breakdown: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        out = self.candidate.to_dict()
        out.update(
            {
                "score_market": self.score_market,
                "score_position": self.score_position,
                "score_pattern": self.score_pattern,
                "score_volume": self.score_volume,
                "score_chip": self.score_chip,
                "score_rr": self.score_rr,
                "score_total": self.score_total,
                "score_grade": self.score_grade,
                "score_breakdown": self.score_breakdown,
            }
        )
        return out


def score_candidate(
    candidate: SignalCandidate,
    regime: dict,
    *,
    event_risk: bool = False,
) -> ScoredSignal:
    """Compute final 6-dimension score + grade for a candidate."""
    s_market = _score_market(candidate, regime)
    s_position = _score_position(candidate)
    s_pattern = _score_pattern(candidate)
    s_volume = _score_volume(candidate)
    s_chip = _score_chip(candidate)
    s_rr = _score_rr(candidate)

    total = round(s_market + s_position + s_pattern + s_volume + s_chip + s_rr, 1)
    grade = _grade(total, event_risk=event_risk)

    breakdown = {
        "market": {"score": s_market, "max": 20, "label": "市场状态"},
        "position": {"score": s_position, "max": 20, "label": "价格结构"},
        "pattern": {"score": s_pattern, "max": 15, "label": "形态质量"},
        "volume": {"score": s_volume, "max": 20, "label": "成交量"},
        "chip": {"score": s_chip, "max": 15, "label": "筹码结构"},
        "rr": {"score": s_rr, "max": 10, "label": "风报比"},
    }

    return ScoredSignal(
        candidate=candidate,
        score_market=s_market,
        score_position=s_position,
        score_pattern=s_pattern,
        score_volume=s_volume,
        score_chip=s_chip,
        score_rr=s_rr,
        score_total=total,
        score_grade=grade,
        score_breakdown=breakdown,
    )


def score_all(
    candidates: list[SignalCandidate],
    regime: dict,
    *,
    event_risk: bool = False,
    drop_unscored: bool = True,
) -> list[ScoredSignal]:
    """Score a list of candidates. By default drops candidates that can't
    earn at least a C grade (cleaner signal feed)."""
    scored = [score_candidate(c, regime, event_risk=event_risk) for c in candidates]
    if drop_unscored:
        scored = [s for s in scored if s.score_grade is not None]
    # Sort by total descending
    scored.sort(key=lambda s: s.score_total, reverse=True)
    return scored
