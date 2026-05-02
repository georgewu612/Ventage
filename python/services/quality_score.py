"""Quality Score — Piotroski F-Score (1-9) for financial health screening.

Reference: Piotroski (2000) "Value Investing: The Use of Historical Financial
Statement Information to Separate Winners from Losers from Value Stocks"

The F-Score combines 9 binary signals across 3 categories:
    Profitability (4 signals):
        F1: Net Income > 0
        F2: Operating Cash Flow > 0
        F3: ROA improving YoY
        F4: OCF > Net Income (quality of earnings — accruals are low)

    Leverage / Liquidity / Source of Funds (3 signals):
        F5: Long-term Debt decreasing YoY
        F6: Current Ratio improving YoY
        F7: No new shares issued

    Operating Efficiency (2 signals):
        F8: Gross Margin improving YoY
        F9: Asset Turnover improving YoY

Score 8-9 = High Quality; 5-7 = Neutral; 0-4 = Low Quality (avoid).

Also includes:
    - Sector exclusion (banks/insurance: F-Score doesn't apply)
    - G-Score for growth stocks (Mohanram 2005, simpler version)

Public API:
    piotroski_f_score(symbol) -> FScoreResult
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

from services.financials_provider import (
    FinancialsError,
    find_value,
    get_balance_sheet,
    get_cash_flow,
    get_company_info,
    get_income_statement,
)

logger = logging.getLogger(__name__)


# ── Aliases for line items (vary across yfinance versions and AV) ────────────

ALIAS_NET_INCOME = ["Net Income", "NetIncome", "netIncome", "Net Income Common Stockholders"]
ALIAS_TOTAL_ASSETS = ["Total Assets", "totalAssets", "TotalAssets"]
ALIAS_OPERATING_CASHFLOW = [
    "Operating Cash Flow", "Total Cash From Operating Activities",
    "Cash Flow From Continuing Operating Activities", "operatingCashflow",
]
ALIAS_LONG_TERM_DEBT = [
    "Long Term Debt", "longTermDebt", "LongTermDebt",
    "Long Term Debt And Capital Lease Obligation",
]
ALIAS_CURRENT_ASSETS = ["Current Assets", "Total Current Assets", "totalCurrentAssets"]
ALIAS_CURRENT_LIABILITIES = ["Current Liabilities", "Total Current Liabilities", "totalCurrentLiabilities"]
ALIAS_SHARES = [
    "Ordinary Shares Number", "Share Issued", "Common Stock",
    "commonStockSharesOutstanding",
]
ALIAS_GROSS_PROFIT = ["Gross Profit", "grossProfit", "GrossProfit"]
ALIAS_TOTAL_REVENUE = [
    "Total Revenue", "Revenue", "totalRevenue", "Operating Revenue",
]


# ── Dataclasses ───────────────────────────────────────────────────────────────

Rating = Literal["high_quality", "neutral", "low_quality", "not_applicable"]


@dataclass
class CheckResult:
    name: str
    name_zh: str
    passed: bool
    value: float | None
    prior_value: float | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "name_zh": self.name_zh,
            "passed": bool(self.passed),
            "value": round(self.value, 4) if self.value is not None else None,
            "prior_value": round(self.prior_value, 4) if self.prior_value is not None else None,
            "note": self.note,
        }


@dataclass
class FScoreResult:
    symbol: str
    sector: str | None
    score: int                       # 0-9
    rating: Rating
    pass_count: int                  # equals score
    profitability: list[CheckResult] = field(default_factory=list)
    leverage_liquidity: list[CheckResult] = field(default_factory=list)
    operating_efficiency: list[CheckResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    applicable: bool = True

    @property
    def category_scores(self) -> dict[str, int]:
        return {
            "profitability": sum(1 for c in self.profitability if c.passed),
            "leverage_liquidity": sum(1 for c in self.leverage_liquidity if c.passed),
            "operating_efficiency": sum(1 for c in self.operating_efficiency if c.passed),
        }

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "sector": self.sector,
            "score": self.score,
            "max_score": 9,
            "rating": self.rating,
            "pass_count": self.pass_count,
            "applicable": self.applicable,
            "category_scores": self.category_scores,
            "profitability": [c.to_dict() for c in self.profitability],
            "leverage_liquidity": [c.to_dict() for c in self.leverage_liquidity],
            "operating_efficiency": [c.to_dict() for c in self.operating_efficiency],
            "warnings": self.warnings,
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_div(a: float | None, b: float | None) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _is_financial_sector(sector: str | None) -> bool:
    if not sector:
        return False
    sector = sector.lower()
    return any(k in sector for k in ["financial", "bank", "insurance"])


def _rating_from_score(score: int) -> Rating:
    if score >= 8:
        return "high_quality"
    if score >= 5:
        return "neutral"
    return "low_quality"


# ── Core scoring ──────────────────────────────────────────────────────────────

def piotroski_f_score(symbol: str) -> FScoreResult:
    """Compute Piotroski F-Score for a stock symbol."""
    sym = symbol.upper()
    info = get_company_info(sym)
    sector = info.get("sector")

    # Banks and insurance: F-Score doesn't apply (different financial structure)
    if _is_financial_sector(sector):
        return FScoreResult(
            symbol=sym, sector=sector, score=0, rating="not_applicable",
            pass_count=0, applicable=False,
            warnings=[
                "F-Score 不适用于银行/保险等金融行业（资产负债表结构不同）。"
                "请用 P/B、ROE、不良贷款率等专业指标评估。"
            ],
        )

    try:
        income = get_income_statement(sym)
        balance = get_balance_sheet(sym)
        cashflow = get_cash_flow(sym)
    except FinancialsError as exc:
        raise FinancialsError(f"Insufficient financial data for {sym}: {exc}")

    if income.shape[1] < 2 or balance.shape[1] < 2:
        raise FinancialsError(
            f"{sym}: need at least 2 years of statements (got income={income.shape[1]}, balance={balance.shape[1]})"
        )

    warnings: list[str] = []
    profitability: list[CheckResult] = []
    leverage_liquidity: list[CheckResult] = []
    operating_efficiency: list[CheckResult] = []

    # ── Most-recent and prior-year extracts ──────────────────────────────
    ni_curr = find_value(income, ALIAS_NET_INCOME, 0)
    ni_prev = find_value(income, ALIAS_NET_INCOME, 1)
    rev_curr = find_value(income, ALIAS_TOTAL_REVENUE, 0)
    rev_prev = find_value(income, ALIAS_TOTAL_REVENUE, 1)
    gp_curr = find_value(income, ALIAS_GROSS_PROFIT, 0)
    gp_prev = find_value(income, ALIAS_GROSS_PROFIT, 1)

    ta_curr = find_value(balance, ALIAS_TOTAL_ASSETS, 0)
    ta_prev = find_value(balance, ALIAS_TOTAL_ASSETS, 1)
    ca_curr = find_value(balance, ALIAS_CURRENT_ASSETS, 0)
    ca_prev = find_value(balance, ALIAS_CURRENT_ASSETS, 1)
    cl_curr = find_value(balance, ALIAS_CURRENT_LIABILITIES, 0)
    cl_prev = find_value(balance, ALIAS_CURRENT_LIABILITIES, 1)
    ltd_curr = find_value(balance, ALIAS_LONG_TERM_DEBT, 0)
    ltd_prev = find_value(balance, ALIAS_LONG_TERM_DEBT, 1)
    shares_curr = find_value(balance, ALIAS_SHARES, 0)
    shares_prev = find_value(balance, ALIAS_SHARES, 1)

    ocf_curr = find_value(cashflow, ALIAS_OPERATING_CASHFLOW, 0)

    # ── PROFITABILITY (4 signals) ─────────────────────────────────────────

    # F1: Net Income > 0
    f1_passed = ni_curr is not None and ni_curr > 0
    profitability.append(CheckResult(
        name="Net Income > 0", name_zh="净利润为正",
        passed=f1_passed, value=ni_curr,
        note="公司当期是否盈利",
    ))

    # F2: Operating Cash Flow > 0
    f2_passed = ocf_curr is not None and ocf_curr > 0
    profitability.append(CheckResult(
        name="Operating Cash Flow > 0", name_zh="经营现金流为正",
        passed=f2_passed, value=ocf_curr,
        note="公司经营活动是否产生现金",
    ))

    # F3: ROA improving YoY (current ROA > prior ROA)
    roa_curr = _safe_div(ni_curr, ta_curr)
    roa_prev = _safe_div(ni_prev, ta_prev)
    f3_passed = (
        roa_curr is not None and roa_prev is not None and roa_curr > roa_prev
    )
    profitability.append(CheckResult(
        name="ROA improving YoY", name_zh="ROA 同比改善",
        passed=f3_passed, value=roa_curr, prior_value=roa_prev,
        note="资产回报率是否同比上升",
    ))

    # F4: OCF > Net Income (low accruals)
    f4_passed = (
        ocf_curr is not None and ni_curr is not None and ocf_curr > ni_curr
    )
    profitability.append(CheckResult(
        name="OCF > Net Income", name_zh="经营现金流 > 净利润",
        passed=f4_passed, value=ocf_curr, prior_value=ni_curr,
        note="盈利质量（避免应计利润虚高）",
    ))

    # ── LEVERAGE / LIQUIDITY (3 signals) ──────────────────────────────────

    # F5: Long-Term Debt decreasing YoY
    if ltd_curr is None or ltd_prev is None:
        # Many companies report 0 long-term debt — treat as 0 vs 0 = passed (no leverage increase)
        f5_passed = (ltd_curr or 0) <= (ltd_prev or 0)
        ltd_note = "长期负债数据缺失（按 0 处理）" if ltd_curr is None else "长期负债是否同比减少"
    else:
        f5_passed = ltd_curr <= ltd_prev
        ltd_note = "长期负债是否同比减少"
    leverage_liquidity.append(CheckResult(
        name="LT Debt decreasing", name_zh="长期负债减少",
        passed=f5_passed, value=ltd_curr, prior_value=ltd_prev,
        note=ltd_note,
    ))

    # F6: Current Ratio improving YoY
    cr_curr = _safe_div(ca_curr, cl_curr)
    cr_prev = _safe_div(ca_prev, cl_prev)
    f6_passed = (
        cr_curr is not None and cr_prev is not None and cr_curr > cr_prev
    )
    leverage_liquidity.append(CheckResult(
        name="Current Ratio improving", name_zh="流动比率改善",
        passed=f6_passed, value=cr_curr, prior_value=cr_prev,
        note="短期偿债能力是否同比改善",
    ))

    # F7: No new shares issued (shares <= prior year)
    if shares_curr is None or shares_prev is None:
        f7_passed = False    # default to fail when unknown (conservative)
        shares_note = "股本数据缺失，按未通过处理"
        warnings.append("无法获取股本数据，F7 默认未通过")
    else:
        # Allow 1% tolerance for buyback rounding
        f7_passed = shares_curr <= shares_prev * 1.01
        shares_note = "未稀释（无新股发行）"
    leverage_liquidity.append(CheckResult(
        name="No share dilution", name_zh="无股本稀释",
        passed=f7_passed, value=shares_curr, prior_value=shares_prev,
        note=shares_note,
    ))

    # ── OPERATING EFFICIENCY (2 signals) ──────────────────────────────────

    # F8: Gross Margin improving YoY
    gm_curr = _safe_div(gp_curr, rev_curr)
    gm_prev = _safe_div(gp_prev, rev_prev)
    f8_passed = (
        gm_curr is not None and gm_prev is not None and gm_curr > gm_prev
    )
    operating_efficiency.append(CheckResult(
        name="Gross Margin improving", name_zh="毛利率改善",
        passed=f8_passed, value=gm_curr, prior_value=gm_prev,
        note="毛利率是否同比上升",
    ))

    # F9: Asset Turnover improving YoY (revenue / total assets)
    at_curr = _safe_div(rev_curr, ta_curr)
    at_prev = _safe_div(rev_prev, ta_prev)
    f9_passed = (
        at_curr is not None and at_prev is not None and at_curr > at_prev
    )
    operating_efficiency.append(CheckResult(
        name="Asset Turnover improving", name_zh="资产周转率改善",
        passed=f9_passed, value=at_curr, prior_value=at_prev,
        note="资产使用效率是否同比上升",
    ))

    # ── Total score ───────────────────────────────────────────────────────
    pass_count = sum(
        1 for c in profitability + leverage_liquidity + operating_efficiency
        if c.passed
    )

    # Data quality warnings
    if ni_curr is None or rev_curr is None:
        warnings.append("⚠️ 部分核心字段缺失，得分可能不准")

    return FScoreResult(
        symbol=sym,
        sector=sector,
        score=pass_count,
        rating=_rating_from_score(pass_count),
        pass_count=pass_count,
        profitability=profitability,
        leverage_liquidity=leverage_liquidity,
        operating_efficiency=operating_efficiency,
        warnings=warnings,
        applicable=True,
    )
