"""LEAN (QuantConnect) engine — reserved for future implementation."""

from __future__ import annotations

from services.backtest_engine import BacktestEngine, BacktestResult


class LEANEngine(BacktestEngine):
    """Placeholder: QuantConnect LEAN engine (not yet implemented)."""

    async def run(
        self,
        strategy_name: str,
        symbol: str,
        start_date: str,
        end_date: str,
        params: dict,
    ) -> BacktestResult:
        raise NotImplementedError(
            "LEAN engine is not yet implemented. Use 'vectorbt' engine instead."
        )
