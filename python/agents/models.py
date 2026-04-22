"""Shared Pydantic models for AI analysis outputs.

Design principle (from CLAUDE.md):
  - AI ONLY summarizes and analyzes — it NEVER computes numbers
  - All structured outputs use Pydantic for validation and schema enforcement
  - These models are the single source of truth for AI response shapes
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class AIAnalysisOutput(BaseModel):
    """Structured output for a single-signal or symbol-level AI analysis.

    Returned by AIAnalyst.analyze_signal() and the /reports/analyze endpoint.
    All text fields are populated by the LLM; all numeric fields are validated
    by Pydantic so the frontend can render them safely.
    """

    conclusion: str = Field(
        max_length=300,
        description="核心结论：一句话总结当前信号的交易含义，引用提供的数据，不要自己计算",
    )
    time_horizon: str = Field(
        max_length=20,
        description="建议持仓时间维度，例如 '1-5天' / '1-4周' / '1-3月'",
    )
    supporting_evidence: Annotated[list[str], Field(max_length=5)] = Field(
        description="支撑该结论的关键证据，每条不超过 80 字，最多 5 条",
    )
    risk_evidence: Annotated[list[str], Field(max_length=3)] = Field(
        description="主要风险点，每条不超过 80 字，最多 3 条",
    )
    invalidation_conditions: Annotated[list[str], Field(max_length=3)] = Field(
        description="信号失效条件：哪些情况出现时应放弃该信号，最多 3 条",
    )
    suggested_strategies: Annotated[list[str], Field(max_length=3)] = Field(
        description="适配的操作策略（仅供参考，非投资建议），最多 3 条",
    )
    historical_performance_summary: str = Field(
        max_length=200,
        description="历史上类似信号组合的表现概述（如无历史数据，说明原因）",
    )
    risk_level: Literal["low", "medium", "high", "very_high"] = Field(
        description="综合风险等级：low / medium / high / very_high",
    )
    confidence_score: float = Field(
        ge=0,
        le=100,
        description="AI 对此次分析结论的置信度，0-100 整数",
    )
    generated_at: str = Field(
        default_factory=lambda: datetime.now(UTC).isoformat(),
        description="生成时间 ISO 8601",
    )
