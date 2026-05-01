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

from services.regime_classifier import classify
from services.strategies.base import SignalCandidate, StrategyBase
from services.strategies.bollinger_extreme_reversion import (
    BollingerExtremeReversionStrategy,
)
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
                candidates.append(cand)
        except Exception as exc:
            logger.warning(
                "strategy_detect_failed",
                strategy=strategy.name,
                symbol=symbol,
                error=str(exc),
            )
    return candidates


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
