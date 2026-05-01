"""Multi-Timeframe (MTF) Signal Confirmation.

规范第 8 节: 多周期协同——日线信号 + 4h 入场确认

核心思路：
    日线策略给出方向（long/short）和入场计划，但只有当 4h 周期同向时，
    才认为时机成熟（避免在日线趋势中处于 4h 弱势的窗口入场）。

4h 确认维度：
    1. EMA 排列方向 (EMA13 vs EMA34)
    2. 收盘价位置 (close 相对最近 N 根 4h K 线的高低位置)
    3. RSI 状态 (long: ≥45 健康；short: ≤55 健康)
    4. 最近 3 根 4h K 线的方向一致性 (动量延续)

输出 mtf_score (0-100) + 分层标签：
    ≥75: confirmed       — 强烈支持入场
    50-74: neutral        — 可入场但需谨慎，仓位酌情减半
    <50: contradicted    — 4h 反向，建议等 4h 修正后再入场（降级或否决）

Public API:
    confirm_with_mtf(symbol, daily_signal_dict) -> MTFConfirmation
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

from services.indicators import ema, rsi

logger = logging.getLogger(__name__)


MTFStatus = Literal["confirmed", "neutral", "contradicted", "no_data"]


@dataclass
class MTFConfirmation:
    """4h confirmation result for a daily signal."""

    symbol: str
    direction: str                     # daily signal direction
    status: MTFStatus
    mtf_score: float                   # 0-100
    mtf_score_grade_adjustment: int    # -1 / 0 / +1，对最终 score_grade 的微调
    bars_analyzed: int

    # Sub-scores
    score_ema_alignment: float
    score_close_position: float
    score_rsi: float
    score_momentum: float

    # Indicators snapshot
    ema_13: float | None
    ema_34: float | None
    rsi_14: float | None
    last_close: float | None
    close_pct_in_range: float | None   # 0-100，最近 N 根 4h 中的位置
    last_3_bars_direction: str         # "up_up_up" / "down_down_up" / 等

    # Tags + warnings
    tags: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "direction": self.direction,
            "status": self.status,
            "mtf_score": round(self.mtf_score, 1),
            "mtf_score_grade_adjustment": self.mtf_score_grade_adjustment,
            "bars_analyzed": self.bars_analyzed,
            "sub_scores": {
                "ema_alignment": round(self.score_ema_alignment, 1),
                "close_position": round(self.score_close_position, 1),
                "rsi": round(self.score_rsi, 1),
                "momentum": round(self.score_momentum, 1),
            },
            "indicators": {
                "ema_13": round(self.ema_13, 2) if self.ema_13 is not None else None,
                "ema_34": round(self.ema_34, 2) if self.ema_34 is not None else None,
                "rsi_14": round(self.rsi_14, 1) if self.rsi_14 is not None else None,
                "last_close": round(self.last_close, 2) if self.last_close is not None else None,
                "close_pct_in_range": round(self.close_pct_in_range, 1)
                    if self.close_pct_in_range is not None else None,
                "last_3_bars_direction": self.last_3_bars_direction,
            },
            "tags": self.tags,
            "warnings": self.warnings,
        }


# ── Internal scoring helpers ──────────────────────────────────────────────────

def _score_ema_alignment(ema13: float, ema34: float, direction: str) -> float:
    """Max 30. EMA13 above EMA34 = bullish; below = bearish."""
    if direction == "long":
        if ema13 > ema34:
            spread_pct = (ema13 - ema34) / ema34 * 100
            return min(30.0, 15 + spread_pct * 5)   # 0.5% spread → 17.5; 3% → 30
        return 0.0
    else:
        if ema13 < ema34:
            spread_pct = (ema34 - ema13) / ema34 * 100
            return min(30.0, 15 + spread_pct * 5)
        return 0.0


def _score_close_position(close: float, high_n: float, low_n: float, direction: str) -> tuple[float, float]:
    """Max 25. Long: prefer close in upper 50% of recent range (and rising).
    Short: prefer lower 50%. Returns (score, pct_in_range)."""
    if high_n == low_n:
        return 12.5, 50.0
    pct = (close - low_n) / (high_n - low_n) * 100   # 0-100

    if direction == "long":
        if pct >= 70:
            return 25.0, pct           # 强势顶部
        if pct >= 50:
            return 15.0 + (pct - 50) / 20 * 10, pct
        if pct >= 30:
            return 8.0, pct            # 中位偏弱
        return 0.0, pct                # 接近底部，4h 弱势
    else:
        # short: invert
        inv = 100 - pct
        if inv >= 70:
            return 25.0, pct
        if inv >= 50:
            return 15.0 + (inv - 50) / 20 * 10, pct
        if inv >= 30:
            return 8.0, pct
        return 0.0, pct


def _score_rsi(rsi_val: float, direction: str) -> float:
    """Max 25. Long: RSI 45-70 healthy. Short: 30-55 healthy."""
    if direction == "long":
        if 45 <= rsi_val <= 70:
            return 25.0
        if 40 <= rsi_val < 45:
            return 15.0
        if 70 < rsi_val <= 80:
            return 18.0   # 超买但仍是上升趋势
        if rsi_val > 80:
            return 8.0    # 极端超买，回调风险
        return 0.0        # rsi < 40，做多 4h 不支持
    else:
        if 30 <= rsi_val <= 55:
            return 25.0
        if 55 < rsi_val <= 60:
            return 15.0
        if 20 <= rsi_val < 30:
            return 18.0
        if rsi_val < 20:
            return 8.0
        return 0.0


def _score_momentum(closes: pd.Series, direction: str) -> tuple[float, str]:
    """Max 20. Last 3 bars direction consistency.
    Returns (score, direction_string e.g. 'up_up_up')."""
    if len(closes) < 4:
        return 10.0, "insufficient_data"
    last = closes.iloc[-4:]
    moves: list[str] = []
    for i in range(1, 4):
        if float(last.iloc[i]) > float(last.iloc[i - 1]):
            moves.append("up")
        elif float(last.iloc[i]) < float(last.iloc[i - 1]):
            moves.append("down")
        else:
            moves.append("flat")
    direction_str = "_".join(moves)
    ups = moves.count("up")
    downs = moves.count("down")

    if direction == "long":
        if ups == 3:
            return 20.0, direction_str         # 三连阳
        if ups == 2:
            return 14.0, direction_str
        if ups == 1:
            return 7.0, direction_str
        return 0.0, direction_str              # 三连阴，做多动能差
    else:
        if downs == 3:
            return 20.0, direction_str
        if downs == 2:
            return 14.0, direction_str
        if downs == 1:
            return 7.0, direction_str
        return 0.0, direction_str


# ── Core analysis ─────────────────────────────────────────────────────────────

def analyze_4h(
    symbol: str,
    direction: str,
    df_4h: pd.DataFrame,
    range_lookback: int = 30,
) -> MTFConfirmation:
    """Analyze a 4h DataFrame against a daily signal direction.

    Args:
        symbol: stock symbol
        direction: 'long' or 'short'
        df_4h: DataFrame indexed by timestamp with OHLCV (4h aggregation)
        range_lookback: bars used for high/low range scoring

    Returns:
        MTFConfirmation
    """
    if df_4h is None or df_4h.empty or len(df_4h) < 35:
        return MTFConfirmation(
            symbol=symbol, direction=direction, status="no_data",
            mtf_score=0.0, mtf_score_grade_adjustment=0,
            bars_analyzed=len(df_4h) if df_4h is not None else 0,
            score_ema_alignment=0, score_close_position=0,
            score_rsi=0, score_momentum=0,
            ema_13=None, ema_34=None, rsi_14=None,
            last_close=None, close_pct_in_range=None,
            last_3_bars_direction="no_data",
            warnings=["4h 数据不足，无法做多周期确认"],
        )

    closes = df_4h["Close"].astype(float)
    highs = df_4h["High"].astype(float)
    lows = df_4h["Low"].astype(float)

    ema13_series = ema(closes, 13)
    ema34_series = ema(closes, 34)
    rsi_series = rsi(closes, 14)

    ema13_val = float(ema13_series.iloc[-1])
    ema34_val = float(ema34_series.iloc[-1])
    rsi_val = float(rsi_series.iloc[-1]) if not pd.isna(rsi_series.iloc[-1]) else 50.0
    last_close = float(closes.iloc[-1])

    # Recent N bars range
    recent = df_4h.iloc[-range_lookback:]
    high_n = float(recent["High"].max())
    low_n = float(recent["Low"].min())

    # Compute sub-scores
    s_ema = _score_ema_alignment(ema13_val, ema34_val, direction)
    s_close, pct_in_range = _score_close_position(last_close, high_n, low_n, direction)
    s_rsi = _score_rsi(rsi_val, direction)
    s_momentum, dir_str = _score_momentum(closes, direction)

    total = round(s_ema + s_close + s_rsi + s_momentum, 1)

    # Status mapping
    if total >= 75:
        status: MTFStatus = "confirmed"
        adj = 0           # 不升级，但保持原级（已是好信号）
    elif total >= 50:
        status = "neutral"
        adj = 0           # 中性不调整
    else:
        status = "contradicted"
        adj = -1          # 4h 反向 → 信号降一级（A→B, B→C, C→丢弃）

    # Tags
    tags: list[str] = []
    warnings: list[str] = []

    if direction == "long":
        if ema13_val > ema34_val:
            tags.append("4h_ema_bullish_cross")
        if rsi_val > 70:
            warnings.append(f"4h RSI 偏高 ({rsi_val:.1f})，注意短期回调")
        if rsi_val < 40:
            warnings.append(f"4h RSI 弱 ({rsi_val:.1f})，4h 趋势可能反向")
        if pct_in_range < 30:
            warnings.append("收盘价处于 4h 区间下沿，建议等待 4h 反弹再入场")
    else:
        if ema13_val < ema34_val:
            tags.append("4h_ema_bearish_cross")
        if rsi_val < 30:
            warnings.append(f"4h RSI 极弱 ({rsi_val:.1f})，注意反弹风险")
        if pct_in_range > 70:
            warnings.append("收盘价处于 4h 区间上沿，建议等待 4h 回落再做空")

    if "up_up_up" in dir_str and direction == "long":
        tags.append("4h_three_bar_uptrend")
    if "down_down_down" in dir_str and direction == "short":
        tags.append("4h_three_bar_downtrend")

    if status == "confirmed":
        tags.append("mtf_confirmed")
    elif status == "contradicted":
        warnings.append(f"4h 周期反向 (mtf_score={total:.0f})，建议等待修正")
        tags.append("mtf_contradicted")

    return MTFConfirmation(
        symbol=symbol,
        direction=direction,
        status=status,
        mtf_score=total,
        mtf_score_grade_adjustment=adj,
        bars_analyzed=len(df_4h),
        score_ema_alignment=s_ema,
        score_close_position=s_close,
        score_rsi=s_rsi,
        score_momentum=s_momentum,
        ema_13=ema13_val,
        ema_34=ema34_val,
        rsi_14=rsi_val,
        last_close=last_close,
        close_pct_in_range=pct_in_range,
        last_3_bars_direction=dir_str,
        tags=tags,
        warnings=warnings,
    )


def confirm_with_mtf(
    symbol: str,
    direction: str,
    *,
    lookback_days: int = 14,
) -> MTFConfirmation:
    """Top-level entry: pulls 4h bars from Alpaca and runs analyze_4h.

    Returns no_data status if Alpaca isn't configured or data fetch fails.
    """
    from services.alpaca_client import get_alpaca_client

    client = get_alpaca_client()
    if client is None:
        return MTFConfirmation(
            symbol=symbol, direction=direction, status="no_data",
            mtf_score=0.0, mtf_score_grade_adjustment=0,
            bars_analyzed=0,
            score_ema_alignment=0, score_close_position=0,
            score_rsi=0, score_momentum=0,
            ema_13=None, ema_34=None, rsi_14=None,
            last_close=None, close_pct_in_range=None,
            last_3_bars_direction="no_data",
            warnings=["Alpaca 未配置，跳过 4h 确认"],
        )

    try:
        df_4h = client.get_4h_bars(symbol, lookback_days=lookback_days)
    except Exception as exc:
        logger.warning("alpaca_4h_fetch_failed symbol=%s: %s", symbol, exc)
        return MTFConfirmation(
            symbol=symbol, direction=direction, status="no_data",
            mtf_score=0.0, mtf_score_grade_adjustment=0,
            bars_analyzed=0,
            score_ema_alignment=0, score_close_position=0,
            score_rsi=0, score_momentum=0,
            ema_13=None, ema_34=None, rsi_14=None,
            last_close=None, close_pct_in_range=None,
            last_3_bars_direction="no_data",
            warnings=[f"Alpaca 4h 数据拉取失败: {exc}"],
        )

    return analyze_4h(symbol, direction, df_4h)
