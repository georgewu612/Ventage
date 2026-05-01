"""Signal Scorer — 6-dimension weighted aggregation + A/B/C grading.

实现规范第 16 节"最终信号总评分":

Phase G calibration (2026-05-01):
    Empirical analysis on 290 closed historical signals revealed:
      - score_position correlation = -0.172 (inverted, logic flawed)
      - score_pattern  correlation = -0.104 (inverted)
      - score_volume   correlation = -0.004 (noise)
      - score_rr       correlation = +0.009 (noise)
      - score_market   correlation = +0.091 (weak positive)
      - score_chip     correlation = +0.086 (weak positive)
    → Reduce inverted dims, boost positive ones, leave noisy ones small.

Updated weights (Phase G):

    市场状态评分：25  ← regime fit × regime_score
    价格结构评分：12  ← reduced from 20 (correlation was inverted)
    动量评分：     8  ← reduced from 15 (correlation was inverted)
    成交量评分：  18  ← slightly reduced from 20 (noise)
    筹码结构评分：22  ← boosted from 15 (positive correlator)
    风报比评分：  15  ← boosted from 10 (provides risk-aware ranking)
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
    """Score the regime fit. Max 25 (Phase G: weight increased from 20)."""
    regime_name = regime.get("regime", "")
    regime_score = float(regime.get("regime_score") or 0)  # 0-100
    fit = STRATEGY_FIT.get((regime_name, candidate.strategy_name), 0.0)
    return round(regime_score / 100 * fit * 25, 1)


def _score_position(candidate: SignalCandidate) -> float:
    """Score entry placement quality. Max 12 (Phase G: reduced from 20).

    Phase G: position-vs-cost-zone sub-logic was empirically inverted on
    historical data — removed it; only stop-distance reasonableness remains.
    Sub-logic can be revisited in a future calibration cycle.
    """
    entry = candidate.entry_price
    stop = candidate.stop_price
    if entry <= 0:
        return 6.0  # neutral

    risk_pct = abs(entry - stop) / entry * 100

    # Wider sweet spot than before — empirically anything from 1.5% to 7%
    # works similarly. Tight stops (<1%) and very wide stops (>10%) penalized.
    if 1.5 <= risk_pct <= 7.0:
        return 12.0
    if 1.0 <= risk_pct < 1.5 or 7.0 < risk_pct <= 9.0:
        return 9.0
    if 0.5 <= risk_pct < 1.0 or 9.0 < risk_pct <= 12.0:
        return 6.0
    return 3.0


def _score_pattern(candidate: SignalCandidate) -> float:
    """Score the strategy-specific pattern strength. Max 8 (Phase G: reduced from 15).

    Phase G: pattern correlation with outcome was -0.104 (mildly inverted).
    Reduced weight + simplified per-strategy scoring. Bollinger reversion's
    sub-logic is preserved since its features (RSI/Stoch) are properly
    correlated with outcomes.
    """
    raw = candidate.raw_features or {}
    name = candidate.strategy_name

    if name == "bollinger_extreme_reversion":
        # Bollinger pattern features ARE predictive — keep richer scoring.
        rsi_v = float(raw.get("rsi") or 50)
        stoch_k = float(raw.get("stoch_k") or 50)
        body = float(raw.get("body_ratio") or 0)

        if candidate.direction == "long":
            rsi_score = max(0, min(3, (35 - rsi_v) / 35 * 3)) if rsi_v < 35 else 0
            stoch_score = (
                max(0, min(2, (20 - stoch_k) / 20 * 2)) if stoch_k < 20 else 0
            )
        else:
            rsi_score = max(0, min(3, (rsi_v - 65) / 35 * 3)) if rsi_v > 65 else 0
            stoch_score = (
                max(0, min(2, (stoch_k - 80) / 20 * 2)) if stoch_k > 80 else 0
            )
        # Empirically, smaller bodies → better outcomes for reversal candles
        body_score = max(0, min(3, (0.6 - body) * 5))
        return round(min(8, rsi_score + stoch_score + body_score), 1)

    if name == "trend_pullback_breakout":
        impulse = float(raw.get("impulse_pct") or 0)
        retrace = float(raw.get("pullback_retrace") or 1)
        impulse_score = min(5, impulse * 0.4)
        retrace_score = max(0, 3 - retrace * 4)
        return round(min(8, impulse_score + retrace_score), 1)

    if name == "wyckoff_liquidity_sweep":
        # Phase G: pierce/body/shadow features showed weak/inverse correlation
        # with outcomes. Use minimal scoring — let market+chip+rr drive grading.
        rv20 = float(raw.get("rv20") or 0)
        divergence_bonus = (
            2.0
            if (raw.get("has_bullish_divergence") or raw.get("has_bearish_divergence"))
            else 0.0
        )
        rv_score = min(4, max(2, (rv20 - 1) * 3))
        return round(min(8, rv_score + divergence_bonus + 2), 1)

    if name == "ema_squeeze_launch":
        sqz = float(raw.get("avg_squeeze_pct") or 5)
        macd_x = bool(raw.get("macd_cross_up"))
        is_first = bool(raw.get("is_first_buy"))
        sqz_score = max(0, 4 - sqz * 0.7)
        macd_bonus = 1.5 if macd_x else 0
        first_bonus = 1.5 if is_first else 0.5
        return round(min(8, sqz_score + macd_bonus + first_bonus), 1)

    return 4.0  # default mid-score


def _score_volume(candidate: SignalCandidate) -> float:
    """Map volume_engine.volume_score (0-100) → 0-18 (Phase G: reduced from 20)."""
    v = candidate.volume_analysis or {}
    raw = float(v.get("volume_score") or 0)
    return round(raw / 100 * 18, 1)


def _score_chip(candidate: SignalCandidate) -> float:
    """Map chip_structure.chip_score (0-100) → 0-22 (Phase G: boosted from 15)."""
    c = candidate.chip_analysis or {}
    raw = float(c.get("chip_score") or 0)
    return round(raw / 100 * 22, 1)


def _score_rr(candidate: SignalCandidate) -> float:
    """Risk/reward ratio score (Phase G: max 15, was 10).

    Assumes user exits 50% at T1 and 50% at T2 (规范第 10.3 节分批止盈模板).
    """
    entry = candidate.entry_price
    stop = candidate.stop_price
    t1 = candidate.target_1
    t2 = candidate.target_2

    if t1 is None or entry == stop:
        return 4.0

    if candidate.direction == "long":
        risk = entry - stop
        reward_t1 = t1 - entry
        reward_t2 = (t2 - entry) if t2 is not None else reward_t1
    else:
        risk = stop - entry
        reward_t1 = entry - t1
        reward_t2 = (entry - t2) if t2 is not None else reward_t1

    if risk <= 0:
        return 4.0

    blended_reward = 0.5 * reward_t1 + 0.5 * reward_t2
    rr = blended_reward / risk

    if rr >= 3.0:
        return 15.0
    if rr >= 2.5:
        return 13.0
    if rr >= 2.0:
        return 11.0
    if rr >= 1.5:
        return 9.0
    if rr >= 1.0:
        return 6.0
    return 3.0


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
        "market": {"score": s_market, "max": 25, "label": "市场状态"},
        "position": {"score": s_position, "max": 12, "label": "价格结构"},
        "pattern": {"score": s_pattern, "max": 8, "label": "形态质量"},
        "volume": {"score": s_volume, "max": 18, "label": "成交量"},
        "chip": {"score": s_chip, "max": 22, "label": "筹码结构"},
        "rr": {"score": s_rr, "max": 15, "label": "风报比"},
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
