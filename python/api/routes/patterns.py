"""Phase H — Cai Sen 12 chart patterns API.

Endpoints:
    GET  /v1/patterns/{symbol}                 — currently active patterns
    POST /v1/patterns/backtest                 — OOS backtest a single pattern
    GET  /v1/patterns/list                     — supported pattern names + i18n labels

Backtest harness: re-runs the chosen detector at every bar over the lookback
window. When a forming/confirmed pattern is found and price reaches T1/T2 or
hits invalidation (or stop), the trade is closed and stats accumulated.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import pandas as pd
import structlog
import yfinance as yf
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from services.pattern_detection import (
    ALL_DETECTORS,
    PATTERN_NAME_MAP,
    PatternMatch,
    detect_all_patterns,
)

logger = structlog.get_logger()

router = APIRouter()


# ── Helpers ────────────────────────────────────────────────────────────────


_DETECTOR_BY_NAME = {d.__name__.replace("detect_", ""): d for d in ALL_DETECTORS}


def _normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df


def _fetch_ohlcv(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    df = yf.download(
        symbol, period=period, interval=interval, progress=False, auto_adjust=True
    )
    if df is None or df.empty:
        raise HTTPException(status_code=404, detail=f"No data for {symbol}")
    return _normalize_columns(df)


# ── /v1/patterns/list ───────────────────────────────────────────────────────


_PATTERN_META: list[dict] = [
    {"key": "w_bottom", "zh": "W 底", "direction": "long", "regime_hint": "ranging"},
    {"key": "m_top", "zh": "M 頭", "direction": "short", "regime_hint": "ranging"},
    {"key": "failed_breakdown", "zh": "破底翻", "direction": "long",
     "regime_hint": "exhaustion_reversal"},
    {"key": "failed_breakout", "zh": "假突破", "direction": "short",
     "regime_hint": "exhaustion_reversal"},
    {"key": "w_bottom_with_failed_breakdown", "zh": "破底翻 W 底",
     "direction": "long", "regime_hint": "exhaustion_reversal"},
    {"key": "head_shoulders_bottom", "zh": "頭肩底", "direction": "long",
     "regime_hint": "exhaustion_reversal"},
    {"key": "head_shoulders_top", "zh": "頭肩頂", "direction": "short",
     "regime_hint": "exhaustion_reversal"},
    {"key": "failed_breakout_hs_top", "zh": "假突破頭肩頂", "direction": "short",
     "regime_hint": "exhaustion_reversal"},
    {"key": "falling_flag", "zh": "下傾旗形", "direction": "long",
     "regime_hint": "squeeze_breakout_setup"},
    {"key": "rising_flag", "zh": "上攬旗形", "direction": "short",
     "regime_hint": "squeeze_breakout_setup"},
    {"key": "converging_triangle_bottom", "zh": "收斂三角形底部",
     "direction": "long", "regime_hint": "ranging"},
    {"key": "converging_triangle_top", "zh": "收斂三角形頂部",
     "direction": "short", "regime_hint": "ranging"},
]


@router.get("/patterns/list")
def list_patterns() -> dict[str, Any]:
    """Return supported pattern keys with bilingual labels."""
    return {"patterns": _PATTERN_META, "n": len(_PATTERN_META)}


# ── /v1/patterns/{symbol} ──────────────────────────────────────────────────


@router.get("/patterns/{symbol}")
def get_active_patterns(
    symbol: str, lookback: int = 120, min_quality: float = 0.0
) -> dict[str, Any]:
    """Return all currently-active (forming or confirmed) chart patterns."""
    sym = symbol.upper()
    period = "6mo" if lookback <= 130 else ("1y" if lookback <= 260 else "2y")
    df = _fetch_ohlcv(sym, period=period)
    df = df.tail(max(lookback, 60))
    matches = detect_all_patterns(df, min_quality=min_quality)
    return {
        "symbol": sym,
        "n_active": len(matches),
        "lookback": int(lookback),
        "as_of": df.index[-1].isoformat() if len(df) else None,
        "last_close": float(df["Close"].iloc[-1]) if len(df) else None,
        "patterns": [m.to_dict() for m in matches],
    }


# ── /v1/patterns/backtest ──────────────────────────────────────────────────


_UNIVERSE_CACHE: dict[str, list[str]] = {}


def _load_universe(name: str) -> list[str]:
    """Load symbol universe. Tries Wikipedia for SP500/NDX/Russell."""
    name = name.lower()
    if name in _UNIVERSE_CACHE:
        return _UNIVERSE_CACHE[name]

    if name in ("sp500", "spx"):
        try:
            tables = pd.read_html(
                "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
            )
            symbols = [s.replace(".", "-") for s in tables[0]["Symbol"].tolist()]
            _UNIVERSE_CACHE[name] = symbols[:200]  # cap for backtest speed
            return _UNIVERSE_CACHE[name]
        except Exception:  # noqa: BLE001
            pass

    if name in ("nasdaq100", "ndx"):
        try:
            tables = pd.read_html("https://en.wikipedia.org/wiki/Nasdaq-100")
            for t in tables:
                cols = [c.lower() for c in t.columns]
                if "ticker" in cols or "symbol" in cols:
                    col = "Ticker" if "Ticker" in t.columns else "Symbol"
                    _UNIVERSE_CACHE[name] = t[col].tolist()
                    return _UNIVERSE_CACHE[name]
        except Exception:  # noqa: BLE001
            pass

    # Fallback: hardcoded sample
    fallback = [
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "AMD",
        "AVGO", "CRM", "ADBE", "NFLX", "QCOM", "INTC", "ORCL", "CSCO",
        "JPM", "BAC", "GS", "MS", "WMT", "COST", "HD", "PG", "JNJ", "PFE",
        "XOM", "CVX", "DIS", "NKE", "MCD", "KO", "PEP", "T", "VZ", "BA",
    ]
    _UNIVERSE_CACHE[name] = fallback
    return fallback


def _backtest_single_symbol(
    symbol: str,
    detector,
    *,
    years: int,
    stop_pct: float = 0.06,
) -> list[dict]:
    """Run rolling pattern detection on a single symbol; return trade records."""
    try:
        df = yf.download(
            symbol,
            period=f"{years}y",
            interval="1d",
            progress=False,
            auto_adjust=True,
        )
    except Exception:  # noqa: BLE001
        return []
    if df is None or df.empty:
        return []
    df = _normalize_columns(df)
    if len(df) < 80:
        return []

    trades: list[dict] = []
    last_signal_date: pd.Timestamp | None = None

    # Walk forward bar-by-bar; only check at month-end-ish cadence (every 5 bars)
    # to keep the test fast and prevent over-triggering.
    for i in range(80, len(df) - 5, 5):
        window = df.iloc[: i + 1]
        try:
            m: PatternMatch | None = detector(window)
        except Exception:  # noqa: BLE001
            continue
        # Only test FORMING patterns. Confirmed patterns have already broken
        # neckline at some past bar — entering at the historical neckline now
        # is unrealistic (price has moved). Forming = neckline not yet broken;
        # we walk forward and trigger entry on actual breakout bar.
        if m is None or m.status != "forming":
            continue
        sig_date = df.index[i]
        if last_signal_date is not None and (sig_date - last_signal_date).days < 30:
            continue
        last_signal_date = sig_date

        neckline = m.neckline_price
        target_1 = m.target_1
        target_2 = m.target_2 if m.target_2 is not None else None
        invalidation = m.invalidation_price

        # Walk forward up to 60 bars to determine outcome
        forward = df.iloc[i + 1 : i + 61]
        if forward.empty:
            continue

        # Stage 1: wait for actual breakout bar
        entry: float | None = None
        entry_bar_idx: int | None = None
        for j in range(len(forward)):
            bar = forward.iloc[j]
            close_j = float(bar["Close"])
            if m.direction == "long" and close_j > neckline:
                entry = close_j
                entry_bar_idx = j
                break
            if m.direction == "short" and close_j < neckline:
                entry = close_j
                entry_bar_idx = j
                break

        if entry is None or entry_bar_idx is None:
            # Pattern never triggered within 60 bars
            continue

        # Stage 2: stop and invalidation derived from ACTUAL fill price
        if m.direction == "long":
            stop = entry * (1.0 - stop_pct)
        else:
            stop = entry * (1.0 + stop_pct)

        outcome = "open"
        exit_price: float = entry
        exit_idx: int = -1
        bars_held = 0

        # Walk forward from bar AFTER entry
        for j in range(entry_bar_idx + 1, len(forward)):
            bar = forward.iloc[j]
            high = float(bar["High"])
            low = float(bar["Low"])
            close = float(bar["Close"])
            bars_held = j - entry_bar_idx

            if m.direction == "long":
                if low <= stop:
                    outcome = "stop"
                    exit_price = stop
                    exit_idx = j
                    break
                if low <= invalidation:
                    outcome = "invalidation"
                    exit_price = invalidation
                    exit_idx = j
                    break
                if target_2 is not None and high >= target_2:
                    outcome = "target_2"
                    exit_price = target_2
                    exit_idx = j
                    break
                if high >= target_1:
                    outcome = "target_1"
                    exit_price = target_1
                    exit_idx = j
                    break
            else:  # short
                if high >= stop:
                    outcome = "stop"
                    exit_price = stop
                    exit_idx = j
                    break
                if high >= invalidation:
                    outcome = "invalidation"
                    exit_price = invalidation
                    exit_idx = j
                    break
                if target_2 is not None and low <= target_2:
                    outcome = "target_2"
                    exit_price = target_2
                    exit_idx = j
                    break
                if low <= target_1:
                    outcome = "target_1"
                    exit_price = target_1
                    exit_idx = j
                    break

        if outcome == "open":
            # Use last close as exit
            exit_price = float(forward["Close"].iloc[-1])
            exit_idx = len(forward) - 1
            bars_held = exit_idx + 1

        if m.direction == "long":
            ret_pct = (exit_price - entry) / entry
        else:
            ret_pct = (entry - exit_price) / entry

        trades.append({
            "symbol": symbol,
            "signal_date": sig_date.isoformat(),
            "entry": float(entry),
            "exit": float(exit_price),
            "outcome": outcome,
            "return_pct": float(ret_pct),
            "bars_held": int(bars_held),
            "pattern_quality": float(m.pattern_quality_score),
        })

    return trades


class PatternBacktestRequest(BaseModel):
    pattern: str = Field(..., description="One of pattern keys from /patterns/list")
    universe: str = Field(default="sp500")
    lookback_years: int = Field(default=5, ge=1, le=10)
    max_symbols: int = Field(default=50, ge=5, le=200,
                             description="Cap to keep latency reasonable")


@router.post("/patterns/backtest")
def backtest_pattern(req: PatternBacktestRequest) -> dict[str, Any]:
    """OOS backtest a single chart pattern across a universe.

    Compares against Cai Sen book's claimed 22-60% return range.
    """
    if req.pattern not in _DETECTOR_BY_NAME:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown pattern '{req.pattern}'. Available: {list(_DETECTOR_BY_NAME)}",
        )

    detector = _DETECTOR_BY_NAME[req.pattern]
    universe = _load_universe(req.universe)[: req.max_symbols]

    all_trades: list[dict] = []
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        futs = {
            pool.submit(
                _backtest_single_symbol,
                sym,
                detector,
                years=req.lookback_years,
            ): sym
            for sym in universe
        }
        for fut in as_completed(futs):
            sym = futs[fut]
            try:
                trades = fut.result(timeout=120)
                all_trades.extend(trades)
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{sym}: {str(exc)[:50]}")

    if not all_trades:
        return {
            "pattern": req.pattern,
            "universe": req.universe,
            "n_symbols": len(universe),
            "n_signals": 0,
            "warning": "No signals generated. Try a different pattern or longer window.",
            "failures": failures[:5],
        }

    n = len(all_trades)
    wins = [t for t in all_trades if t["return_pct"] > 0]
    win_rate = len(wins) / n
    t1_hits = [t for t in all_trades if t["outcome"] == "target_1"]
    t2_hits = [t for t in all_trades if t["outcome"] == "target_2"]
    invalidations = [t for t in all_trades if t["outcome"] == "invalidation"]
    stops = [t for t in all_trades if t["outcome"] == "stop"]
    opens = [t for t in all_trades if t["outcome"] == "open"]

    avg_return = sum(t["return_pct"] for t in all_trades) / n
    avg_bars = sum(t["bars_held"] for t in all_trades) / n
    avg_quality = sum(t["pattern_quality"] for t in all_trades) / n

    # Cai Sen book claim: 22-60% per trade across all 12 patterns
    cai_sen_low = 0.22
    cai_sen_high = 0.60

    return {
        "pattern": req.pattern,
        "pattern_zh": PATTERN_NAME_MAP.get(req.pattern, req.pattern),
        "universe": req.universe,
        "n_symbols_tested": len(universe),
        "lookback_years": req.lookback_years,
        "n_signals": n,
        "n_signals_per_year": round(n / max(req.lookback_years, 1), 1),
        "win_rate": round(win_rate, 4),
        "target_1_hit_rate": round(len(t1_hits) / n, 4),
        "target_2_hit_rate": round(len(t2_hits) / n, 4),
        "invalidation_rate": round(len(invalidations) / n, 4),
        "stop_rate": round(len(stops) / n, 4),
        "open_rate": round(len(opens) / n, 4),
        "avg_return_pct": round(avg_return * 100, 2),
        "avg_bars_held": round(avg_bars, 1),
        "avg_pattern_quality": round(avg_quality, 1),
        "cai_sen_book_claim": {
            "win_rate": "60%+",
            "avg_return_low": cai_sen_low,
            "avg_return_high": cai_sen_high,
        },
        "honest_comparison": _make_comparison(win_rate, avg_return, cai_sen_low, cai_sen_high),
        "sample_trades": all_trades[:30],
        "failures": failures[:5],
    }


def _make_comparison(
    win_rate: float, avg_ret: float, cs_low: float, cs_high: float
) -> str:
    parts = []
    if win_rate >= 0.55:
        parts.append(f"勝率 {win_rate*100:.0f}% 接近書中聲明 (60%+)")
    elif win_rate >= 0.40:
        parts.append(f"勝率 {win_rate*100:.0f}% 偏低於書中聲明")
    else:
        parts.append(f"勝率 {win_rate*100:.0f}% 顯著低於書中聲明 — 該形態在美股 OOS 表現一般")
    if cs_low <= avg_ret <= cs_high:
        parts.append(f"平均報酬 {avg_ret*100:.1f}% 落在書中區間 ({int(cs_low*100)}-{int(cs_high*100)}%)")
    elif avg_ret > 0:
        parts.append(f"平均報酬 {avg_ret*100:.1f}% 低於書中區間")
    else:
        parts.append(f"平均報酬 {avg_ret*100:.1f}% 為負，與書中聲明明顯不符")
    return "；".join(parts)
