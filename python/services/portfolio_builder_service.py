"""Portfolio Builder Service.

Orchestrates AI-powered portfolio construction:
  1. Fetches latest market regime snapshot
  2. Filters strategy templates by risk profile
  3. Selects candidates: core ETFs, enhanced V&M signals, satellite event-driven
  4. Calls GPT-4o-mini for portfolio typing + explanation
  5. Saves result to portfolio_recommendations table

Upgrade (V&M): enhance candidates are now ranked by regime-aware
Value & Momentum composite score instead of raw signal confidence.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import structlog
from supabase import Client, create_client

from agents.models import PortfolioPreferences, PortfolioRecommendation
from config.settings import get_settings
from services.vm_scorer import VMScorer

logger = structlog.get_logger()

# ── Risk tier constants ────────────────────────────────────────────────────────

RISK_RANK = {
    "conservative": 1,
    "moderate": 2,
    "balanced": 3,
    "aggressive": 4,
    "speculative": 5,
}

STRATEGY_RISK = {
    "trend": 3,
    "momentum": 4,
    "mean_reversion": 2,
    "event_driven": 4,
    "low_volatility": 1,
    "volatility": 3,
}

# Core ETF universe by risk tier
CORE_ETF_MAP: dict[str, list[str]] = {
    "conservative": ["TLT", "GLD", "IEF", "LQD"],
    "moderate": ["SPY", "QQQ", "GLD", "TLT"],
    "balanced": ["SPY", "QQQ", "IWM", "GLD"],
    "aggressive": ["QQQ", "IWM", "SMH", "XLK"],
    "speculative": ["QQQ", "SMH", "ARKK", "IWM"],
}

# Allocation structure by risk tier
ALLOCATION_MAP: dict[str, dict[str, int]] = {
    "conservative": {"core": 70, "enhance": 20, "satellite": 10},
    "moderate": {"core": 60, "enhance": 25, "satellite": 15},
    "balanced": {"core": 55, "enhance": 30, "satellite": 15},
    "aggressive": {"core": 45, "enhance": 35, "satellite": 20},
    "speculative": {"core": 35, "enhance": 40, "satellite": 25},
}


class PortfolioBuilderService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.db: Client = create_client(
            self.settings.supabase_url,
            self.settings.supabase_service_role_key,
        )
        self.vm_scorer = VMScorer(db=self.db)

    # ── Public entry point ─────────────────────────────────────────────────────

    def build(self, prefs: PortfolioPreferences) -> dict[str, Any]:
        """Build a portfolio recommendation and persist it."""
        # 1. Current regime
        regime_row = self._get_regime()
        regime = regime_row.get("regime", "neutral")

        # 2. Filter matching strategy templates
        templates = self._get_matching_templates(prefs, regime)

        # 3. Build candidate lists
        core = self._build_core(prefs)
        enhance = self._build_enhance(prefs, regime)
        satellite = self._build_satellite(prefs)
        watchlist = self._build_watchlist(prefs, regime)
        avoid = self._build_avoid(regime)

        # 4. Allocation structure
        allocation = ALLOCATION_MAP.get(prefs.risk_preference, ALLOCATION_MAP["balanced"])

        # 5. AI explanation
        explanation, explanation_en, portfolio_type, portfolio_type_en, confidence = (
            self._ai_explain(prefs, regime, core, enhance, satellite, templates)
        )

        # 6. Simple backtest summary (equal-weight core ETFs 60-day)
        backtest = self._simple_backtest(core)

        rec = PortfolioRecommendation(
            portfolio_type=portfolio_type,
            portfolio_type_en=portfolio_type_en,
            regime_at_creation=regime,
            risk_level=prefs.risk_preference,
            confidence_score=confidence,
            recommended_templates=[t.get("name", "") for t in templates[:3]],
            allocation_structure=allocation,
            core_candidates=core,
            enhance_candidates=enhance,
            satellite_candidates=satellite,
            watchlist_candidates=watchlist,
            avoid_candidates=avoid,
            backtest_summary=backtest,
            ai_explanation=explanation,
            ai_explanation_en=explanation_en,
        )

        # 7. Persist
        rec_id = self._save(prefs, rec)

        return {"id": rec_id, **rec.model_dump()}

    # ── Private helpers ────────────────────────────────────────────────────────

    def _get_regime(self) -> dict:
        rows = (
            self.db.table("market_regime_snapshots")
            .select("regime,volatility,style,vix,recommendation")
            .order("generated_at", desc=True)
            .limit(1)
            .execute()
            .data
        )
        return rows[0] if rows else {}

    def _get_matching_templates(
        self, prefs: PortfolioPreferences, regime: str
    ) -> list[dict]:
        rows = (
            self.db.table("strategy_templates")
            .select("id,name,category,description")
            .execute()
            .data
            or []
        )
        user_rank = RISK_RANK.get(prefs.risk_preference, 3)
        filtered = []
        for t in rows:
            cat = (t.get("category") or "").lower()
            strat_rank = STRATEGY_RISK.get(cat, 3)
            # Exclude strategies with risk rank much higher than user preference
            if strat_rank <= user_rank + 1:
                filtered.append(t)
        return filtered[:5]

    def _build_core(self, prefs: PortfolioPreferences) -> list[dict]:
        etfs = CORE_ETF_MAP.get(prefs.risk_preference, ["SPY", "QQQ", "GLD", "TLT"])
        weight = round(100 / len(etfs), 1)
        return [
            {
                "symbol": sym,
                "rationale": f"核心配置ETF，风险偏好匹配{prefs.risk_preference}",
                "rationale_en": f"Core ETF matched to {prefs.risk_preference} risk profile",
                "weight_pct": weight,
            }
            for sym in etfs
        ]

    def _build_enhance(self, prefs: PortfolioPreferences, regime: str) -> list[dict]:
        """Pull top V&M candidates: value underpin + momentum confirmation.

        Upgrade: uses VMScorer.get_top_vm_candidates() which ranks by
        regime-aware composite score (value_weight changes with regime).
        Falls back to pure momentum signals if value_scores table is empty.
        """
        try:
            # Risk preference adjusts minimum value threshold
            min_value = {
                "conservative": 60.0,
                "moderate":     55.0,
                "balanced":     50.0,
                "aggressive":   40.0,
                "speculative":  30.0,
            }.get(prefs.risk_preference, 50.0)

            candidates = self.vm_scorer.get_top_vm_candidates(
                regime=regime,
                min_value_score=min_value,
                min_momentum_score=50.0,
                limit=5,
            )

            if candidates:
                result = []
                for c in candidates:
                    sweet = " 🎯" if c.get("is_sweet_spot") else ""
                    tier_zh = c.get("value_tier_zh", "合理")
                    tier_en = c.get("value_tier_en", "Fair Value")
                    vm = c.get("vm_score", 0)
                    result.append({
                        "symbol": c["symbol"],
                        "rationale": (
                            f"V&M评分{vm:.0f}分{sweet} | 价值层:{tier_zh}"
                            f" | 动能层:{c.get('momentum_score', 0):.0f}分"
                        ),
                        "rationale_en": (
                            f"V&M score {vm:.0f}{sweet} | Value: {tier_en}"
                            f" | Momentum: {c.get('momentum_score', 0):.0f}/100"
                        ),
                        "weight_pct": None,
                    })
                return result

            # ── Fallback: pure momentum (value_scores table not yet populated) ──
            logger.info("vm_no_candidates_fallback", regime=regime)
            direction = "bullish" if regime == "risk_on" else (
                "bearish" if regime == "risk_off" else "neutral"
            )
            rows = (
                self.db.table("market_signals")
                .select("symbol,direction,confidence")
                .gte("confidence", 0.65)
                .eq("direction", direction)
                .order("confidence", desc=True)
                .limit(5)
                .execute()
                .data
                or []
            )
            if not rows:
                rows = (
                    self.db.table("market_signals")
                    .select("symbol,direction,confidence")
                    .gte("confidence", 0.65)
                    .order("confidence", desc=True)
                    .limit(5)
                    .execute()
                    .data
                    or []
                )
            seen: set[str] = set()
            result = []
            for r in rows:
                sym = r["symbol"]
                if sym not in seen:
                    seen.add(sym)
                    result.append({
                        "symbol": sym,
                        "rationale": f"动能信号{round(float(r['confidence'])*100)}分，方向{r['direction']}",
                        "rationale_en": f"Momentum signal {round(float(r['confidence'])*100)}/100, direction {r['direction']}",
                        "weight_pct": None,
                    })
            return result[:5]

        except Exception as exc:
            logger.warning("enhance_candidates_failed", error=str(exc))
            return []

    def _build_satellite(self, prefs: PortfolioPreferences) -> list[dict]:
        """Pull unusual options flow as satellite event-driven ideas."""
        try:
            rows = (
                self.db.table("options_flow")
                .select("symbol,unusual_score,direction")
                .gte("unusual_score", 80)
                .order("unusual_score", desc=True)
                .limit(3)
                .execute()
                .data
                or []
            )
            seen: set[str] = set()
            result = []
            for r in rows:
                sym = r["symbol"]
                if sym not in seen:
                    seen.add(sym)
                    result.append(
                        {
                            "symbol": sym,
                            "rationale": f"期权异动评分{r.get('unusual_score',0)}，事件驱动型机会",
                            "rationale_en": f"Options unusual score {r.get('unusual_score',0)}, event-driven",
                            "weight_pct": None,
                        }
                    )
            return result
        except Exception as exc:
            logger.warning("satellite_candidates_failed", error=str(exc))
            return []

    def _build_watchlist(self, prefs: PortfolioPreferences, regime: str) -> list[dict]:
        """Medium-confidence signals for observation."""
        try:
            rows = (
                self.db.table("market_signals")
                .select("symbol,confidence,direction")
                .gte("confidence", 0.5)
                .lt("confidence", 0.7)
                .order("confidence", desc=True)
                .limit(5)
                .execute()
                .data
                or []
            )
            seen: set[str] = set()
            result = []
            for r in rows:
                sym = r["symbol"]
                if sym not in seen:
                    seen.add(sym)
                    result.append(
                        {
                            "symbol": sym,
                            "rationale": "信号强度中等，建议持续观察",
                            "rationale_en": "Medium signal strength, observe for entry",
                            "weight_pct": None,
                        }
                    )
            return result
        except Exception:
            return []

    def _build_avoid(self, regime: str) -> list[dict]:
        """High-beta stocks to avoid in risk-off regime."""
        if regime != "risk_off":
            return []
        try:
            rows = (
                self.db.table("market_signals")
                .select("symbol,direction")
                .eq("direction", "bearish")
                .order("confidence", desc=True)
                .limit(3)
                .execute()
                .data
                or []
            )
            return [
                {
                    "symbol": r["symbol"],
                    "rationale": "市场风险规避环境下看空，建议回避",
                    "rationale_en": "Bearish in risk-off regime, suggest avoiding",
                    "weight_pct": None,
                }
                for r in rows
            ]
        except Exception:
            return []

    def _ai_explain(
        self,
        prefs: PortfolioPreferences,
        regime: str,
        core: list[dict],
        enhance: list[dict],
        satellite: list[dict],
        templates: list[dict],
    ) -> tuple[str, str, str, str, float]:
        """Call GPT-4o-mini for bilingual portfolio narrative."""
        try:
            from openai import OpenAI  # noqa: PLC0415

            client = OpenAI(api_key=self.settings.openai_api_key)
            core_str = ", ".join(c["symbol"] for c in core[:4])
            enhance_str = ", ".join(e["symbol"] for e in enhance[:3]) or "无"
            template_str = ", ".join(t.get("name", "") for t in templates[:3]) or "无"
            prompt = f"""You are a portfolio construction AI. Given the inputs below, return ONLY valid JSON (no markdown).

User preferences:
- Risk: {prefs.risk_preference}, Max drawdown: {prefs.max_drawdown_pct}%
- Style: {prefs.trading_style}, Period: {prefs.holding_period}
- Universe: {prefs.universe}, Sectors: {prefs.sector_preferences}

Market regime: {regime}
Core ETFs selected: {core_str}
Enhanced signals: {enhance_str}
Matched strategy templates: {template_str}

Return JSON with exactly:
{{
  "portfolio_type": "<2-4 Chinese characters describing portfolio style>",
  "portfolio_type_en": "<2-4 word English portfolio style label>",
  "ai_explanation": "<2-3 sentences in Chinese explaining why this portfolio suits user's goals and current regime>",
  "ai_explanation_en": "<2-3 sentences in English>",
  "confidence_score": <integer 60-95>
}}"""
            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.4,
                max_tokens=400,
            )
            data = json.loads(resp.choices[0].message.content)
            return (
                data.get("ai_explanation", ""),
                data.get("ai_explanation_en", ""),
                data.get("portfolio_type", "均衡配置"),
                data.get("portfolio_type_en", "Balanced Allocation"),
                float(data.get("confidence_score", 75)),
            )
        except Exception as exc:
            logger.warning("ai_explain_failed", error=str(exc))
            type_map = {
                "conservative": ("防御配置", "Defensive Portfolio"),
                "moderate": ("稳健配置", "Moderate Portfolio"),
                "balanced": ("均衡配置", "Balanced Portfolio"),
                "aggressive": ("进取配置", "Growth Portfolio"),
                "speculative": ("激进配置", "Aggressive Portfolio"),
            }
            zh, en = type_map.get(prefs.risk_preference, ("均衡配置", "Balanced Portfolio"))
            return (
                f"基于{regime}市场环境，构建{zh}方案，风险偏好{prefs.risk_preference}。",
                f"Built a {en} for {regime} market regime with {prefs.risk_preference} risk profile.",
                zh,
                en,
                70.0,
            )

    def _simple_backtest(self, core: list[dict]) -> dict:
        """60-day equal-weight backtest of core ETFs using yfinance."""
        try:
            import yfinance as yf  # noqa: PLC0415

            symbols = [c["symbol"] for c in core[:4]]
            if not symbols:
                return {}
            hist = yf.download(
                symbols,
                period="65d",
                auto_adjust=True,
                progress=False,
                group_by="ticker",
            )
            import pandas as pd  # noqa: PLC0415

            returns_list = []
            for sym in symbols:
                try:
                    close = hist[sym]["Close"] if len(symbols) > 1 else hist["Close"]
                    if isinstance(close, pd.DataFrame):
                        close = close.iloc[:, 0]
                    r = close.dropna().pct_change().dropna()
                    returns_list.append(r)
                except Exception:
                    pass
            if not returns_list:
                return {}
            import numpy as np  # noqa: PLC0415

            eq_weight = sum(returns_list) / len(returns_list)  # type: ignore[arg-type]
            cum = (1 + eq_weight).cumprod()
            total_return = float(cum.iloc[-1] - 1) * 100
            peak = cum.cummax()
            dd = ((cum - peak) / peak).min()
            max_dd = float(dd) * 100
            sharpe = float(eq_weight.mean() / eq_weight.std() * np.sqrt(252)) if eq_weight.std() > 0 else 0
            win_rate = float((eq_weight > 0).mean()) * 100
            return {
                "period_days": 60,
                "total_return_pct": round(total_return, 2),
                "max_drawdown_pct": round(abs(max_dd), 2),
                "sharpe_ratio": round(sharpe, 2),
                "win_rate_pct": round(win_rate, 1),
                "symbols": symbols,
            }
        except Exception as exc:
            logger.warning("simple_backtest_failed", error=str(exc))
            return {}

    def _save(self, prefs: PortfolioPreferences, rec: PortfolioRecommendation) -> str:
        row = {
            "user_id": prefs.user_id,
            "risk_preference": prefs.risk_preference,
            "max_drawdown_pct": prefs.max_drawdown_pct,
            "return_preference": prefs.return_preference,
            "holding_period": prefs.holding_period,
            "trading_style": prefs.trading_style,
            "universe": prefs.universe,
            "sector_preferences": prefs.sector_preferences,
            "risk_limits": prefs.risk_limits,
            "portfolio_type": rec.portfolio_type,
            "portfolio_type_en": rec.portfolio_type_en,
            "recommended_templates": rec.recommended_templates,
            "allocation_structure": rec.allocation_structure,
            "core_candidates": rec.core_candidates,
            "enhance_candidates": rec.enhance_candidates,
            "satellite_candidates": rec.satellite_candidates,
            "watchlist_candidates": rec.watchlist_candidates,
            "avoid_candidates": rec.avoid_candidates,
            "backtest_summary": rec.backtest_summary,
            "ai_explanation": rec.ai_explanation,
            "ai_explanation_en": rec.ai_explanation_en,
            "risk_level": rec.risk_level,
            "confidence_score": rec.confidence_score,
            "regime_at_creation": rec.regime_at_creation,
        }
        result = self.db.table("portfolio_recommendations").insert(row).execute()
        return result.data[0]["id"] if result.data else ""
