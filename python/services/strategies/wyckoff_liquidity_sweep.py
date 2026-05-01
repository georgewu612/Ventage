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

    # Tunables
    LOOKBACK_KEY_LEVEL = 20      # find recent N-bar high/low
    SWEEP_WINDOW = 3              # how many bars within which the reclaim must happen
    SWEEP_PIERCE_PCT = 0.3        # piercing must be ≥0.3% past the level (otherwise it's just a touch)
    LOWER_SHADOW_MIN = 0.40       # ≥40% lower shadow for long
    UPPER_SHADOW_MIN = 0.40       # ≥40% upper shadow for short
    RSI_OVERSOLD = 35
    RSI_OVERBOUGHT = 65

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
        pierced_below = sweep_low < prior_low * (1 - self.SWEEP_PIERCE_PCT / 100)
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

        if pierced_below and reclaimed_above and is_long_reversal_candle:
            direction = "long"
            entry_price = last_close
            stop_price = sweep_low - 0.3 * atr_14
            r = entry_price - stop_price
            if r <= 0:
                return None
            mid_range = (prior_high + prior_low) / 2
            target_1 = mid_range
            target_2 = prior_high
            invalidation = (
                f"Sweep failed if close back below {sweep_low:.2f}; "
                f"or no follow-through within next 2 bars"
            )

            divergence = bool(regime.get("notes", {}).get("has_bullish_divergence"))
            tags = ["liquidity_sweep_long", "reversal_candle"]
            if rv20 > 1.3:
                tags.append("sweep_with_volume")
            if rsi_now < self.RSI_OVERSOLD:
                tags.append("oversold_bounce")
            if divergence:
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
                    "has_bullish_divergence": divergence,
                },
                key_level=prior_low,
            )

        # ── SHORT SWEEP detection ─────────────────────────────────────────
        sweep_high = float(recent["High"].max())
        pierced_above = sweep_high > prior_high * (1 + self.SWEEP_PIERCE_PCT / 100)
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
            mid_range = (prior_high + prior_low) / 2
            target_1 = mid_range
            target_2 = prior_low
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
