"""Risk Engine — position sizing & exposure management.

规范第 17 节：风控引擎

核心逻辑：
    单笔风险额 = 账户规模 × 单笔风险比例
    建议股数   = 单笔风险额 / |entry - stop|
    建议金额   = 建议股数 × entry_price

单笔风险比例（按等级）：
    A 级 → 1.0%   (最高质量信号，最大仓位)
    B 级 → 0.75%
    C 级 → 0.50%
    逆向策略（bollinger_extreme_reversion / wyckoff 空头）→ 额外打 0.75× 折扣

总账户敞口上限：4-6%（不同风险偏好）
同板块 / 高相关合并计算敞口

Public API:
    calculate_position(signal, account_size, existing_positions, risk_preference)
        → PositionSizing

    check_exposure(positions, account_size, risk_preference)
        → ExposureCheck
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

# ── 风险参数配置 ─────────────────────────────────────────────────────────────

GRADE_RISK_PCT: dict[str, float] = {
    "A": 0.010,   # 1.0%
    "B": 0.0075,  # 0.75%
    "C": 0.005,   # 0.50%
}

# 账户最大总敞口（所有活跃仓位的风险额之和 / 账户规模）
MAX_TOTAL_EXPOSURE: dict[str, float] = {
    "conservative": 0.04,   # 4%
    "moderate":     0.05,   # 5%
    "aggressive":   0.06,   # 6%
}

# 逆向策略额外折扣（规范 17.2）
CONTRARIAN_STRATEGIES = {"bollinger_extreme_reversion"}
CONTRARIAN_DISCOUNT = 0.75   # 乘以 0.75

# 同板块最大合并敞口
MAX_SECTOR_EXPOSURE_PCT = 0.025   # 2.5%

RiskPreference = Literal["conservative", "moderate", "aggressive"]


# ── 输出数据类 ────────────────────────────────────────────────────────────────

@dataclass
class PositionSizing:
    """单笔建议仓位计算结果。"""

    # 输入摘要
    symbol: str
    grade: str
    strategy_name: str
    entry_price: float
    stop_price: float
    account_size: float
    risk_preference: RiskPreference

    # 核心结果
    risk_pct: float          # 本次信号适用的风险比例（含折扣后）
    dollar_risk: float       # 单笔风险金额 = account_size × risk_pct
    risk_per_share: float    # 每股风险 = |entry - stop|
    suggested_shares: int    # 建议股数（向下取整）
    suggested_amount: float  # 建议总投入 = suggested_shares × entry_price

    # 止损 / 目标摘要（便于前端显示，不需要再回查信号）
    target_1: float | None = None
    target_2: float | None = None
    potential_gain_t1: float | None = None   # 若触 T1 的盈利（含 50% 平仓）
    rr_t1: float | None = None
    rr_t2: float | None = None

    # 风险提示
    warnings: list[str] = field(default_factory=list)
    is_contrarian: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "grade": self.grade,
            "strategy_name": self.strategy_name,
            "entry_price": self.entry_price,
            "stop_price": self.stop_price,
            "account_size": self.account_size,
            "risk_preference": self.risk_preference,
            "risk_pct": round(self.risk_pct * 100, 2),       # 以 % 返回
            "dollar_risk": round(self.dollar_risk, 2),
            "risk_per_share": round(self.risk_per_share, 4),
            "suggested_shares": self.suggested_shares,
            "suggested_amount": round(self.suggested_amount, 2),
            "target_1": self.target_1,
            "target_2": self.target_2,
            "potential_gain_t1": round(self.potential_gain_t1, 2) if self.potential_gain_t1 is not None else None,
            "rr_t1": round(self.rr_t1, 2) if self.rr_t1 is not None else None,
            "rr_t2": round(self.rr_t2, 2) if self.rr_t2 is not None else None,
            "warnings": self.warnings,
            "is_contrarian": self.is_contrarian,
        }


@dataclass
class ExposureCheck:
    """当前账户总敞口检查结果。"""

    account_size: float
    risk_preference: RiskPreference
    max_total_exposure_pct: float
    current_exposure_pct: float         # 当前已用敞口
    remaining_exposure_pct: float       # 剩余可用敞口
    remaining_dollar: float             # 剩余可用风险金额
    active_positions: int
    at_capacity: bool
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "account_size": self.account_size,
            "risk_preference": self.risk_preference,
            "max_total_exposure_pct": round(self.max_total_exposure_pct * 100, 2),
            "current_exposure_pct": round(self.current_exposure_pct * 100, 2),
            "remaining_exposure_pct": round(self.remaining_exposure_pct * 100, 2),
            "remaining_dollar": round(self.remaining_dollar, 2),
            "active_positions": self.active_positions,
            "at_capacity": self.at_capacity,
            "warnings": self.warnings,
        }


# ── 核心计算函数 ──────────────────────────────────────────────────────────────

def calculate_position(
    *,
    symbol: str,
    grade: str,
    strategy_name: str,
    direction: str,
    entry_price: float,
    stop_price: float,
    target_1: float | None = None,
    target_2: float | None = None,
    account_size: float,
    risk_preference: RiskPreference = "moderate",
    existing_exposure_pct: float = 0.0,   # 当前已用敞口比例
) -> PositionSizing:
    """计算单笔建议仓位。

    Args:
        symbol: 股票代码
        grade: A/B/C
        strategy_name: 策略名称（用于判断逆向折扣）
        direction: long/short
        entry_price: 入场价
        stop_price: 止损价
        target_1: T1 目标价（可选）
        target_2: T2 目标价（可选）
        account_size: 账户总规模（美元）
        risk_preference: conservative/moderate/aggressive
        existing_exposure_pct: 当前账户已用风险敞口（0.0-1.0）

    Returns:
        PositionSizing dataclass
    """
    warnings: list[str] = []
    grade = grade.upper() if grade else "C"

    # 基础风险比例
    base_risk_pct = GRADE_RISK_PCT.get(grade, GRADE_RISK_PCT["C"])

    # 逆向策略折扣
    is_contrarian = strategy_name in CONTRARIAN_STRATEGIES
    if is_contrarian:
        base_risk_pct *= CONTRARIAN_DISCOUNT
        warnings.append("逆向策略已自动降低风险比例至 75%")

    # 每股风险
    risk_per_share = abs(entry_price - stop_price)
    if risk_per_share <= 0:
        warnings.append("入场价与止损价相同，无法计算仓位")
        return PositionSizing(
            symbol=symbol, grade=grade, strategy_name=strategy_name,
            entry_price=entry_price, stop_price=stop_price,
            account_size=account_size, risk_preference=risk_preference,
            risk_pct=0.0, dollar_risk=0.0, risk_per_share=0.0,
            suggested_shares=0, suggested_amount=0.0,
            target_1=target_1, target_2=target_2,
            warnings=warnings + ["入场价与止损价相同，无法计算仓位"],
            is_contrarian=is_contrarian,
        )

    # 总敞口检查 — 是否还有空间
    max_exposure = MAX_TOTAL_EXPOSURE.get(risk_preference, 0.05)
    remaining_exposure = max(0.0, max_exposure - existing_exposure_pct)
    if remaining_exposure <= 0:
        warnings.append("账户总风险敞口已达上限，建议等待现有仓位出场后再开新仓")
        base_risk_pct = 0.0
    elif base_risk_pct > remaining_exposure:
        # 按剩余空间截断
        warnings.append(
            f"账户剩余风险空间 {remaining_exposure*100:.2f}%，已自动调整（原 {base_risk_pct*100:.2f}%）"
        )
        base_risk_pct = remaining_exposure

    dollar_risk = account_size * base_risk_pct
    suggested_shares = int(dollar_risk / risk_per_share) if risk_per_share > 0 else 0
    suggested_amount = suggested_shares * entry_price

    # 仓位占比检查
    position_pct = suggested_amount / account_size if account_size > 0 else 0
    if position_pct > 0.25:
        warnings.append(f"建议仓位占账户 {position_pct*100:.1f}%，集中度偏高，请注意分散")

    # 最低流动性检查（建议至少 5 股）
    if 0 < suggested_shares < 5:
        warnings.append(f"建议股数仅 {suggested_shares} 股，止损过宽或账户规模较小")

    # R:R 计算
    rr_t1 = rr_t2 = potential_gain_t1 = None
    if target_1 is not None:
        if direction == "long":
            reward_t1 = target_1 - entry_price
        else:
            reward_t1 = entry_price - target_1
        rr_t1 = reward_t1 / risk_per_share if risk_per_share > 0 else 0
        # 50% 平仓在 T1
        potential_gain_t1 = suggested_shares * 0.5 * reward_t1

        if target_2 is not None:
            if direction == "long":
                reward_t2 = target_2 - entry_price
            else:
                reward_t2 = entry_price - target_2
            rr_t2 = reward_t2 / risk_per_share if risk_per_share > 0 else 0

    return PositionSizing(
        symbol=symbol,
        grade=grade,
        strategy_name=strategy_name,
        entry_price=entry_price,
        stop_price=stop_price,
        account_size=account_size,
        risk_preference=risk_preference,
        risk_pct=base_risk_pct,
        dollar_risk=dollar_risk,
        risk_per_share=risk_per_share,
        suggested_shares=suggested_shares,
        suggested_amount=suggested_amount,
        target_1=target_1,
        target_2=target_2,
        potential_gain_t1=potential_gain_t1,
        rr_t1=rr_t1,
        rr_t2=rr_t2,
        warnings=warnings,
        is_contrarian=is_contrarian,
    )


def check_exposure(
    *,
    active_signals: list[dict[str, Any]],
    account_size: float,
    risk_preference: RiskPreference = "moderate",
) -> ExposureCheck:
    """检查当前活跃信号的总敞口。

    Args:
        active_signals: 活跃的 strategy_signals 行列表，每行需有 entry_price / stop_price / grade
        account_size: 账户规模
        risk_preference: conservative/moderate/aggressive

    Returns:
        ExposureCheck dataclass
    """
    warnings: list[str] = []
    max_exposure = MAX_TOTAL_EXPOSURE.get(risk_preference, 0.05)

    total_risk_pct = 0.0
    sector_risk: dict[str, float] = {}

    for sig in active_signals:
        grade = (sig.get("score_grade") or "C").upper()
        entry = float(sig.get("entry_price") or 0)
        stop = float(sig.get("stop_price") or 0)
        strategy = sig.get("strategy_name") or ""
        sector = sig.get("sector") or "unknown"

        if entry <= 0 or stop <= 0:
            continue

        base_pct = GRADE_RISK_PCT.get(grade, GRADE_RISK_PCT["C"])
        if strategy in CONTRARIAN_STRATEGIES:
            base_pct *= CONTRARIAN_DISCOUNT

        total_risk_pct += base_pct
        sector_risk[sector] = sector_risk.get(sector, 0.0) + base_pct

    # 板块集中度检查
    for sec, pct in sector_risk.items():
        if pct > MAX_SECTOR_EXPOSURE_PCT and sec != "unknown":
            warnings.append(f"{sec} 板块风险集中度 {pct*100:.1f}%，超过 {MAX_SECTOR_EXPOSURE_PCT*100:.1f}% 上限")

    remaining = max(0.0, max_exposure - total_risk_pct)
    at_capacity = total_risk_pct >= max_exposure

    if at_capacity:
        warnings.append("账户总风险敞口已达上限")
    elif total_risk_pct > max_exposure * 0.8:
        warnings.append(f"账户总敞口已用 {total_risk_pct/max_exposure*100:.0f}%，接近上限")

    return ExposureCheck(
        account_size=account_size,
        risk_preference=risk_preference,
        max_total_exposure_pct=max_exposure,
        current_exposure_pct=total_risk_pct,
        remaining_exposure_pct=remaining,
        remaining_dollar=account_size * remaining,
        active_positions=len(active_signals),
        at_capacity=at_capacity,
        warnings=warnings,
    )
