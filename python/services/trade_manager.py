"""Trade Manager — 4-type exit rule engine.

规范第 18 节：交易管理 & 出场规则

四类出场：
    1. 止损出场        price hits stop_price
    2. 逻辑失效出场    strategy-specific invalidation conditions
    3. 分批止盈出场    1R → 减仓 40%；T1 → 再减 40%；T2 → 清仓剩余
    4. 时间止损        默认 20 根 K 线未触及 1R → 出场

Public API:
    get_exit_plan(signal)             → ExitPlan
    evaluate_exit(signal, ohlcv)      → ExitEvaluation
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

# ── 常量 ──────────────────────────────────────────────────────────────────────

DEFAULT_TIME_STOP_BARS = 20      # 20 根日线 ≈ 1 个月
STAGE1_REDUCE_PCT     = 0.40     # 1R 时减仓 40%
STAGE2_REDUCE_PCT     = 0.40     # T1 时再减 40%
STAGE3_REDUCE_PCT     = 1.00     # T2 / 时间止损 / 失效 → 清仓剩余

ExitReason = Literal[
    "stop_loss",
    "logic_invalidation",
    "take_profit_t1",
    "take_profit_t2",
    "time_stop",
    "holding",
]


# ── 分批止盈计划 ──────────────────────────────────────────────────────────────

@dataclass
class StageLevel:
    """单个分批止盈层级。"""
    level: int                   # 1 / 2 / 3
    trigger_label: str           # 触发描述
    trigger_price: float | None  # 触发价（None = 时间触发）
    trigger_r: float | None      # 以 R 表示的盈利倍数
    reduce_pct: float            # 减仓比例 0-1
    note: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": self.level,
            "trigger_label": self.trigger_label,
            "trigger_price": round(self.trigger_price, 2) if self.trigger_price else None,
            "trigger_r": round(self.trigger_r, 2) if self.trigger_r is not None else None,
            "reduce_pct": round(self.reduce_pct * 100, 0),
            "note": self.note,
        }


@dataclass
class ExitPlan:
    """完整的出场计划（开仓前即可生成，不需要实时价格）。"""

    # 信号基本信息
    symbol: str
    strategy_name: str
    direction: str
    entry_price: float
    stop_price: float
    target_1: float | None
    target_2: float | None

    # 计算结果
    risk_per_share: float        # |entry - stop|
    r1_price: float              # entry ± 1R（第一个减仓触发点）
    time_stop_bars: int          # 未达 1R 的最大持仓 K 线数

    # 分批止盈计划
    stages: list[StageLevel]

    # 逻辑失效条件（文字描述）
    invalidation_rules: list[str]

    # 止损说明
    stop_note: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "strategy_name": self.strategy_name,
            "direction": self.direction,
            "entry_price": round(self.entry_price, 2),
            "stop_price": round(self.stop_price, 2),
            "target_1": round(self.target_1, 2) if self.target_1 else None,
            "target_2": round(self.target_2, 2) if self.target_2 else None,
            "risk_per_share": round(self.risk_per_share, 4),
            "r1_price": round(self.r1_price, 2),
            "time_stop_bars": self.time_stop_bars,
            "stages": [s.to_dict() for s in self.stages],
            "invalidation_rules": self.invalidation_rules,
            "stop_note": self.stop_note,
        }


@dataclass
class ExitEvaluation:
    """实时评估结果（需要当前 OHLCV 数据）。"""

    symbol: str
    status: Literal["active", "closed", "warning"]
    exit_reason: ExitReason | None
    recommended_action: str       # 给用户看的操作建议（中文）
    recommended_action_en: str    # 英文版
    bars_held: int                # 已持仓 K 线数

    # 当前进展
    current_price: float
    r_progress: float             # 当前盈亏 / 每股风险（负 = 亏损）
    mfe_r: float                  # 最大有利偏移（R 单位）
    mae_r: float                  # 最大不利偏移（R 单位，≤0）

    # 触发的阶段
    stages_hit: list[int]         # 已经触发的止盈层级（1/2/3）
    next_target: float | None     # 下一个目标价

    alerts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "status": self.status,
            "exit_reason": self.exit_reason,
            "recommended_action": self.recommended_action,
            "recommended_action_en": self.recommended_action_en,
            "bars_held": self.bars_held,
            "current_price": round(self.current_price, 2),
            "r_progress": round(self.r_progress, 3),
            "mfe_r": round(self.mfe_r, 3),
            "mae_r": round(self.mae_r, 3),
            "stages_hit": self.stages_hit,
            "next_target": round(self.next_target, 2) if self.next_target else None,
            "alerts": self.alerts,
        }


# ── 逻辑失效规则（策略级别） ──────────────────────────────────────────────────

def _invalidation_rules(strategy_name: str, direction: str, signal: dict[str, Any]) -> list[str]:
    """生成策略特定的逻辑失效文字描述。"""
    entry = float(signal.get("entry_price") or 0)
    stop = float(signal.get("stop_price") or 0)
    is_long = direction == "long"

    common = [
        f"{'跌破' if is_long else '突破'}止损价 ${stop:.2f} 后立即出场（不等收盘）",
    ]

    if strategy_name == "trend_pullback_breakout":
        if is_long:
            return common + [
                f"突破后连续 3 根收盘价低于入场价 ${entry:.2f}",
                "放量阴线跌破回调低点",
                "ADX 快速跌至 20 以下（趋势消失）",
            ]
        else:
            return common + [
                f"突破后连续 3 根收盘价高于入场价 ${entry:.2f}",
                "放量阳线突破反弹高点",
                "ADX 快速跌至 20 以下（趋势消失）",
            ]

    if strategy_name == "wyckoff_liquidity_sweep":
        raw = signal.get("raw_features") or {}
        sweep_ref = raw.get("sweep_low") or raw.get("sweep_high")
        if is_long:
            ref_str = f" (${sweep_ref:.2f})" if sweep_ref else ""
            return common + [
                f"收盘价跌回扫荡低点{ref_str}以下",
                "连续 2 根收盘价低于入场价，反弹动能消失",
                "RSI 跌破 40，未能形成新高",
            ]
        else:
            ref_str = f" (${sweep_ref:.2f})" if sweep_ref else ""
            return common + [
                f"收盘价反弹回扫荡高点{ref_str}以上",
                "连续 2 根收盘价高于入场价，做空动能消失",
                "RSI 反弹至 60 以上",
            ]

    if strategy_name == "ema_squeeze_launch":
        if is_long:
            return common + [
                "收盘价跌破 EMA13（蓄势结构破坏）",
                "成交量持续萎缩 3 根以上，突破无延续",
                "MACD 金叉信号转死叉",
            ]
        else:
            return common + [
                "收盘价反弹回 EMA13 以上",
                "放量阳线否定做空逻辑",
                "MACD 死叉信号转金叉",
            ]

    if strategy_name == "bollinger_extreme_reversion":
        if is_long:
            return common + [
                "价格未能回到布林中轨，转而再次跌破下轨",
                "连续 3 根收盘价低于入场价，均值回归逻辑失效",
                "成交量持续放大但价格下行（卖压真实）",
            ]
        else:
            return common + [
                "价格未能回到布林中轨，转而再次突破上轨",
                "连续 3 根收盘价高于入场价，均值回归逻辑失效",
                "成交量持续放大但价格上行（买盘真实）",
            ]

    # 通用
    return common + [
        "连续 3 根收盘价反向穿越入场价",
        "成交量异常放大但价格反向运动",
    ]


# ── 生成出场计划 ──────────────────────────────────────────────────────────────

def get_exit_plan(signal: dict[str, Any]) -> ExitPlan:
    """根据信号生成完整的出场计划（开仓前即可调用）。

    Args:
        signal: strategy_signals 行（dict），需包含
                symbol, strategy_name, direction,
                entry_price, stop_price, target_1, target_2,
                invalidation_reason（可选）, raw_features（可选）
    """
    symbol        = signal.get("symbol", "")
    strategy_name = signal.get("strategy_name", "")
    direction     = signal.get("direction", "long")
    entry         = float(signal.get("entry_price") or 0)
    stop          = float(signal.get("stop_price") or 0)
    t1            = float(signal["target_1"]) if signal.get("target_1") else None
    t2            = float(signal["target_2"]) if signal.get("target_2") else None
    is_long       = direction == "long"

    risk = abs(entry - stop)
    if risk <= 0:
        risk = entry * 0.02   # fallback: 2% of price

    # 1R 价格
    r1_price = (entry + risk) if is_long else (entry - risk)

    # ── 分批止盈阶段 ─────────────────────────────────────────────
    stages: list[StageLevel] = []

    # Stage 1: 达到 1R 时减仓 40%
    stages.append(StageLevel(
        level=1,
        trigger_label=f"盈利 1R (${r1_price:.2f})",
        trigger_price=r1_price,
        trigger_r=1.0,
        reduce_pct=STAGE1_REDUCE_PCT,
        note=f"将止损上移至成本价 ${entry:.2f}，锁定保本",
    ))

    # Stage 2: T1 时再减 40%
    if t1 is not None:
        t1_r = abs(t1 - entry) / risk
        stages.append(StageLevel(
            level=2,
            trigger_label=f"触达 T1 (${t1:.2f} / {t1_r:.1f}R)",
            trigger_price=t1,
            trigger_r=t1_r,
            reduce_pct=STAGE2_REDUCE_PCT,
            note=f"止损上移至 1R (${r1_price:.2f})，持有剩余 {100 - int((STAGE1_REDUCE_PCT + STAGE2_REDUCE_PCT)*100)}%",
        ))
    else:
        # 若无 T1，则以 1.5R 作为第二档
        t1_price = (entry + 1.5 * risk) if is_long else (entry - 1.5 * risk)
        stages.append(StageLevel(
            level=2,
            trigger_label=f"盈利 1.5R (${t1_price:.2f})",
            trigger_price=t1_price,
            trigger_r=1.5,
            reduce_pct=STAGE2_REDUCE_PCT,
            note=f"持有剩余 {100 - int((STAGE1_REDUCE_PCT + STAGE2_REDUCE_PCT)*100)}% 等待 T2",
        ))

    # Stage 3: T2 清仓
    if t2 is not None:
        t2_r = abs(t2 - entry) / risk
        stages.append(StageLevel(
            level=3,
            trigger_label=f"触达 T2 (${t2:.2f} / {t2_r:.1f}R)",
            trigger_price=t2,
            trigger_r=t2_r,
            reduce_pct=STAGE3_REDUCE_PCT,
            note="清仓剩余全部持仓",
        ))
    else:
        # 无 T2：持有至 2R 清仓
        t2_price = (entry + 2.0 * risk) if is_long else (entry - 2.0 * risk)
        stages.append(StageLevel(
            level=3,
            trigger_label=f"盈利 2R (${t2_price:.2f})",
            trigger_price=t2_price,
            trigger_r=2.0,
            reduce_pct=STAGE3_REDUCE_PCT,
            note="清仓全部剩余持仓",
        ))

    # 止损说明
    stop_note = (
        f"{'跌破' if is_long else '突破'} ${stop:.2f} 立即全仓止损，"
        f"亏损 = 1R（${risk:.2f}/股）"
    )

    # 逻辑失效规则
    inv_rules = _invalidation_rules(strategy_name, direction, signal)

    return ExitPlan(
        symbol=symbol,
        strategy_name=strategy_name,
        direction=direction,
        entry_price=entry,
        stop_price=stop,
        target_1=t1,
        target_2=t2,
        risk_per_share=risk,
        r1_price=r1_price,
        time_stop_bars=DEFAULT_TIME_STOP_BARS,
        stages=stages,
        invalidation_rules=inv_rules,
        stop_note=stop_note,
    )


# ── 实时评估（需要 OHLCV） ────────────────────────────────────────────────────

def evaluate_exit(
    signal: dict[str, Any],
    ohlcv: pd.DataFrame,
    entry_bar_index: int = 0,
) -> ExitEvaluation:
    """使用历史 OHLCV 评估当前出场状态。

    Args:
        signal: strategy_signals 行
        ohlcv: 从入场日起的 OHLCV DataFrame（index 0 = 入场当天）
        entry_bar_index: ohlcv 中入场 K 线的位置（默认 0）

    Returns:
        ExitEvaluation
    """
    symbol    = signal.get("symbol", "")
    direction = signal.get("direction", "long")
    entry     = float(signal.get("entry_price") or 0)
    stop      = float(signal.get("stop_price") or 0)
    t1        = float(signal["target_1"]) if signal.get("target_1") else None
    t2        = float(signal["target_2"]) if signal.get("target_2") else None
    is_long   = direction == "long"

    risk = abs(entry - stop)
    if risk <= 0:
        risk = entry * 0.02

    r1_price = (entry + risk) if is_long else (entry - risk)
    plan     = get_exit_plan(signal)

    if ohlcv.empty:
        return ExitEvaluation(
            symbol=symbol, status="active",
            exit_reason=None,
            recommended_action="无 K 线数据，持仓中",
            recommended_action_en="No bar data — holding",
            bars_held=0,
            current_price=entry,
            r_progress=0.0, mfe_r=0.0, mae_r=0.0,
            stages_hit=[], next_target=r1_price,
        )

    # 从 entry_bar_index 截取持仓期数据
    bars = ohlcv.iloc[entry_bar_index:]
    bars_held = len(bars)
    close_series = bars["Close"].astype(float)
    high_series  = bars["High"].astype(float)
    low_series   = bars["Low"].astype(float)

    current_price = float(close_series.iloc[-1])

    # MFE / MAE
    if is_long:
        mfe = float(high_series.max()) - entry
        mae = float(low_series.min()) - entry
    else:
        mfe = entry - float(low_series.min())
        mae = entry - float(high_series.max())

    mfe_r = mfe / risk
    mae_r = mae / risk   # ≤ 0 表示有利

    r_progress = ((current_price - entry) / risk) if is_long else ((entry - current_price) / risk)

    alerts: list[str] = []
    stages_hit: list[int] = []

    # ── 检查止损触发 ──────────────────────────────────────────────
    stop_triggered = (
        (is_long  and float(low_series.min())  <= stop) or
        (not is_long and float(high_series.max()) >= stop)
    )
    if stop_triggered:
        return ExitEvaluation(
            symbol=symbol, status="closed",
            exit_reason="stop_loss",
            recommended_action=f"止损触发，出场价约 ${stop:.2f}，亏损 -1R",
            recommended_action_en=f"Stop loss triggered at ~${stop:.2f}, -1R",
            bars_held=bars_held,
            current_price=current_price,
            r_progress=r_progress, mfe_r=mfe_r, mae_r=mae_r,
            stages_hit=[], next_target=None,
        )

    # ── 检查分批止盈阶段 ──────────────────────────────────────────
    for stage in plan.stages:
        tp = stage.trigger_price
        if tp is None:
            continue
        hit = (
            (is_long  and float(high_series.max()) >= tp) or
            (not is_long and float(low_series.min()) <= tp)
        )
        if hit:
            stages_hit.append(stage.level)

    # ── 时间止损检查 ──────────────────────────────────────────────
    time_stop_triggered = (
        bars_held >= DEFAULT_TIME_STOP_BARS and
        mfe_r < 1.0 and
        r_progress < 0.5
    )
    if time_stop_triggered:
        return ExitEvaluation(
            symbol=symbol, status="closed",
            exit_reason="time_stop",
            recommended_action=f"持仓已超 {DEFAULT_TIME_STOP_BARS} 根 K 线，未达 1R 目标，建议清仓",
            recommended_action_en=f"Time stop: {DEFAULT_TIME_STOP_BARS}+ bars without reaching 1R — exit",
            bars_held=bars_held,
            current_price=current_price,
            r_progress=r_progress, mfe_r=mfe_r, mae_r=mae_r,
            stages_hit=stages_hit, next_target=None,
        )

    # ── 当前建议动作 ──────────────────────────────────────────────
    all_stages = [s.level for s in plan.stages]
    remaining_stages = [l for l in all_stages if l not in stages_hit]

    if stages_hit and max(stages_hit) >= 3:
        # 全部目标已达
        recommended_action    = "所有止盈目标已达成，可考虑清仓"
        recommended_action_en = "All targets hit — consider full exit"
        status: Literal["active", "closed", "warning"] = "closed"
        exit_reason: ExitReason | None = "take_profit_t2"
        next_target = None
    elif stages_hit:
        # 部分止盈
        next_stage_level = min(remaining_stages) if remaining_stages else None
        next_stage = next((s for s in plan.stages if s.level == next_stage_level), None)
        next_target_price = next_stage.trigger_price if next_stage else None

        recommended_action = (
            f"已触发第 {max(stages_hit)} 档止盈，"
            f"持有剩余仓位等待 ${next_target_price:.2f}" if next_target_price else
            f"已触发第 {max(stages_hit)} 档止盈，剩余仓位考虑移动止损"
        )
        recommended_action_en = (
            f"Stage {max(stages_hit)} profit taken — hold remainder toward ${next_target_price:.2f}"
            if next_target_price else
            f"Stage {max(stages_hit)} profit taken — trail stop on remainder"
        )
        status = "active"
        exit_reason = None
        next_target = next_target_price
    else:
        # 尚未触发任何止盈
        next_target = r1_price
        if r_progress < -0.5:
            alerts.append(f"亏损已达 {abs(r_progress):.1f}R，接近止损，请确认止损单已挂好")
        if bars_held >= DEFAULT_TIME_STOP_BARS * 0.7:
            alerts.append(f"已持仓 {bars_held} 根 K 线，若价格无进展请考虑提前出场")

        recommended_action = (
            f"持仓中，等待价格突破 1R (${r1_price:.2f}) 后启动首档减仓"
        )
        recommended_action_en = (
            f"Holding — wait for 1R (${r1_price:.2f}) to trigger Stage 1 profit taking"
        )
        status = "active"
        exit_reason = None

    return ExitEvaluation(
        symbol=symbol, status=status,
        exit_reason=exit_reason,
        recommended_action=recommended_action,
        recommended_action_en=recommended_action_en,
        bars_held=bars_held,
        current_price=current_price,
        r_progress=r_progress, mfe_r=mfe_r, mae_r=mae_r,
        stages_hit=stages_hit, next_target=next_target,
        alerts=alerts,
    )
