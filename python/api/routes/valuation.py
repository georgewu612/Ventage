"""Valuation API — DCF + future fair-value methods.

Endpoints:
    GET /v1/valuation/dcf/{symbol}   — full DCF analysis
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/valuation/dcf/{symbol}")
def get_dcf(symbol: str) -> dict[str, Any]:
    """Run DCF valuation for a stock symbol.

    Returns fair value per share, current price, upside %, rating
    (undervalued/fairly_valued/overvalued), 5-year FCF projection,
    sensitivity matrix (3×3 WACC × terminal growth), and warnings.
    """
    from services.dcf_valuation import valuate

    try:
        result = valuate(symbol.upper())
        return result.to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        import traceback
        tb = traceback.format_exc().splitlines()[-3:]   # last 3 lines for context
        detail = f"DCF valuation failed: {exc} | trace: {' | '.join(tb)}"
        raise HTTPException(status_code=500, detail=detail[:500])
