"""Quality Score API — F-Score / G-Score endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/quality/fscore/{symbol}")
def get_fscore(symbol: str) -> dict[str, Any]:
    """Compute Piotroski F-Score (0-9) for a stock.

    Returns score breakdown across 3 categories (profitability,
    leverage/liquidity, operating efficiency) with 9 sub-checks.
    Returns rating: high_quality (8-9) / neutral (5-7) / low_quality (0-4)
    or not_applicable for banks/insurance.
    """
    from services.quality_score import piotroski_f_score
    from services.financials_provider import FinancialsError

    try:
        result = piotroski_f_score(symbol.upper())
        return result.to_dict()
    except FinancialsError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]
        detail = f"F-Score failed: {exc} | {' | '.join(tb)}"
        raise HTTPException(status_code=500, detail=detail[:500])
