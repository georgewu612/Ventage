"""策略 2: 威科夫流动性扫荡 (Wyckoff Liquidity Sweep).

规范 7-B: 价格短暂跌破/突破关键位置，触发市场流动性后迅速收回，反向切入。

Eligible regimes: ranging / exhaustion_reversal

Detection rules (规范 7B.4-7B.7):
    Long sweep:
        - Price touched/broke below recent N-day low (key level)
        - Closed BACK above the broken level (sweep reclaimed)
        - Reclaim happened within 1-3 bars
        - Volume spike on the sweep day preferred
        - Reversal candle pattern (long lower shadow / hammer / engulfing)
        - RSI oversold or bullish divergence — bonus
    Short sweep: mirror image at recent N-day high

Output trade plan:
    entry  = close of confirmation bar
    stop   = sweep extreme (low for long, high for short) ± buffer
    target_1 = mid of recent range
    target_2 = opposite range edge
    trailing = atr_2 (loose trailing)
"""

from __future__ import annotations

import pandas as pd

from services.chip_structure import analyze_chip_structure
from services.indicators import atr, rsi
from services.strategies.base import SignalCandidate, StrategyBase
from services.volume_engine import analyze_volume


class WyckoffLiquiditySweepStrategy(StrategyBase):
    name = "wyckoff_liquidity_sweep"
    eligible_regimes = ["ranging", "exhaustion_reversal"]

    # Tunables — Phase G calibration (2026-05-01)
    # Backtest learnings: longs in ranging regime had -0.46R avg, deep sweeps
    # didn't outperform, body size inversely correlated with outcome.
    # → tighten pierce, increase shadow requirement, drop body requirement,
    #   disable LONG in pure ranging (only allow LONG when there's confirmed
    #   exhaustion/divergence)
    LOOKBACK_KEY_LEVEL = 20
    SWEEP_WINDOW = 3
    SWEEP_PIERCE_PCT = 0.6        # was 0.3 — require deeper sweep (less noise)
    LOWER_SHADOW_MIN = 0.50       # was 0.40 — stronger reversal candle
    UPPER_SHADOW_MIN = 0.50       # same for shorts
    RSI_OVERSOLD = 35
    RSI_OVERBOUGHT = 65
    # New: minimum 1× ATR away from key level (avoids tight chop near resistance)
    MIN_PIERCE_ATR = 0.3
    # In pure 'ranging' regime, LONG signals lost money historically.
    # Require divergence confirmation OR force exhaustion_reversal regime for longs.
    REQUIRE_DIVERGENCE_FOR_LONG_IN_RANGING = True

    def detect(
        self,
        symbol: str,
        ohlcv: pd.DataFrame,
        regime: dict,
    ) -> SignalCandidate | None:
        if not self.is_eligible(regime):
            return None
        if len(ohlcv) < 60:
            return None

        open_ = ohlcv["Open"].astype(float)
        high = ohlcv["High"].astype(float)
        low = ohlcv["Low"].astype(float)
        close = ohlcv["Close"].astype(float)
        volume = ohlcv["Volume"].astype(float)

        last_close = float(close.iloc[-1])
        last_open = float(open_.iloc[-1])
        last_high = float(high.iloc[-1])
        last_low = float(low.iloc[-1])
        full_range = last_high - last_low
        if full_range <= 0:
            return None

        body = abs(last_close - last_open)
        body_ratio = body / full_range
        upper_shadow = last_high - max(last_close, last_open)
        lower_shadow = min(last_close, last_open) - last_low
        upper_ratio = upper_shadow / full_range
        lower_ratio = lower_shadow / full_range

        # Define recent key levels (excluding the last SWEEP_WINDOW bars)
        ref_window = ohlcv.iloc[-self.LOOKBACK_KEY_LEVEL - self.SWEEP_WINDOW : -self.SWEEP_WINDOW]
        if len(ref_window) < 10:
            return None
        prior_low = float(ref_window["Low"].min())
        prior_high = float(ref_window["High"].max())

        # Last `SWEEP_WINDOW` bars include the sweep + reclaim
        recent = ohlcv.iloc[-self.SWEEP_WINDOW :]

        rsi_now = float(rsi(close).iloc[-1]) if len(close) >= 14 else 50
        atr_14 = float(atr(high, low, close).iloc[-1])
        avg_vol_20 = float(volume.iloc[-21:-1].mean()) if len(volume) >= 21 else 0
        rv20 = float(volume.iloc[-1]) / avg_vol_20 if avg_vol_20 > 0 else 0

        # ── LONG SWEEP detection ──────────────────────────────────────────
        # 1. At some point in last 3 bars, low broke below prior_low
        sweep_low = float(recent["Low"].min())
        # Two pierce conditions: pct AND minimum ATR-distance (avoids chop)
        pct_pierce_threshold = prior_low * (1 - self.SWEEP_PIERCE_PCT / 100)
        atr_pierce_threshold = prior_low - self.MIN_PIERCE_ATR * atr_14
        pierced_below = sweep_low < min(pct_pierce_threshold, atr_pierce_threshold)
        # 2. Today closes BACK above prior_low (reclaim)
        reclaimed_above = last_close > prior_low
        # 3. Today is a reversal candle: long lower shadow OR bullish engulfing
        is_long_reversal_candle = (
            (lower_ratio >= self.LOWER_SHADOW_MIN and last_close >= last_open)
            or (
                last_close > last_open
                and len(close) >= 2
                and last_close > float(close.iloc[-2])
                and last_open < float(close.iloc[-2])  # engulfs prev close
            )
        )

        # Phase G: in pure 'ranging' regime, longs lost -0.46R historically.
        # Require bullish divergence OR exhaustion_reversal regime to enable LONG.
        divergence_long = bool(regime.get("notes", {}).get("has_bullish_divergence"))
        regime_name = regime.get("regime", "")
        long_regime_allowed = (
            regime_name == "exhaustion_reversal"
            or (
                regime_name == "ranging"
                and (
                    not self.REQUIRE_DIVERGENCE_FOR_LONG_IN_RANGING
                    or divergence_long
                )
            )
        )

        if (
            pierced_below
            and reclaimed_above
            and is_long_reversal_candle
            and long_regime_allowed
        ):
            direction = "long"
            entry_price = last_close
            stop_price = sweep_low - 0.3 * atr_14
            r = entry_price - stop_price
            if r <= 0:
                return None
            # Phase G: tighter, more achievable targets.
            # Old: T1 = mid-range (often unreachable in 20 bars); T2 = prior_high.
            # New: T1 = 1.5×R fixed; T2 = mid-range (capped by prior_high).
            target_1 = entry_price + 1.5 * r
            target_2 = min((prior_high + prior_low) / 2, prior_high)
            invalidation = (
                f"Sweep failed if close back below {sweep_low:.2f}; "
                f"or no follow-through within next 2 bars"
            )

            tags = ["liquidity_sweep_long", "reversal_candle"]
            if rv20 > 1.3:
                tags.append("sweep_with_volume")
            if rsi_now < self.RSI_OVERSOLD:
                tags.append("oversold_bounce")
            if divergence_long:
                tags.append("bullish_divergence_confirmation")

            return self._build_candidate(
                symbol=symbol,
                ohlcv=ohlcv,
                regime=regime,
                direction=direction,
                entry_price=entry_price,
                stop_price=stop_price,
                target_1=target_1,
                target_2=target_2,
                invalidation=invalidation,
                tags=tags,
                raw={
                    "prior_low": round(prior_low, 2),
                    "sweep_low": round(sweep_low, 2),
                    "pierce_pct": round(
                        (prior_low - sweep_low) / prior_low * 100, 3
                    ),
                    "lower_shadow_ratio": round(lower_ratio, 3),
                    "body_ratio": round(body_ratio, 3),
                    "rv20": round(rv20, 3),
                    "rsi": round(rsi_now, 1),
                    "atr_14": round(atr_14, 3),
                    "r_dollars": round(r, 2),
                    "has_bullish_divergence": divergence_long,
                },
                key_level=prior_low,
            )

        # ── SHORT SWEEP detection ─────────────────────────────────────────
        sweep_high = float(recent["High"].max())
        pct_pierce_threshold_high = prior_high * (1 + self.SWEEP_PIERCE_PCT / 100)
        atr_pierce_threshold_high = prior_high + self.MIN_PIERCE_ATR * atr_14
        pierced_above = sweep_high > max(pct_pierce_threshold_high, atr_pierce_threshold_high)
        reclaimed_below = last_close < prior_high
        is_short_reversal_candle = (
            (upper_ratio >= self.UPPER_SHADOW_MIN and last_close <= last_open)
            or (
                last_close < last_open
                and len(close) >= 2
                and last_close < float(close.iloc[-2])
                and last_open > float(close.iloc[-2])
            )
        )

        if pierced_above and reclaimed_below and is_short_reversal_candle:
            direction = "short"
            entry_price = last_close
            stop_price = sweep_high + 0.3 * atr_14
            r = stop_price - entry_price
            if r <= 0:
                return None
            # Phase G: tighter targets for shorts too.
            target_1 = entry_price - 1.5 * r
            target_2 = max((prior_high + prior_low) / 2, prior_low)
            invalidation = (
                f"Sweep failed if close back above {sweep_high:.2f}; "
                f"or no follow-through within next 2 bars"
            )

            divergence = bool(regime.get("notes", {}).get("has_bearish_divergence"))
            tags = ["liquidity_sweep_short", "reversal_candle"]
            if rv20 > 1.3:
                tags.append("sweep_with_volume")
            if rsi_now > self.RSI_OVERBOUGHT:
                tags.append("overbought_rejection")
            if divergence:
                tags.append("bearish_divergence_confirmation")

            return self._build_candidate(
                symbol=symbol,
                ohlcv=ohlcv,
                regime=regime,
                direction=direction,
                entry_price=entry_price,
                stop_price=stop_price,
                target_1=target_1,
                target_2=target_2,
                invalidation=invalidation,
                tags=tags,
                raw={
                    "prior_high": round(prior_high, 2),
                    "sweep_high": round(sweep_high, 2),
                    "pierce_pct": round(
                        (sweep_high - prior_high) / prior_high * 100, 3
                    ),
                    "upper_shadow_ratio": round(upper_ratio, 3),
                    "body_ratio": round(body_ratio, 3),
                    "rv20": round(rv20, 3),
                    "rsi": round(rsi_now, 1),
                    "atr_14": round(atr_14, 3),
                    "r_dollars": round(r, 2),
                    "has_bearish_divergence": divergence,
                },
                key_level=prior_high,
            )

        return None

    # ── Helper: build candidate with engines attached ────────────────────
    def _build_candidate(
        self,
        *,
        symbol: str,
        ohlcv: pd.DataFrame,
        regime: dict,
        direction: str,
        entry_price: float,
        stop_price: float,
        target_1: float,
        target_2: float,
        invalidation: str,
        tags: list[str],
        raw: dict,
        key_level: float,
    ) -> SignalCandidate:
        volume_ctx = {
            "signal_type": "sweep",
            "key_level": key_level,
            "direction": direction,
        }
        vol_res = analyze_volume(ohlcv, volume_ctx)
        chip_res = analyze_chip_structure(ohlcv)

        return SignalCandidate(
            strategy_name=self.name,
            symbol=symbol,
            direction=direction,
            market_regime=regime["regime"],
            entry_price=round(entry_price, 2),
            stop_price=round(stop_price, 2),
            target_1=round(target_1, 2),
            target_2=round(target_2, 2),
            trailing_rule="atr_2",
            invalidation_reason=invalidation,
            pattern_tags=tags,
            raw_features=raw,
            volume_analysis=vol_res.to_dict(),
            chip_analysis=chip_res.to_dict(),
            notes={
                "regime_score": regime.get("regime_score"),
                "key_level_swept": round(key_level, 2),
            },
        )
