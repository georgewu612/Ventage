"""IC Analysis — Information Coefficient for factor predictive power.

The Information Coefficient (IC) is the academic-standard metric for
measuring how well a factor predicts forward returns:

    IC_t = Spearman_corr(factor_value_at_t, return_from_t_to_t+horizon)

Compute IC each rebalance period, then summarize:
    IC Mean = average across periods (>0.05 typically meaningful)
    IC Std  = volatility of IC
    IC IR   = IC Mean / IC Std (Information Ratio; >0.5 = good)
    Hit Rate = % periods where IC > 0
    Decay   = IC at horizon h vs h+5, h+10 (does signal persist?)

Reference: Grinold & Kahn "Active Portfolio Management" (industry standard);
《因子投资：方法与实践》 also uses IC implicitly via FM regression.

Public API:
    compute_ic(factor_name, horizon_days=20, lookback_months=24,
               sector_neutral=True) -> ICResult
    compute_all_factors_ic(...) -> dict[factor_name, ICResult]
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd

from services.factor_universe import (
    CLUSTERS,
    FACTOR_NAMES,
    get_universe_panel,
)
from services.financials_provider import get_price_history

logger = logging.getLogger(__name__)


# ── Output dataclasses ───────────────────────────────────────────────────────

@dataclass
class ICResult:
    factor_name: str
    horizon_days: int
    lookback_months: int
    n_periods: int
    n_symbols_avg: float
    ic_series: list[dict[str, Any]]   # [{date, ic, n_obs}, ...]
    ic_mean: float                    # average IC across periods
    ic_std: float
    ic_ir: float                      # IC mean / IC std (info ratio)
    hit_rate: float                   # % periods with IC > 0
    t_stat: float                     # IC mean / (IC std / sqrt(n))
    is_predictive: bool               # |t_stat| >= 2.0
    decay: dict[str, float]           # {h+5: ic, h+10: ic, h+20: ic}
    interpretation: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "factor_name": self.factor_name,
            "horizon_days": self.horizon_days,
            "lookback_months": self.lookback_months,
            "n_periods": self.n_periods,
            "n_symbols_avg": round(self.n_symbols_avg, 1),
            "ic_series": [
                {
                    "date": s["date"],
                    "ic": round(s["ic"], 4),
                    "n_obs": s["n_obs"],
                }
                for s in self.ic_series
            ],
            "ic_mean": round(self.ic_mean, 4),
            "ic_std": round(self.ic_std, 4),
            "ic_ir": round(self.ic_ir, 3),
            "hit_rate": round(self.hit_rate * 100, 1),
            "t_stat": round(self.t_stat, 2),
            "is_predictive": self.is_predictive,
            "decay": {k: round(v, 4) for k, v in self.decay.items()},
            "interpretation": self.interpretation,
        }


# ── Helpers ──────────────────────────────────────────────────────────────────

def _spearman_safe(a: np.ndarray, b: np.ndarray) -> float:
    """Spearman correlation with NaN handling."""
    try:
        from scipy.stats import spearmanr
        valid = ~(np.isnan(a) | np.isnan(b))
        if valid.sum() < 5:
            return float("nan")
        rho, _ = spearmanr(a[valid], b[valid])
        return float(rho) if rho is not None and not pd.isna(rho) else float("nan")
    except Exception:
        return float("nan")


def _interpret_ic(ic_mean: float, ic_ir: float, hit_rate: float, is_pred: bool) -> str:
    """Plain-language IC interpretation."""
    abs_ic = abs(ic_mean)
    direction = "正向" if ic_mean > 0 else "反向"

    if not is_pred:
        return (
            f"IC 均值 {ic_mean:.3f}（IR={ic_ir:.2f}），未达到统计显著阈值，"
            f"该因子在样本期内**不能稳定预测收益**"
        )

    strength = (
        "极强" if abs_ic > 0.10 else
        "强" if abs_ic > 0.05 else
        "中等" if abs_ic > 0.03 else
        "弱"
    )
    return (
        f"IC 均值 {ic_mean:+.3f}（{strength}{direction}），IR={ic_ir:.2f}，"
        f"胜率 {hit_rate*100:.0f}%。该因子在样本期内**显著预测收益**"
    )


# ── Core IC computation ──────────────────────────────────────────────────────

def compute_ic(
    factor_name: str,
    *,
    horizon_days: int = 20,
    lookback_months: int = 24,
    sector_neutral: bool = True,
    symbols: list[str] | None = None,
) -> ICResult:
    """Compute IC time-series for a single factor.

    Methodology:
        1. Pull factor values for universe (current snapshot only — limitation)
        2. Pull price history for `lookback_months` months
        3. For each month-end snapshot t:
              IC_t = Spearman(factor_at_t, return_from_t_to_t+horizon_days)
        4. Aggregate: mean / std / IR / hit rate / decay

    Limitation: We use TODAY's factor values for all historical periods
    (no point-in-time factor cache yet). This means IC is biased toward
    recent factor states. For true backtest IC, need historical factor values.

    Args:
        factor_name: one of FACTOR_NAMES or a cluster name
        horizon_days: forward return window (default 20 ≈ 1 month)
        lookback_months: history window
        sector_neutral: apply sector-neutralized z-scores

    Returns:
        ICResult with full diagnostics
    """
    valid_factors = FACTOR_NAMES + list(CLUSTERS.keys())
    if factor_name not in valid_factors:
        raise ValueError(f"Unknown factor: {factor_name}. Valid: {valid_factors}")

    # Get universe panel with appropriate transform
    transform = "z_score" if sector_neutral else "raw"
    include_clusters = factor_name in CLUSTERS
    panel = get_universe_panel(
        symbols=symbols,
        transform=transform,
        include_clusters=include_clusters,
    )
    if panel.empty or factor_name not in panel.columns:
        raise ValueError(
            f"Factor {factor_name} not in cache. Refresh the universe first."
        )

    syms_with_factor = panel[panel[factor_name].notna()].index.tolist()
    if len(syms_with_factor) < 10:
        raise ValueError(f"Need ≥10 symbols with {factor_name}, have {len(syms_with_factor)}")

    # Pull price history for all symbols
    period = f"{max(lookback_months + 3, 12)}mo"
    price_panels: dict[str, pd.Series] = {}
    for sym in syms_with_factor:
        try:
            hist = get_price_history(sym, period=period)
            if hist is None or hist.empty:
                continue
            price_panels[sym] = hist["Close"].astype(float)
        except Exception:
            continue

    if len(price_panels) < 10:
        raise ValueError(f"Only {len(price_panels)} symbols have price history")

    # Build aligned price DataFrame
    prices = pd.DataFrame(price_panels).sort_index().fillna(method="ffill")

    # Resample to month-end snapshots
    monthly_close = prices.resample("ME").last().tail(lookback_months + 1)
    if len(monthly_close) < 6:
        raise ValueError(f"Only {len(monthly_close)} months of data")

    # Compute forward h-day returns at each month-end snapshot
    # IC at t = corr(factor_t, return from t to t+h trading days)
    ic_records: list[dict[str, Any]] = []
    factor_vec = panel[factor_name]

    for i in range(len(monthly_close) - 1):
        snapshot_date = monthly_close.index[i]
        # Find next h trading days from snapshot
        future_window = prices[prices.index >= snapshot_date].iloc[: horizon_days + 1]
        if len(future_window) < horizon_days // 2:
            continue
        # Forward returns per symbol
        start_prices = future_window.iloc[0]
        end_prices = future_window.iloc[-1]
        fwd_returns = (end_prices / start_prices) - 1
        fwd_returns = fwd_returns.dropna()

        # Align with factor vector
        common = list(set(fwd_returns.index) & set(factor_vec.dropna().index))
        if len(common) < 10:
            continue
        ic = _spearman_safe(
            factor_vec.loc[common].values,
            fwd_returns.loc[common].values,
        )
        if not math.isnan(ic):
            ic_records.append({
                "date": snapshot_date.strftime("%Y-%m-%d"),
                "ic": ic,
                "n_obs": len(common),
            })

    n_periods = len(ic_records)
    if n_periods < 4:
        raise ValueError(f"Only {n_periods} valid IC periods, need ≥4")

    ic_array = np.array([r["ic"] for r in ic_records])
    ic_mean = float(np.mean(ic_array))
    ic_std = float(np.std(ic_array, ddof=1))
    ic_ir = ic_mean / ic_std if ic_std > 0 else 0.0
    hit_rate = float((ic_array > 0).mean())
    t_stat = ic_mean / (ic_std / math.sqrt(n_periods)) if ic_std > 0 else 0.0
    is_predictive = abs(t_stat) >= 2.0

    n_obs_avg = float(np.mean([r["n_obs"] for r in ic_records]))

    # Decay analysis: re-compute IC at h+5, h+10, h+20
    decay: dict[str, float] = {}
    for h_alt in [horizon_days + 5, horizon_days + 10, horizon_days + 20]:
        try:
            decay_ics = []
            for i in range(len(monthly_close) - 1):
                snapshot_date = monthly_close.index[i]
                fw = prices[prices.index >= snapshot_date].iloc[: h_alt + 1]
                if len(fw) < h_alt // 2:
                    continue
                fr = (fw.iloc[-1] / fw.iloc[0]) - 1
                fr = fr.dropna()
                common = list(set(fr.index) & set(factor_vec.dropna().index))
                if len(common) < 10:
                    continue
                ic_alt = _spearman_safe(
                    factor_vec.loc[common].values, fr.loc[common].values
                )
                if not math.isnan(ic_alt):
                    decay_ics.append(ic_alt)
            decay[f"h{h_alt}"] = float(np.mean(decay_ics)) if decay_ics else float("nan")
        except Exception:
            decay[f"h{h_alt}"] = float("nan")

    interp = _interpret_ic(ic_mean, ic_ir, hit_rate, is_predictive)

    return ICResult(
        factor_name=factor_name,
        horizon_days=horizon_days,
        lookback_months=lookback_months,
        n_periods=n_periods,
        n_symbols_avg=n_obs_avg,
        ic_series=ic_records,
        ic_mean=ic_mean,
        ic_std=ic_std,
        ic_ir=ic_ir,
        hit_rate=hit_rate,
        t_stat=t_stat,
        is_predictive=is_predictive,
        decay=decay,
        interpretation=interp,
    )


# ── Batch: all factors ──────────────────────────────────────────────────────

def compute_all_factors_ic(
    *,
    horizon_days: int = 20,
    lookback_months: int = 24,
    sector_neutral: bool = True,
    include_clusters: bool = True,
) -> dict[str, Any]:
    """Run IC analysis for all factors (and optionally clusters). Returns summary table."""
    factor_list = list(FACTOR_NAMES)
    if include_clusters:
        factor_list += list(CLUSTERS.keys())

    results: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for fname in factor_list:
        try:
            r = compute_ic(
                fname,
                horizon_days=horizon_days,
                lookback_months=lookback_months,
                sector_neutral=sector_neutral,
            )
            results[fname] = r.to_dict()
        except Exception as exc:
            errors[fname] = str(exc)
            logger.info("IC failed for %s: %s", fname, exc)

    # Sort by absolute IC IR descending
    sorted_factors = sorted(
        results.items(),
        key=lambda kv: abs(kv[1].get("ic_ir", 0)),
        reverse=True,
    )

    return {
        "horizon_days": horizon_days,
        "lookback_months": lookback_months,
        "sector_neutral": sector_neutral,
        "factors": dict(sorted_factors),
        "errors": errors,
    }
