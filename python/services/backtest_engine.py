"""Abstract base class for backtest engines.

Design: one interface, multiple implementations.
- VectorbtEngine  → open-source vectorbt (current)
- LEANEngine      → QuantConnect LEAN (future, raises NotImplementedError)

Adding a new engine: subclass BacktestEngine, implement `run()`.
The API layer calls `get_engine(name)` — zero changes required there.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class EquityPoint:
    date: str     # ISO date string
    value: float  # portfolio value (starts at 1.0 = 100%)


@dataclass
class TradeRecord:
    entry_date: str
    exit_date: str | None
    side: str          # "long" | "short"
    entry_price: float
    exit_price: float | None
    quantity: float
    pnl: float
    pnl_pct: float


@dataclass
class BacktestResult:
    """Normalised output returned by every engine implementation."""

    total_return: float        # e.g. 0.35 = +35%
    annualized_return: float
    sharpe_ratio: float
    max_drawdown: float        # positive value, e.g. 0.15 = −15%
    win_rate: float            # 0-1
    total_trades: int
    profit_factor: float       # gross_profit / gross_loss (0 if no losses)
    equity_curve: list[EquityPoint] = field(default_factory=list)
    trades: list[TradeRecord] = field(default_factory=list)
    engine: str = "unknown"
    error: str | None = None


class BacktestEngine(ABC):
    """Abstract interface for all backtest engines."""

    @abstractmethod
    async def run(
        self,
        strategy_name: str,
        symbol: str,
        start_date: str,
        end_date: str,
        params: dict,
    ) -> BacktestResult:
        """Run a backtest and return normalised results.

        Args:
            strategy_name: Template key, e.g. "sma_crossover"
            symbol:        Stock ticker, e.g. "NVDA"
            start_date:    ISO date, e.g. "2022-01-01"
            end_date:      ISO date, e.g. "2024-12-31"
            params:        Strategy-specific parameters dict
        """
        ...


def get_engine(name: str = "vectorbt") -> BacktestEngine:
    """Factory — returns the requested engine implementation."""
    if name == "vectorbt":
        from services.vectorbt_engine import VectorbtEngine
        return VectorbtEngine()
    if name == "lean":
        from services.lean_engine import LEANEngine
        return LEANEngine()
    raise ValueError(f"Unknown backtest engine: {name!r}. Available: vectorbt, lean")
