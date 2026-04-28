"""Technical analysis API — on-demand OHLC + indicators via yfinance."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from config.settings import get_settings
from services.vm_scorer import VMScorer

router = APIRouter()

# period → yfinance period string
PERIOD_MAP = {
    "1d": "1d",
    "5d": "5d",
    "1m": "1mo",
    "3m": "3mo",
    "6m": "6mo",
    "1y": "1y",
    "2y": "2y",
}

# interval → yfinance interval string
INTERVAL_MAP = {
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
    "1h": "1h",
    "1d": "1d",
}

# yfinance limits: max period for each interval
INTERVAL_MAX_PERIOD = {
    "1min": "5d",  # 1m data max 7 days
    "5min": "1m",  # 5m data max 60 days
    "15min": "1m",  # 15m data max 60 days
    "1h": "3m",  # 1h data max 730 days
    "1d": "2y",  # daily data unlimited
}


def _compute_rsi(prices: pd.Series, period: int = 14) -> pd.Series:
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0).rolling(period).mean()
    loss = (-delta.where(delta < 0, 0.0)).rolling(period).mean()
    rs = gain / loss
    return 100 - (100 / (1 + rs))


def _compute_macd(
    prices: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9
) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema_fast = prices.ewm(span=fast, adjust=False).mean()
    ema_slow = prices.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def _compute_bollinger(
    prices: pd.Series, period: int = 20, num_std: float = 2.0
) -> tuple[pd.Series, pd.Series, pd.Series]:
    sma = prices.rolling(period).mean()
    std = prices.rolling(period).std()
    upper = sma + num_std * std
    lower = sma - num_std * std
    return upper, sma, lower


def _safe_float(val: Any) -> float | None:
    """Convert numpy/pandas value to Python float, handling NaN."""
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    try:
        f = float(val)
        return None if np.isnan(f) else round(f, 4)
    except (TypeError, ValueError):
        return None


@router.get("/technical/{symbol}")
def get_technical_analysis(
    symbol: str,
    period: str = Query(default="3m", description="1d, 5d, 1m, 3m, 6m, 1y, 2y"),
    interval: str = Query(default="1d", description="1min, 5min, 15min, 1h, 1d"),
) -> dict[str, Any]:
    """Fetch OHLC data and compute technical indicators for a symbol."""
    yf_period = PERIOD_MAP.get(period)
    if not yf_period:
        raise HTTPException(
            status_code=400, detail=f"Invalid period: {period}. Use: {list(PERIOD_MAP.keys())}"
        )

    yf_interval = INTERVAL_MAP.get(interval)
    if not yf_interval:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid interval: {interval}. Use: {list(INTERVAL_MAP.keys())}",
        )

    # Enforce yfinance period limits for intraday intervals
    max_period = INTERVAL_MAX_PERIOD.get(interval, "2y")
    period_order = list(PERIOD_MAP.keys())
    if period_order.index(period) > period_order.index(max_period):
        yf_period = PERIOD_MAP[max_period]

    try:
        ticker = yf.Ticker(symbol.upper())
        df = ticker.history(period=yf_period, interval=yf_interval)
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail=f"Failed to fetch data from Yahoo Finance: {exc}"
        ) from exc

    if df.empty:
        raise HTTPException(status_code=404, detail=f"No data found for symbol: {symbol.upper()}")

    close = df["Close"]

    # Compute indicators
    rsi = _compute_rsi(close)
    macd_line, macd_signal, macd_hist = _compute_macd(close)
    bb_upper, bb_mid, bb_lower = _compute_bollinger(close)
    sma_20 = close.rolling(20).mean()
    sma_50 = close.rolling(50).mean()
    ema_12 = close.ewm(span=12, adjust=False).mean()

    # Build OHLC candles array
    candles = []
    for idx, row in df.iterrows():
        ts = int(idx.timestamp())
        candles.append(
            {
                "time": ts,
                "open": _safe_float(row["Open"]),
                "high": _safe_float(row["High"]),
                "low": _safe_float(row["Low"]),
                "close": _safe_float(row["Close"]),
                "volume": int(row["Volume"]) if not np.isnan(row["Volume"]) else 0,
            }
        )

    # Build indicator series (aligned with candles by timestamp)
    indicators: dict[str, list] = {
        "rsi": [],
        "macd_line": [],
        "macd_signal": [],
        "macd_hist": [],
        "bb_upper": [],
        "bb_mid": [],
        "bb_lower": [],
        "sma_20": [],
        "sma_50": [],
        "ema_12": [],
    }

    for idx in df.index:
        ts = int(idx.timestamp())
        for key, series in [
            ("rsi", rsi),
            ("macd_line", macd_line),
            ("macd_signal", macd_signal),
            ("macd_hist", macd_hist),
            ("bb_upper", bb_upper),
            ("bb_mid", bb_mid),
            ("bb_lower", bb_lower),
            ("sma_20", sma_20),
            ("sma_50", sma_50),
            ("ema_12", ema_12),
        ]:
            val = _safe_float(series.get(idx))
            if val is not None:
                indicators[key].append({"time": ts, "value": val})

    # Latest values for summary cards
    latest_close = _safe_float(close.iloc[-1])
    prev_close = _safe_float(close.iloc[-2]) if len(close) > 1 else latest_close
    change = round(latest_close - prev_close, 4) if latest_close and prev_close else 0
    change_pct = round((change / prev_close) * 100, 2) if prev_close else 0

    latest = {
        "price": latest_close,
        "change": change,
        "change_pct": change_pct,
        "rsi": _safe_float(rsi.iloc[-1]),
        "macd": _safe_float(macd_line.iloc[-1]),
        "macd_signal": _safe_float(macd_signal.iloc[-1]),
        "macd_hist": _safe_float(macd_hist.iloc[-1]),
        "sma_20": _safe_float(sma_20.iloc[-1]),
        "sma_50": _safe_float(sma_50.iloc[-1]),
        "bb_upper": _safe_float(bb_upper.iloc[-1]),
        "bb_lower": _safe_float(bb_lower.iloc[-1]),
        "volume": int(df["Volume"].iloc[-1]) if not np.isnan(df["Volume"].iloc[-1]) else 0,
        "high_52w": _safe_float(close.rolling(252).max().iloc[-1])
        if len(close) >= 252
        else _safe_float(close.max()),
        "low_52w": _safe_float(close.rolling(252).min().iloc[-1])
        if len(close) >= 252
        else _safe_float(close.min()),
    }

    # Simple technical signal
    signals = []
    if latest["rsi"] is not None:
        if latest["rsi"] > 70:
            signals.append({"indicator": "RSI", "signal": "overbought", "direction": "bearish"})
        elif latest["rsi"] < 30:
            signals.append({"indicator": "RSI", "signal": "oversold", "direction": "bullish"})

    if latest["macd"] is not None and latest["macd_signal"] is not None:
        if latest["macd"] > latest["macd_signal"]:
            signals.append(
                {"indicator": "MACD", "signal": "bullish_crossover", "direction": "bullish"}
            )
        else:
            signals.append(
                {"indicator": "MACD", "signal": "bearish_crossover", "direction": "bearish"}
            )

    if latest["price"] is not None and latest["sma_20"] is not None:
        if latest["price"] > latest["sma_20"]:
            signals.append({"indicator": "SMA20", "signal": "above_sma", "direction": "bullish"})
        else:
            signals.append({"indicator": "SMA20", "signal": "below_sma", "direction": "bearish"})

    if latest["price"] is not None and latest["sma_50"] is not None:
        if latest["price"] > latest["sma_50"]:
            signals.append({"indicator": "SMA50", "signal": "above_sma", "direction": "bullish"})
        else:
            signals.append({"indicator": "SMA50", "signal": "below_sma", "direction": "bearish"})

    return {
        "symbol": symbol.upper(),
        "period": period,
        "interval": interval,
        "candles": candles,
        "indicators": indicators,
        "latest": latest,
        "signals": signals,
    }


@router.get("/technical/{symbol}/analog")
def get_historical_analog(symbol: str) -> dict[str, Any]:
    """Find historical periods with similar market regime/VIX and compute forward returns.

    Uses the latest market_regime_snapshots entry to identify the current VIX range,
    then scans 5 years of daily history for similar environments and returns forward
    5/10/20-day return statistics for the requested symbol.
    """
    from supabase import create_client
    from config.settings import get_settings

    settings = get_settings()

    # ── 1. Fetch current regime from DB ───────────────────────────────────────
    current_vix: float | None = None
    current_regime: str = "neutral"
    spy_above_200ma: bool = True

    try:
        if settings.has_supabase_config:
            db = create_client(settings.supabase_url, settings.supabase_service_role_key)
            regime_res = (
                db.table("market_regime_snapshots")
                .select("regime, vix, spy_vs_200ma_pct")
                .order("generated_at", desc=True)
                .limit(1)
                .execute()
            )
            if regime_res.data:
                snap = regime_res.data[0]
                current_vix = snap.get("vix")
                current_regime = snap.get("regime", "neutral")
                spy_vs_200ma = snap.get("spy_vs_200ma_pct", 0) or 0
                spy_above_200ma = float(spy_vs_200ma) >= 0
    except Exception:
        pass  # fall back to default values

    # ── 2. Pull 5-year daily data for symbol + SPY ────────────────────────────
    sym_upper = symbol.upper()
    try:
        sym_df = yf.Ticker(sym_upper).history(period="5y", interval="1d")
        spy_df = yf.Ticker("SPY").history(period="5y", interval="1d")
        vix_df = yf.Ticker("^VIX").history(period="5y", interval="1d")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch data: {exc}") from exc

    if sym_df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {sym_upper}")

    # Align all series by date index
    sym_close = sym_df["Close"].rename("sym")
    spy_close = spy_df["Close"].rename("spy") if not spy_df.empty else pd.Series(dtype=float)
    vix_close = vix_df["Close"].rename("vix") if not vix_df.empty else pd.Series(dtype=float)

    # Normalize index to date (remove tz)
    for s in [sym_close, spy_close, vix_close]:
        if hasattr(s.index, "tz_localize"):
            try:
                s.index = s.index.tz_localize(None)
            except TypeError:
                s.index = s.index.tz_convert(None)

    combined = pd.concat([sym_close, spy_close, vix_close], axis=1).dropna()

    if combined.empty or len(combined) < 30:
        return {
            "symbol": sym_upper,
            "regime": current_regime,
            "sample_count": 0,
            "avg_5d": None,
            "avg_10d": None,
            "avg_20d": None,
            "win_rate_5d": None,
            "win_rate_20d": None,
            "max_drawdown_pct": None,
            "windows": [],
        }

    # ── 3. SPY 200-day MA ─────────────────────────────────────────────────────
    combined["spy_sma200"] = combined["spy"].rolling(200).mean()
    combined["spy_above_200ma"] = combined["spy"] > combined["spy_sma200"]

    # ── 4. Identify analog windows ────────────────────────────────────────────
    # VIX tolerance: ±30% of current_vix (or fallback range 15-25)
    if current_vix and current_vix > 0:
        vix_low = current_vix * 0.70
        vix_high = current_vix * 1.30
    else:
        vix_low, vix_high = 12.0, 30.0

    windows = []
    returns_5d: list[float] = []
    returns_10d: list[float] = []
    returns_20d: list[float] = []

    dates = combined.index.tolist()
    # Leave at least 20 trading days at the end for forward returns
    for i, date in enumerate(dates[:-25]):
        row = combined.iloc[i]
        vix_val = row.get("vix", np.nan)
        spy_flag = bool(row.get("spy_above_200ma", spy_above_200ma))

        # Filter: VIX in range AND SPY direction matches
        if np.isnan(vix_val):
            continue
        if not (vix_low <= vix_val <= vix_high):
            continue
        if spy_flag != spy_above_200ma:
            continue

        sym_price = row["sym"]

        # Forward returns
        def _fwd(days: int) -> float | None:
            j = i + days
            if j < len(combined):
                fwd_price = combined.iloc[j]["sym"]
                return round((fwd_price / sym_price - 1) * 100, 2)
            return None

        r5 = _fwd(5)
        r10 = _fwd(10)
        r20 = _fwd(20)

        if r5 is not None:
            returns_5d.append(r5)
        if r10 is not None:
            returns_10d.append(r10)
        if r20 is not None:
            returns_20d.append(r20)

        windows.append({
            "start": date.strftime("%Y-%m-%d") if hasattr(date, "strftime") else str(date)[:10],
            "vix": round(float(vix_val), 1),
            "return_5d": r5,
            "return_20d": r20,
        })

    # Limit to most recent 20 analog windows for the chart
    windows_recent = windows[-20:] if len(windows) > 20 else windows

    # ── 5. Compute statistics ─────────────────────────────────────────────────
    def _avg(lst: list[float]) -> float | None:
        return round(sum(lst) / len(lst), 2) if lst else None

    def _win_rate(lst: list[float]) -> float | None:
        return round(sum(1 for r in lst if r > 0) / len(lst) * 100, 1) if lst else None

    def _max_dd(lst: list[float]) -> float | None:
        if not lst:
            return None
        return round(min(lst), 2)

    return {
        "symbol": sym_upper,
        "regime": current_regime,
        "current_vix": round(current_vix, 1) if current_vix else None,
        "sample_count": len(windows),
        "avg_5d": _avg(returns_5d),
        "avg_10d": _avg(returns_10d),
        "avg_20d": _avg(returns_20d),
        "win_rate_5d": _win_rate(returns_5d),
        "win_rate_20d": _win_rate(returns_20d),
        "max_drawdown_pct": _max_dd(returns_20d),
        "windows": windows_recent,
    }


# ── V&M Score endpoint ─────────────────────────────────────────────────────────

@router.get("/technical/{symbol}/value")
def get_vm_score(symbol: str) -> dict[str, Any]:
    """Return Value & Momentum composite score for a symbol.

    Combines:
      - Fundamental value_score from value_scores table (PE/PB/FCF/etc.)
      - Momentum signal_score from market_signals table
      - Regime-aware composite weighting from market_regime_snapshots

    If value_scores has no data for this symbol yet, triggers a live
    yfinance fetch and returns the score without persisting (on-demand mode).
    """
    sym_upper = symbol.upper()
    settings = get_settings()
    db = create_client(settings.supabase_url, settings.supabase_service_role_key)
    scorer = VMScorer(db=db)

    # Get current regime
    try:
        regime_rows = (
            db.table("market_regime_snapshots")
            .select("regime")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        regime = regime_rows[0]["regime"] if regime_rows else "neutral"
    except Exception:
        regime = "neutral"

    # Check if we have cached value data
    value_row = scorer._get_value_score(sym_upper)

    # On-demand fetch if not cached
    if value_row is None:
        try:
            from etl.collectors.value_collector import ValueCollector, compute_value_score, _safe_float
            ticker = yf.Ticker(sym_upper)
            info = ticker.info or {}
            raw = {
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
            vs, vt = compute_value_score(raw)
            # Upsert so next call is instant
            from datetime import UTC, datetime
            db.table("value_scores").upsert({
                "symbol": sym_upper,
                **{k: (int(v) if k == "free_cashflow" and v is not None else v)
                   for k, v in raw.items()},
                "value_score": vs,
                "value_tier": vt,
                "updated_at": datetime.now(UTC).isoformat(),
            }, on_conflict="symbol").execute()
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Failed to fetch value data: {exc}")

    result = scorer.score_symbol(sym_upper, regime)
    return result
