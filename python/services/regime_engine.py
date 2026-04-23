"""Market Regime Engine — 每日判断市场环境，不依赖 Qlib 或付费 API.

数据来源（全部 yfinance 免费）：
  ^VIX  → 波动率状态
  SPY   → 趋势（相对 200 日均线）
  RSP   → 等权 S&P 500（Invesco S&P 500 Equal Weight ETF，宽度指标）
  QQQ   → 成长/纳斯达克代表
  IWM   → 价值/小盘代表

P/C 比率来自 DB 的 options_flow 表（已有数据，无需外部 API）。

使用方式：
    from services.regime_engine import RegimeEngine
    engine = RegimeEngine(db)
    snapshot = await engine.compute_and_save()
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

import structlog

logger = structlog.get_logger()

# ── 类型别名 ───────────────────────────────────────────────────────────────────

RegimeType  = Literal["risk_on", "neutral", "risk_off"]
VolType     = Literal["low", "normal", "high", "very_high"]
BreadthType = Literal["healthy", "narrow", "weak"]
StyleType   = Literal["growth", "value", "defensive", "cyclical", "mixed"]
RecommType  = Literal["offense", "neutral", "defense"]


@dataclass
class RegimeSnapshot:
    regime: RegimeType
    volatility: VolType
    breadth: BreadthType
    style: StyleType
    recommendation: RecommType
    confidence: float
    vix: float | None
    spy_vs_200ma_pct: float | None
    rsp_spy_ratio: float | None
    qqq_iwm_ratio: float | None
    put_call_ratio: float | None
    chief_summary: str
    chief_summary_en: str
    generated_at: str


# ── Regime Engine ──────────────────────────────────────────────────────────────


class RegimeEngine:
    """计算并存储市场环境快照。"""

    def __init__(self, db) -> None:
        self.db = db
        self.log = logger.bind(component="regime_engine")

    async def compute_and_save(self) -> RegimeSnapshot:
        """在线程池中计算 Regime（yfinance 是同步的），然后写入 DB。"""
        snapshot = await asyncio.to_thread(self._compute)
        self._save(snapshot)
        self.log.info(
            "regime_computed",
            regime=snapshot.regime,
            volatility=snapshot.volatility,
            vix=snapshot.vix,
            spy_vs_200ma_pct=snapshot.spy_vs_200ma_pct,
        )
        return snapshot

    def _compute(self) -> RegimeSnapshot:
        """同步计算所有指标并组合成 RegimeSnapshot。"""
        import yfinance as yf

        # 1. 拉取日线数据（过去 14 个月，确保有足够数据算 200MA）
        tickers = yf.download(
            ["^VIX", "SPY", "RSP", "QQQ", "IWM"],
            period="14mo",
            interval="1d",
            progress=False,
            auto_adjust=True,
        )
        closes = tickers["Close"]

        # 安全取值
        def _last(col: str) -> float | None:
            try:
                val = closes[col].dropna().iloc[-1]
                return float(val)
            except Exception:
                return None

        vix     = _last("^VIX")
        spy_now = _last("SPY")
        rsp_now = _last("RSP")
        qqq_now = _last("QQQ")
        iwm_now = _last("IWM")

        # SPY 200 日均线
        spy_200ma: float | None = None
        spy_vs_200ma_pct: float | None = None
        try:
            spy_200ma = float(closes["SPY"].dropna().rolling(200).mean().iloc[-1])
            if spy_200ma and spy_now:
                spy_vs_200ma_pct = round((spy_now - spy_200ma) / spy_200ma * 100, 2)
        except Exception:
            pass

        rsp_spy_ratio: float | None = None
        if rsp_now and spy_now:
            rsp_spy_ratio = round(rsp_now / spy_now, 4)

        qqq_iwm_ratio: float | None = None
        if qqq_now and iwm_now:
            qqq_iwm_ratio = round(qqq_now / iwm_now, 4)

        # 2. P/C 比率（来自 DB）
        put_call_ratio = self._get_pc_ratio_from_db()

        # 3. 各维度判断
        volatility = self._vol_state(vix)
        breadth    = self._breadth_state(rsp_spy_ratio, spy_vs_200ma_pct)
        style      = self._style_state(qqq_iwm_ratio, spy_vs_200ma_pct)
        regime, confidence = self._regime_state(
            vix, spy_vs_200ma_pct, breadth, put_call_ratio
        )
        recommendation = self._recommendation(regime, volatility)

        # 4. 生成摘要文本
        chief_zh, chief_en = self._build_summary(
            regime, volatility, breadth, style,
            vix, spy_vs_200ma_pct
        )

        return RegimeSnapshot(
            regime=regime,
            volatility=volatility,
            breadth=breadth,
            style=style,
            recommendation=recommendation,
            confidence=round(confidence, 2),
            vix=round(vix, 2) if vix else None,
            spy_vs_200ma_pct=spy_vs_200ma_pct,
            rsp_spy_ratio=rsp_spy_ratio,
            qqq_iwm_ratio=qqq_iwm_ratio,
            put_call_ratio=put_call_ratio,
            chief_summary=chief_zh,
            chief_summary_en=chief_en,
            generated_at=datetime.now(UTC).isoformat(),
        )

    # ── 各维度判断规则 ─────────────────────────────────────────────────────────

    def _vol_state(self, vix: float | None) -> VolType:
        if vix is None:
            return "normal"
        if vix < 15:
            return "low"
        if vix < 20:
            return "normal"
        if vix < 30:
            return "high"
        return "very_high"

    def _breadth_state(
        self, rsp_spy: float | None, spy_200ma_pct: float | None
    ) -> BreadthType:
        if rsp_spy is None or spy_200ma_pct is None:
            return "narrow"
        if rsp_spy > 0.45 and spy_200ma_pct > 0:
            return "healthy"
        if rsp_spy < 0.43 or spy_200ma_pct < -5:
            return "weak"
        return "narrow"

    def _style_state(
        self, qqq_iwm: float | None, spy_200ma_pct: float | None
    ) -> StyleType:
        if qqq_iwm is None:
            return "mixed"
        if spy_200ma_pct is not None and spy_200ma_pct < -5:
            return "defensive"
        if qqq_iwm > 2.8:
            return "growth"
        if qqq_iwm < 2.3:
            return "value"
        return "mixed"

    def _regime_state(
        self,
        vix: float | None,
        spy_200ma_pct: float | None,
        breadth: BreadthType,
        pc_ratio: float | None,
    ) -> tuple[RegimeType, float]:
        score = 0
        # VIX 贡献
        if vix is not None:
            if vix < 18:
                score += 2
            elif vix < 22:
                score += 1
            elif vix > 28:
                score -= 2
            elif vix > 23:
                score -= 1
        # SPY vs 200MA
        if spy_200ma_pct is not None:
            if spy_200ma_pct > 5:
                score += 2
            elif spy_200ma_pct > 0:
                score += 1
            elif spy_200ma_pct < -8:
                score -= 2
            elif spy_200ma_pct < -3:
                score -= 1
        # 市场宽度
        if breadth == "healthy":
            score += 1
        elif breadth == "weak":
            score -= 1
        # P/C 比率（低 = 市场乐观）
        if pc_ratio is not None:
            if pc_ratio < 0.75:
                score += 1
            elif pc_ratio > 1.2:
                score -= 1

        if score >= 3:
            confidence = min(0.92, 0.65 + score * 0.05)
            return "risk_on", confidence
        if score <= -2:
            confidence = min(0.92, 0.65 + abs(score) * 0.05)
            return "risk_off", confidence
        return "neutral", 0.62

    def _recommendation(self, regime: RegimeType, vol: VolType) -> RecommType:
        if regime == "risk_on" and vol in ("low", "normal"):
            return "offense"
        if regime == "risk_off" or vol == "very_high":
            return "defense"
        return "neutral"

    def _build_summary(
        self,
        regime: RegimeType,
        vol: VolType,
        breadth: BreadthType,
        style: StyleType,
        vix: float | None,
        spy_200ma_pct: float | None,
    ) -> tuple[str, str]:
        regime_zh = {"risk_on": "风险偏好", "neutral": "中性", "risk_off": "风险规避"}[regime]
        regime_en = {"risk_on": "Risk-On", "neutral": "Neutral", "risk_off": "Risk-Off"}[regime]

        vix_str    = f"VIX={vix:.1f}" if vix else "VIX=N/A"
        ma_str_zh  = (
            f"SPY较200MA{'上方' if (spy_200ma_pct or 0) > 0 else '下方'}"
            f"{abs(spy_200ma_pct or 0):.1f}%"
            if spy_200ma_pct is not None else "SPY趋势未知"
        )
        ma_str_en = (
            f"SPY is {abs(spy_200ma_pct or 0):.1f}% "
            f"{'above' if (spy_200ma_pct or 0) > 0 else 'below'} its 200-day MA"
            if spy_200ma_pct is not None else "SPY trend unknown"
        )

        action_zh = {"offense": "建议积极布局", "neutral": "均衡配置", "defense": "防守为主"}
        rec = self._recommendation(regime, vol)

        zh = (
            f"当前市场处于{regime_zh}状态。{vix_str}，{ma_str_zh}，"
            f"市场宽度{breadth}，风格偏{style}。{action_zh[rec]}。"
        )
        en = (
            f"Market is in {regime_en} mode. {vix_str}, {ma_str_en}. "
            f"Breadth is {breadth}, style bias is {style}. "
            f"Recommended posture: {rec}."
        )
        return zh, en

    def _get_pc_ratio_from_db(self) -> float | None:
        """从 options_flow 表计算近 24h 的 P/C 比率。"""
        try:
            cutoff = (datetime.now(UTC) - timedelta(hours=24)).isoformat()
            rows = (
                self.db.table("options_flow")
                .select("option_type")
                .gte("created_at", cutoff)
                .execute()
                .data
                or []
            )
            puts  = sum(1 for r in rows if r.get("option_type") == "put")
            calls = sum(1 for r in rows if r.get("option_type") == "call")
            if calls > 0:
                return round(puts / calls, 3)
        except Exception as exc:
            self.log.warning("pc_ratio_failed", error=str(exc))
        return None

    def _save(self, s: RegimeSnapshot) -> None:
        """写入 market_regime_snapshots 表。"""
        self.db.table("market_regime_snapshots").insert({
            "regime":           s.regime,
            "volatility":       s.volatility,
            "breadth":          s.breadth,
            "style":            s.style,
            "recommendation":   s.recommendation,
            "confidence":       s.confidence,
            "vix":              s.vix,
            "spy_vs_200ma_pct": s.spy_vs_200ma_pct,
            "rsp_spy_ratio":    s.rsp_spy_ratio,
            "qqq_iwm_ratio":    s.qqq_iwm_ratio,
            "put_call_ratio":   s.put_call_ratio,
            "chief_summary":    s.chief_summary,
            "chief_summary_en": s.chief_summary_en,
            "generated_at":     s.generated_at,
        }).execute()
