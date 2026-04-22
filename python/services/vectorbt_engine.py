"""vectorbt backtest engine implementation.

Wraps the open-source vectorbt library.
Falls back gracefully if vectorbt is not installed (returns an error result).

Supported strategies:
  - sma_crossover      — SMA fast/slow crossover
  - rsi_mean_reversion — RSI oversold/overbought
  - bollinger_band     — Bollinger Band breakout
  - macd_signal        — MACD line / signal line crossover
"""

from __future__ import annotations

import math
from datetime import UTC, datetime

import numpy as np
import pandas as pd
import structlog
import yfinance as yf

from services.backtest_engine import BacktestEngine, BacktestResult, EquityPoint, TradeRecord

logger = structlog.get_logger()

# ── helpers ───────────────────────────────────────────────────────────────────


def _safe(v: float) -> float:
    """Replace NaN/inf with 0.0 for JSON-safe output."""
    if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        return 0.0
    return float(v)


def _download_prices(symbol: str, start: str, end: str) -> pd.Series:
    """Download adjusted close prices via yfinance."""
    df = yf.download(symbol, start=start, end=end, auto_adjust=True, progress=False)
    if df is None or df.empty:
        raise ValueError(f"No price data returned for {symbol} ({start}→{end})")
    close = df["Close"]
    # yfinance may return a DataFrame with a MultiIndex when auto_adjust=True
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    return close.dropna()


def _equity_curve_from_portfolio(portfolio) -> list[EquityPoint]:
    """Convert vectorbt Portfolio equity curve to JSON-serialisable list."""
    value = portfolio.value()
    initial = float(value.iloc[0]) if not value.empty else 1.0
    points: list[EquityPoint] = []
    for dt, v in value.items():
        date_str = pd.Timestamp(dt).strftime("%Y-%m-%d")
        points.append(EquityPoint(date=date_str, value=_safe(float(v) / initial)))
    return points


def _trades_from_portfolio(portfolio) -> list[TradeRecord]:
    """Extract closed trades from vectorbt Portfolio."""
    try:
        trades = portfolio.trades.records_readable
    except Exception:
        return []

    result: list[TradeRecord] = []
    for _, row in trades.iterrows():
        try:
            entry_price = _safe(float(row.get("Entry Price", 0) or 0))
            exit_price = _safe(float(row.get("Exit Price", 0) or 0))
            size = _safe(float(row.get("Size", 1) or 1))
            pnl = _safe(float(row.get("PnL", 0) or 0))
            pnl_pct = _safe(float(row.get("Return", 0) or 0))
            entry_idx = row.get("Entry Index", row.get("Entry Timestamp"))
            exit_idx = row.get("Exit Index", row.get("Exit Timestamp"))

            entry_date = str(entry_idx)[:10] if entry_idx is not None else ""
            exit_date = str(exit_idx)[:10] if exit_idx is not None else None

            result.append(TradeRecord(
                entry_date=entry_date,
                exit_date=exit_date,
                side="long",
                entry_price=entry_price,
                exit_price=exit_price,
                quantity=size,
                pnl=pnl,
                pnl_pct=pnl_pct,
            ))
        except Exception:
            continue

    return result


def _metrics(portfolio) -> dict:
    """Extract key performance metrics from vectorbt Portfolio."""
    try:
        stats = portfolio.stats()
        total_return = _safe(float(stats.get("Total Return [%]", 0)) / 100)
        sharpe = _safe(float(stats.get("Sharpe Ratio", 0)))
        max_dd = _safe(abs(float(stats.get("Max Drawdown [%]", 0))) / 100)
        win_rate = _safe(float(stats.get("Win Rate [%]", 0)) / 100)
        total_trades = int(stats.get("Total Trades", 0) or 0)

        # Annualised return
        start = portfolio.wrapper.index[0]
        end = portfolio.wrapper.index[-1]
        years = max((end - start).days / 365.25, 0.01)
        ann_return = _safe((1 + total_return) ** (1 / years) - 1)

        # Profit factor
        try:
            trades_df = portfolio.trades.records_readable
            profits = trades_df[trades_df["PnL"] > 0]["PnL"].sum()
            losses = abs(trades_df[trades_df["PnL"] < 0]["PnL"].sum())
            profit_factor = _safe(profits / losses) if losses > 0 else 0.0
        except Exception:
            profit_factor = 0.0

        return {
            "total_return": total_return,
            "annualized_return": ann_return,
            "sharpe_ratio": sharpe,
            "max_drawdown": max_dd,
            "win_rate": win_rate,
            "total_trades": total_trades,
            "profit_factor": profit_factor,
        }
    except Exception as exc:
        logger.warning("metrics_extraction_failed", error=str(exc))
        return {
            "total_return": 0.0,
            "annualized_return": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
            "total_trades": 0,
            "profit_factor": 0.0,
        }


# ── Strategy signal generators ────────────────────────────────────────────────


def _signals_sma_crossover(close: pd.Series, params: dict):
    fast = int(params.get("fast_period", 10))
    slow = int(params.get("slow_period", 30))
    fast_ma = close.rolling(fast).mean()
    slow_ma = close.rolling(slow).mean()
    entries = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
    exits = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))
    return entries, exits


def _signals_rsi_mean_reversion(close: pd.Series, params: dict):
    period = int(params.get("rsi_period", 14))
    oversold = float(params.get("oversold", 30))
    overbought = float(params.get("overbought", 70))

    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)

    entries = rsi < oversold
    exits = rsi > overbought
    return entries, exits


def _signals_bollinger_band(close: pd.Series, params: dict):
    period = int(params.get("period", 20))
    std_dev = float(params.get("std_dev", 2.0))

    mid = close.rolling(period).mean()
    std = close.rolling(period).std()
    upper = mid + std_dev * std
    lower = mid - std_dev * std

    entries = close < lower
    exits = close > upper
    return entries, exits


def _signals_macd(close: pd.Series, params: dict):
    fast = int(params.get("fast_period", 12))
    slow = int(params.get("slow_period", 26))
    signal_p = int(params.get("signal_period", 9))

    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd = ema_fast - ema_slow
    signal = macd.ewm(span=signal_p, adjust=False).mean()

    entries = (macd > signal) & (macd.shift(1) <= signal.shift(1))
    exits = (macd < signal) & (macd.shift(1) >= signal.shift(1))
    return entries, exits


_SIGNAL_MAP = {
    "sma_crossover": _signals_sma_crossover,
    "rsi_mean_reversion": _signals_rsi_mean_reversion,
    "bollinger_band": _signals_bollinger_band,
    "macd_signal": _signals_macd,
}


# ── Engine ────────────────────────────────────────────────────────────────────


class VectorbtEngine(BacktestEngine):
    """vectorbt-backed backtest engine."""

    async def run(
        self,
        strategy_name: str,
        symbol: str,
        start_date: str,
        end_date: str,
        params: dict,
    ) -> BacktestResult:
        log = logger.bind(strategy=strategy_name, symbol=symbol)

        try:
            import vectorbt as vbt  # noqa: F401
        except ImportError:
            log.error("vectorbt_not_installed")
            return BacktestResult(
                total_return=0, annualized_return=0, sharpe_ratio=0,
                max_drawdown=0, win_rate=0, total_trades=0, profit_factor=0,
                engine="vectorbt",
                error="vectorbt not installed. Run: pip install vectorbt",
            )

        signal_fn = _SIGNAL_MAP.get(strategy_name)
        if not signal_fn:
            return BacktestResult(
                total_return=0, annualized_return=0, sharpe_ratio=0,
                max_drawdown=0, win_rate=0, total_trades=0, profit_factor=0,
                engine="vectorbt",
                error=f"Unknown strategy: {strategy_name!r}",
            )

        try:
            log.info("backtest_start")
            close = _download_prices(symbol, start_date, end_date)

            entries, exits = signal_fn(close, params)

            # Align booleans to close index
            entries = entries.reindex(close.index, fill_value=False)
            exits = exits.reindex(close.index, fill_value=False)

            import vectorbt as vbt
            portfolio = vbt.Portfolio.from_signals(
                close,
                entries=entries,
                exits=exits,
                init_cash=10_000,
                fees=0.001,   # 0.1% per trade
                freq="D",
            )

            m = _metrics(portfolio)
            equity = _equity_curve_from_portfolio(portfolio)
            trades = _trades_from_portfolio(portfolio)

            log.info("backtest_done", total_return=m["total_return"], trades=m["total_trades"])

            return BacktestResult(
                **m,
                equity_curve=equity,
                trades=trades,
                engine="vectorbt",
            )

        except Exception as exc:
            log.error("backtest_failed", error=str(exc))
            return BacktestResult(
                total_return=0, annualized_return=0, sharpe_ratio=0,
                max_drawdown=0, win_rate=0, total_trades=0, profit_factor=0,
                engine="vectorbt",
                error=str(exc),
            )
