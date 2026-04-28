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
import pandas as pd
import yfinance as yf
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

        # If no DB signal, compute live momentum from price data
        live_momentum: dict | None = None
        if momentum_row is None:
            live_momentum = self._compute_live_momentum(symbol)

        momentum_score = (
            self._normalize_momentum(momentum_row)
            if momentum_row
            else (live_momentum.get("score", 0.0) if live_momentum else 0.0)
        )
        momentum_direction = (
            momentum_row.get("direction") if momentum_row
            else (live_momentum.get("direction") if live_momentum else None)
        )

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
            "momentum_score":      round(momentum_score, 1),
            "momentum_direction":  momentum_direction,
            "momentum_source":     "db_signal" if momentum_row else "live_price",
            "signal_score":        momentum_row.get("signal_score") if momentum_row else None,
            # Live momentum detail (when computed from price)
            "rsi":             live_momentum.get("rsi") if live_momentum else None,
            "above_200ma":     live_momentum.get("above_200ma") if live_momentum else None,
            "return_6m_pct":   live_momentum.get("return_6m_pct") if live_momentum else None,
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
        sig = row.get("signal_score")
        if sig is not None:
            return float(sig)
        conf = row.get("confidence")
        if conf is not None:
            return float(conf) * 100
        return 0.0

    def _compute_live_momentum(self, symbol: str) -> dict | None:
        """Compute momentum score from live price data via yfinance.

        Used as fallback when market_signals has no entry for the symbol.

        Scoring (total 100 pts):
          RSI component   (40 pts): RSI 50-70 range → bullish momentum
          MA200 component (30 pts): price above 200-day MA
          6M return       (30 pts): relative return over past 6 months
        """
        try:
            df = yf.download(symbol, period="1y", interval="1d", progress=False, auto_adjust=True)
            if df is None or len(df) < 30:
                return None

            close = df["Close"].squeeze()

            # ── RSI (40 pts) ──────────────────────────────────────────────────
            delta = close.diff()
            gain = delta.where(delta > 0, 0.0).rolling(14).mean()
            loss = (-delta.where(delta < 0, 0.0)).rolling(14).mean()
            rs = gain / loss.replace(0, float("nan"))
            rsi_series = 100 - (100 / (1 + rs))
            rsi = float(rsi_series.iloc[-1]) if not rsi_series.empty else 50.0
            if pd.isna(rsi):
                rsi = 50.0

            if rsi >= 70:
                rsi_pts = 35      # overbought but strong
            elif rsi >= 60:
                rsi_pts = 40      # sweet zone
            elif rsi >= 50:
                rsi_pts = 28
            elif rsi >= 40:
                rsi_pts = 12
            else:
                rsi_pts = 0

            # ── 200-day MA (30 pts) ───────────────────────────────────────────
            ma200 = float(close.rolling(200).mean().iloc[-1]) if len(close) >= 200 else float(close.mean())
            current_price = float(close.iloc[-1])
            above_200ma = current_price > ma200
            pct_vs_ma = (current_price - ma200) / ma200 * 100 if ma200 > 0 else 0.0

            if pct_vs_ma >= 10:
                ma_pts = 30
            elif pct_vs_ma >= 5:
                ma_pts = 25
            elif pct_vs_ma >= 0:
                ma_pts = 18
            elif pct_vs_ma >= -5:
                ma_pts = 8
            else:
                ma_pts = 0

            # ── 6-month return (30 pts) ───────────────────────────────────────
            idx_6m = max(0, len(close) - 126)
            price_6m_ago = float(close.iloc[idx_6m])
            return_6m = (current_price - price_6m_ago) / price_6m_ago * 100 if price_6m_ago > 0 else 0.0

            if return_6m >= 25:
                ret_pts = 30
            elif return_6m >= 15:
                ret_pts = 25
            elif return_6m >= 5:
                ret_pts = 18
            elif return_6m >= 0:
                ret_pts = 10
            elif return_6m >= -10:
                ret_pts = 4
            else:
                ret_pts = 0

            score = float(rsi_pts + ma_pts + ret_pts)

            direction = (
                "bullish" if score >= 60
                else "bearish" if score < 35
                else "neutral"
            )

            logger.debug(
                "live_momentum_computed",
                symbol=symbol,
                rsi=round(rsi, 1),
                above_200ma=above_200ma,
                return_6m=round(return_6m, 1),
                score=score,
            )

            return {
                "score":        score,
                "direction":    direction,
                "rsi":          round(rsi, 1),
                "above_200ma":  above_200ma,
                "return_6m_pct": round(return_6m, 1),
            }

        except Exception as exc:
            logger.warning("live_momentum_failed", symbol=symbol, error=str(exc))
            return None

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
