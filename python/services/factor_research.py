"""Factor Research — academic-grade factor analysis.

Implements three core methods from《因子投资：方法与实践》:
    1. cross_section_sort()       — Chapter 2.1 portfolio-sort method
    2. fama_macbeth_regression()  — Chapter 2.2 + 2.4 with Newey-West adjustment
    3. long_short_backtest()      — Chapter 7 factor portfolio construction

These tools answer "is a factor actually pricing returns?" with a
statistically rigorous methodology, not just visual inspection.

Public API:
    cross_section_sort(symbols, factor_name, n_bins=10, lookback_months=12)
        -> SortResult
    fama_macbeth_regression(symbols, factor_names, lookback_months=24)
        -> FMResult
    long_short_backtest(symbols, factor_name, long_pct=0.20, short_pct=0.20,
                        rebalance_freq='M', lookback_months=24)
        -> BacktestResult
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import numpy as np
import pandas as pd

from services.factor_universe import FACTOR_NAMES, get_universe_panel
from services.financials_provider import get_price_history

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _monthly_returns(symbols: list[str], months: int) -> pd.DataFrame:
    """Pull monthly returns for symbols. Returns DataFrame: rows=month-end, cols=symbols."""
    series_map: dict[str, pd.Series] = {}
    period = f"{max(months + 2, 12)}mo"
    for sym in symbols:
        try:
            hist = get_price_history(sym, period=period)
            if hist is None or hist.empty:
                continue
            monthly = hist["Close"].resample("ME").last().pct_change().dropna()
            if not monthly.empty:
                series_map[sym] = monthly.tail(months)
        except Exception as exc:
            logger.info("Skip %s in returns fetch: %s", sym, exc)
            continue

    if not series_map:
        return pd.DataFrame()

    df = pd.DataFrame(series_map)
    return df


def _newey_west_se(residuals: np.ndarray, lags: int = 6) -> float:
    """Compute Newey-West HAC standard error for the mean of a series.

    Adjusts for autocorrelation up to `lags` periods. From book Chapter 2.4.3.
    """
    n = len(residuals)
    if n < 2:
        return 0.0
    # Demean (residuals from mean)
    e = residuals - np.mean(residuals)
    # Variance term (lag 0)
    var = np.sum(e * e) / n
    # Autocovariance terms (Bartlett kernel weights)
    for lag in range(1, min(lags + 1, n)):
        weight = 1 - lag / (lags + 1)
        cov = np.sum(e[lag:] * e[:-lag]) / n
        var += 2 * weight * cov
    # Standard error of the mean
    return math.sqrt(max(var, 0) / n)


# ── 1. Cross-Section Sort ────────────────────────────────────────────────────

@dataclass
class SortBin:
    bin_id: int                # 1 = lowest factor value, n_bins = highest
    avg_factor: float
    avg_return: float          # average monthly return
    n_symbols: int
    symbols: list[str] = field(default_factory=list)


@dataclass
class SortResult:
    factor_name: str
    n_bins: int
    lookback_months: int
    bins: list[SortBin]
    high_minus_low_return: float    # H-L spread
    spread_t_stat: float
    spread_p_value: float
    monotonic_corr: float           # Spearman rank corr between bin avg factor and avg return
    monotonic_p_value: float
    interpretation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "factor_name": self.factor_name,
            "n_bins": self.n_bins,
            "lookback_months": self.lookback_months,
            "bins": [
                {
                    "bin_id": b.bin_id,
                    "avg_factor": round(b.avg_factor, 4),
                    "avg_return": round(b.avg_return * 100, 3),   # %
                    "n_symbols": b.n_symbols,
                    "symbols": b.symbols,
                }
                for b in self.bins
            ],
            "high_minus_low_return": round(self.high_minus_low_return * 100, 3),
            "spread_t_stat": round(self.spread_t_stat, 2),
            "spread_p_value": round(self.spread_p_value, 4),
            "monotonic_corr": round(self.monotonic_corr, 3),
            "monotonic_p_value": round(self.monotonic_p_value, 4),
            "interpretation": self.interpretation,
        }


def cross_section_sort(
    symbols: list[str] | None = None,
    *,
    factor_name: str = "value",
    n_bins: int = 10,
    lookback_months: int = 12,
) -> SortResult:
    """Sort stocks into n_bins by factor value, compute average forward returns per bin.

    The book's classic portfolio-sort method (Chapter 2.1).
    """
    if factor_name not in FACTOR_NAMES:
        raise ValueError(f"Unknown factor: {factor_name}. Choose from {FACTOR_NAMES}")

    panel = get_universe_panel(symbols=symbols, factor_names=[factor_name])
    if panel.empty:
        raise ValueError(
            "Factor universe cache is empty. Call POST /v1/factors/research/refresh first."
        )

    # Filter symbols with valid factor values
    valid = panel[panel[factor_name].notna()].copy()
    if len(valid) < n_bins:
        raise ValueError(
            f"Need ≥{n_bins} symbols with {factor_name}, have {len(valid)}"
        )

    # Get returns
    syms = valid.index.tolist()
    returns = _monthly_returns(syms, lookback_months)
    if returns.empty:
        raise ValueError("No return data available")

    avg_returns = returns.mean(axis=0)   # mean over time per symbol
    valid["avg_return"] = avg_returns

    # Drop symbols where we couldn't get returns
    valid = valid[valid["avg_return"].notna()]
    if len(valid) < n_bins:
        raise ValueError(f"Only {len(valid)} symbols have both factor and returns")

    # Bin by factor value (qcut into n quantile bins, 1 = lowest)
    valid["bin"] = pd.qcut(
        valid[factor_name], q=n_bins, labels=False, duplicates="drop"
    )
    valid["bin"] = valid["bin"].astype(int) + 1   # 1-indexed

    bins: list[SortBin] = []
    for bin_id in sorted(valid["bin"].unique()):
        chunk = valid[valid["bin"] == bin_id]
        bins.append(SortBin(
            bin_id=int(bin_id),
            avg_factor=float(chunk[factor_name].mean()),
            avg_return=float(chunk["avg_return"].mean()),
            n_symbols=len(chunk),
            symbols=chunk.index.tolist()[:8],  # cap for UI
        ))

    # H-L spread (top bin return - bottom bin return)
    high_bin = bins[-1]
    low_bin = bins[0]
    high_returns_per_month = returns[high_bin.symbols].mean(axis=1).dropna()
    low_returns_per_month = returns[low_bin.symbols].mean(axis=1).dropna()

    # Align time index
    common_idx = high_returns_per_month.index.intersection(low_returns_per_month.index)
    spread_series = (
        high_returns_per_month.loc[common_idx] - low_returns_per_month.loc[common_idx]
    )

    if len(spread_series) >= 2:
        spread_mean = float(spread_series.mean())
        nw_se = _newey_west_se(spread_series.values, lags=min(6, len(spread_series) - 1))
        spread_t = spread_mean / nw_se if nw_se > 0 else 0.0
        # Two-tailed p-value (normal approximation)
        from scipy.stats import norm
        spread_p = float(2 * (1 - norm.cdf(abs(spread_t))))
    else:
        spread_mean = float(high_bin.avg_return - low_bin.avg_return)
        spread_t = 0.0
        spread_p = 1.0

    # Monotonicity: Spearman rank correlation between bin avg factor and avg return
    factor_vals = [b.avg_factor for b in bins]
    return_vals = [b.avg_return for b in bins]
    if len(bins) >= 3:
        from scipy.stats import spearmanr
        rho, mono_p = spearmanr(factor_vals, return_vals)
        mono_rho = float(rho) if rho is not None and not pd.isna(rho) else 0.0
        mono_p_value = float(mono_p) if mono_p is not None and not pd.isna(mono_p) else 1.0
    else:
        mono_rho = 0.0
        mono_p_value = 1.0

    # Interpretation
    if abs(spread_t) >= 2.0 and spread_mean > 0:
        interp = (
            f"H-L 多空对冲组合月均收益 {spread_mean*100:.2f}%（t={spread_t:.2f}）显著为正，"
            f"该因子在样本期内被定价"
        )
    elif abs(spread_t) >= 2.0 and spread_mean < 0:
        interp = (
            f"H-L 月均收益 {spread_mean*100:.2f}%（t={spread_t:.2f}）显著为负，"
            f"反向因子（高暴露反而获得低收益）"
        )
    else:
        interp = (
            f"H-L 月均收益 {spread_mean*100:.2f}%（t={spread_t:.2f}）不显著，"
            f"无法在该样本上拒绝 H₀: 因子无收益"
        )

    return SortResult(
        factor_name=factor_name,
        n_bins=len(bins),
        lookback_months=lookback_months,
        bins=bins,
        high_minus_low_return=spread_mean,
        spread_t_stat=spread_t,
        spread_p_value=spread_p,
        monotonic_corr=mono_rho,
        monotonic_p_value=mono_p_value,
        interpretation=interp,
    )


# ── 2. Fama-MacBeth Regression ───────────────────────────────────────────────

@dataclass
class FMFactorResult:
    factor_name: str
    avg_premium: float        # average monthly factor premium (decimal)
    t_stat: float             # Newey-West adjusted
    p_value: float
    impact_coefficient: float    # avg_premium × stdev(factor) — book Sec 4.2
    is_significant: bool        # |t| >= 2.0


@dataclass
class FMResult:
    factor_names: list[str]
    n_periods: int
    n_symbols_avg: float
    newey_west_lags: int
    factors: list[FMFactorResult]
    interpretation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "factor_names": self.factor_names,
            "n_periods": self.n_periods,
            "n_symbols_avg": round(self.n_symbols_avg, 1),
            "newey_west_lags": self.newey_west_lags,
            "factors": [
                {
                    "factor_name": f.factor_name,
                    "avg_premium": round(f.avg_premium * 100, 3),    # %
                    "t_stat": round(f.t_stat, 2),
                    "p_value": round(f.p_value, 4),
                    "impact_coefficient": round(f.impact_coefficient * 100, 3),   # %
                    "is_significant": f.is_significant,
                }
                for f in self.factors
            ],
            "interpretation": self.interpretation,
        }


def fama_macbeth_regression(
    symbols: list[str] | None = None,
    *,
    factor_names: list[str] | None = None,
    lookback_months: int = 24,
    newey_west_lags: int = 6,
) -> FMResult:
    """Run Fama-MacBeth two-stage regression with Newey-West adjustment.

    Stage 1: Each month, run cross-section regression
              R_{i,t} = α_t + Σ λ_{f,t} × X_{f,i} + ε_{i,t}
              → get monthly factor premiums {λ_{f,t}}

    Stage 2: Average each factor's premiums over time, adjust SE for autocorrelation
              t-stat = mean(λ_f) / NeweyWest_SE(λ_f, lags)

    Reference: 《因子投资》Section 2.2 + 2.4.
    """
    factors = factor_names or FACTOR_NAMES
    panel = get_universe_panel(symbols=symbols, factor_names=factors)
    if panel.empty:
        raise ValueError("Factor universe is empty. Refresh first.")

    valid = panel.dropna(subset=factors)
    if len(valid) < len(factors) + 5:
        raise ValueError(f"Need ≥{len(factors) + 5} valid symbols, have {len(valid)}")

    syms = valid.index.tolist()
    returns = _monthly_returns(syms, lookback_months)
    if returns.empty or returns.shape[0] < 6:
        raise ValueError("Insufficient return history")

    # Standardize factor exposures cross-sectionally (z-score) so coefficients are comparable
    X = valid[factors].copy()
    factor_stds = X.std()
    X = (X - X.mean()) / factor_stds.replace(0, 1)
    X = X.fillna(0)
    X.insert(0, "intercept", 1.0)

    # For each month, regress next-month return on current factor exposures
    monthly_premiums: list[dict[str, float]] = []
    n_symbols_per_period: list[int] = []

    for date_idx, ret_row in returns.iterrows():
        common_syms = [s for s in ret_row.index if s in X.index and pd.notna(ret_row[s])]
        if len(common_syms) < len(factors) + 3:
            continue
        y = ret_row.loc[common_syms].values
        X_t = X.loc[common_syms].values
        # OLS: β = (X'X)^-1 X'y
        try:
            coefs, *_ = np.linalg.lstsq(X_t, y, rcond=None)
        except np.linalg.LinAlgError:
            continue
        # coefs[0] = intercept, coefs[1+i] = factor i premium
        premium_dict = {f: float(coefs[i + 1]) for i, f in enumerate(factors)}
        monthly_premiums.append(premium_dict)
        n_symbols_per_period.append(len(common_syms))

    n_periods = len(monthly_premiums)
    if n_periods < 4:
        raise ValueError(f"Only {n_periods} periods passed regression, need ≥4")

    # Aggregate per-factor
    factor_results: list[FMFactorResult] = []
    for f in factors:
        series = np.array([m[f] for m in monthly_premiums])
        mean_premium = float(np.mean(series))
        nw_se = _newey_west_se(series, lags=min(newey_west_lags, n_periods - 1))
        t_stat = mean_premium / nw_se if nw_se > 0 else 0.0
        from scipy.stats import norm
        p_value = float(2 * (1 - norm.cdf(abs(t_stat))))
        # Impact coefficient: premium × cross-sectional std (interpretable units)
        impact = mean_premium * float(factor_stds.get(f, 1.0))
        factor_results.append(FMFactorResult(
            factor_name=f,
            avg_premium=mean_premium,
            t_stat=t_stat,
            p_value=p_value,
            impact_coefficient=impact,
            is_significant=abs(t_stat) >= 2.0,
        ))

    # Sort by |t-stat| desc for interpretation
    sig = [f for f in factor_results if f.is_significant]
    if sig:
        names = ", ".join(
            f"{f.factor_name}(t={f.t_stat:.1f})" for f in sorted(sig, key=lambda x: -abs(x.t_stat))
        )
        interp = f"在 {n_periods} 期回归中，被定价的因子: {names}（|t| ≥ 2）"
    else:
        interp = f"经 Newey-West 调整后，{n_periods} 期内未发现显著因子"

    return FMResult(
        factor_names=factors,
        n_periods=n_periods,
        n_symbols_avg=float(np.mean(n_symbols_per_period)) if n_symbols_per_period else 0,
        newey_west_lags=newey_west_lags,
        factors=factor_results,
        interpretation=interp,
    )


# ── 3. Long-Short Factor Backtest ────────────────────────────────────────────

@dataclass
class BacktestResult:
    factor_name: str
    long_pct: float
    short_pct: float
    n_periods: int
    long_avg_return: float
    short_avg_return: float
    spread_avg_return: float        # long - short, monthly
    annualized_return: float        # spread × 12
    annualized_vol: float
    sharpe_ratio: float
    max_drawdown: float             # 0..1, expressed positive
    win_rate: float                 # % months spread > 0
    cumulative_curve: list[dict[str, Any]]    # [{date, cum_long, cum_short, cum_spread}, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "factor_name": self.factor_name,
            "long_pct": round(self.long_pct * 100, 1),
            "short_pct": round(self.short_pct * 100, 1),
            "n_periods": self.n_periods,
            "long_avg_return": round(self.long_avg_return * 100, 3),
            "short_avg_return": round(self.short_avg_return * 100, 3),
            "spread_avg_return": round(self.spread_avg_return * 100, 3),
            "annualized_return": round(self.annualized_return * 100, 2),
            "annualized_vol": round(self.annualized_vol * 100, 2),
            "sharpe_ratio": round(self.sharpe_ratio, 2),
            "max_drawdown": round(self.max_drawdown * 100, 2),
            "win_rate": round(self.win_rate * 100, 1),
            "cumulative_curve": self.cumulative_curve,
        }


def long_short_backtest(
    symbols: list[str] | None = None,
    *,
    factor_name: str = "value",
    long_pct: float = 0.20,
    short_pct: float = 0.20,
    lookback_months: int = 24,
) -> BacktestResult:
    """Construct a long-short portfolio sorted on `factor_name` and backtest.

    Long top `long_pct` symbols, short bottom `short_pct`, equal-weighted within each leg.
    Rebalance not modeled (uses snapshot factor values for entire window) —
    fine for first-pass research but real production would re-sort each month.
    """
    if factor_name not in FACTOR_NAMES:
        raise ValueError(f"Unknown factor: {factor_name}")

    panel = get_universe_panel(symbols=symbols, factor_names=[factor_name])
    if panel.empty:
        raise ValueError("Factor universe is empty. Refresh first.")

    valid = panel[panel[factor_name].notna()].copy()
    n_long = max(1, int(len(valid) * long_pct))
    n_short = max(1, int(len(valid) * short_pct))

    sorted_df = valid.sort_values(factor_name)
    short_syms = sorted_df.head(n_short).index.tolist()
    long_syms = sorted_df.tail(n_long).index.tolist()

    all_syms = list(set(long_syms + short_syms))
    returns = _monthly_returns(all_syms, lookback_months)
    if returns.empty or returns.shape[0] < 4:
        raise ValueError(
            f"Insufficient return data ({returns.shape[0] if not returns.empty else 0} months)"
        )

    # Equal-weighted leg returns per month
    long_ret = returns[[s for s in long_syms if s in returns.columns]].mean(axis=1)
    short_ret = returns[[s for s in short_syms if s in returns.columns]].mean(axis=1)
    spread = (long_ret - short_ret).dropna()

    if spread.empty:
        raise ValueError("Spread series is empty")

    # Stats
    spread_mean = float(spread.mean())
    spread_std = float(spread.std())
    long_mean = float(long_ret.mean())
    short_mean = float(short_ret.mean())
    annualized_return = spread_mean * 12
    annualized_vol = spread_std * math.sqrt(12)
    sharpe = annualized_return / annualized_vol if annualized_vol > 0 else 0.0
    win_rate = float((spread > 0).mean())

    # Max drawdown on cumulative spread
    cum_spread = (1 + spread).cumprod()
    peak = cum_spread.expanding().max()
    drawdown = (cum_spread - peak) / peak
    max_dd = float(-drawdown.min()) if not drawdown.empty else 0.0

    # Cumulative curves
    cum_long = (1 + long_ret).cumprod()
    cum_short = (1 + short_ret).cumprod()

    curve = []
    for date, cum_l in cum_long.items():
        if date not in cum_short.index or date not in cum_spread.index:
            continue
        curve.append({
            "date": date.strftime("%Y-%m"),
            "long": round(float(cum_l), 4),
            "short": round(float(cum_short.loc[date]), 4),
            "spread": round(float(cum_spread.loc[date]), 4),
        })

    return BacktestResult(
        factor_name=factor_name,
        long_pct=long_pct,
        short_pct=short_pct,
        n_periods=len(spread),
        long_avg_return=long_mean,
        short_avg_return=short_mean,
        spread_avg_return=spread_mean,
        annualized_return=annualized_return,
        annualized_vol=annualized_vol,
        sharpe_ratio=sharpe,
        max_drawdown=max_dd,
        win_rate=win_rate,
        cumulative_curve=curve,
    )


# ── True Point-In-Time backtest (Phase V.2) ─────────────────────────────

@dataclass
class PITBacktestResult:
    """Result of true PIT backtest using historical snapshots."""
    n_snapshots_used: int
    snapshot_dates: list[str]
    period_returns: list[dict[str, Any]]    # [{date, n_matched, return, symbols}, ...]
    annualized_return: float
    annualized_vol: float
    sharpe_ratio: float
    max_drawdown: float
    win_rate: float
    cumulative_curve: list[dict[str, Any]]   # [{date, portfolio, benchmark}]
    benchmark_annualized: float
    alpha_annual: float
    information_ratio: float
    avg_holdings: float
    interpretation: str
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "n_snapshots_used": self.n_snapshots_used,
            "snapshot_dates": self.snapshot_dates,
            "period_returns": [
                {
                    "date": p["date"],
                    "n_matched": p["n_matched"],
                    "return_pct": round(p["return"] * 100, 3),
                    "benchmark_pct": round(p.get("benchmark", 0) * 100, 3),
                    "sample_symbols": p.get("symbols", [])[:6],
                }
                for p in self.period_returns
            ],
            "annualized_return_pct": round(self.annualized_return * 100, 2),
            "annualized_vol_pct": round(self.annualized_vol * 100, 2),
            "sharpe_ratio": round(self.sharpe_ratio, 2),
            "max_drawdown_pct": round(self.max_drawdown * 100, 2),
            "win_rate_pct": round(self.win_rate * 100, 1),
            "cumulative_curve": self.cumulative_curve,
            "benchmark_annualized_pct": round(self.benchmark_annualized * 100, 2),
            "alpha_annual_pct": round(self.alpha_annual * 100, 2),
            "information_ratio": round(self.information_ratio, 2),
            "avg_holdings": round(self.avg_holdings, 1),
            "interpretation": self.interpretation,
            "warnings": self.warnings,
        }


def _apply_conditions_to_panel(panel: pd.DataFrame, conditions: list[dict]) -> list[str]:
    """Apply screener conditions to a panel DataFrame, return matching symbols."""
    df = panel.copy()
    for cond in conditions:
        factor = cond.get("factor")
        op = cond.get("op")
        value = cond.get("value")
        if factor not in df.columns:
            continue
        col = df[factor]
        if op == ">=":
            df = df[col >= value]
        elif op == ">":
            df = df[col > value]
        elif op == "<=":
            df = df[col <= value]
        elif op == "<":
            df = df[col < value]
        elif op == "==":
            df = df[col == value]
        elif op == "!=":
            df = df[col != value]
    return df.index.tolist()


def pit_backtest_screener(
    conditions: list[dict],
    *,
    benchmark: str = "SPY",
    min_holdings: int = 5,
) -> PITBacktestResult:
    """True point-in-time backtest of a screener strategy.

    For each historical snapshot date:
        1. Load that month's factor panel
        2. Apply screener conditions
        3. Take next month's return (snapshot_date → next_snapshot_date)
        4. Equal-weight average across matched symbols

    This eliminates look-ahead bias because at time T we only use factor
    values that were known at time T (from factor_history table).

    Requires ≥2 snapshots to produce any result. Becomes meaningful at ≥6.

    Args:
        conditions: list of {factor, op, value} dicts
        benchmark: ticker for alpha calculation (default SPY)
        min_holdings: skip period if fewer than N symbols match

    Returns:
        PITBacktestResult with full diagnostics
    """
    import math
    from datetime import datetime, timedelta
    from services.factor_snapshot import get_pit_panel
    from services.factor_universe import _get_supabase
    from services.financials_provider import get_price_history

    db = _get_supabase()

    # 1. Fetch all snapshot dates (sorted asc).
    # Use momentum_60d as probe — present in both normal snapshots and
    # technical-only backfills, so we get the full date list.
    rows: list[dict] = []
    offset = 0
    while True:
        resp = (
            db.table("factor_history")
            .select("snapshot_date")
            .eq("factor_name", "momentum_60d")
            .order("snapshot_date", desc=False)
            .range(offset, offset + 999)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    all_dates = sorted({r["snapshot_date"] for r in rows})

    if len(all_dates) < 2:
        raise ValueError(
            f"Need ≥2 monthly snapshots for PIT backtest, have {len(all_dates)}. "
            f"Trigger snapshots monthly via /v1/factors/snapshot/run; meaningful "
            f"results require ≥6."
        )

    warnings: list[str] = []
    if len(all_dates) < 6:
        warnings.append(
            f"⚠️ 仅 {len(all_dates)} 份快照（建议 ≥6 才稳健）。"
            f"统计势能不足，结果仅供参考。"
        )

    # 2. Fetch benchmark price history (covers entire span + buffer)
    span_days = (
        datetime.fromisoformat(all_dates[-1]).date()
        - datetime.fromisoformat(all_dates[0]).date()
    ).days
    period = f"{max(span_days // 30 + 3, 3)}mo"
    try:
        bench_hist = get_price_history(benchmark, period=period)
    except Exception as exc:
        raise ValueError(f"Could not fetch benchmark {benchmark}: {exc}")

    # Strip tz from index so naive Timestamp comparisons work cleanly
    if bench_hist.index.tz is not None:
        bench_hist.index = bench_hist.index.tz_localize(None)
    bench_close = bench_hist["Close"].astype(float)

    # 3. Pre-compute matches per period (so we know which symbols to fetch)
    # Then bulk-fetch unique symbol price histories in parallel
    pre_matches: list[tuple[str, str, list[str]]] = []   # (snap_date, next_date, symbols)
    for i in range(len(all_dates) - 1):
        snap_date = all_dates[i]
        next_snap_date = all_dates[i + 1]
        panel = get_pit_panel(snap_date)
        if panel.empty:
            continue
        matched = _apply_conditions_to_panel(panel, conditions)
        if len(matched) >= min_holdings:
            pre_matches.append((snap_date, next_snap_date, matched))

    if not pre_matches:
        raise ValueError("No periods had ≥{min_holdings} matched symbols")

    all_needed_syms = sorted({s for _, _, syms in pre_matches for s in syms})

    # Bulk-fetch price histories with concurrent workers (cached across calls)
    from concurrent.futures import ThreadPoolExecutor
    sym_history: dict[str, pd.DataFrame] = {}
    def _fetch_one(s: str):
        try:
            h = get_price_history(s, period=period)
            if h is not None and not h.empty:
                if h.index.tz is not None:
                    h.index = h.index.tz_localize(None)
                return s, h
        except Exception:
            pass
        return s, None

    with ThreadPoolExecutor(max_workers=8) as ex:
        for s, h in ex.map(_fetch_one, all_needed_syms):
            if h is not None:
                sym_history[s] = h

    # 4. Loop through snapshot pairs and compute returns
    period_returns: list[dict] = []
    for snap_date, next_snap_date, matched in pre_matches:
        snap_dt = pd.Timestamp(snap_date)
        next_dt = pd.Timestamp(next_snap_date)

        rets: list[float] = []
        for sym in matched:
            hist = sym_history.get(sym)
            if hist is None:
                continue
            try:
                close = hist["Close"].astype(float)
                start_prices = close[close.index >= snap_dt]
                end_prices = close[close.index >= next_dt]
                if start_prices.empty or end_prices.empty:
                    continue
                p0 = float(start_prices.iloc[0])
                p1 = float(end_prices.iloc[0])
                if p0 > 0:
                    rets.append((p1 / p0) - 1)
            except Exception:
                continue

        if len(rets) < min_holdings:
            continue

        port_ret = float(np.mean(rets))

        # Benchmark return same period
        b_start = bench_close[bench_close.index >= snap_dt]
        b_end = bench_close[bench_close.index >= next_dt]
        if not b_start.empty and not b_end.empty:
            bench_period_ret = float(b_end.iloc[0] / b_start.iloc[0] - 1)
        else:
            bench_period_ret = 0.0

        period_returns.append({
            "date": snap_date,
            "n_matched": len(matched),
            "return": port_ret,
            "benchmark": bench_period_ret,
            "symbols": matched,
        })

    if not period_returns:
        raise ValueError(
            "No periods produced returns. Try loosening conditions or wait for more snapshots."
        )

    # 4. Aggregate stats
    port_rets = np.array([p["return"] for p in period_returns])
    bench_rets = np.array([p["benchmark"] for p in period_returns])
    n = len(port_rets)
    avg_n_matched = float(np.mean([p["n_matched"] for p in period_returns]))

    mean_m = float(np.mean(port_rets))
    std_m = float(np.std(port_rets, ddof=1)) if n > 1 else 0.0
    annualized_return = mean_m * 12
    annualized_vol = std_m * math.sqrt(12)
    sharpe = annualized_return / annualized_vol if annualized_vol > 0 else 0.0
    win_rate = float((port_rets > 0).mean())

    bench_mean = float(np.mean(bench_rets))
    bench_annualized = bench_mean * 12
    alpha_annual = annualized_return - bench_annualized
    excess = port_rets - bench_rets
    excess_vol = float(np.std(excess, ddof=1)) * math.sqrt(12) if n > 1 else 0.0
    info_ratio = alpha_annual / excess_vol if excess_vol > 0 else 0.0

    # 5. Cumulative curve
    cum_port = np.cumprod(1 + port_rets)
    cum_bench = np.cumprod(1 + bench_rets)
    peak = np.maximum.accumulate(cum_port)
    drawdown = (cum_port - peak) / peak
    max_dd = float(-drawdown.min()) if len(drawdown) > 0 else 0.0

    cumulative_curve = []
    for i, p in enumerate(period_returns):
        cumulative_curve.append({
            "date": p["date"],
            "portfolio": round(float(cum_port[i]), 4),
            "benchmark": round(float(cum_bench[i]), 4),
        })

    # 6. Interpretation
    if abs(sharpe) >= 1.0 and alpha_annual > 0:
        interp = (
            f"真实 OOS Sharpe {sharpe:.2f}（年化 {annualized_return*100:.1f}%, "
            f"α {alpha_annual*100:+.1f}%）。{n} 期数据，{'统计势能足' if n >= 6 else '样本太小'}"
        )
    elif sharpe < 0:
        interp = f"真实 OOS Sharpe {sharpe:.2f}，策略未跑赢风险。该筛选条件在样本期内表现不佳"
    else:
        interp = f"真实 OOS Sharpe {sharpe:.2f}，{n} 期。{'结果模糊' if n < 6 else '边际策略'}"

    return PITBacktestResult(
        n_snapshots_used=len(all_dates),
        snapshot_dates=all_dates,
        period_returns=period_returns,
        annualized_return=annualized_return,
        annualized_vol=annualized_vol,
        sharpe_ratio=sharpe,
        max_drawdown=max_dd,
        win_rate=win_rate,
        cumulative_curve=cumulative_curve,
        benchmark_annualized=bench_annualized,
        alpha_annual=alpha_annual,
        information_ratio=info_ratio,
        avg_holdings=avg_n_matched,
        interpretation=interp,
        warnings=warnings,
    )
