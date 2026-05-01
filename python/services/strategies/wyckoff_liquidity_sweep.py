"""策略 2: 威科夫流动性扫荡 (Wyckoff Liquidity Sweep) — v2 (Phase H.1).

规范 7-B: 价格短暂跌破/突破关键位置，触发市场流动性后迅速收回，反向切入。

Eligible regimes: ranging / exhaustion_reversal

Phase H.1 rewrite — 2-bar confirmation pattern:
    Old (Phase G): 1-bar pattern — pierce + reclaim + reversal candle on
        the SAME day. Empirically too noisy: 60%+ failed continuation.
    New (Phase H): 2-bar confirmation — sweep on bar N-1, follow-through
        on bar N. Detected on bar N (latency = 1 bar, but reduces noise).

    Bar N-1 (sweep bar):
        - Low pierced below prior_low by ≥ 0.6% AND ≥ 0.3 × ATR
        - Reversal pattern (lower-shadow ≥ 0.50 OR engulfing)
        - Closed ABOVE the prior_low (reclaim happened intra-day)
    Bar N (confirmation bar — TODAY):
        - Closed ABOVE bar N-1's close (follow-through)
        - Closed ABOVE bar N-1's high preferred (strong confirmation)
        - Volume on bar N >= 1.0× 20-day avg (no rejection)
        - Did NOT make a new low below sweep_low (range respected)

Output trade plan:
    entry  = close of TODAY (confirmation bar)
    stop   = sweep_low - 0.3×ATR (or sweep_high + buffer for shorts)
    target_1 = entry + 1.5×R (Phase G calibration)
    target_2 = mid of recent range
    trailing = atr_2

Mirror logic for shorts at prior_high.
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

        # ── LONG SWEEP — 2-bar confirmation ───────────────────────────────
        # Bar N-1 = sweep candle; Bar N (today) = confirmation
        if len(ohlcv) < 3:
            return None
        sweep_bar_open = float(open_.iloc[-2])
        sweep_bar_high = float(high.iloc[-2])
        sweep_bar_low = float(low.iloc[-2])
        sweep_bar_close = float(close.iloc[-2])
        sweep_bar_range = sweep_bar_high - sweep_bar_low
        if sweep_bar_range <= 0:
            return None
        sweep_bar_lower_shadow_ratio = (
            (min(sweep_bar_close, sweep_bar_open) - sweep_bar_low) / sweep_bar_range
        )
        sweep_bar_upper_shadow_ratio = (
            (sweep_bar_high - max(sweep_bar_close, sweep_bar_open)) / sweep_bar_range
        )

        # Pierce: bar N-1 (or any of last SWEEP_WINDOW bars) low broke below prior_low
        sweep_window_lows = ohlcv["Low"].iloc[-(self.SWEEP_WINDOW + 1) : -1]
        sweep_low = float(sweep_window_lows.min())
        pct_pierce_threshold_low = prior_low * (1 - self.SWEEP_PIERCE_PCT / 100)
        atr_pierce_threshold_low = prior_low - self.MIN_PIERCE_ATR * atr_14
        pierced_below = sweep_low < min(pct_pierce_threshold_low, atr_pierce_threshold_low)

        # Sweep bar reclaimed prior_low intra-day (closed back above)
        sweep_bar_reclaimed = sweep_bar_close > prior_low

        # Sweep bar shows reversal: lower shadow OR bullish engulfing
        is_sweep_bar_reversal = (
            (
                sweep_bar_lower_shadow_ratio >= self.LOWER_SHADOW_MIN
                and sweep_bar_close >= sweep_bar_open
            )
            or (
                sweep_bar_close > sweep_bar_open
                and len(close) >= 3
                and sweep_bar_close > float(close.iloc[-3])
                and sweep_bar_open < float(close.iloc[-3])
            )
        )

        # CONFIRMATION on TODAY (bar N): close > sweep_bar_close AND no new low below sweep
        today_continued_up = last_close > sweep_bar_close
        today_no_new_low = last_low > sweep_low * 0.999  # slack for rounding
        # Volume not weak (no distribution selling)
        today_volume_ok = rv20 >= 1.0 if avg_vol_20 > 0 else True
        # Bonus: closed above sweep bar's high (very strong confirmation)
        today_above_sweep_high = last_close > sweep_bar_high

        # Phase G: in pure 'ranging' regime, longs lost -0.46R historically.
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
            and sweep_bar_reclaimed
            and is_sweep_bar_reversal
            and today_continued_up
            and today_no_new_low
            and today_volume_ok
            and long_regime_allowed
        ):
            direction = "long"
            entry_price = last_close
            stop_price = sweep_low - 0.3 * atr_14
            r = entry_price - stop_price
            if r <= 0:
                return None
            target_1 = entry_price + 1.5 * r
            target_2 = min((prior_high + prior_low) / 2, prior_high)
            invalidation = (
                f"Failure if close back below sweep_low ({sweep_low:.2f}); "
                f"or 2 consecutive closes below entry ({entry_price:.2f})"
            )

            tags = ["liquidity_sweep_long", "two_bar_confirmation"]
            if today_above_sweep_high:
                tags.append("strong_confirmation")
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
                    "sweep_bar_close": round(sweep_bar_close, 2),
                    "sweep_bar_lower_shadow": round(sweep_bar_lower_shadow_ratio, 3),
                    "pierce_pct": round(
                        (prior_low - sweep_low) / prior_low * 100, 3
                    ),
                    "today_above_sweep_high": today_above_sweep_high,
                    "rv20": round(rv20, 3),
                    "rsi": round(rsi_now, 1),
                    "atr_14": round(atr_14, 3),
                    "r_dollars": round(r, 2),
                    "has_bullish_divergence": divergence_long,
                },
                key_level=prior_low,
            )

        # ── SHORT SWEEP — 2-bar confirmation ──────────────────────────────
        # Bar N-1 = sweep bar (broke above prior_high then closed back below)
        # Bar N (today) = confirmation (closed below sweep_bar_close)
        sweep_window_highs = ohlcv["High"].iloc[-(self.SWEEP_WINDOW + 1) : -1]
        sweep_high = float(sweep_window_highs.max())
        pct_pierce_threshold_high = prior_high * (1 + self.SWEEP_PIERCE_PCT / 100)
        atr_pierce_threshold_high = prior_high + self.MIN_PIERCE_ATR * atr_14
        pierced_above = sweep_high > max(pct_pierce_threshold_high, atr_pierce_threshold_high)
        sweep_bar_reclaimed_short = sweep_bar_close < prior_high

        is_sweep_bar_short_reversal = (
            (
                sweep_bar_upper_shadow_ratio >= self.UPPER_SHADOW_MIN
                and sweep_bar_close <= sweep_bar_open
            )
            or (
                sweep_bar_close < sweep_bar_open
                and len(close) >= 3
                and sweep_bar_close < float(close.iloc[-3])
                and sweep_bar_open > float(close.iloc[-3])
            )
        )

        # CONFIRMATION today: closed below sweep_bar_close + no new high
        today_continued_down = last_close < sweep_bar_close
        today_no_new_high = last_high < sweep_high * 1.001
        today_below_sweep_low = last_close < sweep_bar_low

        if (
            pierced_above
            and sweep_bar_reclaimed_short
            and is_sweep_bar_short_reversal
            and today_continued_down
            and today_no_new_high
            and today_volume_ok
        ):
            direction = "short"
            entry_price = last_close
            stop_price = sweep_high + 0.3 * atr_14
            r = stop_price - entry_price
            if r <= 0:
                return None
            target_1 = entry_price - 1.5 * r
            target_2 = max((prior_high + prior_low) / 2, prior_low)
            invalidation = (
                f"Failure if close back above sweep_high ({sweep_high:.2f}); "
                f"or 2 consecutive closes above entry ({entry_price:.2f})"
            )

            divergence = bool(regime.get("notes", {}).get("has_bearish_divergence"))
            tags = ["liquidity_sweep_short", "two_bar_confirmation"]
            if today_below_sweep_low:
                tags.append("strong_confirmation")
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
                    "sweep_bar_close": round(sweep_bar_close, 2),
                    "sweep_bar_upper_shadow": round(sweep_bar_upper_shadow_ratio, 3),
                    "today_below_sweep_low": today_below_sweep_low,
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
