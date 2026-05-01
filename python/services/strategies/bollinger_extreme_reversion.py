"""策略 4: 布林带极端均值回归 (Bollinger Extreme Mean Reversion).

规范 7-D: 在震荡环境中，价格偏离布林带边界后回归中值。

Eligible regimes: ranging (primary)

Detection rules (规范 7D.4-7D.6):
    Pre-conditions (already gated by regime: ADX<20 + flat BB):
        - Bollinger Bands not expanding (squeeze-style ranging)
        - 20MA flat (no clear trend)
    Long trigger (7D.5):
        - Price touches OR pierces lower band today
        - Reversal candle (long lower shadow / hammer / bullish engulfing)
        - Stochastic K < 20 (oversold) — bonus
        - RSI < 35 — bonus
    Short trigger (7D.6):
        - Price touches/pierces upper band
        - Reversal candle (long upper shadow / bearish engulfing)
        - Stochastic K > 80 (overbought) — bonus
        - RSI > 65 — bonus

Output trade plan:
    entry  = current close (after reversal candle confirms)
    stop   = below reversal-candle low (long) / above reversal-candle high (short)
    target_1 = BB middle (20MA)
    target_2 = opposite band
    trailing = none — target-based exit
"""

from __future__ import annotations

import pandas as pd

from services.chip_structure import analyze_chip_structure
from services.indicators import atr, bollinger, rsi, stochastic
from services.strategies.base import SignalCandidate, StrategyBase
from services.volume_engine import analyze_volume


class BollingerExtremeReversionStrategy(StrategyBase):
    name = "bollinger_extreme_reversion"
    eligible_regimes = ["ranging"]

    # Tunables
    LOWER_SHADOW_MIN = 0.40
    UPPER_SHADOW_MIN = 0.40
    BODY_RATIO_MIN_REVERSAL = 0.30
    STOCH_OVERSOLD = 20
    STOCH_OVERBOUGHT = 80
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

        bb_u, bb_m, bb_l = bollinger(close, 20, 2.0)
        last_bb_u = float(bb_u.iloc[-1])
        last_bb_m = float(bb_m.iloc[-1])
        last_bb_l = float(bb_l.iloc[-1])

        # Reject if BB is expanding (volatility breakout, not mean reversion)
        bb_width_now = last_bb_u - last_bb_l
        bb_width_5_ago = float((bb_u.iloc[-5] - bb_l.iloc[-5])) if len(bb_u) >= 5 else bb_width_now
        if bb_width_now > bb_width_5_ago * 1.3:
            return None  # bands expanding = trending, not ranging

        # Compute momentum oscillators
        try:
            stoch_k, stoch_d = stochastic(high, low, close, 14, 3)
            last_k = float(stoch_k.iloc[-1])
        except Exception:
            last_k = 50
        rsi_now = float(rsi(close).iloc[-1]) if len(close) >= 14 else 50
        atr_14 = float(atr(high, low, close).iloc[-1])

        # ── LONG trigger: piercing lower band + bullish reversal ──────────
        pierced_lower = last_low < last_bb_l
        is_bull_reversal = (
            (lower_ratio >= self.LOWER_SHADOW_MIN and last_close >= last_open)  # hammer
            or (
                last_close > last_open
                and len(close) >= 2
                and last_close > float(close.iloc[-2])
                and last_open <= float(close.iloc[-2])
            )  # bullish engulfing
        )

        if pierced_lower and is_bull_reversal:
            entry_price = last_close
            stop_price = last_low - 0.3 * atr_14
            r = entry_price - stop_price
            if r <= 0:
                return None
            target_1 = last_bb_m
            target_2 = last_bb_u
            invalidation = (
                f"Two consecutive closes below {last_bb_l:.2f}; "
                f"or BB starts expanding (regime change to trending)"
            )

            tags = ["bb_lower_extreme", "bullish_reversal_candle"]
            if last_k < self.STOCH_OVERSOLD:
                tags.append("stoch_oversold")
            if rsi_now < self.RSI_OVERSOLD:
                tags.append("rsi_oversold")

            return self._build_candidate(
                symbol=symbol,
                ohlcv=ohlcv,
                regime=regime,
                direction="long",
                entry_price=entry_price,
                stop_price=stop_price,
                target_1=target_1,
                target_2=target_2,
                invalidation=invalidation,
                tags=tags,
                raw={
                    "bb_lower": round(last_bb_l, 2),
                    "bb_middle": round(last_bb_m, 2),
                    "bb_upper": round(last_bb_u, 2),
                    "bb_width_now": round(bb_width_now, 3),
                    "bb_width_5_ago": round(bb_width_5_ago, 3),
                    "lower_shadow_ratio": round(lower_ratio, 3),
                    "body_ratio": round(body_ratio, 3),
                    "rsi": round(rsi_now, 1),
                    "stoch_k": round(last_k, 1),
                    "atr_14": round(atr_14, 3),
                    "r_dollars": round(r, 2),
                },
                key_level=last_bb_l,
            )

        # ── SHORT trigger: piercing upper band + bearish reversal ─────────
        pierced_upper = last_high > last_bb_u
        is_bear_reversal = (
            (upper_ratio >= self.UPPER_SHADOW_MIN and last_close <= last_open)  # shooting star
            or (
                last_close < last_open
                and len(close) >= 2
                and last_close < float(close.iloc[-2])
                and last_open >= float(close.iloc[-2])
            )  # bearish engulfing
        )

        if pierced_upper and is_bear_reversal:
            entry_price = last_close
            stop_price = last_high + 0.3 * atr_14
            r = stop_price - entry_price
            if r <= 0:
                return None
            target_1 = last_bb_m
            target_2 = last_bb_l
            invalidation = (
                f"Two consecutive closes above {last_bb_u:.2f}; "
                f"or BB starts expanding"
            )

            tags = ["bb_upper_extreme", "bearish_reversal_candle"]
            if last_k > self.STOCH_OVERBOUGHT:
                tags.append("stoch_overbought")
            if rsi_now > self.RSI_OVERBOUGHT:
                tags.append("rsi_overbought")

            return self._build_candidate(
                symbol=symbol,
                ohlcv=ohlcv,
                regime=regime,
                direction="short",
                entry_price=entry_price,
                stop_price=stop_price,
                target_1=target_1,
                target_2=target_2,
                invalidation=invalidation,
                tags=tags,
                raw={
                    "bb_lower": round(last_bb_l, 2),
                    "bb_middle": round(last_bb_m, 2),
                    "bb_upper": round(last_bb_u, 2),
                    "bb_width_now": round(bb_width_now, 3),
                    "bb_width_5_ago": round(bb_width_5_ago, 3),
                    "upper_shadow_ratio": round(upper_ratio, 3),
                    "body_ratio": round(body_ratio, 3),
                    "rsi": round(rsi_now, 1),
                    "stoch_k": round(last_k, 1),
                    "atr_14": round(atr_14, 3),
                    "r_dollars": round(r, 2),
                },
                key_level=last_bb_u,
            )

        return None

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
            "signal_type": "reversal",
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
            trailing_rule=None,  # target-based exits, no trailing
            invalidation_reason=invalidation,
            pattern_tags=tags,
            raw_features=raw,
            volume_analysis=vol_res.to_dict(),
            chip_analysis=chip_res.to_dict(),
            notes={
                "regime_score": regime.get("regime_score"),
                "bb_width_at_signal": raw.get("bb_width_now"),
            },
        )
