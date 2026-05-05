"""Strategy interface — base class + signal data structure.

Every strategy inherits StrategyBase and implements detect(). The output
SignalCandidate is a flat dataclass that maps directly to columns in the
`strategy_signals` table (with scoring fields filled in by signal_scorer.py
in Phase E).

Design principles:
    - Strategies are stateless and pure (deterministic given OHLCV + regime).
    - Each strategy declares its eligible_regimes — the router uses this to
      decide whether to invoke detect() at all.
    - When detect() returns None, the strategy has no signal. When it returns
      a SignalCandidate, the candidate goes through scoring + persistence.
    - Strategies SHOULD call volume_engine and chip_structure internally to
      populate the corresponding analysis fields, so downstream scoring has
      everything it needs in one place.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from typing import Literal

import pandas as pd


StrategyName = Literal[
    "trend_pullback_breakout",
    "wyckoff_liquidity_sweep",
    "ema_squeeze_launch",
    "bollinger_extreme_reversion",
    "cai_sen_patterns",
]

Direction = Literal["long", "short"]


@dataclass
class SignalCandidate:
    """Output of a strategy's detect() method (pre-scoring).

    Maps to columns in `strategy_signals` table. After signal_scorer.py
    processes this candidate, the final score_total / score_grade fields
    are populated and the row is persisted.
    """

    # Identity
    strategy_name: StrategyName
    symbol: str
    direction: Direction
    market_regime: str             # the regime that gated this signal

    # Trade plan (规范 7.x)
    entry_price: float
    stop_price: float
    target_1: float | None
    target_2: float | None
    trailing_rule: str | None      # 'ema_13' / 'atr_2' / 'fixed' etc.
    invalidation_reason: str       # human-readable rule for monitoring
    secondary_entry: bool = False  # True if this is a 2nd-buy / re-entry pattern

    # Pattern tags emitted by the strategy itself
    pattern_tags: list[str] = field(default_factory=list)

    # Raw features for the scorer (each strategy populates differently)
    raw_features: dict = field(default_factory=dict)

    # Embedded analyses from the engines
    volume_analysis: dict | None = None  # VolumeAnalysis.to_dict() output
    chip_analysis: dict | None = None    # ChipAnalysis.to_dict() output

    # Debug / observability
    notes: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


class StrategyBase(ABC):
    """Abstract base class for all 4 spec strategies."""

    name: StrategyName
    eligible_regimes: list[str]  # Set in subclass

    @abstractmethod
    def detect(
        self,
        symbol: str,
        ohlcv: pd.DataFrame,
        regime: dict,
    ) -> SignalCandidate | None:
        """Detect a signal at the latest bar.

        Args:
            symbol: Ticker (already uppercased).
            ohlcv: DataFrame with columns Open/High/Low/Close/Volume.
                Latest bar = ohlcv.iloc[-1]. Strategies typically need
                ≥120 bars of history.
            regime: Output of regime_classifier.classify().to_dict().

        Returns:
            SignalCandidate if all preconditions match, else None.
        """
        raise NotImplementedError

    def is_eligible(self, regime: dict) -> bool:
        """Quick gate to skip strategies that don't match current regime."""
        return regime.get("regime") in self.eligible_regimes
