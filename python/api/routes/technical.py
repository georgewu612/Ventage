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


# ── Support / Resistance + Pattern Recognition endpoint ───────────────────────

def _find_sr_levels(
    high: pd.Series,
    low: pd.Series,
    close: pd.Series,
    volume: pd.Series | None = None,
    window: int = 8,
    cluster_pct: float = 0.015,
    min_touches: int = 2,
    weekly_high: pd.Series | None = None,
    weekly_low: pd.Series | None = None,
) -> tuple[list[dict], list[dict]]:
    """Detect support and resistance levels using enhanced multi-factor algorithm.

    Improvements over v1:
    1. Volume-weighted extrema — high-volume swing points count double
    2. Multi-timeframe confluence — levels confirmed on weekly chart promoted to 'key'
    3. Wick-aware touch counting — counts price approaches within cluster_pct on OHLC
    4. Round-number magnetism — levels within 0.5% of a round number get +1 touch bonus

    Returns (support_levels, resistance_levels) sorted nearest-first.
    Each level: {price, touch_count, strength: 'weak'|'medium'|'strong'|'key'}
    """
    current = float(close.iloc[-1])
    avg_vol = float(volume.mean()) if volume is not None and len(volume) > 0 else 1.0

    # ── 1. Find local extrema with volume weighting ────────────────────────────
    # A pivot with volume ≥ 1.5× avg is treated as 2 votes
    resist_candidates: list[float] = []
    for i in range(window, len(high) - window):
        slice_h = high.iloc[i - window: i + window + 1]
        if float(high.iloc[i]) == float(slice_h.max()):
            votes = 2 if (volume is not None and float(volume.iloc[i]) >= avg_vol * 1.5) else 1
            resist_candidates.extend([float(high.iloc[i])] * votes)

    support_candidates: list[float] = []
    for i in range(window, len(low) - window):
        slice_l = low.iloc[i - window: i + window + 1]
        if float(low.iloc[i]) == float(slice_l.min()):
            votes = 2 if (volume is not None and float(volume.iloc[i]) >= avg_vol * 1.5) else 1
            support_candidates.extend([float(low.iloc[i])] * votes)

    # ── 2. Weekly-level pivot prices (for confluence boost) ───────────────────
    weekly_resist_prices: set[float] = set()
    weekly_support_prices: set[float] = set()
    if weekly_high is not None and weekly_low is not None:
        w_win = 3  # smaller window for weekly
        for i in range(w_win, len(weekly_high) - w_win):
            slice_h = weekly_high.iloc[i - w_win: i + w_win + 1]
            if float(weekly_high.iloc[i]) == float(slice_h.max()):
                weekly_resist_prices.add(float(weekly_high.iloc[i]))
        for i in range(w_win, len(weekly_low) - w_win):
            slice_l = weekly_low.iloc[i - w_win: i + w_win + 1]
            if float(weekly_low.iloc[i]) == float(slice_l.min()):
                weekly_support_prices.add(float(weekly_low.iloc[i]))

    def _is_round_number(price: float) -> bool:
        """True if price is within 0.5% of a round number (integer or .5 for >$50)."""
        rounded = round(price)
        if abs(price - rounded) / price < 0.005:
            return True
        if price > 50:
            half = round(price * 2) / 2
            if abs(price - half) / price < 0.005:
                return True
        return False

    def _weekly_confluent(price: float, weekly_set: set[float]) -> bool:
        return any(abs(price - wp) / price <= cluster_pct * 1.5 for wp in weekly_set)

    def cluster(candidates: list[float], is_resist: bool) -> list[dict]:
        if not candidates:
            return []
        candidates_sorted = sorted(candidates)
        clusters: list[list[float]] = []
        current_cluster = [candidates_sorted[0]]
        for price in candidates_sorted[1:]:
            if (price - current_cluster[0]) / max(current_cluster[0], 0.01) <= cluster_pct:
                current_cluster.append(price)
            else:
                clusters.append(current_cluster)
                current_cluster = [price]
        clusters.append(current_cluster)

        weekly_set = weekly_resist_prices if is_resist else weekly_support_prices

        result = []
        for cl in clusters:
            avg = sum(cl) / len(cl)
            # Base touch count = number of pivot votes in this cluster
            touches = len(cl)

            # Wick-aware: count candles where H touched resistance zone or L touched support zone
            zone_lo = avg * (1 - cluster_pct)
            zone_hi = avg * (1 + cluster_pct)
            if is_resist:
                wick_touches = int(((high >= zone_lo) & (high <= zone_hi)).sum())
            else:
                wick_touches = int(((low >= zone_lo) & (low <= zone_hi)).sum())
            touches += wick_touches

            # Round-number bonus
            if _is_round_number(avg):
                touches += 1

            # Weekly confluence → promoted directly to 'key' regardless of touch count
            is_key_by_weekly = _weekly_confluent(avg, weekly_set)

            touches = min(touches, 30)
            if is_key_by_weekly:
                strength = "key"
            elif touches >= 12:
                strength = "key"
            elif touches >= 7:
                strength = "strong"
            elif touches >= 4:
                strength = "medium"
            else:
                strength = "weak"

            result.append({
                "price": round(avg, 2),
                "touch_count": touches,
                "strength": strength,
                "weekly_confluent": is_key_by_weekly,
            })
        return result

    all_support = [
        lv for lv in cluster(support_candidates, is_resist=False)
        if lv["price"] < current * 0.998 and lv["touch_count"] >= min_touches
    ]
    all_resist = [
        lv for lv in cluster(resist_candidates, is_resist=True)
        if lv["price"] > current * 1.002 and lv["touch_count"] >= min_touches
    ]

    # Sort: support → descending (nearest first), resist → ascending (nearest first)
    # Promote 'key' levels to front within same side
    def sort_key_support(lv: dict) -> tuple:
        order = {"key": 0, "strong": 1, "medium": 2, "weak": 3}
        dist = current - lv["price"]  # smaller = nearer
        return (order[lv["strength"]], dist)

    def sort_key_resist(lv: dict) -> tuple:
        order = {"key": 0, "strong": 1, "medium": 2, "weak": 3}
        dist = lv["price"] - current
        return (order[lv["strength"]], dist)

    support_levels = sorted(all_support, key=sort_key_support)[:6]
    resist_levels  = sorted(all_resist,  key=sort_key_resist)[:6]
    return support_levels, resist_levels


def _fibonacci_levels(high: float, low: float) -> dict[str, float]:
    """Compute Fibonacci retracement levels from swing high/low."""
    diff = high - low
    return {
        "0.0":   round(high, 2),
        "23.6":  round(high - 0.236 * diff, 2),
        "38.2":  round(high - 0.382 * diff, 2),
        "50.0":  round(high - 0.500 * diff, 2),
        "61.8":  round(high - 0.618 * diff, 2),
        "78.6":  round(high - 0.786 * diff, 2),
        "100.0": round(low, 2),
    }


def _detect_patterns(
    close: pd.Series,
    high:  pd.Series,
    low:   pd.Series,
    volume: pd.Series,
    rsi:   pd.Series,
    macd:  pd.Series,
    macd_signal: pd.Series,
    bb_upper: pd.Series,
    bb_lower: pd.Series,
    bb_mid:   pd.Series,
) -> list[dict]:
    """Rule-based pattern detector. Returns list of detected patterns."""
    patterns = []
    c = close.iloc[-1]
    prev_c = close.iloc[-2] if len(close) > 1 else c

    def add(name_zh: str, name_en: str, desc_zh: str, desc_en: str, severity: str):
        patterns.append({
            "name_zh": name_zh, "name_en": name_en,
            "desc_zh": desc_zh, "desc_en": desc_en,
            "severity": severity,  # "bullish"|"bearish"|"neutral"
        })

    # ── RSI ───────────────────────────────────────────────────────────────────
    rsi_now = float(rsi.iloc[-1]) if not np.isnan(rsi.iloc[-1]) else 50.0
    rsi_prev = float(rsi.iloc[-2]) if len(rsi) > 1 else rsi_now

    if rsi_now >= 70:
        add("RSI超买", "RSI Overbought",
            f"RSI={rsi_now:.1f}，处于超买区，短线回调风险较高。",
            f"RSI={rsi_now:.1f} is in overbought territory. Pullback risk elevated.",
            "bearish")
    elif rsi_now <= 30:
        add("RSI超卖", "RSI Oversold",
            f"RSI={rsi_now:.1f}，处于超卖区，短线反弹概率较高。",
            f"RSI={rsi_now:.1f} is oversold. Short-term bounce likely.",
            "bullish")
    elif rsi_now > 50 and rsi_prev <= 50:
        add("RSI突破50", "RSI Cross 50",
            f"RSI由下方突破50中轴，动能由弱转强。",
            f"RSI crossed above 50 — momentum turning positive.",
            "bullish")
    elif rsi_now < 50 and rsi_prev >= 50:
        add("RSI跌破50", "RSI Break 50",
            f"RSI由上方跌破50中轴，动能由强转弱。",
            f"RSI crossed below 50 — momentum turning negative.",
            "bearish")

    # ── MACD ─────────────────────────────────────────────────────────────────
    macd_now  = float(macd.iloc[-1])
    macd_prev = float(macd.iloc[-2]) if len(macd) > 1 else macd_now
    sig_now   = float(macd_signal.iloc[-1])
    sig_prev  = float(macd_signal.iloc[-2]) if len(macd_signal) > 1 else sig_now
    hist_now  = macd_now - sig_now
    hist_prev = macd_prev - sig_prev

    if macd_now > sig_now and macd_prev <= sig_prev:
        add("MACD金叉", "MACD Golden Cross",
            "MACD线上穿信号线，中期趋势转多。",
            "MACD crossed above signal line — medium-term trend turning bullish.",
            "bullish")
    elif macd_now < sig_now and macd_prev >= sig_prev:
        add("MACD死叉", "MACD Death Cross",
            "MACD线下穿信号线，中期趋势转空。",
            "MACD crossed below signal line — medium-term trend turning bearish.",
            "bearish")
    elif hist_now > 0 and hist_prev < 0:
        add("MACD柱翻正", "MACD Histogram Positive",
            "MACD柱由负转正，多头动能增强。",
            "MACD histogram turned positive — bullish momentum building.",
            "bullish")
    elif hist_now < 0 and hist_prev > 0:
        add("MACD柱翻负", "MACD Histogram Negative",
            "MACD柱由正转负，空头动能增强。",
            "MACD histogram turned negative — bearish momentum building.",
            "bearish")

    # ── Bollinger Bands ───────────────────────────────────────────────────────
    bb_up  = float(bb_upper.iloc[-1])
    bb_lo  = float(bb_lower.iloc[-1])
    bb_mid_val = float(bb_mid.iloc[-1])
    bb_width = (bb_up - bb_lo) / bb_mid_val if bb_mid_val > 0 else 0

    if c > bb_up:
        add("突破布林上轨", "BB Upper Breakout",
            "价格突破布林带上轨，强势但注意回调风险。",
            "Price broke above Bollinger upper band — strong but overbought risk.",
            "bearish")
    elif c < bb_lo:
        add("跌破布林下轨", "BB Lower Breakdown",
            "价格跌破布林带下轨，弱势但注意超卖反弹。",
            "Price broke below Bollinger lower band — weak but oversold bounce risk.",
            "bullish")
    elif bb_width < 0.05:
        add("布林带收窄", "BB Squeeze",
            "布林带极度收窄，预示大幅波动即将来临。",
            "Bollinger Bands squeezing — high volatility breakout imminent.",
            "neutral")
    elif c > bb_mid_val and close.iloc[-5] < bb_mid_val:
        add("回踩中轨后反弹", "BB Mid Bounce",
            "价格回踩布林中轨后反弹，上升趋势延续。",
            "Price bounced off BB mid-band — uptrend continuation.",
            "bullish")

    # ── Moving Averages ───────────────────────────────────────────────────────
    if len(close) >= 200:
        ma50  = float(close.rolling(50).mean().iloc[-1])
        ma200 = float(close.rolling(200).mean().iloc[-1])
        ma50_prev  = float(close.rolling(50).mean().iloc[-2])
        ma200_prev = float(close.rolling(200).mean().iloc[-2])

        if ma50 > ma200 and ma50_prev <= ma200_prev:
            add("黄金交叉", "Golden Cross",
                "50日均线上穿200日均线，长期牛市信号。",
                "50MA crossed above 200MA — long-term bullish signal.",
                "bullish")
        elif ma50 < ma200 and ma50_prev >= ma200_prev:
            add("死亡交叉", "Death Cross",
                "50日均线下穿200日均线，长期熊市信号。",
                "50MA crossed below 200MA — long-term bearish signal.",
                "bearish")
        elif c > ma200 and prev_c <= ma200:
            add("突破200日均线", "Break Above 200MA",
                "价格突破200日均线，中长期趋势转多。",
                "Price broke above 200MA — medium-long term trend turning bullish.",
                "bullish")
        elif c < ma200 and prev_c >= ma200:
            add("跌破200日均线", "Break Below 200MA",
                "价格跌破200日均线，中长期趋势转空。",
                "Price fell below 200MA — medium-long term trend turning bearish.",
                "bearish")

    # ── Volume ────────────────────────────────────────────────────────────────
    if len(volume) >= 20:
        avg_vol = float(volume.iloc[-20:].mean())
        cur_vol = float(volume.iloc[-1])
        if cur_vol > avg_vol * 2 and c > prev_c:
            add("放量上涨", "High Volume Rally",
                f"成交量是20日均量的{cur_vol/avg_vol:.1f}倍，放量上涨，买盘积极。",
                f"Volume {cur_vol/avg_vol:.1f}x 20-day average with price rising — strong buying pressure.",
                "bullish")
        elif cur_vol > avg_vol * 2 and c < prev_c:
            add("放量下跌", "High Volume Selloff",
                f"成交量是20日均量的{cur_vol/avg_vol:.1f}倍，放量下跌，卖盘积极。",
                f"Volume {cur_vol/avg_vol:.1f}x 20-day average with price falling — strong selling pressure.",
                "bearish")

    # ── Double Top / Double Bottom (simplified) ───────────────────────────────
    if len(high) >= 60:
        recent_highs = high.iloc[-60:]
        top1_idx = recent_highs.iloc[:30].idxmax()
        top2_idx = recent_highs.iloc[30:].idxmax()
        top1 = float(recent_highs[top1_idx])
        top2 = float(recent_highs[top2_idx])
        if abs(top1 - top2) / top1 < 0.02 and c < min(top1, top2) * 0.97:
            add("双顶形态", "Double Top",
                f"在{top1:.2f}附近出现双顶，颈线已破，目标下行。",
                f"Double top pattern near {top1:.2f}. Neckline broken — bearish target.",
                "bearish")

    if len(low) >= 60:
        recent_lows = low.iloc[-60:]
        bot1_idx = recent_lows.iloc[:30].idxmin()
        bot2_idx = recent_lows.iloc[30:].idxmin()
        bot1 = float(recent_lows[bot1_idx])
        bot2 = float(recent_lows[bot2_idx])
        if abs(bot1 - bot2) / bot1 < 0.02 and c > max(bot1, bot2) * 1.03:
            add("双底形态", "Double Bottom",
                f"在{bot1:.2f}附近出现双底，颈线已破，目标上行。",
                f"Double bottom pattern near {bot1:.2f}. Neckline broken — bullish target.",
                "bullish")

    return patterns


def _ai_bias_summary(
    symbol: str,
    current_price: float,
    support_levels: list[dict],
    resist_levels: list[dict],
    patterns: list[dict],
    rsi: float,
    fib: dict,
) -> tuple[str, str, str]:
    """Generate short AI technical bias summary (zh + en).

    Returns (bias, summary_zh, summary_en).
    bias: 'bullish'|'bearish'|'neutral'
    """
    try:
        import openai
        from config.settings import get_settings
        settings = get_settings()
        client = openai.OpenAI(api_key=settings.openai_api_key)

        bullish_count = sum(1 for p in patterns if p["severity"] == "bullish")
        bearish_count = sum(1 for p in patterns if p["severity"] == "bearish")

        nearest_support = support_levels[0]["price"] if support_levels else "N/A"
        nearest_resist  = resist_levels[0]["price"]  if resist_levels  else "N/A"
        pattern_list = "; ".join(p["name_zh"] for p in patterns) or "无明显形态"
        pattern_list_en = "; ".join(p["name_en"] for p in patterns) or "No significant pattern"

        prompt = f"""你是一位专业技术分析师，用简洁、专业的语言生成技术判断摘要。

股票：{symbol} | 当前价：${current_price:.2f}
RSI(14)：{rsi:.1f}
最近支撑：${nearest_support} | 最近压力：${nearest_resist}
检测形态：{pattern_list}
多头信号数：{bullish_count} | 空头信号数：{bearish_count}

请生成：
1. bias字段：只能是 bullish/bearish/neutral 三选一
2. summary_zh：1-2句中文技术判断，20-40字，提到关键价位和形态
3. summary_en：对应英文版，15-30词

严格返回JSON格式：{{"bias":"...","summary_zh":"...","summary_en":"..."}}"""

        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=200,
        )
        import json
        data = json.loads(resp.choices[0].message.content)
        bias = data.get("bias", "neutral")
        if bias not in ("bullish", "bearish", "neutral"):
            bias = "neutral"
        return bias, data.get("summary_zh", ""), data.get("summary_en", "")

    except Exception:
        # Fallback: rule-based
        bullish_count = sum(1 for p in patterns if p["severity"] == "bullish")
        bearish_count = sum(1 for p in patterns if p["severity"] == "bearish")
        if bullish_count > bearish_count:
            bias = "bullish"
            zh = f"技术面偏多，{patterns[0]['name_zh'] if patterns else 'RSI正常'}，近期支撑{support_levels[0]['price'] if support_levels else 'N/A'}。"
            en = f"Technically bullish. Key support at {support_levels[0]['price'] if support_levels else 'N/A'}."
        elif bearish_count > bullish_count:
            bias = "bearish"
            zh = f"技术面偏空，{patterns[0]['name_zh'] if patterns else 'RSI偏高'}，近期压力{resist_levels[0]['price'] if resist_levels else 'N/A'}。"
            en = f"Technically bearish. Key resistance at {resist_levels[0]['price'] if resist_levels else 'N/A'}."
        else:
            bias = "neutral"
            zh = f"技术面中性，价格在支撑{support_levels[0]['price'] if support_levels else 'N/A'}与压力{resist_levels[0]['price'] if resist_levels else 'N/A'}间震荡。"
            en = f"Neutral. Price ranging between support {support_levels[0]['price'] if support_levels else 'N/A'} and resistance {resist_levels[0]['price'] if resist_levels else 'N/A'}."
        return bias, zh, en


@router.get("/technical/{symbol}/levels")
def get_technical_levels(symbol: str) -> dict[str, Any]:
    """Return support/resistance levels, detected patterns, Fibonacci levels, and AI bias summary.

    Used by TechnicalLevelsCard + CandlestickChart line overlay in Stock Workbench.
    """
    sym = symbol.upper()

    # Fetch 2 years of daily OHLCV (more history → better S/R detection)
    df = yf.download(sym, period="2y", interval="1d", progress=False, auto_adjust=True)
    if df is None or len(df) < 60:
        raise HTTPException(status_code=404, detail=f"Insufficient data for {sym}")

    # Flatten MultiIndex columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    close  = df["Close"].squeeze().dropna()
    high   = df["High"].squeeze().dropna()
    low    = df["Low"].squeeze().dropna()
    volume = df["Volume"].squeeze().dropna()

    # Fetch weekly data for multi-timeframe confluence
    weekly_high: pd.Series | None = None
    weekly_low: pd.Series | None = None
    try:
        df_w = yf.download(sym, period="5y", interval="1wk", progress=False, auto_adjust=True)
        if df_w is not None and len(df_w) >= 20:
            if isinstance(df_w.columns, pd.MultiIndex):
                df_w.columns = df_w.columns.get_level_values(0)
            weekly_high = df_w["High"].squeeze().dropna()
            weekly_low  = df_w["Low"].squeeze().dropna()
    except Exception:
        pass  # weekly data optional

    # Indicators
    rsi_series   = _compute_rsi(close)
    macd_line, macd_sig, _ = _compute_macd(close)
    bb_upper, bb_mid, bb_lower = _compute_bollinger(close)

    rsi_now = _safe_float(rsi_series.iloc[-1]) or 50.0
    current_price = float(close.iloc[-1])

    # S/R levels — enhanced with volume weighting + weekly confluence
    support_levels, resist_levels = _find_sr_levels(
        high, low, close, volume,
        weekly_high=weekly_high, weekly_low=weekly_low,
    )

    # Fibonacci (52-week high/low)
    week52_high = float(high.max())
    week52_low  = float(low.min())
    fib = _fibonacci_levels(week52_high, week52_low)

    # Pattern detection
    patterns = _detect_patterns(
        close, high, low, volume,
        rsi_series, macd_line, macd_sig,
        bb_upper, bb_lower, bb_mid,
    )

    # Price targets from S/R
    bull_target = resist_levels[0]["price"] if resist_levels else round(current_price * 1.05, 2)
    bear_target = support_levels[0]["price"] if support_levels else round(current_price * 0.95, 2)
    base_target = round(current_price, 2)

    # AI bias summary
    bias, summary_zh, summary_en = _ai_bias_summary(
        sym, current_price, support_levels, resist_levels, patterns, rsi_now, fib
    )

    return {
        "symbol":          sym,
        "current_price":   round(current_price, 2),
        "rsi":             round(rsi_now, 1),
        "bias":            bias,
        "summary_zh":      summary_zh,
        "summary_en":      summary_en,
        "support_levels":  support_levels,
        "resist_levels":   resist_levels,
        "fibonacci":       fib,
        "price_targets": {
            "bull":  bull_target,
            "base":  base_target,
            "bear":  bear_target,
        },
        "patterns":        patterns,
        "week52_high":     round(week52_high, 2),
        "week52_low":      round(week52_low, 2),
    }
