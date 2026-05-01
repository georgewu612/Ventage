"""策略 1: 顺势回调突破 (Trend Pullback Breakout).

规范 7-A: 在强趋势中寻找短暂缩量整理，等待带量突破后顺势跟进。

Eligible regimes: strong_uptrend (long) / strong_downtrend (short)

Detection rules (规范 7A.4-7A.7):
    Pre-conditions:
        - regime in eligible set
        - Recent impulse leg (>=5% over ~10 bars)
    Pullback quality (7A.5):
        - Pullback magnitude <= 50% of impulse
        - Pullback period bars: 3-10 bars
        - Avg pullback volume < impulse avg volume
        - Pullback didn't break EMA34 / EMA55
        - Body sizes shrink during pullback
    Breakout trigger (7A.6):
        - Today's close breaks pullback range upper edge
        - Strong real body
        - Volume >= 20-day avg × 1.3
        - Upper shadow not too long
        - RSI > 50

Output trade plan:
    entry  = breakout close
    stop   = pullback low (or 1.5 ATR)
    target_1 = entry + 1×R
    target_2 = entry + impulse-leg projection (flag-pole measured move)
    trailing = ema_13
"""

from __future__ import annotations

import pandas as pd

from services.chip_structure import analyze_chip_structure
from services.indicators import atr, ema, rsi
from services.strategies.base import SignalCandidate, StrategyBase
from services.volume_engine import analyze_volume


class TrendPullbackBreakoutStrategy(StrategyBase):
    name = "trend_pullback_breakout"
    eligible_regimes = ["strong_uptrend", "strong_downtrend"]

    # Tunables
    MIN_IMPULSE_PCT = 3.5       # impulse leg must be ≥3.5% (was 5% — too strict for low-vol)
    IMPULSE_LOOKBACK = 10       # bars to look for impulse leg
    PULLBACK_MIN_BARS = 3
    PULLBACK_MAX_BARS = 10
    PULLBACK_MAX_RETRACE = 0.5  # 50% of impulse
    PULLBACK_DRYUP_RATIO = 0.95 # avg pullback vol must be < 0.95× prior avg (relaxed from 1.0)
    BREAKOUT_VOL_MULT = 1.2     # was 1.3 — relaxed slightly
    UPPER_SHADOW_MAX = 0.35     # ≤35% upper shadow (was 0.30)
    BODY_RATIO_MIN = 0.45       # ≥45% body (was 0.50)
    RSI_BULL_MIN = 50
    RSI_BEAR_MAX = 50

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

        is_long = regime["regime"] == "strong_uptrend"
        direction = "long" if is_long else "short"

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
        upper_ratio = upper_shadow / full_range

        # ── 1. Find recent impulse leg ────────────────────────────────────
        # For long: impulse = swing from low to high in last ~20 bars
        # For short: impulse = swing from high to low
        win = ohlcv.iloc[-self.IMPULSE_LOOKBACK * 3 : -self.PULLBACK_MIN_BARS]
        if len(win) < 10:
            return None

        if is_long:
            impulse_low = float(win["Low"].min())
            impulse_low_idx = int(win["Low"].values.argmin())
            # Impulse high = max AFTER the low
            after_low = win.iloc[impulse_low_idx + 1 :] if impulse_low_idx + 1 < len(win) else win.tail(1)
            if len(after_low) == 0:
                return None
            impulse_high = float(after_low["High"].max())
            impulse_pct = (impulse_high - impulse_low) / impulse_low * 100
        else:
            impulse_high = float(win["High"].max())
            impulse_high_idx = int(win["High"].values.argmax())
            after_high = win.iloc[impulse_high_idx + 1 :] if impulse_high_idx + 1 < len(win) else win.tail(1)
            if len(after_high) == 0:
                return None
            impulse_low = float(after_high["Low"].min())
            impulse_pct = (impulse_high - impulse_low) / impulse_high * 100

        if impulse_pct < self.MIN_IMPULSE_PCT:
            return None

        # ── 2. Pullback quality ────────────────────────────────────────────
        pullback_window = ohlcv.iloc[-self.PULLBACK_MAX_BARS - 1 : -1]  # last 10 bars before today
        if len(pullback_window) < self.PULLBACK_MIN_BARS:
            return None

        if is_long:
            pullback_extreme = float(pullback_window["Low"].min())
            pullback_retrace = (impulse_high - pullback_extreme) / (
                impulse_high - impulse_low
            )
            range_top = float(pullback_window["High"].max())  # the "上沿"
        else:
            pullback_extreme = float(pullback_window["High"].max())
            pullback_retrace = (pullback_extreme - impulse_low) / (
                impulse_high - impulse_low
            )
            range_top = float(pullback_window["Low"].min())  # the "下沿" for short

        if pullback_retrace > self.PULLBACK_MAX_RETRACE:
            return None  # too deep — no longer a healthy pullback

        # Pullback didn't break key EMA
        e34 = ema(close, 34)
        e55 = ema(close, 55)
        if is_long:
            pullback_low_recent = float(pullback_window["Low"].min())
            if pullback_low_recent < float(e55.iloc[-len(pullback_window) :].min()):
                return None
        else:
            pullback_high_recent = float(pullback_window["High"].max())
            if pullback_high_recent > float(e55.iloc[-len(pullback_window) :].max()):
                return None

        # Pullback volume should dry up
        pullback_avg_vol = float(pullback_window["Volume"].mean())
        # Compare to impulse volume — use last 20 days
        prior_avg_vol = float(volume.iloc[-30:-len(pullback_window)].mean())
        if pullback_avg_vol > prior_avg_vol * self.PULLBACK_DRYUP_RATIO:
            return None  # not a real dryup

        # ── 3. Breakout trigger ────────────────────────────────────────────
        avg_vol_20 = float(volume.iloc[-21:-1].mean())
        rv20 = float(volume.iloc[-1]) / avg_vol_20 if avg_vol_20 > 0 else 0
        rsi_now = float(rsi(close).iloc[-1]) if len(close) >= 14 else 50

        # Breakout = today closes above (long) / below (short) the range edge
        if is_long:
            broke_out = last_close > range_top
            strong_body = (last_close > last_open) and body_ratio >= self.BODY_RATIO_MIN
            rsi_ok = rsi_now > self.RSI_BULL_MIN
        else:
            broke_out = last_close < range_top  # range_top is the low edge for short
            strong_body = (last_close < last_open) and body_ratio >= self.BODY_RATIO_MIN
            rsi_ok = rsi_now < self.RSI_BEAR_MAX

        if not broke_out or not strong_body:
            return None
        if rv20 < self.BREAKOUT_VOL_MULT:
            return None
        if upper_ratio > self.UPPER_SHADOW_MAX:
            return None
        if not rsi_ok:
            return None

        # ── 4. Compute trade plan ──────────────────────────────────────────
        atr_14 = float(atr(high, low, close).iloc[-1])
        if is_long:
            stop_price = max(pullback_extreme, last_close - 1.5 * atr_14)
            r = last_close - stop_price
            target_1 = last_close + r
            # Flag-pole projection: add the impulse leg to the breakout
            target_2 = range_top + (impulse_high - impulse_low)
        else:
            stop_price = min(pullback_extreme, last_close + 1.5 * atr_14)
            r = stop_price - last_close
            target_1 = last_close - r
            target_2 = range_top - (impulse_high - impulse_low)

        if r <= 0:
            return None

        # ── 5. Run engines (volume, chip) ──────────────────────────────────
        volume_ctx = {
            "signal_type": "breakout",
            "key_level": range_top,
            "direction": direction,
        }
        vol_res = analyze_volume(ohlcv, volume_ctx)
        chip_res = analyze_chip_structure(ohlcv)

        return SignalCandidate(
            strategy_name=self.name,
            symbol=symbol,
            direction=direction,
            market_regime=regime["regime"],
            entry_price=round(last_close, 2),
            stop_price=round(stop_price, 2),
            target_1=round(target_1, 2),
            target_2=round(target_2, 2),
            trailing_rule="ema_13",
            invalidation_reason=(
                f"Failure to hold above {range_top:.2f} for 2 bars; "
                f"or break below {pullback_extreme:.2f}"
                if is_long
                else f"Failure to hold below {range_top:.2f} for 2 bars; "
                f"or break above {pullback_extreme:.2f}"
            ),
            pattern_tags=[
                "trend_continuation",
                "flag_breakout",
                f"impulse_pct_{impulse_pct:.1f}",
            ],
            raw_features={
                "impulse_low": round(impulse_low, 2),
                "impulse_high": round(impulse_high, 2),
                "impulse_pct": round(impulse_pct, 2),
                "pullback_retrace": round(pullback_retrace, 3),
                "pullback_avg_vol_ratio": round(pullback_avg_vol / prior_avg_vol, 3)
                if prior_avg_vol > 0
                else None,
                "breakout_close": round(last_close, 2),
                "breakout_range_top": round(range_top, 2),
                "rv20": round(rv20, 3),
                "body_ratio": round(body_ratio, 3),
                "upper_shadow_ratio": round(upper_ratio, 3),
                "rsi": round(rsi_now, 1),
                "atr_14": round(atr_14, 3),
                "r_dollars": round(r, 2),
            },
            volume_analysis=vol_res.to_dict(),
            chip_analysis=chip_res.to_dict(),
            notes={
                "regime_score": regime.get("regime_score"),
                "ema_alignment": regime.get("ema_alignment"),
            },
        )
