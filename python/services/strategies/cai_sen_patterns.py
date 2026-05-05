"""策略 5: 蔡森《多空轉折一手抓》12 形態識別 (Cai Sen Pattern Recognition).

依据：蔡森《多空轉折一手抓》（繁体版）。提供 12 個圖形識別 + 等幅滿足計算 +
量價驗證 + 時間波對稱。

Eligible regimes: ranging / exhaustion_reversal / squeeze_breakout_setup /
                   strong_uptrend / strong_downtrend (per book mapping)

Detection rules:
    - 调用 services.pattern_detection 中的 12 个 detector
    - 按 regime 选择优先 detector 子集
    - 取 quality_score 最高且 status 不为 'broken' 的形态

Output trade plan (蔡森公式):
    entry  = neckline 突破点
    stop   = entry × (1 ± 0.06)        # 5-7% 中位
    target_1 = 第一波等幅满足
    target_2 = 第二波等幅满足
    invalidation = 颈线返回站稳
"""

from __future__ import annotations

import pandas as pd

from services.chip_structure import analyze_chip_structure
from services.pattern_detection import (
    PatternMatch,
    detect_converging_triangle_bottom,
    detect_converging_triangle_top,
    detect_failed_breakdown,
    detect_failed_breakout,
    detect_failed_breakout_hs_top,
    detect_falling_flag,
    detect_head_shoulders_bottom,
    detect_head_shoulders_top,
    detect_m_top,
    detect_rising_flag,
    detect_w_bottom,
    detect_w_bottom_with_failed_breakdown,
)
from services.strategies.base import SignalCandidate, StrategyBase
from services.volume_engine import analyze_volume


# Regime → detector list (per Phase H plan §1)
PREFERRED_DETECTORS_BY_REGIME: dict[str, list] = {
    "ranging": [
        detect_w_bottom,
        detect_m_top,
        detect_converging_triangle_bottom,
        detect_converging_triangle_top,
    ],
    "exhaustion_reversal": [
        detect_failed_breakdown,
        detect_failed_breakout,
        detect_w_bottom_with_failed_breakdown,
        detect_head_shoulders_bottom,
        detect_head_shoulders_top,
        detect_failed_breakout_hs_top,
    ],
    "squeeze_breakout_setup": [
        detect_falling_flag,
        detect_rising_flag,
    ],
    "strong_uptrend": [detect_falling_flag],   # continuation 加倉訊號
    "strong_downtrend": [detect_rising_flag],  # continuation 加倉訊號
    "elevated_event_risk": [],                 # 事件期不出形态信号
}


class CaiSenPatternStrategy(StrategyBase):
    name = "cai_sen_patterns"
    eligible_regimes = [
        "ranging",
        "exhaustion_reversal",
        "squeeze_breakout_setup",
        "strong_uptrend",
        "strong_downtrend",
    ]

    # Tunables
    MIN_QUALITY_SCORE = 55.0    # below this → skip (low-quality pattern)

    def detect(
        self,
        symbol: str,
        ohlcv: pd.DataFrame,
        regime: dict,
    ) -> SignalCandidate | None:
        if not self.is_eligible(regime):
            return None
        if len(ohlcv) < 60:
            return None

        regime_key = regime.get("regime") or ""
        detectors = PREFERRED_DETECTORS_BY_REGIME.get(regime_key, [])
        if not detectors:
            return None

        # Run all preferred detectors; take highest-quality non-broken match
        best: PatternMatch | None = None
        all_matches: list[PatternMatch] = []
        for d in detectors:
            try:
                m = d(ohlcv)
            except Exception:  # noqa: BLE001 — defensive
                continue
            if m is None or m.status == "broken":
                continue
            if m.pattern_quality_score < self.MIN_QUALITY_SCORE:
                continue
            all_matches.append(m)
            if best is None or m.pattern_quality_score > best.pattern_quality_score:
                best = m

        if best is None:
            return None

        # Run shared engines for downstream scoring
        try:
            vol_analysis = analyze_volume(ohlcv).to_dict()
        except Exception:  # noqa: BLE001
            vol_analysis = None
        try:
            chip_analysis = analyze_chip_structure(ohlcv).to_dict()
        except Exception:  # noqa: BLE001
            chip_analysis = None

        # Pattern tags: include all detected patterns + measured_move marker
        pattern_tags = [m.pattern_name_en for m in all_matches]
        if "measured_move" not in pattern_tags:
            pattern_tags.append("measured_move")

        return SignalCandidate(
            strategy_name="cai_sen_patterns",
            symbol=symbol,
            direction=best.direction,
            market_regime=regime_key,
            entry_price=best.entry_price,
            stop_price=best.stop_price,
            target_1=best.target_1,
            target_2=best.target_2,
            trailing_rule="neckline_retest_break",
            invalidation_reason=(
                f"price returns through neckline at {best.invalidation_price:.2f}"
            ),
            secondary_entry=False,
            pattern_tags=pattern_tags,
            raw_features={
                "pattern_name_en": best.pattern_name_en,
                "pattern_name": best.pattern_name,
                "pattern_quality": best.pattern_quality_score,
                "time_symmetry": best.time_symmetry_score,
                "volume_confirmed": best.volume_confirmation,
                "measured_move_pct": best.measured_move_pct,
                "measured_move_source": best.pattern_name_en,
                "neckline_price": best.neckline_price,
                "invalidation_price": best.invalidation_price,
                "status": best.status,
                "all_matches": [
                    {"name": m.pattern_name_en, "quality": m.pattern_quality_score}
                    for m in all_matches
                ],
            },
            volume_analysis=vol_analysis,
            chip_analysis=chip_analysis,
            notes={"book": "蔡森《多空轉折一手抓》"},
        )
