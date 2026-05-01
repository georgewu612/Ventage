"""Trading System v2 — 4 specification strategies.

Each strategy implements StrategyBase and outputs SignalCandidate when its
preconditions are met. Strategies internally call:
    - indicators (ADX, EMA, BB, ATR, etc.)
    - volume_engine.analyze_volume()
    - chip_structure.analyze_chip_structure()

The candidates are then scored by signal_scorer.py (Phase E) into final
A/B/C-graded signals stored in strategy_signals table.

Strategy → primary regime mapping (per 规范第 6 节):
    trend_pullback_breakout    → strong_uptrend / strong_downtrend
    wyckoff_liquidity_sweep    → ranging / exhaustion_reversal
    ema_squeeze_launch         → squeeze_breakout_setup
    bollinger_extreme_reversion → ranging
"""

from services.strategies.base import (
    SignalCandidate,
    StrategyBase,
    StrategyName,
)

__all__ = ["SignalCandidate", "StrategyBase", "StrategyName"]
