"""Phase G.1: Feature-importance analysis on backfilled signals.

Pulls all closed signals + outcomes from Supabase and computes:
  • Per-strategy outcome distribution
  • Per-scoring-dimension correlation with pnl_r
  • Per-raw-feature correlation with pnl_r (segmented by strategy)
  • Recommended tightening thresholds

Outputs a plain-text report. No mutations to DB.
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean, median

from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT / "python"))


def _client():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _pearson(xs: list[float], ys: list[float]) -> float:
    """Compute Pearson correlation. Returns 0 if degenerate."""
    if len(xs) < 5 or len(ys) < 5 or len(xs) != len(ys):
        return 0.0
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = sum((x - mx) ** 2 for x in xs) ** 0.5
    dy = sum((y - my) ** 2 for y in ys) ** 0.5
    if dx == 0 or dy == 0:
        return 0.0
    return num / (dx * dy)


def _quartile_buckets(values: list[float], pnl_rs: list[float]) -> list[tuple]:
    """Sort by `values`, split into 4 buckets, return (mean_value, mean_pnl_r, count)."""
    paired = sorted(zip(values, pnl_rs))
    n = len(paired)
    if n < 8:
        return []
    qs = [
        paired[: n // 4],
        paired[n // 4 : n // 2],
        paired[n // 2 : 3 * n // 4],
        paired[3 * n // 4 :],
    ]
    return [
        (mean(v for v, _ in q), mean(p for _, p in q), len(q)) for q in qs
    ]


def main():
    db = _client()

    # Pull all signals + outcomes (fetch in chunks to avoid limits)
    print("Fetching signals...")
    signals: list[dict] = []
    offset = 0
    page = 1000
    while True:
        chunk = (
            db.table("strategy_signals")
            .select("*")
            .order("datetime", desc=True)
            .range(offset, offset + page - 1)
            .execute()
            .data
            or []
        )
        signals.extend(chunk)
        if len(chunk) < page:
            break
        offset += page

    sig_ids = [s["id"] for s in signals]
    print(f"  {len(signals)} signals")

    print("Fetching outcomes...")
    outcomes_map: dict[str, dict] = {}
    for i in range(0, len(sig_ids), 50):
        chunk_ids = sig_ids[i : i + 50]
        outs = (
            db.table("signal_outcomes")
            .select("*")
            .in_("signal_id", chunk_ids)
            .execute()
            .data
            or []
        )
        for o in outs:
            outcomes_map[o["signal_id"]] = o
    print(f"  {len(outcomes_map)} outcomes")

    closed = [
        (s, outcomes_map[s["id"]])
        for s in signals
        if s["id"] in outcomes_map and outcomes_map[s["id"]].get("pnl_r") is not None
    ]
    print(f"  {len(closed)} closed signals\n")

    # ── Per-strategy summary ───────────────────────────────────────────────
    print("=" * 70)
    print("PER-STRATEGY OUTCOMES")
    print("=" * 70)
    by_strategy = defaultdict(list)
    for s, o in closed:
        by_strategy[s["strategy_name"]].append(float(o["pnl_r"]))

    for strat, rs in by_strategy.items():
        wins = [r for r in rs if r > 0]
        losses = [r for r in rs if r <= 0]
        print(
            f"  {strat:32s} n={len(rs):3d}  win_rate={len(wins) / len(rs):.2%}  "
            f"avg_r={sum(rs) / len(rs):+.3f}  best={max(rs):+.2f}  worst={min(rs):+.2f}"
        )
        print(
            f"    {'':30s}   avg_winner={sum(wins) / len(wins) if wins else 0:+.2f}R  "
            f"avg_loser={sum(losses) / len(losses) if losses else 0:+.2f}R"
        )

    # ── Per-grade summary ──────────────────────────────────────────────────
    print()
    print("=" * 70)
    print("PER-GRADE OUTCOMES")
    print("=" * 70)
    by_grade = defaultdict(list)
    for s, o in closed:
        by_grade[s["score_grade"]].append(float(o["pnl_r"]))
    for g in ["A", "B", "C"]:
        rs = by_grade.get(g, [])
        if not rs:
            continue
        wins = [r for r in rs if r > 0]
        print(
            f"  {g}: n={len(rs):3d}  win_rate={len(wins) / len(rs):.2%}  "
            f"avg_r={sum(rs) / len(rs):+.3f}"
        )

    # ── Per-scoring-dimension predictive power ─────────────────────────────
    print()
    print("=" * 70)
    print("SCORING DIMENSION → pnl_r CORRELATION (>|0.1| is meaningful)")
    print("=" * 70)
    score_fields = [
        "score_total",
        "score_market",
        "score_position",
        "score_pattern",
        "score_volume",
        "score_chip",
        "score_rr",
    ]
    pnl_rs_all = [float(o["pnl_r"]) for _, o in closed]
    for f in score_fields:
        vals = [float(s[f]) for s, _ in closed if s.get(f) is not None]
        rs = [float(o["pnl_r"]) for s, o in closed if s.get(f) is not None]
        if len(vals) < 30:
            continue
        corr = _pearson(vals, rs)
        # Show quartile breakdown
        buckets = _quartile_buckets(vals, rs)
        bucket_str = " → ".join(f"{b[1]:+.2f}" for b in buckets)
        print(
            f"  {f:18s} corr={corr:+.3f}  bucket_avgR (Q1→Q4): {bucket_str}"
        )

    # ── Per-strategy raw_features analysis ─────────────────────────────────
    print()
    print("=" * 70)
    print("WYCKOFF — RAW FEATURE ANALYSIS")
    print("=" * 70)
    wyckoffs = [
        (s, o) for s, o in closed if s["strategy_name"] == "wyckoff_liquidity_sweep"
    ]
    if wyckoffs:
        print(f"  {len(wyckoffs)} closed wyckoff signals\n")

        # Extract features
        def get_feat(sig, key, default=None):
            f = sig.get("raw_features") or {}
            v = f.get(key)
            try:
                return float(v) if v is not None else default
            except (TypeError, ValueError):
                return default

        feature_keys = [
            "pierce_pct",
            "rv20",
            "body_ratio",
            "rsi",
            "atr_14",
            "lower_shadow_ratio",
            "upper_shadow_ratio",
        ]
        for fk in feature_keys:
            vals = []
            rs = []
            for s, o in wyckoffs:
                v = get_feat(s, fk)
                if v is None:
                    continue
                vals.append(v)
                rs.append(float(o["pnl_r"]))
            if len(vals) < 20:
                continue
            corr = _pearson(vals, rs)
            buckets = _quartile_buckets(vals, rs)
            bucket_str = " → ".join(
                f"{b[1]:+.2f} (val~{b[0]:.2f})" for b in buckets
            )
            print(f"  {fk:24s} corr={corr:+.3f}")
            print(f"    {' ' * 22}     Q1→Q4: {bucket_str}")

        # Direction split
        longs = [(s, o) for s, o in wyckoffs if s["direction"] == "long"]
        shorts = [(s, o) for s, o in wyckoffs if s["direction"] == "short"]
        if longs:
            rs = [float(o["pnl_r"]) for _, o in longs]
            wins = [r for r in rs if r > 0]
            print(f"\n  longs:  n={len(longs):3d}  win_rate={len(wins) / len(rs):.2%}  avg_r={sum(rs) / len(rs):+.3f}")
        if shorts:
            rs = [float(o["pnl_r"]) for _, o in shorts]
            wins = [r for r in rs if r > 0]
            print(f"  shorts: n={len(shorts):3d}  win_rate={len(wins) / len(rs):.2%}  avg_r={sum(rs) / len(rs):+.3f}")

        # Regime split
        print()
        by_reg = defaultdict(list)
        for s, o in wyckoffs:
            by_reg[s["regime_at_signal"]].append(float(o["pnl_r"]))
        for reg, rs in by_reg.items():
            wins = [r for r in rs if r > 0]
            print(f"  regime={reg:24s} n={len(rs):3d}  win_rate={len(wins) / len(rs):.2%}  avg_r={sum(rs) / len(rs):+.3f}")

    # ── Bollinger raw features (for comparison — what works) ──────────────
    print()
    print("=" * 70)
    print("BOLLINGER REVERSION — RAW FEATURE ANALYSIS (profitable strategy)")
    print("=" * 70)
    bbs = [
        (s, o)
        for s, o in closed
        if s["strategy_name"] == "bollinger_extreme_reversion"
    ]
    if bbs:
        print(f"  {len(bbs)} closed bb_reversion signals\n")
        feature_keys = ["rsi", "stoch_k", "body_ratio", "bb_width_now"]
        for fk in feature_keys:
            vals = []
            rs = []
            for s, o in bbs:
                f = s.get("raw_features") or {}
                v = f.get(fk)
                try:
                    v = float(v) if v is not None else None
                except (TypeError, ValueError):
                    v = None
                if v is None:
                    continue
                vals.append(v)
                rs.append(float(o["pnl_r"]))
            if len(vals) < 15:
                continue
            corr = _pearson(vals, rs)
            buckets = _quartile_buckets(vals, rs)
            bucket_str = " → ".join(
                f"{b[1]:+.2f} (val~{b[0]:.2f})" for b in buckets
            )
            print(f"  {fk:24s} corr={corr:+.3f}")
            print(f"    {' ' * 22}     Q1→Q4: {bucket_str}")

    # ── Suggestions ────────────────────────────────────────────────────────
    print()
    print("=" * 70)
    print("AUTO-GENERATED RECOMMENDATIONS")
    print("=" * 70)
    # Strategy-level
    for strat, rs in by_strategy.items():
        avg = sum(rs) / len(rs) if rs else 0
        wr = len([r for r in rs if r > 0]) / len(rs) if rs else 0
        if avg < -0.05:
            print(f"  ❌ {strat}: avg_r={avg:+.2f}, win_rate={wr:.2%}")
            print(f"     → Tighten entry conditions (raise volume/divergence requirements)")
            print(f"     → Or revise targets (current T1 may be unreachable)")
        elif avg > 0.1:
            print(f"  ✅ {strat}: avg_r={avg:+.2f}, win_rate={wr:.2%} — keep as-is")
    # Score correlation
    print()
    score_corrs = {}
    for f in score_fields:
        if f == "score_total":
            continue
        vals = [float(s[f]) for s, _ in closed if s.get(f) is not None]
        rs = [float(o["pnl_r"]) for s, o in closed if s.get(f) is not None]
        if len(vals) >= 30:
            score_corrs[f] = _pearson(vals, rs)
    sorted_corrs = sorted(score_corrs.items(), key=lambda x: abs(x[1]), reverse=True)
    print("  Score dimension predictive ranking (by |corr|):")
    for f, c in sorted_corrs:
        flag = "✓" if abs(c) > 0.1 else "?" if abs(c) > 0.05 else "✗"
        print(f"    {flag} {f:18s} {c:+.3f}")
    print("  → Reduce weight on dims with corr near 0; increase weight on top-correlated dims")


if __name__ == "__main__":
    main()
