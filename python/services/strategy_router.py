"""Strategy Router — orchestrates the 4 spec strategies.

Implements 规范第 6 节: regime → enabled strategy set.

Public API:
    scan_symbol(symbol, ohlcv) -> list[SignalCandidate]
        Run all eligible strategies for the given regime; return all candidates.
    scan_universe(symbols) -> dict[symbol, list[SignalCandidate]]
        Scan a list of symbols (Watchlist + holdings).

Note: this layer does NOT score or persist. That's signal_scorer.py + DB write
(Phase E and F). Router's job is dispatch.

Regime → Strategy mapping (规范 6 节):
    strong_uptrend          → trend_pullback_breakout (long), ema_squeeze_launch
    strong_downtrend        → trend_pullback_breakout (short), wyckoff_sweep (short)
    squeeze_breakout_setup  → ema_squeeze_launch
    ranging                 → bollinger_extreme_reversion, wyckoff_liquidity_sweep
    exhaustion_reversal     → wyckoff_liquidity_sweep
    elevated_event_risk     → none (only A-grade signals after scoring; gate later)
"""

from __future__ import annotations

import structlog
import pandas as pd

from services.pattern_detection import detect_best_pattern_for_direction
from services.regime_classifier import classify
from services.strategies.base import SignalCandidate, StrategyBase
from services.strategies.bollinger_extreme_reversion import (
    BollingerExtremeReversionStrategy,
)
from services.strategies.cai_sen_patterns import CaiSenPatternStrategy
from services.strategies.ema_squeeze_launch import EmaSqueezeLaunchStrategy
from services.strategies.trend_pullback_breakout import TrendPullbackBreakoutStrategy
from services.strategies.wyckoff_liquidity_sweep import WyckoffLiquiditySweepStrategy

logger = structlog.get_logger()


# ── Strategy instances (singletons) ──────────────────────────────────────────


_STRATEGIES: list[StrategyBase] = [
    TrendPullbackBreakoutStrategy(),
    WyckoffLiquiditySweepStrategy(),
    EmaSqueezeLaunchStrategy(),
    BollingerExtremeReversionStrategy(),
    CaiSenPatternStrategy(),  # Phase H — 蔡森 12 形态识别（含等幅满足计算）
]


def get_eligible_strategies(regime: str) -> list[StrategyBase]:
    """Return list of strategies whose eligible_regimes includes `regime`."""
    return [s for s in _STRATEGIES if regime in s.eligible_regimes]


# ── Scan functions ───────────────────────────────────────────────────────────


def scan_symbol(
    symbol: str,
    ohlcv: pd.DataFrame,
    *,
    regime_override: dict | None = None,
) -> list[SignalCandidate]:
    """Run all eligible strategies for a single symbol.

    Args:
        symbol: Ticker (already uppercased).
        ohlcv: OHLCV DataFrame (≥120 bars recommended).
        regime_override: Optional pre-computed regime dict. If None,
            classify() is called fresh.

    Returns:
        List of SignalCandidate (may be empty).
    """
    if regime_override is None:
        regime_result = classify(ohlcv)
        regime = regime_result.to_dict()
    else:
        regime = regime_override

    candidates: list[SignalCandidate] = []
    for strategy in get_eligible_strategies(regime["regime"]):
        try:
            cand = strategy.detect(symbol, ohlcv, regime)
            if cand is not None:
                # Phase H-4: enrich non-cai_sen candidates with measured-move
                # targets when a high-quality chart pattern matches direction.
                if strategy.name != "cai_sen_patterns":
                    _enrich_with_measured_move(cand, ohlcv)
                candidates.append(cand)
        except Exception as exc:
            logger.warning(
                "strategy_detect_failed",
                strategy=strategy.name,
                symbol=symbol,
                error=str(exc),
            )
    return candidates


def _enrich_with_measured_move(
    cand: SignalCandidate, ohlcv: pd.DataFrame, *, min_quality: float = 65.0
) -> None:
    """Phase H-4: if a high-quality Cai-Sen pattern matches this candidate's
    direction, override target_1/target_2 with the measured-move projection
    and tag the source. Mutates `cand` in place.

    No-op if no qualifying pattern is found.
    """
    try:
        pat = detect_best_pattern_for_direction(
            ohlcv, cand.direction, min_quality=min_quality
        )
    except Exception:  # noqa: BLE001 — defensive
        return
    if pat is None:
        return
    cand.target_1 = round(float(pat.target_1), 2)
    cand.target_2 = round(float(pat.target_2), 2) if pat.target_2 is not None else None
    if pat.pattern_name_en not in cand.pattern_tags:
        cand.pattern_tags.append(pat.pattern_name_en)
    cand.pattern_tags.append("measured_move")
    cand.raw_features = {
        **(cand.raw_features or {}),
        "measured_move_source": pat.pattern_name_en,
        "measured_move_pattern_name": pat.pattern_name,
        "measured_move_pct": pat.measured_move_pct,
        "measured_move_quality": pat.pattern_quality_score,
    }


def scan_universe(
    symbols_with_ohlcv: dict[str, pd.DataFrame],
) -> dict[str, list[SignalCandidate]]:
    """Run all strategies across a universe of symbols.

    Args:
        symbols_with_ohlcv: dict mapping symbol → its OHLCV DataFrame.
            Caller is responsible for fetching OHLCV.

    Returns:
        dict mapping symbol → list of SignalCandidate (may be empty).
    """
    results: dict[str, list[SignalCandidate]] = {}
    for symbol, ohlcv in symbols_with_ohlcv.items():
        try:
            results[symbol] = scan_symbol(symbol, ohlcv)
        except Exception as exc:
            logger.warning("scan_symbol_failed", symbol=symbol, error=str(exc))
            results[symbol] = []
    return results
