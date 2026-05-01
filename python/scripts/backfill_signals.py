"""One-off backfill: replay 2 years of OHLCV through the strategy router,
score each candidate, simulate the outcome from forward bars, and persist
both `strategy_signals` + `signal_outcomes` rows to Supabase.

After this runs, the Signal Journal page (`/dashboard/signals/journal`)
will show real win rates / avg-R / by-grade and by-strategy stats based
on historical samples instead of an empty table.

Usage:
    cd python && python3 scripts/backfill_signals.py [--days N] [--symbols S1,S2,...]

Defaults:
    --days     500  (about 2 years of trading days)
    --symbols  NVDA,TSLA,AAPL,AMD,GOOGL,META,MSFT,AMZN,NFLX,COIN,CRM,ADBE,
               SPY,QQQ,IWM,GLD
    --min_grade C   (persist all signals; outcome stats most informative
                     when we have full distribution)

The script is idempotent — same (symbol, strategy, timeframe, date) is
deduped at the DB level, so re-running won't double-count.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf
from dotenv import load_dotenv
from supabase import create_client

# Load .env
ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

# Add python/ to path so we can import services
sys.path.insert(0, str(ROOT / "python"))

from services.regime_classifier import classify  # noqa: E402
from services.signal_journal import (  # noqa: E402
    _evaluate_outcome,
    _scored_to_row,
)
from services.signal_scorer import score_all  # noqa: E402
from services.strategy_router import scan_symbol  # noqa: E402

DEFAULT_UNIVERSE = [
    # Mega-caps tech
    "NVDA", "TSLA", "AAPL", "AMD", "GOOGL", "META", "MSFT", "AMZN",
    # Notable single names
    "NFLX", "COIN", "CRM", "ADBE", "AVGO",
    # ETFs for diversity
    "SPY", "QQQ", "IWM", "GLD",
]
DEFAULT_DAYS = 500
DEFAULT_MIN_GRADE = "C"
HISTORY_REQUIRED = 200  # bars needed before we can run regime + strategies
OUTCOME_LOOKAHEAD = 20  # bars after a signal to evaluate T1/T2/stop


def _client():
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def replay_symbol(
    db,
    symbol: str,
    *,
    days: int,
    min_grade: str,
) -> dict:
    """Walk forward through `days` bars of OHLCV, generating + persisting signals."""
    full = yf.download(
        symbol, period="2y", interval="1d", auto_adjust=True, progress=False
    )
    if full is None or full.empty:
        return {"symbol": symbol, "error": "no_data", "scanned": 0, "persisted": 0}
    if isinstance(full.columns, pd.MultiIndex):
        full.columns = full.columns.get_level_values(0)
    full = full.dropna(how="all")

    if len(full) < HISTORY_REQUIRED + 30:
        return {
            "symbol": symbol,
            "error": "insufficient_history",
            "scanned": 0,
            "persisted": 0,
        }

    n = len(full)
    start_idx = max(HISTORY_REQUIRED, n - days)
    # Don't replay the most recent OUTCOME_LOOKAHEAD bars — they don't have
    # enough forward data to evaluate outcome.
    end_idx = max(start_idx, n - OUTCOME_LOOKAHEAD)

    grade_order = {"A": 3, "B": 2, "C": 1}
    min_g = grade_order.get(min_grade.upper(), 1)

    scanned = 0
    candidates_found = 0
    persisted = 0
    persisted_with_outcome = 0
    skipped_dedup = 0
    errors = 0

    for i in range(start_idx, end_idx):
        scanned += 1
        # Slice up to AND including bar i (the bar being evaluated)
        sub = full.iloc[: i + 1]
        try:
            regime = classify(sub).to_dict()
            cands = scan_symbol(symbol, sub, regime_override=regime)
            if not cands:
                continue
            scored = score_all(cands, regime, drop_unscored=True)
            for s in scored:
                if grade_order.get(s.score_grade or "", 0) < min_g:
                    continue
                candidates_found += 1
                # Build the row
                bar_ts = sub.index[-1]
                if bar_ts.tz is None:
                    bar_ts = bar_ts.tz_localize("UTC")
                bar_dt = bar_ts.to_pydatetime()
                row = _scored_to_row(s, bar_dt)

                # Insert signal
                try:
                    res = db.table("strategy_signals").insert(row).execute()
                    rows = res.data or []
                    if not rows:
                        skipped_dedup += 1
                        continue
                    sid = rows[0]["id"]
                    persisted += 1
                except Exception as exc:
                    msg = str(exc).lower()
                    if "duplicate" in msg or "unique" in msg or "23505" in msg:
                        skipped_dedup += 1
                        continue
                    errors += 1
                    continue

                # Evaluate outcome using the forward window
                fwd_end = min(i + 1 + OUTCOME_LOOKAHEAD, n)
                fwd = full.iloc[i + 1 : fwd_end]
                signal_dict = {
                    "id": sid,
                    "datetime": bar_dt.isoformat(),
                    "direction": s.candidate.direction,
                    "entry_price": s.candidate.entry_price,
                    "stop_price": s.candidate.stop_price,
                    "target_1": s.candidate.target_1,
                    "target_2": s.candidate.target_2,
                }
                outcome = _evaluate_outcome(signal_dict, fwd)
                if outcome:
                    try:
                        db.table("signal_outcomes").upsert(
                            outcome, on_conflict="signal_id"
                        ).execute()
                        # Flip status
                        new_status = (
                            "closed"
                            if outcome["exit_reason"]
                            in ("target_1", "target_2", "stop", "trailing")
                            else "invalidated"
                        )
                        db.table("strategy_signals").update(
                            {"status": new_status}
                        ).eq("id", sid).execute()
                        persisted_with_outcome += 1
                    except Exception as exc:
                        # Outcome insert failed but signal persisted — that's OK
                        pass
                else:
                    # Mark as expired (no T1/T2/stop hit within forward window)
                    db.table("strategy_signals").update(
                        {"status": "expired"}
                    ).eq("id", sid).execute()

        except Exception as exc:
            errors += 1
            continue

    return {
        "symbol": symbol,
        "scanned": scanned,
        "candidates_found": candidates_found,
        "persisted": persisted,
        "persisted_with_outcome": persisted_with_outcome,
        "skipped_dedup": skipped_dedup,
        "errors": errors,
    }


def main():
    parser = argparse.ArgumentParser(description="Backfill historical strategy signals")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument(
        "--symbols",
        type=str,
        default=",".join(DEFAULT_UNIVERSE),
        help="Comma-separated tickers",
    )
    parser.add_argument("--min_grade", type=str, default=DEFAULT_MIN_GRADE)
    parser.add_argument("--limit_per_symbol", type=int, default=0,
                        help="If >0, stop each symbol after persisting N signals (debug)")
    args = parser.parse_args()

    syms = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    print(f"=== Backfill: {len(syms)} symbols × {args.days} days, min_grade={args.min_grade} ===\n")

    db = _client()
    overall_start = time.perf_counter()
    aggregate = {
        "scanned_bars": 0,
        "candidates_found": 0,
        "persisted": 0,
        "persisted_with_outcome": 0,
        "skipped_dedup": 0,
        "errors": 0,
    }

    for sym in syms:
        t0 = time.perf_counter()
        result = replay_symbol(
            db, sym, days=args.days, min_grade=args.min_grade
        )
        elapsed = time.perf_counter() - t0
        if result.get("error"):
            print(f"  {sym:6s} ERROR {result['error']} ({elapsed:.1f}s)")
            continue
        aggregate["scanned_bars"] += result["scanned"]
        aggregate["candidates_found"] += result["candidates_found"]
        aggregate["persisted"] += result["persisted"]
        aggregate["persisted_with_outcome"] += result["persisted_with_outcome"]
        aggregate["skipped_dedup"] += result["skipped_dedup"]
        aggregate["errors"] += result["errors"]
        print(
            f"  {sym:6s} bars={result['scanned']:4d} cands={result['candidates_found']:4d} "
            f"persisted={result['persisted']:4d} "
            f"with_outcome={result['persisted_with_outcome']:4d} "
            f"dedup_skip={result['skipped_dedup']:3d} err={result['errors']} "
            f"({elapsed:.1f}s)"
        )

    total_elapsed = time.perf_counter() - overall_start
    print("\n=== AGGREGATE ===")
    for k, v in aggregate.items():
        print(f"  {k:30s} {v}")
    print(f"  total_elapsed                   {total_elapsed:.1f}s")


if __name__ == "__main__":
    main()
