"""Value Screener Collector.

Pulls fundamental financial metrics via yfinance for a defined symbol universe,
computes a value_score (0-100) per stock, and upserts into the value_scores table.

Scoring methodology:
  - P/E ratio         (lower = better, capped at 40)
  - P/B ratio         (lower = better, capped at 8)
  - P/S ratio         (lower = better, capped at 10)
  - Free Cash Flow    (positive = bonus)
  - Debt/Equity       (lower = better)
  - ROE               (higher = better)
  - Dividend Yield    (presence = small bonus)
  - Revenue Growth    (positive trending = bonus)

Total score is normalized to 0-100 with tier classification:
  80-100 → deep_value
  60-79  → value
  40-59  → fair
  20-39  → expensive
  0-19   → avoid
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any

import structlog
import yfinance as yf

from etl.base import BaseCollector

logger = structlog.get_logger()

# ── Default universe ───────────────────────────────────────────────────────────
# Broad US equity universe: large-cap S&P names + sector leaders
DEFAULT_UNIVERSE: list[str] = [
    # Mega-cap tech
    "AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "TSM", "AVGO",
    # Financials
    "JPM", "BAC", "GS", "MS", "WFC", "BRK-B", "V", "MA",
    # Healthcare
    "JNJ", "UNH", "LLY", "ABBV", "MRK", "PFE", "TMO",
    # Industrials
    "CAT", "DE", "HON", "GE", "RTX", "UPS", "BA",
    # Consumer
    "PG", "KO", "PEP", "WMT", "COST", "MCD", "SBUX",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG",
    # Materials / Other
    "LIN", "APD", "NEM", "FCX",
    # Growth / Mid-cap
    "CRM", "NOW", "SNOW", "PLTR", "PANW", "CRWD",
    # Small/mid popular
    "RIVN", "SOFI", "HOOD", "COIN", "RBLX", "UBER", "LYFT",
]


def _safe_float(val: Any, default: float | None = None) -> float | None:
    """Safely convert a value to float."""
    try:
        if val is None or val != val:  # NaN check
            return default
        return float(val)
    except (TypeError, ValueError):
        return default


def compute_value_score(metrics: dict[str, Any]) -> tuple[float, str]:
    """Compute a 0-100 value score from raw financial metrics.

    Returns (score, tier).
    """
    score = 0.0
    max_score = 0.0

    # ── P/E ratio (weight: 25 pts) ─────────────────────────────────────────────
    pe = _safe_float(metrics.get("pe_ratio"))
    max_score += 25
    if pe is not None and pe > 0:
        if pe < 10:
            score += 25
        elif pe < 15:
            score += 22
        elif pe < 20:
            score += 18
        elif pe < 25:
            score += 13
        elif pe < 35:
            score += 7
        # pe >= 35 or negative → 0 pts

    # ── P/B ratio (weight: 15 pts) ─────────────────────────────────────────────
    pb = _safe_float(metrics.get("pb_ratio"))
    max_score += 15
    if pb is not None and pb > 0:
        if pb < 1:
            score += 15
        elif pb < 2:
            score += 12
        elif pb < 3:
            score += 9
        elif pb < 5:
            score += 5
        elif pb < 8:
            score += 2

    # ── P/S ratio (weight: 10 pts) ─────────────────────────────────────────────
    ps = _safe_float(metrics.get("ps_ratio"))
    max_score += 10
    if ps is not None and ps > 0:
        if ps < 1:
            score += 10
        elif ps < 2:
            score += 8
        elif ps < 4:
            score += 5
        elif ps < 7:
            score += 2

    # ── Free Cash Flow positive (weight: 20 pts) ───────────────────────────────
    fcf = _safe_float(metrics.get("free_cashflow"))
    max_score += 20
    if fcf is not None:
        if fcf > 1_000_000_000:    # > $1B FCF
            score += 20
        elif fcf > 100_000_000:    # > $100M FCF
            score += 15
        elif fcf > 0:
            score += 8
        # Negative FCF → 0 pts

    # ── Debt/Equity (weight: 10 pts) ───────────────────────────────────────────
    de = _safe_float(metrics.get("debt_to_equity"))
    max_score += 10
    if de is not None and de >= 0:
        if de < 0.3:
            score += 10
        elif de < 0.6:
            score += 8
        elif de < 1.0:
            score += 5
        elif de < 1.5:
            score += 2

    # ── ROE (weight: 10 pts) ───────────────────────────────────────────────────
    roe = _safe_float(metrics.get("roe"))
    max_score += 10
    if roe is not None:
        if roe > 0.25:   # > 25%
            score += 10
        elif roe > 0.15:
            score += 7
        elif roe > 0.08:
            score += 4
        elif roe > 0:
            score += 1

    # ── Dividend yield (weight: 5 pts, bonus for income) ──────────────────────
    div = _safe_float(metrics.get("dividend_yield"))
    max_score += 5
    if div is not None and div > 0:
        if div > 0.04:   # > 4%
            score += 5
        elif div > 0.02:
            score += 3
        else:
            score += 1

    # ── Revenue growth (weight: 5 pts) ─────────────────────────────────────────
    rev_g = _safe_float(metrics.get("revenue_growth"))
    max_score += 5
    if rev_g is not None:
        if rev_g > 0.20:
            score += 5
        elif rev_g > 0.10:
            score += 3
        elif rev_g > 0:
            score += 1

    # Normalize to 0-100
    normalized = round((score / max_score) * 100, 2) if max_score > 0 else 0.0

    # Tier classification
    if normalized >= 80:
        tier = "deep_value"
    elif normalized >= 60:
        tier = "value"
    elif normalized >= 40:
        tier = "fair"
    elif normalized >= 20:
        tier = "expensive"
    else:
        tier = "avoid"

    return normalized, tier


class ValueCollector(BaseCollector):
    """Collects fundamental value metrics and scores for a symbol universe."""

    name = "value_screener"

    def __init__(self, supabase_client: Any, symbols: list[str] | None = None) -> None:
        super().__init__(supabase_client)
        self.symbols = symbols or DEFAULT_UNIVERSE

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch yfinance fundamentals for all symbols."""
        records: list[dict[str, Any]] = []
        # yfinance calls are synchronous; run in executor to avoid blocking
        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None, self._fetch_all_sync
        )
        records.extend(results)
        return records

    def _fetch_all_sync(self) -> list[dict[str, Any]]:
        """Synchronous batch fetch for all symbols."""
        records = []
        for symbol in self.symbols:
            try:
                rec = self._fetch_one(symbol)
                if rec:
                    records.append(rec)
            except Exception as exc:
                self.log.warning("symbol_fetch_failed", symbol=symbol, error=str(exc))
        return records

    def _fetch_one(self, symbol: str) -> dict[str, Any] | None:
        """Fetch and score one symbol."""
        ticker = yf.Ticker(symbol)
        info = ticker.info or {}

        if not info or info.get("regularMarketPrice") is None:
            self.log.debug("no_data", symbol=symbol)
            return None

        raw_metrics = {
            "pe_ratio":       _safe_float(info.get("trailingPE") or info.get("forwardPE")),
            "pb_ratio":       _safe_float(info.get("priceToBook")),
            "ps_ratio":       _safe_float(info.get("priceToSalesTrailing12Months")),
            "free_cashflow":  _safe_float(info.get("freeCashflow")),
            "dividend_yield": _safe_float(info.get("dividendYield")),
            "debt_to_equity": _safe_float(info.get("debtToEquity")),
            "roe":            _safe_float(info.get("returnOnEquity")),
            "revenue_growth": _safe_float(info.get("revenueGrowth")),
            "earnings_growth":_safe_float(info.get("earningsGrowth")),
        }

        value_score, value_tier = compute_value_score(raw_metrics)

        return {
            "symbol":         symbol,
            "pe_ratio":       raw_metrics["pe_ratio"],
            "pb_ratio":       raw_metrics["pb_ratio"],
            "ps_ratio":       raw_metrics["ps_ratio"],
            "free_cashflow":  int(raw_metrics["free_cashflow"]) if raw_metrics["free_cashflow"] is not None else None,
            "dividend_yield": raw_metrics["dividend_yield"],
            "debt_to_equity": raw_metrics["debt_to_equity"],
            "roe":            raw_metrics["roe"],
            "revenue_growth": raw_metrics["revenue_growth"],
            "earnings_growth":raw_metrics["earnings_growth"],
            "value_score":    value_score,
            "value_tier":     value_tier,
            "updated_at":     datetime.now(UTC).isoformat(),
        }

    async def load(self, records: list[dict[str, Any]]) -> int:
        """Upsert value scores into the value_scores table."""
        if not records:
            return 0
        try:
            self.db.table("value_scores").upsert(records, on_conflict="symbol").execute()
            self.log.info("upserted", count=len(records))
            return len(records)
        except Exception as exc:
            self.log.error("load_failed", error=str(exc))
            raise
