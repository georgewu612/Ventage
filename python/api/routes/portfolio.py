"""Portfolio monitoring endpoints.

POST /v1/portfolio/upload        — import holdings from CSV or JSON body
GET  /v1/portfolio/summary       — current holdings with live prices & P&L
GET  /v1/portfolio/exposure      — sector / style / concentration breakdown
POST /v1/portfolio/snapshot      — save today's snapshot
GET  /v1/portfolio/history       — equity curve from snapshots
DELETE /v1/portfolio/holding/{symbol} — remove a holding
"""

from __future__ import annotations

import io
import csv
import json
from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
import yfinance as yf
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from openai import OpenAI
from pydantic import BaseModel
from supabase import Client, create_client

from config.settings import get_settings

logger = structlog.get_logger()
router = APIRouter()


# ── helpers ───────────────────────────────────────────────────────────────────

def _db() -> Client:
    s = get_settings()
    if not s.has_supabase_config:
        raise HTTPException(status_code=503, detail="Supabase not configured")
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _get_prices(symbols: list[str]) -> dict[str, float]:
    """Fetch latest close prices for a list of symbols via yfinance."""
    if not symbols:
        return {}
    try:
        tickers = yf.download(
            symbols,
            period="2d",
            auto_adjust=True,
            progress=False,
            group_by="ticker",
        )
        prices: dict[str, float] = {}
        for sym in symbols:
            try:
                if len(symbols) == 1:
                    close = tickers["Close"]
                else:
                    close = tickers[sym]["Close"]
                if isinstance(close, pd.DataFrame):
                    close = close.iloc[:, 0]
                prices[sym] = float(close.dropna().iloc[-1])
            except Exception:
                prices[sym] = 0.0
        return prices
    except Exception as exc:
        logger.warning("price_fetch_failed", error=str(exc))
        return {s: 0.0 for s in symbols}


def _sector_map(symbols: list[str]) -> dict[str, str]:
    """Best-effort sector lookup via yfinance info."""
    result: dict[str, str] = {}
    for sym in symbols:
        try:
            info = yf.Ticker(sym).info
            result[sym] = info.get("sector") or info.get("quoteType") or "Unknown"
        except Exception:
            result[sym] = "Unknown"
    return result


# ── Request models ────────────────────────────────────────────────────────────

class HoldingItem(BaseModel):
    symbol: str
    quantity: float
    avg_cost: float
    notes: str | None = None


class UploadRequest(BaseModel):
    user_id: str
    holdings: list[HoldingItem]


class CsvUploadRequest(BaseModel):
    user_id: str
    csv_text: str   # raw CSV content as a string


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/portfolio/upload")
def upload_holdings(req: UploadRequest) -> dict[str, Any]:
    """Upsert holdings for a user (replaces existing rows for each symbol)."""
    db = _db()
    now = datetime.now(UTC).isoformat()

    rows = [
        {
            "user_id": req.user_id,
            "symbol": h.symbol.upper(),
            "quantity": h.quantity,
            "avg_cost": h.avg_cost,
            "notes": h.notes,
            "updated_at": now,
        }
        for h in req.holdings
        if h.quantity > 0
    ]

    if not rows:
        raise HTTPException(status_code=400, detail="No valid holdings provided")

    db.table("portfolio_holdings").upsert(rows, on_conflict="user_id,symbol").execute()

    return {"imported": len(rows), "symbols": [r["symbol"] for r in rows]}


@router.post("/portfolio/upload-csv")
def upload_csv(req: CsvUploadRequest) -> dict[str, Any]:
    """Parse a CSV string and upsert holdings.

    Expected CSV columns (case-insensitive): symbol, quantity/shares, avg_cost/cost/price
    Supports TD Ameritrade and IBKR export formats.
    """
    try:
        reader = csv.DictReader(io.StringIO(req.csv_text.strip()))
        holdings: list[HoldingItem] = []

        # Normalise column names
        def _col(row: dict, *candidates: str) -> str | None:
            for c in candidates:
                for key in row:
                    if key.strip().lower() == c.lower():
                        return row[key].strip().replace(",", "")
            return None

        for row in reader:
            sym = _col(row, "symbol", "ticker", "Symbol", "Ticker")
            qty = _col(row, "quantity", "shares", "qty", "Quantity", "Shares")
            cost = _col(row, "avg_cost", "average_cost", "cost", "price", "Avg Cost", "Cost Basis Per Share")
            if sym and qty and cost:
                try:
                    holdings.append(HoldingItem(
                        symbol=sym.upper().replace("$", ""),
                        quantity=float(qty),
                        avg_cost=float(cost),
                    ))
                except ValueError:
                    continue

        if not holdings:
            raise HTTPException(status_code=400, detail="Could not parse any holdings from CSV")

        return upload_holdings(UploadRequest(user_id=req.user_id, holdings=holdings))

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"CSV parse error: {exc}")


@router.get("/portfolio/summary")
def portfolio_summary(user_id: str = Query(...)) -> dict[str, Any]:
    """Return current holdings with live prices and P&L."""
    db = _db()
    result = db.table("portfolio_holdings").select("*").eq("user_id", user_id).execute()
    holdings = result.data or []

    if not holdings:
        return {"holdings": [], "total_value": 0, "total_cost": 0, "total_pnl": 0, "total_pnl_pct": 0}

    symbols = [h["symbol"] for h in holdings]
    prices = _get_prices(symbols)

    enriched = []
    total_value = 0.0
    total_cost = 0.0

    for h in holdings:
        sym = h["symbol"]
        qty = float(h["quantity"])
        cost = float(h["avg_cost"])
        price = prices.get(sym, 0.0)

        value = price * qty
        cost_basis = cost * qty
        pnl = value - cost_basis
        pnl_pct = (pnl / cost_basis * 100) if cost_basis > 0 else 0.0

        total_value += value
        total_cost += cost_basis

        enriched.append({
            "symbol": sym,
            "quantity": qty,
            "avg_cost": cost,
            "current_price": price,
            "market_value": round(value, 2),
            "cost_basis": round(cost_basis, 2),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl_pct, 2),
            "weight": 0.0,  # filled below
            "notes": h.get("notes"),
        })

    # Weight calculation
    for pos in enriched:
        pos["weight"] = round(pos["market_value"] / total_value * 100, 2) if total_value > 0 else 0.0

    total_pnl = total_value - total_cost
    total_pnl_pct = (total_pnl / total_cost * 100) if total_cost > 0 else 0.0

    # Sort by weight descending
    enriched.sort(key=lambda x: x["weight"], reverse=True)

    return {
        "holdings": enriched,
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_pnl": round(total_pnl, 2),
        "total_pnl_pct": round(total_pnl_pct, 2),
        "position_count": len(enriched),
        "updated_at": datetime.now(UTC).isoformat(),
    }


@router.get("/portfolio/exposure")
def portfolio_exposure(user_id: str = Query(...)) -> dict[str, Any]:
    """Return sector / concentration breakdown."""
    summary = portfolio_summary(user_id=user_id)
    holdings = summary["holdings"]

    if not holdings:
        return {"sectors": {}, "top5_concentration": 0, "largest_position": None}

    symbols = [h["symbol"] for h in holdings]
    sectors = _sector_map(symbols)

    # Sector weights
    sector_weights: dict[str, float] = {}
    for h in holdings:
        sec = sectors.get(h["symbol"], "Unknown")
        sector_weights[sec] = round(sector_weights.get(sec, 0.0) + h["weight"], 2)

    # Top-5 concentration
    weights = sorted([h["weight"] for h in holdings], reverse=True)
    top5 = round(sum(weights[:5]), 2)

    return {
        "sectors": sector_weights,
        "top5_concentration": top5,
        "largest_position": holdings[0] if holdings else None,
        "position_count": len(holdings),
    }


@router.post("/portfolio/snapshot")
def save_snapshot(user_id: str = Query(...)) -> dict[str, Any]:
    """Save today's portfolio snapshot for the equity curve."""
    db = _db()
    summary = portfolio_summary(user_id=user_id)
    today = datetime.now(UTC).date().isoformat()

    snapshot_row = {
        "user_id": user_id,
        "snapshot_date": today,
        "total_value": summary["total_value"],
        "total_cost": summary["total_cost"],
        "total_pnl": summary["total_pnl"],
        "positions": summary["holdings"],
    }

    db.table("portfolio_snapshots").upsert(
        snapshot_row, on_conflict="user_id,snapshot_date"
    ).execute()

    return {"saved": True, "date": today, "total_value": summary["total_value"]}


@router.get("/portfolio/history")
def portfolio_history(
    user_id: str = Query(...),
    days: int = Query(default=90, le=365),
) -> dict[str, Any]:
    """Return historical snapshots for equity curve rendering."""
    db = _db()
    since = (datetime.now(UTC) - timedelta(days=days)).date().isoformat()

    result = (
        db.table("portfolio_snapshots")
        .select("snapshot_date, total_value, total_cost, total_pnl")
        .eq("user_id", user_id)
        .gte("snapshot_date", since)
        .order("snapshot_date")
        .execute()
    )

    snapshots = result.data or []
    return {"days": days, "snapshots": snapshots, "count": len(snapshots)}


@router.delete("/portfolio/holding/{symbol}")
def delete_holding(symbol: str, user_id: str = Query(...)) -> dict[str, Any]:
    """Remove a position from the portfolio."""
    db = _db()
    db.table("portfolio_holdings").delete().eq("user_id", user_id).eq("symbol", symbol.upper()).execute()
    return {"deleted": symbol.upper()}


@router.get("/portfolio/metrics")
def portfolio_metrics(user_id: str = Query(...)) -> dict[str, Any]:
    """Return performance metrics: max drawdown, best/worst performer, SPY benchmark."""
    db = _db()

    # Current holdings → best/worst performer
    summary = portfolio_summary(user_id=user_id)
    holdings = summary["holdings"]

    best: dict | None = None
    worst: dict | None = None
    if holdings:
        best = max(holdings, key=lambda h: h["pnl_pct"])
        worst = min(holdings, key=lambda h: h["pnl_pct"])

    # Max drawdown + 30-day portfolio return from snapshots (last 90 days)
    since = (datetime.now(UTC) - timedelta(days=90)).date().isoformat()
    snap_result = (
        db.table("portfolio_snapshots")
        .select("snapshot_date, total_value")
        .eq("user_id", user_id)
        .gte("snapshot_date", since)
        .order("snapshot_date")
        .execute()
    )
    snapshots = snap_result.data or []

    max_drawdown_pct = 0.0
    portfolio_30d_return_pct: float | None = None

    if len(snapshots) >= 2:
        values = [float(s["total_value"]) for s in snapshots]
        peak = values[0]
        for v in values:
            if v > peak:
                peak = v
            dd = (peak - v) / peak * 100 if peak > 0 else 0.0
            if dd > max_drawdown_pct:
                max_drawdown_pct = dd

        first_val = values[0]
        last_val = values[-1]
        if first_val > 0:
            portfolio_30d_return_pct = round((last_val - first_val) / first_val * 100, 2)

    # SPY 30-day return as benchmark
    spy_30d_return_pct: float | None = None
    try:
        spy_hist = yf.Ticker("SPY").history(period="35d")
        if len(spy_hist) >= 2:
            spy_30d_return_pct = round(
                (float(spy_hist["Close"].iloc[-1]) - float(spy_hist["Close"].iloc[0]))
                / float(spy_hist["Close"].iloc[0]) * 100,
                2,
            )
    except Exception:
        pass

    return {
        "max_drawdown_pct": round(max_drawdown_pct, 2),
        "best_performer": {"symbol": best["symbol"], "pnl_pct": best["pnl_pct"]} if best else None,
        "worst_performer": {"symbol": worst["symbol"], "pnl_pct": worst["pnl_pct"]} if worst else None,
        "spy_30d_return_pct": spy_30d_return_pct,
        "portfolio_30d_return_pct": portfolio_30d_return_pct,
        "snapshot_count": len(snapshots),
    }


@router.get("/portfolio/analyze")
def analyze_portfolio(user_id: str = Query(...)) -> dict[str, Any]:
    """AI portfolio health analysis: health score, regime alignment, risk flags, recommendations."""
    try:
        return _do_analyze(user_id)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("portfolio_analyze_error", error=str(exc))
        raise HTTPException(status_code=500, detail=f"Analysis failed: {exc}")


def _do_analyze(user_id: str) -> dict[str, Any]:
    db = _db()
    s = get_settings()

    summary = portfolio_summary(user_id=user_id)
    holdings = summary["holdings"]
    if not holdings:
        raise HTTPException(status_code=400, detail="No holdings to analyze")

    # Latest market regime
    regime_row = (
        db.table("market_regime_snapshots")
        .select("regime,recommendation,vix,volatility,breadth,style,chief_summary_en")
        .order("generated_at", desc=True)
        .limit(1)
        .execute()
        .data or [{}]
    )[0]

    # Latest signals for held symbols (confidence * 100 = signal_score)
    symbols = [h["symbol"] for h in holdings]
    signals_rows = (
        db.table("market_signals")
        .select("symbol,direction,confidence,analysis")
        .in_("symbol", symbols)
        .order("created_at", desc=True)
        .limit(len(symbols) * 2)
        .execute()
        .data or []
    )
    # Deduplicate — keep latest per symbol
    seen: set[str] = set()
    latest_signals: list[dict] = []
    for s_row in signals_rows:
        if s_row["symbol"] not in seen:
            seen.add(s_row["symbol"])
            latest_signals.append(s_row)

    holdings_text = "\n".join(
        f"- {h['symbol']}: weight {h['weight']:.1f}%, cost ${h['avg_cost']:.2f}, "
        f"current ${h['current_price']:.2f}, P&L {h['pnl_pct']:+.1f}%"
        for h in holdings
    )
    signals_text = "\n".join(
        f"- {r['symbol']}: {r['direction']} (score {round(float(r['confidence'] or 0) * 100)})"
        for r in latest_signals
    ) or "No recent signals for these symbols."

    regime_text = (
        f"Regime={regime_row.get('regime','unknown')}, "
        f"VIX={regime_row.get('vix','?')}, "
        f"Volatility={regime_row.get('volatility','?')}, "
        f"Recommendation={regime_row.get('recommendation','?')}"
    )

    prompt = f"""You are a portfolio risk analyst. Analyze the following portfolio and return a JSON health report.

Portfolio (total P&L {summary['total_pnl_pct']:+.1f}%):
{holdings_text}

Market regime today: {regime_text}

Recent signals for held positions:
{signals_text}

Return ONLY valid JSON with exactly this structure (no extra keys):
{{
  "health_score": <integer 0-100, 100=excellent>,
  "regime_alignment": "aligned" | "neutral" | "misaligned",
  "regime_alignment_reason": "<one sentence in Chinese explaining how portfolio fits current regime>",
  "risk_flags": [
    {{"symbol": "<SYMBOL or 'PORTFOLIO'>", "severity": "high"|"medium"|"low", "message": "<risk description in Chinese>"}}
  ],
  "recommendations": ["<concrete actionable advice in Chinese>"],
  "summary": "<2 sentences in Chinese summarizing portfolio health and key concern>",
  "summary_en": "<2 sentences in English>"
}}

Constraints: max 3 risk_flags, max 3 recommendations. Be specific and actionable."""

    openai_client = OpenAI(api_key=s.openai_api_key)
    response = openai_client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.3,
        max_tokens=800,
    )

    result = json.loads(response.choices[0].message.content)
    result.setdefault("health_score", 50)
    result.setdefault("risk_flags", [])
    result.setdefault("recommendations", [])

    return {
        "analyzed_at": datetime.now(UTC).isoformat(),
        "holding_count": len(holdings),
        **result,
    }
