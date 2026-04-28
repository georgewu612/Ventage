"""Value & Momentum (V&M) Composite Scorer.

Combines fundamental value_score (from value_scores table) with momentum
signal_score (from market_signals table) using regime-aware weighting.

Key insight (Fama-French):
  - Value and Momentum are negatively correlated across cycles
  - risk_on  → Momentum works, Value lags  → weight 30/70
  - risk_off → Value works, Momentum lags  → weight 70/30
  - neutral  → Equal weighting             → weight 50/50

The composite VM score (0-100) is used in:
  1. PortfolioBuilderService._build_enhance() — better candidate ranking
  2. GET /v1/technical/{symbol}/value — Stock Workbench card
"""

from __future__ import annotations

import structlog
from supabase import Client, create_client

from config.settings import get_settings

logger = structlog.get_logger()

# Regime → (value_weight, momentum_weight)
REGIME_WEIGHTS: dict[str, tuple[float, float]] = {
    "risk_on":  (0.30, 0.70),
    "neutral":  (0.50, 0.50),
    "risk_off": (0.70, 0.30),
}

# Tier labels (bilingual)
TIER_LABEL: dict[str, dict[str, str]] = {
    "deep_value": {"zh": "极度低估", "en": "Deep Value"},
    "value":      {"zh": "低估",     "en": "Undervalued"},
    "fair":       {"zh": "合理",     "en": "Fair Value"},
    "expensive":  {"zh": "偏贵",     "en": "Expensive"},
    "avoid":      {"zh": "高估回避", "en": "Avoid"},
}


class VMScorer:
    """Computes V&M composite scores for individual symbols or batches."""

    def __init__(self, db: Client | None = None) -> None:
        if db is None:
            s = get_settings()
            db = create_client(s.supabase_url, s.supabase_service_role_key)
        self.db = db

    # ── Public API ─────────────────────────────────────────────────────────────

    def score_symbol(self, symbol: str, regime: str = "neutral") -> dict:
        """Return full V&M breakdown for a single symbol."""
        value_row = self._get_value_score(symbol)
        momentum_row = self._get_momentum_score(symbol)

        value_score = float(value_row.get("value_score", 0)) if value_row else 0.0
        value_tier  = value_row.get("value_tier", "fair") if value_row else "fair"
        momentum_score = self._normalize_momentum(momentum_row)

        vm_score, v_w, m_w = self._composite(value_score, momentum_score, regime)

        # Sweet spot: high value + rising momentum (both ≥ 60)
        is_sweet_spot = value_score >= 60 and momentum_score >= 60

        return {
            "symbol":          symbol,
            "regime":          regime,
            # Value layer
            "value_score":     round(value_score, 1),
            "value_tier":      value_tier,
            "value_tier_zh":   TIER_LABEL.get(value_tier, {}).get("zh", value_tier),
            "value_tier_en":   TIER_LABEL.get(value_tier, {}).get("en", value_tier),
            "pe_ratio":        value_row.get("pe_ratio") if value_row else None,
            "pb_ratio":        value_row.get("pb_ratio") if value_row else None,
            "ps_ratio":        value_row.get("ps_ratio") if value_row else None,
            "free_cashflow":   value_row.get("free_cashflow") if value_row else None,
            "debt_to_equity":  value_row.get("debt_to_equity") if value_row else None,
            "roe":             value_row.get("roe") if value_row else None,
            "dividend_yield":  value_row.get("dividend_yield") if value_row else None,
            "revenue_growth":  value_row.get("revenue_growth") if value_row else None,
            "value_updated_at":value_row.get("updated_at") if value_row else None,
            # Momentum layer
            "momentum_score":  round(momentum_score, 1),
            "momentum_direction": momentum_row.get("direction") if momentum_row else None,
            "signal_score":    momentum_row.get("signal_score") if momentum_row else None,
            # Composite
            "vm_score":        round(vm_score, 1),
            "value_weight":    v_w,
            "momentum_weight": m_w,
            "is_sweet_spot":   is_sweet_spot,
            "sweet_spot_label_zh": "甜点区 🎯" if is_sweet_spot else "",
            "sweet_spot_label_en": "Sweet Spot 🎯" if is_sweet_spot else "",
        }

    def score_batch(
        self,
        symbols: list[str],
        regime: str = "neutral",
    ) -> list[dict]:
        """Score multiple symbols, sorted by vm_score descending."""
        results = []
        for sym in symbols:
            try:
                results.append(self.score_symbol(sym, regime))
            except Exception as exc:
                logger.warning("score_failed", symbol=sym, error=str(exc))
        return sorted(results, key=lambda x: x["vm_score"], reverse=True)

    def get_top_vm_candidates(
        self,
        regime: str = "neutral",
        min_value_score: float = 50.0,
        min_momentum_score: float = 50.0,
        limit: int = 10,
    ) -> list[dict]:
        """
        Pull symbols from value_scores where value_score >= threshold,
        then score them with live momentum data and filter by momentum threshold.
        Returns top candidates sorted by vm_score.
        """
        # Pull value candidates from DB
        rows = (
            self.db.table("value_scores")
            .select("symbol,value_score,value_tier")
            .gte("value_score", min_value_score)
            .order("value_score", desc=True)
            .limit(50)  # over-fetch, then filter by momentum
            .execute()
            .data
            or []
        )
        symbols = [r["symbol"] for r in rows]
        if not symbols:
            return []

        scored = self.score_batch(symbols, regime)
        filtered = [s for s in scored if s["momentum_score"] >= min_momentum_score]
        return filtered[:limit]

    # ── Private helpers ────────────────────────────────────────────────────────

    def _get_value_score(self, symbol: str) -> dict | None:
        try:
            rows = (
                self.db.table("value_scores")
                .select("*")
                .eq("symbol", symbol)
                .limit(1)
                .execute()
                .data
                or []
            )
            return rows[0] if rows else None
        except Exception as exc:
            logger.warning("value_fetch_failed", symbol=symbol, error=str(exc))
            return None

    def _get_momentum_score(self, symbol: str) -> dict | None:
        """Get most recent signal for this symbol from market_signals."""
        try:
            rows = (
                self.db.table("market_signals")
                .select("symbol,direction,signal_score,confidence,created_at")
                .eq("symbol", symbol)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
                .data
                or []
            )
            return rows[0] if rows else None
        except Exception as exc:
            logger.warning("momentum_fetch_failed", symbol=symbol, error=str(exc))
            return None

    def _normalize_momentum(self, row: dict | None) -> float:
        """Convert signal row to 0-100 momentum score."""
        if not row:
            return 0.0
        # signal_score is already 0-100 if present
        sig = row.get("signal_score")
        if sig is not None:
            return float(sig)
        # fallback: confidence * 100
        conf = row.get("confidence")
        if conf is not None:
            return float(conf) * 100
        return 0.0

    def _composite(
        self,
        value_score: float,
        momentum_score: float,
        regime: str,
    ) -> tuple[float, float, float]:
        """Return (vm_score, value_weight, momentum_weight)."""
        v_w, m_w = REGIME_WEIGHTS.get(regime, (0.50, 0.50))
        vm = value_score * v_w + momentum_score * m_w
        return vm, v_w, m_w
