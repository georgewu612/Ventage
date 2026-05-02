"""DCF Valuation — Discounted Cash Flow analysis.

Adapted from Dexter (https://github.com/virattt/dexter) DCF skill methodology
into Python. Methodology only — no code reuse, no external API dependency.

Workflow (8 steps):
    1. Gather financial data (FCF history, balance sheet, market data)
    2. Calculate FCF growth rate (5-year CAGR with cap)
    3. Estimate discount rate (sector WACC + adjustments)
    4. Project future cash flows (5 years + terminal value)
    5. Discount to present value → fair value per share
    6. Sensitivity analysis (WACC ± 1%, terminal growth 2.0/2.5/3.0%)
    7. Validate (EV comparison, terminal value ratio)
    8. Format output

Data source: yfinance (free, gives cash flow + balance sheet + price)
    Future: switch to AlphaVantage CASH_FLOW / BALANCE_SHEET / OVERVIEW
    when production data quality matters.

Public API:
    valuate(symbol) -> DCFResult
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)


# ── Sector WACC Reference (ported from Dexter sector-wacc.md) ────────────────

SECTOR_WACC: dict[str, tuple[float, float]] = {
    # (low, high) WACC range as decimals
    "Communication Services":   (0.08, 0.10),
    "Consumer Cyclical":        (0.08, 0.10),    # = Consumer Discretionary
    "Consumer Discretionary":   (0.08, 0.10),
    "Consumer Defensive":       (0.07, 0.08),    # = Consumer Staples
    "Consumer Staples":         (0.07, 0.08),
    "Energy":                   (0.09, 0.11),
    "Financial Services":       (0.08, 0.10),    # = Financials
    "Financials":               (0.08, 0.10),
    "Healthcare":               (0.08, 0.10),    # = Health Care
    "Health Care":              (0.08, 0.10),
    "Industrials":              (0.08, 0.09),
    "Technology":               (0.08, 0.12),    # = Information Technology
    "Information Technology":   (0.08, 0.12),
    "Basic Materials":          (0.08, 0.10),    # = Materials
    "Materials":                (0.08, 0.10),
    "Real Estate":              (0.07, 0.09),
    "Utilities":                (0.06, 0.07),
}

DEFAULT_WACC = (0.08, 0.10)            # if sector unknown
TERMINAL_GROWTH_DEFAULT = 0.025        # GDP proxy
PROJECTION_YEARS = 5
GROWTH_DECAY = [1.0, 0.95, 0.90, 0.85, 0.80]   # year 1-5
MAX_GROWTH_RATE = 0.15                 # cap sustained growth at 15%
MIN_GROWTH_RATE = -0.05                # floor at -5%


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class DCFResult:
    """Output of DCF valuation."""
    symbol: str
    sector: str | None

    # Inputs
    current_price: float
    market_cap: float | None
    fcf_history: list[float]           # last N years (most recent first)
    fcf_growth_used: float             # decimal, e.g. 0.08
    wacc_used: float                   # decimal, e.g. 0.09
    terminal_growth: float
    net_debt: float
    shares_outstanding: float

    # Projections
    projected_fcfs: list[dict[str, Any]]   # [{year, fcf, pv}, ...]
    terminal_value: float
    terminal_value_pv: float
    enterprise_value: float

    # Output
    fair_value_per_share: float
    upside_pct: float                  # (fair - current) / current * 100
    rating: str                        # "undervalued" / "fairly_valued" / "overvalued"

    # Sensitivity (3×3 matrix)
    sensitivity: list[list[dict[str, Any]]]   # [[{wacc, growth, fair_value}, ...], ...]

    # Validation
    validation_passes: bool
    validation_notes: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "sector": self.sector,
            "current_price": round(self.current_price, 2),
            "market_cap": round(self.market_cap, 0) if self.market_cap else None,
            "fcf_history": [round(x, 0) for x in self.fcf_history],
            "fcf_growth_used": round(self.fcf_growth_used * 100, 2),
            "wacc_used": round(self.wacc_used * 100, 2),
            "terminal_growth": round(self.terminal_growth * 100, 2),
            "net_debt": round(self.net_debt, 0),
            "shares_outstanding": round(self.shares_outstanding, 0),
            "projected_fcfs": [
                {"year": p["year"], "fcf": round(p["fcf"], 0), "pv": round(p["pv"], 0)}
                for p in self.projected_fcfs
            ],
            "terminal_value": round(self.terminal_value, 0),
            "terminal_value_pv": round(self.terminal_value_pv, 0),
            "enterprise_value": round(self.enterprise_value, 0),
            "fair_value_per_share": round(self.fair_value_per_share, 2),
            "upside_pct": round(self.upside_pct, 1),
            "rating": self.rating,
            "sensitivity": [
                [
                    {
                        "wacc": round(c["wacc"] * 100, 2),
                        "growth": round(c["growth"] * 100, 2),
                        "fair_value": round(c["fair_value"], 2),
                    }
                    for c in row
                ]
                for row in self.sensitivity
            ],
            "validation_passes": self.validation_passes,
            "validation_notes": self.validation_notes,
            "warnings": self.warnings,
        }


# ── Step 1: Data gathering ────────────────────────────────────────────────────

def _safe_float(value: Any, default: float = 0.0) -> float:
    """Convert to float, defaulting on None/NaN/error."""
    if value is None:
        return default
    try:
        f = float(value)
        return f if pd.notna(f) else default
    except (TypeError, ValueError):
        return default


def _fetch_data(symbol: str) -> dict[str, Any]:
    """Pull all required data from yfinance.

    Returns dict with: fcf_history, current_price, market_cap, sector,
    total_debt, cash, shares_outstanding, beta, debt_to_equity.
    Raises ValueError with a friendly message if data is insufficient.
    """
    ticker = yf.Ticker(symbol)
    try:
        info = ticker.info or {}
    except Exception as exc:
        raise ValueError(f"yfinance info fetch failed for {symbol}: {exc}")

    try:
        cf_stmt = ticker.cashflow
    except Exception as exc:
        raise ValueError(f"yfinance cashflow fetch failed for {symbol}: {exc}")

    if cf_stmt is None or (hasattr(cf_stmt, "empty") and cf_stmt.empty):
        raise ValueError(f"No cash flow data for {symbol}")

    # Try direct Free Cash Flow row first (saves a step + safer when CapEx
    # naming changes), then fall back to OCF - CapEx.
    fcf_row = _row(cf_stmt, ["Free Cash Flow", "Free Cashflow"])
    if fcf_row is not None and fcf_row.dropna().shape[0] >= 2:
        fcf_series = fcf_row.dropna()
    else:
        operating_cf = _row(cf_stmt, [
            "Operating Cash Flow",
            "Total Cash From Operating Activities",
            "Cash Flow From Continuing Operating Activities",
        ])
        capex = _row(cf_stmt, ["Capital Expenditure", "Capital Expenditures"])

        if operating_cf is None or capex is None:
            raise ValueError(
                f"Missing FCF/OCF/CapEx data for {symbol} — yfinance "
                f"returned an unexpected cashflow schema"
            )

        # capex usually comes back negative — abs() it
        fcf_series = (
            operating_cf + capex.apply(lambda x: -abs(x) if pd.notna(x) else x)
        ).dropna()

    fcf_history = [_safe_float(x) for x in fcf_series.values]
    fcf_history = [x for x in fcf_history if x != 0]   # drop zeros from coercion

    if len(fcf_history) < 2:
        raise ValueError(f"Need ≥2 years FCF history for {symbol}")

    # Get current price from multiple fallback sources
    current_price = (
        _safe_float(info.get("currentPrice"))
        or _safe_float(info.get("regularMarketPrice"))
        or _safe_float(info.get("previousClose"))
    )
    if current_price <= 0:
        # Fallback: try ticker.history
        try:
            hist = ticker.history(period="5d")
            if hist is not None and not hist.empty:
                current_price = _safe_float(hist["Close"].iloc[-1])
        except Exception:
            pass

    if current_price <= 0:
        raise ValueError(f"Could not determine current price for {symbol}")

    shares = (
        _safe_float(info.get("sharesOutstanding"))
        or _safe_float(info.get("impliedSharesOutstanding"))
        or _safe_float(info.get("floatShares"))
    )
    if shares <= 0:
        raise ValueError(f"Invalid shares outstanding for {symbol}")

    return {
        "fcf_history": fcf_history,
        "current_price": current_price,
        "market_cap": _safe_float(info.get("marketCap")) or None,
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "total_debt": _safe_float(info.get("totalDebt")),
        "cash": _safe_float(info.get("totalCash")),
        "shares_outstanding": shares,
        "beta": _safe_float(info.get("beta"), 1.0),
        "debt_to_equity": _safe_float(info.get("debtToEquity")) / 100,   # yfinance returns %
        "roic": _safe_float(info.get("returnOnInvestedCapital")),
    }


def _row(df: pd.DataFrame, candidates: list[str]) -> pd.Series | None:
    for name in candidates:
        if name in df.index:
            return df.loc[name]
    return None


# ── Step 2: Growth rate ──────────────────────────────────────────────────────

def _estimate_growth(fcf_history: list[float], analyst_growth: float | None = None) -> float:
    """5-year CAGR with 15% haircut + 15% cap."""
    if len(fcf_history) < 2:
        return 0.05   # fallback: 5%

    # Reverse so oldest first for CAGR
    series = list(reversed(fcf_history))
    start, end = series[0], series[-1]

    # Negative or near-zero starting FCF → use absolute change rate or fallback
    if start <= 0:
        return 0.05

    n = len(series) - 1
    cagr = (end / start) ** (1 / n) - 1 if end > 0 else -0.05

    # 15% haircut for prudence (Dexter recommendation)
    cagr *= 0.85

    # Cross-validate with analyst estimate (if available, weight 50/50)
    if analyst_growth is not None:
        cagr = 0.5 * cagr + 0.5 * analyst_growth

    return max(MIN_GROWTH_RATE, min(MAX_GROWTH_RATE, cagr))


# ── Step 3: WACC ─────────────────────────────────────────────────────────────

def _estimate_wacc(sector: str | None, market_cap: float | None, debt_to_equity: float) -> float:
    """Pick base WACC from sector table + apply adjustments."""
    base_low, base_high = SECTOR_WACC.get(sector or "", DEFAULT_WACC)
    wacc = (base_low + base_high) / 2     # midpoint

    # Adjustments (from Dexter sector-wacc.md)
    if debt_to_equity > 1.5:
        wacc += 0.015                     # high debt
    if market_cap and market_cap < 2_000_000_000:
        wacc += 0.015                     # small cap
    # Skip "moat" / "recurring revenue" — too subjective for automated

    return round(wacc, 4)


# ── Step 4-5: Projection + present value ──────────────────────────────────────

def _project_and_discount(
    last_fcf: float, growth: float, wacc: float, terminal_growth: float
) -> tuple[list[dict[str, Any]], float, float]:
    """Returns (projected_fcfs, terminal_value, terminal_pv)."""
    projections: list[dict[str, Any]] = []
    fcf = last_fcf
    for i, decay in enumerate(GROWTH_DECAY, start=1):
        effective_growth = growth * decay
        fcf = fcf * (1 + effective_growth)
        pv = fcf / ((1 + wacc) ** i)
        projections.append({"year": i, "fcf": fcf, "pv": pv, "growth": effective_growth})

    # Gordon growth model terminal value
    terminal_fcf = projections[-1]["fcf"] * (1 + terminal_growth)
    terminal_value = terminal_fcf / (wacc - terminal_growth) if wacc > terminal_growth else 0
    terminal_pv = terminal_value / ((1 + wacc) ** PROJECTION_YEARS)

    return projections, terminal_value, terminal_pv


# ── Step 6: Sensitivity ──────────────────────────────────────────────────────

def _sensitivity(
    last_fcf: float,
    growth: float,
    base_wacc: float,
    net_debt: float,
    shares: float,
) -> list[list[dict[str, Any]]]:
    """3×3 matrix: WACC ±1% × terminal growth (2.0/2.5/3.0%)."""
    wacc_offsets = [-0.01, 0, 0.01]
    terminal_growths = [0.020, 0.025, 0.030]

    matrix: list[list[dict[str, Any]]] = []
    for w_off in wacc_offsets:
        wacc = base_wacc + w_off
        row: list[dict[str, Any]] = []
        for tg in terminal_growths:
            projs, _, term_pv = _project_and_discount(last_fcf, growth, wacc, tg)
            ev = sum(p["pv"] for p in projs) + term_pv
            equity = ev - net_debt
            fair = equity / shares if shares > 0 else 0
            row.append({"wacc": wacc, "growth": tg, "fair_value": fair})
        matrix.append(row)

    return matrix


# ── Public API ───────────────────────────────────────────────────────────────

def valuate(symbol: str) -> DCFResult:
    """Run complete DCF valuation for a symbol."""
    data = _fetch_data(symbol)

    fcf_history = data["fcf_history"]
    current_price = data["current_price"]
    sector = data["sector"]
    market_cap = data["market_cap"]
    debt_to_equity = data["debt_to_equity"]
    net_debt = max(0, data["total_debt"] - data["cash"])
    shares = data["shares_outstanding"]

    if shares <= 0:
        raise ValueError(f"Invalid shares outstanding for {symbol}")

    # Step 2-3
    growth = _estimate_growth(fcf_history)
    wacc = _estimate_wacc(sector, market_cap, debt_to_equity)
    terminal_growth = TERMINAL_GROWTH_DEFAULT

    # Step 4-5: Project + discount
    last_fcf = fcf_history[0]   # most recent
    projections, terminal_value, terminal_pv = _project_and_discount(
        last_fcf, growth, wacc, terminal_growth
    )
    enterprise_value = sum(p["pv"] for p in projections) + terminal_pv
    equity_value = enterprise_value - net_debt
    fair_value = equity_value / shares

    upside_pct = ((fair_value - current_price) / current_price * 100) if current_price > 0 else 0
    if upside_pct > 15:
        rating = "undervalued"
    elif upside_pct < -15:
        rating = "overvalued"
    else:
        rating = "fairly_valued"

    # Step 6: Sensitivity
    sens = _sensitivity(last_fcf, growth, wacc, net_debt, shares)

    # Step 7: Validation
    validation_notes: list[str] = []
    warnings: list[str] = []
    passes = True

    # Terminal value ratio (should be 50-80%)
    tv_ratio = terminal_pv / enterprise_value if enterprise_value > 0 else 0
    if tv_ratio > 0.90:
        warnings.append(f"终值占比 {tv_ratio*100:.0f}%，过度依赖远期假设")
        passes = False
    elif tv_ratio < 0.40:
        warnings.append(f"终值占比 {tv_ratio*100:.0f}%，近期增长假设偏激进")
    validation_notes.append(f"终值/EV = {tv_ratio*100:.0f}% (健康范围 50-80%)")

    # Sanity: FCF must be positive on average
    avg_fcf = sum(fcf_history[:3]) / min(3, len(fcf_history))
    if avg_fcf <= 0:
        warnings.append("近 3 年平均 FCF 为负，DCF 模型不适用")
        passes = False

    # WACC vs ROIC reasonableness
    roic = data.get("roic", 0)
    if roic > 0 and wacc > roic:
        warnings.append(f"WACC ({wacc*100:.1f}%) > ROIC ({roic*100:.1f}%)，公司在毁损价值")

    # Cap on growth
    if growth >= MAX_GROWTH_RATE:
        warnings.append(f"增长率被限制在 {MAX_GROWTH_RATE*100:.0f}% 上限")

    # DCF 不适用的行业警告
    if sector in ("Financial Services", "Financials"):
        warnings.append("⚠️ DCF 模型不适用于银行/金融股（FCF 算法把放贷当成资本开支），请用 P/B、ROE、股息折现等方法")
        passes = False
    elif fair_value < 0:
        warnings.append("⚠️ 公允价值为负，可能是 FCF 数据异常或不适用 DCF 模型")
        passes = False

    return DCFResult(
        symbol=symbol.upper(),
        sector=sector,
        current_price=current_price,
        market_cap=market_cap,
        fcf_history=fcf_history,
        fcf_growth_used=growth,
        wacc_used=wacc,
        terminal_growth=terminal_growth,
        net_debt=net_debt,
        shares_outstanding=shares,
        projected_fcfs=projections,
        terminal_value=terminal_value,
        terminal_value_pv=terminal_pv,
        enterprise_value=enterprise_value,
        fair_value_per_share=fair_value,
        upside_pct=upside_pct,
        rating=rating,
        sensitivity=sens,
        validation_passes=passes,
        validation_notes=validation_notes,
        warnings=warnings,
    )
