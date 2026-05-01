"""策略 3: 13/34/55 EMA 主升浪启动 (EMA Squeeze Launch).

规范 7-C: 横盘、缩量、均线缠绕后，一旦放量突破，往往进入主升浪。

Eligible regimes: squeeze_breakout_setup (primary) + early strong_uptrend

Detection rules (规范 7C.4-7C.6):
    Squeeze quality (7C.4):
        - 13/34/55 EMA max dispersion < 5% (already gated by regime)
        - ATR declining (already in regime classifier)
        - Bollinger band squeeze (already in regime classifier)
        - Recent volume average lower than long-term
    First buy point (7C.5):
        - Today's close above all 3 EMAs (13/34/55)
        - Strong real body
        - Volume >= 1.3-2× recent average
        - MACD ideally crossing up (bonus)
    Second buy point (7C.6) — secondary_entry=True:
        - Already broke out previously
        - Pulled back to ema_34 / ema_55
        - Dryup volume on pullback
        - Today resumes upward with strong candle

Output trade plan:
    entry  = breakout close
    stop   = below platform / EMA55 / 1.5×ATR
    target_1 = entry + 1×R
    target_2 = entry + platform-height projection
    trailing = ema_13
"""

from __future__ import annotations

import pandas as pd

from services.chip_structure import analyze_chip_structure
from services.indicators import atr, ema, ema_squeeze_pct, macd
from services.strategies.base import SignalCandidate, StrategyBase
from services.volume_engine import analyze_volume


class EmaSqueezeLaunchStrategy(StrategyBase):
    name = "ema_squeeze_launch"
    eligible_regimes = ["squeeze_breakout_setup", "strong_uptrend"]

    # Tunables
    SQUEEZE_PCT_MAX = 5.0
    PLATFORM_LOOKBACK = 25
    BREAKOUT_VOL_MULT = 1.2     # was 1.3 — relaxed
    BODY_RATIO_MIN = 0.40       # was 0.50 — relaxed (squeeze break can have moderate body)
    TRANSITION_LOOKBACK = 3     # consider it a fresh breakout if any of last 3 prev bars not above all EMAs
    SECONDARY_PULLBACK_BARS = 7
    SECONDARY_PULLBACK_MAX_RETRACE = 0.6  # to EMA34 area

    def detect(
        self,
        symbol: str,
        ohlcv: pd.DataFrame,
        regime: dict,
    ) -> SignalCandidate | None:
        if not self.is_eligible(regime):
            return None
        if len(ohlcv) < 100:
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

        e13 = ema(close, 13)
        e34 = ema(close, 34)
        e55 = ema(close, 55)
        last_e13 = float(e13.iloc[-1])
        last_e34 = float(e34.iloc[-1])
        last_e55 = float(e55.iloc[-1])

        # ── Squeeze quality (recent N bars must have small EMA dispersion) ──
        # We already know the current bar passes (regime gated), but verify
        # the squeeze persisted over the lookback window.
        squeeze_window = ohlcv.iloc[-self.PLATFORM_LOOKBACK : -1]
        if len(squeeze_window) < 15:
            return None

        # Compute squeeze pct at each bar in the window
        sqz_pcts = []
        for i in range(len(squeeze_window)):
            idx = squeeze_window.index[i]
            try:
                a = float(e13.loc[idx])
                b = float(e34.loc[idx])
                c = float(e55.loc[idx])
                mean = (a + b + c) / 3
                if mean > 0:
                    sqz_pcts.append(max(abs(a - b), abs(b - c), abs(a - c)) / mean * 100)
            except Exception:
                continue
        if len(sqz_pcts) < 5:
            return None
        avg_sqz = sum(sqz_pcts) / len(sqz_pcts)
        if avg_sqz > self.SQUEEZE_PCT_MAX * 1.5:
            return None  # window wasn't tight enough

        # ── Platform top (= recent high during squeeze) ──────────────────
        platform_top = float(squeeze_window["High"].max())
        platform_bot = float(squeeze_window["Low"].min())
        platform_height = platform_top - platform_bot
        if platform_height <= 0:
            return None

        # ── Volume check ──────────────────────────────────────────────────
        avg_vol_20 = float(volume.iloc[-21:-1].mean()) if len(volume) >= 21 else 0
        rv20 = float(volume.iloc[-1]) / avg_vol_20 if avg_vol_20 > 0 else 0

        # ── First buy point: breakout above all 3 EMAs + above platform ──
        above_all_emas = (
            last_close > last_e13 and last_close > last_e34 and last_close > last_e55
        )
        above_platform = last_close > platform_top
        strong_bull_body = (last_close > last_open) and body_ratio >= self.BODY_RATIO_MIN
        prev_close = float(close.iloc[-2])
        # Transition check: was the close NOT above all 3 EMAs in any of the last
        # `TRANSITION_LOOKBACK` prior bars? (Spec demands a fresh breakout, not
        # a continuation of an already-established trend.)
        prev_n_above_all = []
        for k in range(2, 2 + self.TRANSITION_LOOKBACK):
            if k > len(close):
                break
            try:
                pc = float(close.iloc[-k])
                prev_n_above_all.append(
                    pc > float(e13.iloc[-k])
                    and pc > float(e34.iloc[-k])
                    and pc > float(e55.iloc[-k])
                )
            except Exception:
                continue
        prev_above_all = all(prev_n_above_all) if prev_n_above_all else False

        # Detect MACD cross-up
        macd_line, macd_sig, _ = macd(close)
        macd_cross_up = False
        if len(macd_line) >= 2 and len(macd_sig) >= 2:
            macd_cross_up = (
                float(macd_line.iloc[-2]) <= float(macd_sig.iloc[-2])
                and float(macd_line.iloc[-1]) > float(macd_sig.iloc[-1])
            )

        # ── First buy detection ──────────────────────────────────────────
        is_first_buy = (
            above_all_emas
            and above_platform
            and strong_bull_body
            and rv20 >= self.BREAKOUT_VOL_MULT
            and not prev_above_all  # transition from below/inside to above
        )

        # ── Second buy detection (secondary_entry) ───────────────────────
        # Look back ~7 bars: did we already break out, then pull back to EMA34?
        is_second_buy = False
        if not is_first_buy and above_all_emas:
            # Did we break above platform recently then dip back to EMA34?
            recent7 = ohlcv.iloc[-self.SECONDARY_PULLBACK_BARS - 1 : -1]
            if len(recent7) >= 4:
                broke_out_recently = float(recent7["Close"].max()) > platform_top
                touched_ema34 = float(recent7["Low"].min()) <= last_e34 * 1.01
                pullback_dryup = (
                    float(recent7["Volume"].mean()) < avg_vol_20 * 0.9
                    if avg_vol_20 > 0
                    else False
                )
                today_resume = (
                    last_close > last_e34
                    and last_close > prev_close
                    and rv20 >= 1.0
                    and strong_bull_body
                )
                is_second_buy = (
                    broke_out_recently
                    and touched_ema34
                    and pullback_dryup
                    and today_resume
                )

        if not is_first_buy and not is_second_buy:
            return None

        # ── Trade plan ────────────────────────────────────────────────────
        atr_14 = float(atr(high, low, close).iloc[-1])
        # Stop: below EMA55 OR below platform low (whichever is HIGHER, less risk)
        # OR last_close - 1.5×ATR
        stop_price = max(
            min(last_e55, platform_bot),
            last_close - 1.5 * atr_14,
        )
        r = last_close - stop_price
        if r <= 0:
            return None
        target_1 = last_close + r
        # Platform measured move target
        target_2 = platform_top + platform_height

        tags = ["ema_squeeze_breakout", "above_all_emas"]
        if is_first_buy:
            tags.append("first_buy_point")
        if is_second_buy:
            tags.append("second_buy_point_pullback_to_ema34")
        if macd_cross_up:
            tags.append("macd_cross_up")
        if avg_sqz < 3.0:
            tags.append("very_tight_squeeze")

        invalidation = (
            f"Failure to hold above {platform_top:.2f}; "
            f"or close below EMA55 ({last_e55:.2f}) for 2 bars"
        )

        # ── Engines ───────────────────────────────────────────────────────
        volume_ctx = {
            "signal_type": "breakout",
            "key_level": platform_top,
            "direction": "long",
        }
        vol_res = analyze_volume(ohlcv, volume_ctx)
        chip_res = analyze_chip_structure(ohlcv)

        return SignalCandidate(
            strategy_name=self.name,
            symbol=symbol,
            direction="long",
            market_regime=regime["regime"],
            entry_price=round(last_close, 2),
            stop_price=round(stop_price, 2),
            target_1=round(target_1, 2),
            target_2=round(target_2, 2),
            trailing_rule="ema_13",
            invalidation_reason=invalidation,
            secondary_entry=is_second_buy,
            pattern_tags=tags,
            raw_features={
                "platform_top": round(platform_top, 2),
                "platform_bot": round(platform_bot, 2),
                "platform_height": round(platform_height, 2),
                "avg_squeeze_pct": round(avg_sqz, 3),
                "current_squeeze_pct": float(ema_squeeze_pct(e13, e34, e55) or 0),
                "ema_13": round(last_e13, 2),
                "ema_34": round(last_e34, 2),
                "ema_55": round(last_e55, 2),
                "rv20": round(rv20, 3),
                "body_ratio": round(body_ratio, 3),
                "macd_cross_up": macd_cross_up,
                "atr_14": round(atr_14, 3),
                "r_dollars": round(r, 2),
                "is_first_buy": is_first_buy,
                "is_second_buy": is_second_buy,
            },
            volume_analysis=vol_res.to_dict(),
            chip_analysis=chip_res.to_dict(),
            notes={
                "regime_score": regime.get("regime_score"),
                "regime_squeeze_pct": regime.get("ema_squeeze_pct"),
            },
        )
