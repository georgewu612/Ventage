"""Financials Provider — yfinance + AlphaVantage dual-source with fallback.

Used by DCF, F-Score, Factor Profile etc. for company fundamental data.

Strategy:
    1. yfinance first (free, fast, no rate limit)
    2. AlphaVantage fallback if yfinance returns incomplete data
    3. Cache by (symbol, statement_kind) for 6 hours to avoid repeat fetches

Public API:
    get_income_statement(symbol)  -> pd.DataFrame   # rows = line items, cols = years
    get_balance_sheet(symbol)     -> pd.DataFrame
    get_cash_flow(symbol)         -> pd.DataFrame
    get_company_info(symbol)      -> dict           # sector / market_cap / shares / etc
    get_price_history(symbol, period='1y') -> pd.DataFrame
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx
import pandas as pd
import yfinance as yf

logger = logging.getLogger(__name__)

StatementKind = Literal["income", "balance", "cashflow"]

# ── In-memory cache (6h TTL) ──────────────────────────────────────────────────

_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL_SECONDS = 6 * 3600


def _cache_get(key: str) -> Any | None:
    if key not in _cache:
        return None
    ts, value = _cache[key]
    if time.time() - ts > _CACHE_TTL_SECONDS:
        del _cache[key]
        return None
    return value


def _cache_set(key: str, value: Any) -> None:
    _cache[key] = (time.time(), value)


# ── Errors ────────────────────────────────────────────────────────────────────

class FinancialsError(Exception):
    """Raised when both data providers fail."""


# ── yfinance fetchers ─────────────────────────────────────────────────────────

def _yf_statement(symbol: str, kind: StatementKind) -> pd.DataFrame:
    ticker = yf.Ticker(symbol)
    if kind == "income":
        df = ticker.income_stmt
    elif kind == "balance":
        df = ticker.balance_sheet
    elif kind == "cashflow":
        df = ticker.cashflow
    else:
        raise ValueError(f"Unknown statement kind: {kind}")
    if df is None or df.empty:
        raise FinancialsError(f"yfinance returned empty {kind} for {symbol}")
    return df


def _yf_info(symbol: str) -> dict[str, Any]:
    info = yf.Ticker(symbol).info or {}
    if not info or not info.get("symbol"):
        raise FinancialsError(f"yfinance returned empty info for {symbol}")
    return info


# ── AlphaVantage fetchers ─────────────────────────────────────────────────────

_AV_BASE = "https://www.alphavantage.co/query"


def _av_call(function: str, symbol: str) -> dict[str, Any]:
    """Call AlphaVantage API; raises FinancialsError on failure."""
    from config.settings import get_settings
    s = get_settings()
    if not s.alphavantage_api_key:
        raise FinancialsError("AlphaVantage not configured")
    params = {"function": function, "symbol": symbol.upper(), "apikey": s.alphavantage_api_key}
    try:
        with httpx.Client(timeout=20.0) as client:
            resp = client.get(_AV_BASE, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise FinancialsError(f"AlphaVantage HTTP error: {exc}") from exc

    if "Error Message" in data:
        raise FinancialsError(f"AlphaVantage: {data['Error Message']}")
    if "Note" in data and "API call frequency" in data.get("Note", ""):
        raise FinancialsError("AlphaVantage rate limit exceeded")
    return data


def _av_statement(symbol: str, kind: StatementKind) -> pd.DataFrame:
    """Fetch statement from AlphaVantage and convert to yfinance-shaped DataFrame.

    yfinance shape: rows = line items, columns = year-end dates (most-recent first).
    """
    fn_map = {
        "income": "INCOME_STATEMENT",
        "balance": "BALANCE_SHEET",
        "cashflow": "CASH_FLOW",
    }
    data = _av_call(fn_map[kind], symbol)
    annuals = data.get("annualReports") or []
    if not annuals:
        raise FinancialsError(f"AlphaVantage returned no annual {kind} for {symbol}")

    # Build a wide DataFrame: cols = fiscalDateEnding, rows = field names
    df = pd.DataFrame(annuals).set_index("fiscalDateEnding").T
    df.columns = pd.to_datetime(df.columns)
    # Convert numeric strings to floats (AV returns "None" or numeric strings)
    df = df.apply(pd.to_numeric, errors="coerce")
    return df


def _av_info(symbol: str) -> dict[str, Any]:
    data = _av_call("OVERVIEW", symbol)
    if not data or not data.get("Symbol"):
        raise FinancialsError(f"AlphaVantage OVERVIEW empty for {symbol}")

    # Map AV keys to yfinance-style keys (lowercase + camelCase)
    mc = _to_float(data.get("MarketCapitalization"))
    return {
        "symbol": data.get("Symbol"),
        "shortName": data.get("Name"),
        "sector": data.get("Sector"),
        "industry": data.get("Industry"),
        "marketCap": mc,
        "sharesOutstanding": _to_float(data.get("SharesOutstanding")),
        "currentPrice": _to_float(data.get("AnalystTargetPrice")),  # imprecise
        "totalDebt": None,  # not in OVERVIEW
        "totalCash": None,
        "beta": _to_float(data.get("Beta")),
        "debtToEquity": _to_float(data.get("DebtToEquityRatio")) or 0,
        "returnOnEquityTTM": _to_float(data.get("ReturnOnEquityTTM")),
        "_source": "alphavantage",
    }


def _to_float(v: Any) -> float | None:
    if v is None or v in ("None", "-", ""):
        return None
    try:
        f = float(v)
        return f if pd.notna(f) else None
    except (TypeError, ValueError):
        return None


# ── Public API with fallback ──────────────────────────────────────────────────

def get_statement(symbol: str, kind: StatementKind) -> pd.DataFrame:
    """Get financial statement with yfinance→AlphaVantage fallback."""
    cache_key = f"stmt:{symbol.upper()}:{kind}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    # Try yfinance first
    try:
        df = _yf_statement(symbol, kind)
        # Sanity check: must have at least 2 columns (years)
        if df.shape[1] >= 2:
            _cache_set(cache_key, df)
            return df
        logger.info("yfinance %s schema thin for %s, falling back to AV", kind, symbol)
    except FinancialsError as exc:
        logger.info("yfinance %s failed for %s: %s, trying AV", kind, symbol, exc)
    except Exception as exc:
        logger.warning("yfinance %s unexpected error for %s: %s", kind, symbol, exc)

    # Fallback to AlphaVantage
    try:
        df = _av_statement(symbol, kind)
        _cache_set(cache_key, df)
        return df
    except FinancialsError as exc:
        raise FinancialsError(f"Both providers failed for {symbol} {kind}: {exc}")


def get_income_statement(symbol: str) -> pd.DataFrame:
    return get_statement(symbol, "income")


def get_balance_sheet(symbol: str) -> pd.DataFrame:
    return get_statement(symbol, "balance")


def get_cash_flow(symbol: str) -> pd.DataFrame:
    return get_statement(symbol, "cashflow")


def get_company_info(symbol: str) -> dict[str, Any]:
    cache_key = f"info:{symbol.upper()}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        info = _yf_info(symbol)
        info["_source"] = "yfinance"
        _cache_set(cache_key, info)
        return info
    except FinancialsError as exc:
        logger.info("yfinance info failed for %s: %s, trying AV", symbol, exc)

    try:
        info = _av_info(symbol)
        _cache_set(cache_key, info)
        return info
    except FinancialsError as exc:
        raise FinancialsError(f"Both providers failed for {symbol} info: {exc}")


def get_price_history(symbol: str, period: str = "1y") -> pd.DataFrame:
    """Get OHLCV. yfinance only — AV's TIME_SERIES_DAILY is on free tier but slow."""
    cache_key = f"hist:{symbol.upper()}:{period}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    try:
        hist = yf.Ticker(symbol).history(period=period, auto_adjust=True)
        if hist is None or hist.empty:
            raise FinancialsError(f"No price history for {symbol}")
        _cache_set(cache_key, hist)
        return hist
    except Exception as exc:
        raise FinancialsError(f"Price history failed for {symbol}: {exc}")


# ── Helper: row-finder with multiple aliases (for line items) ────────────────

def find_row(df: pd.DataFrame, candidates: list[str]) -> pd.Series | None:
    """Find a row in financial statement by trying multiple field name variants."""
    if df is None or df.empty:
        return None
    for name in candidates:
        if name in df.index:
            return df.loc[name]
        # Case-insensitive partial match
        for idx in df.index:
            if str(idx).lower() == name.lower():
                return df.loc[idx]
    return None


def find_value(df: pd.DataFrame, candidates: list[str], col_idx: int = 0) -> float | None:
    """Find a single most-recent value (or YoY column index)."""
    row = find_row(df, candidates)
    if row is None:
        return None
    try:
        v = row.iloc[col_idx]
        return float(v) if pd.notna(v) else None
    except (IndexError, TypeError, ValueError):
        return None


# ── Status ────────────────────────────────────────────────────────────────────

@dataclass
class ProviderStatus:
    yfinance_available: bool
    alphavantage_configured: bool
    cache_size: int


def status() -> ProviderStatus:
    from config.settings import get_settings
    s = get_settings()
    return ProviderStatus(
        yfinance_available=True,    # always
        alphavantage_configured=bool(s.alphavantage_api_key),
        cache_size=len(_cache),
    )
