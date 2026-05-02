"""Factor Profile — 6-dimension style exposure radar.

Computes a stock's exposure to 6 well-known style factors and
expresses each as a percentile (0-100) vs a peer universe.

Reference: 《因子投资：方法与实践》(石川 et al, 2020) Chapter 3-4 +
academic literature on Fama-French / Carhart / Novy-Marx factors.

The 6 factors:
    1. Value       — high BM / EP → cheap stocks
    2. Quality     — high ROE + GP/Assets (Novy-Marx 2013)
    3. Momentum    — past 12-1 month return (Jegadeesh-Titman 1993)
    4. Size        — small-cap premium (-log market_cap inverted, so
                      higher = smaller)
    5. Low Vol     — low realized volatility (Frazzini-Pedersen 2014)
    6. Low Inv     — low total-asset growth (Hou-Xue-Zhang 2015 q-factor)

Each factor is computed as a raw value, then percentile-ranked against
a peer universe (default: same sector in S&P 500).

For peer universe data we cache for 24 hours (file-based JSON cache)
to avoid hammering yfinance every request.

Public API:
    compute_factor_profile(symbol) -> FactorProfile
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

from services.financials_provider import (
    FinancialsError,
    find_value,
    get_balance_sheet,
    get_company_info,
    get_income_statement,
    get_price_history,
)

logger = logging.getLogger(__name__)

# ── Aliases ─────────────────────────────────────────────────────────────────

ALIAS_TOTAL_ASSETS = ["Total Assets", "totalAssets"]
ALIAS_TOTAL_EQUITY = [
    "Stockholders Equity", "Total Stockholder Equity", "totalStockholderEquity",
    "Common Stock Equity",
]
ALIAS_GROSS_PROFIT = ["Gross Profit", "grossProfit"]
ALIAS_NET_INCOME = ["Net Income", "netIncome", "Net Income Common Stockholders"]
ALIAS_REVENUE = ["Total Revenue", "Revenue", "totalRevenue"]
ALIAS_SHARES = ["Ordinary Shares Number", "Share Issued", "commonStockSharesOutstanding"]


# ── Peer universe cache ─────────────────────────────────────────────────────

_CACHE_DIR = Path(os.environ.get("VENTAGE_CACHE_DIR", "/tmp/ventage_cache"))
_CACHE_DIR.mkdir(parents=True, exist_ok=True)
_PEER_CACHE_TTL = 24 * 3600   # 24h


# Default peer universe: large-cap representatives across sectors (~50 names).
# Lean on purpose — full S&P 500 would take 5+ minutes on a cold cache.
DEFAULT_PEER_UNIVERSE = [
    # Technology
    "AAPL", "MSFT", "NVDA", "AVGO", "ORCL", "CRM", "ADBE", "AMD", "CSCO", "INTC",
    # Communication Services
    "GOOGL", "META", "NFLX", "T", "VZ", "DIS",
    # Consumer Cyclical / Discretionary
    "AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX",
    # Consumer Defensive / Staples
    "WMT", "COST", "PG", "KO", "PEP",
    # Healthcare
    "UNH", "JNJ", "LLY", "PFE", "ABBV", "MRK",
    # Industrials
    "CAT", "DE", "BA", "HON", "UPS", "GE",
    # Energy
    "XOM", "CVX", "COP",
    # Materials
    "LIN", "SHW",
    # Real Estate
    "PLD", "AMT",
    # Utilities
    "NEE", "DUK", "SO",
]


# ── Output dataclass ─────────────────────────────────────────────────────────

@dataclass
class FactorScore:
    name: str
    name_zh: str
    raw_value: float
    percentile: float    # 0-100, higher = stronger exposure
    interpretation: str  # short text

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "name_zh": self.name_zh,
            "raw_value": round(self.raw_value, 4),
            "percentile": round(self.percentile, 1),
            "interpretation": self.interpretation,
        }


@dataclass
class FactorProfile:
    symbol: str
    sector: str | None
    peer_count: int
    factors: dict[str, FactorScore]
    summary: str
    summary_zh: str
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "sector": self.sector,
            "peer_count": self.peer_count,
            "factors": {k: v.to_dict() for k, v in self.factors.items()},
            "summary": self.summary,
            "summary_zh": self.summary_zh,
            "warnings": self.warnings,
        }


# ── Raw factor calculations ─────────────────────────────────────────────────

def _compute_raw_factors(symbol: str) -> dict[str, float]:
    """Compute the 6 raw factor values for one symbol.
    Returns dict with keys: value, quality, momentum, size, low_vol, low_inv.
    Returns NaN for any factor that can't be computed.
    """
    info = get_company_info(symbol)

    # ── Market data ──
    market_cap = info.get("marketCap")
    sector = info.get("sector")

    # ── Income / balance for fundamentals ──
    try:
        income = get_income_statement(symbol)
    except FinancialsError:
        income = pd.DataFrame()
    try:
        balance = get_balance_sheet(symbol)
    except FinancialsError:
        balance = pd.DataFrame()

    ni_curr = find_value(income, ALIAS_NET_INCOME, 0)
    rev_curr = find_value(income, ALIAS_REVENUE, 0)
    gp_curr = find_value(income, ALIAS_GROSS_PROFIT, 0)
    ta_curr = find_value(balance, ALIAS_TOTAL_ASSETS, 0)
    ta_prev = find_value(balance, ALIAS_TOTAL_ASSETS, 1)
    equity_curr = find_value(balance, ALIAS_TOTAL_EQUITY, 0)
    shares = find_value(balance, ALIAS_SHARES, 0) or info.get("sharesOutstanding")

    # ── Price history for momentum + volatility ──
    try:
        hist = get_price_history(symbol, period="2y")
    except FinancialsError:
        hist = pd.DataFrame()

    # 1. Value: BM = book equity / market cap
    book_to_market = float("nan")
    if equity_curr and market_cap and market_cap > 0:
        book_to_market = equity_curr / market_cap
    # Earnings yield (1/PE) as secondary
    earnings_yield = float("nan")
    if ni_curr and market_cap and market_cap > 0:
        earnings_yield = ni_curr / market_cap

    # Composite Value: average of standardized BM and EP (book + earnings yield)
    if not math.isnan(book_to_market) and not math.isnan(earnings_yield):
        value_raw = (book_to_market + earnings_yield) / 2
    elif not math.isnan(book_to_market):
        value_raw = book_to_market
    elif not math.isnan(earnings_yield):
        value_raw = earnings_yield
    else:
        value_raw = float("nan")

    # 2. Quality: ROE + Gross Profit / Assets (Novy-Marx)
    roe = (ni_curr / equity_curr) if (ni_curr is not None and equity_curr) else float("nan")
    gp_assets = (gp_curr / ta_curr) if (gp_curr is not None and ta_curr) else float("nan")
    if not math.isnan(roe) and not math.isnan(gp_assets):
        quality_raw = (roe + gp_assets) / 2
    elif not math.isnan(roe):
        quality_raw = roe
    elif not math.isnan(gp_assets):
        quality_raw = gp_assets
    else:
        quality_raw = float("nan")

    # 3. Momentum: 12-1 month return (skip last month to avoid reversal)
    momentum_raw = float("nan")
    if not hist.empty and len(hist) >= 252:
        # 252 trading days back to ~21 days back
        try:
            close_today = float(hist["Close"].iloc[-21])    # ~1 month ago
            close_year_ago = float(hist["Close"].iloc[-252])
            if close_year_ago > 0:
                momentum_raw = (close_today / close_year_ago) - 1
        except (IndexError, ValueError):
            pass

    # 4. Size: -log(market_cap) — higher value = smaller cap = more "small cap" exposure
    size_raw = float("nan")
    if market_cap and market_cap > 0:
        size_raw = -math.log(market_cap)

    # 5. Low Vol: -annualized volatility (negative because we want high score = low vol)
    low_vol_raw = float("nan")
    if not hist.empty and len(hist) >= 60:
        try:
            returns = hist["Close"].pct_change().dropna()
            vol = float(returns.rolling(252).std().iloc[-1] * math.sqrt(252))
            low_vol_raw = -vol
        except (ValueError, KeyError):
            pass

    # 6. Low Investment: -total asset growth YoY (Hou-Xue-Zhang)
    low_inv_raw = float("nan")
    if ta_curr and ta_prev and ta_prev > 0:
        asset_growth = (ta_curr - ta_prev) / ta_prev
        low_inv_raw = -asset_growth

    return {
        "value": value_raw,
        "quality": quality_raw,
        "momentum": momentum_raw,
        "size": size_raw,
        "low_vol": low_vol_raw,
        "low_inv": low_inv_raw,
        "_sector": sector,
    }


# ── Peer universe caching + percentile ───────────────────────────────────────

def _get_peer_factors(peer_universe: list[str]) -> pd.DataFrame:
    """Get raw factors for entire peer universe, cached for 24h.
    Returns DataFrame: rows = symbols, cols = factor names.
    """
    cache_file = _CACHE_DIR / f"peers_{hash(tuple(sorted(peer_universe))) & 0xFFFFFFFF:x}.json"

    # Try cache
    if cache_file.exists():
        try:
            stat = cache_file.stat()
            if time.time() - stat.st_mtime < _PEER_CACHE_TTL:
                with open(cache_file, "r") as f:
                    payload = json.load(f)
                df = pd.DataFrame(payload).T
                logger.info("Peer cache hit: %d symbols", df.shape[0])
                return df
        except Exception as exc:
            logger.warning("Peer cache read failed: %s", exc)

    # Compute fresh
    rows: dict[str, dict[str, float]] = {}
    for sym in peer_universe:
        try:
            raw = _compute_raw_factors(sym)
            # Drop _sector key for the numeric DataFrame
            rows[sym] = {k: v for k, v in raw.items() if not k.startswith("_")}
        except Exception as exc:
            logger.info("Peer %s skipped: %s", sym, exc)
            continue

    df = pd.DataFrame(rows).T

    # Persist cache
    try:
        with open(cache_file, "w") as f:
            json.dump({k: v for k, v in df.to_dict("index").items()}, f)
    except Exception as exc:
        logger.warning("Peer cache write failed: %s", exc)

    return df


def _percentile_rank(value: float, series: pd.Series) -> float:
    """Return 0-100 percentile rank of value within series (NaN-safe)."""
    if math.isnan(value):
        return 50.0   # neutral fallback
    clean = series.dropna()
    if clean.empty:
        return 50.0
    rank = (clean < value).sum()
    pct = rank / len(clean) * 100
    return float(pct)


# ── Interpretation ──────────────────────────────────────────────────────────

def _interpret(name: str, percentile: float) -> str:
    """One-line interpretation in Chinese."""
    if percentile >= 75:
        level = "高"
    elif percentile >= 50:
        level = "中高"
    elif percentile >= 25:
        level = "中低"
    else:
        level = "低"

    interpretations = {
        "value": f"{level}价值（BM+EP 综合）",
        "quality": f"{level}质量（ROE+毛利率/资产）",
        "momentum": f"{level}动量（过去 12-1 月收益）",
        "size": f"{level}小盘暴露",
        "low_vol": f"{level}低波动（年化波动率倒数）",
        "low_inv": f"{level}低投资（总资产增长率倒数）",
    }
    return interpretations.get(name, level)


def _build_summary(profile: dict[str, FactorScore]) -> tuple[str, str]:
    """Identify top 2-3 factor exposures and write short summary."""
    sorted_factors = sorted(profile.items(), key=lambda kv: kv[1].percentile, reverse=True)
    top = [(k, v) for k, v in sorted_factors[:3] if v.percentile >= 60]

    name_map_zh = {
        "value": "价值偏好",
        "quality": "高质量",
        "momentum": "强动量",
        "size": "小盘",
        "low_vol": "低波动",
        "low_inv": "低投资",
    }
    name_map_en = {
        "value": "value-tilted",
        "quality": "high quality",
        "momentum": "strong momentum",
        "size": "small-cap",
        "low_vol": "low volatility",
        "low_inv": "low investment",
    }

    if not top:
        return ("Balanced exposure with no dominant style", "无明显风格倾向，各维度均衡")
    zh = "、".join(name_map_zh.get(k, k) for k, _ in top)
    en = ", ".join(name_map_en.get(k, k) for k, _ in top)
    return (f"Profile: {en}", f"风格画像：{zh}")


# ── Public API ───────────────────────────────────────────────────────────────

def compute_factor_profile(
    symbol: str,
    peer_universe: list[str] | None = None,
) -> FactorProfile:
    """Compute 6-dim factor profile for a stock.

    Args:
        symbol: stock ticker
        peer_universe: list of peer tickers (default: DEFAULT_PEER_UNIVERSE)

    Returns:
        FactorProfile with raw values + percentiles + interpretation
    """
    sym = symbol.upper()
    peers = peer_universe or DEFAULT_PEER_UNIVERSE
    if sym not in peers:
        peers = [sym] + peers   # ensure target is in universe

    # Compute target stock's raw factors
    raw = _compute_raw_factors(sym)
    sector = raw.pop("_sector", None)

    warnings: list[str] = []
    nan_factors = [k for k, v in raw.items() if math.isnan(v)]
    if nan_factors:
        warnings.append(f"以下因子数据缺失，按 50% 分位处理: {', '.join(nan_factors)}")

    # Compute peer universe (cached)
    peer_df = _get_peer_factors(peers)
    peer_count = peer_df.shape[0]
    if peer_count < 5:
        warnings.append(f"参考股票池仅 {peer_count} 只，百分位结果不够稳定")

    # Build factor scores with percentiles
    factors: dict[str, FactorScore] = {}
    name_map_zh = {
        "value": "价值",
        "quality": "质量",
        "momentum": "动量",
        "size": "小盘",
        "low_vol": "低波动",
        "low_inv": "低投资",
    }

    for fname in ["value", "quality", "momentum", "size", "low_vol", "low_inv"]:
        raw_value = raw[fname]
        percentile = (
            _percentile_rank(raw_value, peer_df[fname])
            if fname in peer_df.columns
            else 50.0
        )
        factors[fname] = FactorScore(
            name=fname,
            name_zh=name_map_zh[fname],
            raw_value=raw_value if not math.isnan(raw_value) else 0.0,
            percentile=percentile,
            interpretation=_interpret(fname, percentile),
        )

    summary_en, summary_zh = _build_summary(factors)

    return FactorProfile(
        symbol=sym,
        sector=sector,
        peer_count=peer_count,
        factors=factors,
        summary=summary_en,
        summary_zh=summary_zh,
        warnings=warnings,
    )
