"""Dark pool / large-block trade collector.

Data sources (in priority order):
1. Unusual Whales — `/api/darkpool/recent`  (if UNUSUAL_WHALES_API_KEY set)
2. FINRA OTC Transparency API — free weekly aggregates, no auth required

Dark pool trades represent large institutional block trades executed
off-exchange. High dark-pool volume relative to typical levels often
signals institutional accumulation or distribution.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import httpx
import structlog

from config.settings import get_settings
from etl.base import BaseCollector

logger = structlog.get_logger()

# Symbols to query when using FINRA (top liquid names)
CORE_SYMBOLS = [
    "AAPL",
    "MSFT",
    "NVDA",
    "TSLA",
    "AMZN",
    "META",
    "GOOGL",
    "AMD",
    "NFLX",
    "PLTR",
    "SPY",
    "QQQ",
    "MRVL",
    "AVGO",
    "CRM",
    "ORCL",
    "ADBE",
    "INTC",
    "MU",
    "QCOM",
]

# Minimum dark-pool value (USD) worth recording
MIN_TRADE_VALUE = 500_000  # $500K


class DarkPoolCollector(BaseCollector):
    """Collects large-block / dark-pool trade data."""

    name = "dark_pool"
    table = "dark_pool_orders"

    async def collect(self) -> list[dict[str, Any]]:
        settings = get_settings()
        if settings.has_unusual_whales_config:
            self.log.info("darkpool_source", source="unusual_whales")
            return await self._collect_unusual_whales(settings.unusual_whales_api_key)

        self.log.info("darkpool_source", source="finra")
        return await self._collect_finra()

    # ── Unusual Whales ──────────────────────────────────────────────

    async def _collect_unusual_whales(self, api_key: str) -> list[dict[str, Any]]:
        """Fetch recent dark pool prints from Unusual Whales."""
        url = "https://api.unusualwhales.com/api/darkpool/recent"
        headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                records = data.get("data", data) if isinstance(data, dict) else data
                self.log.info("uw_darkpool_fetched", count=len(records))
                return records if isinstance(records, list) else []
            except Exception as exc:
                self.log.warning("uw_darkpool_failed", error=str(exc))
                return await self._collect_finra()  # graceful fallback

    # ── FINRA OTC Transparency (free) ───────────────────────────────

    async def _collect_finra(self) -> list[dict[str, Any]]:
        """Fetch weekly OTC/dark-pool aggregates from FINRA transparency portal."""
        url = "https://api.finra.org/data/group/otcMarket/name/weeklySummary?limit=500&offset=0"
        headers = {"Accept": "application/json"}

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(url, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                self.log.info("finra_darkpool_fetched", count=len(data))
                return data if isinstance(data, list) else []
            except Exception as exc:
                self.log.warning("finra_darkpool_failed", error=str(exc))
                return []

    # ── Transform ───────────────────────────────────────────────────

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Normalize raw records to dark_pool_orders schema."""
        transformed: list[dict[str, Any]] = []
        now = datetime.now(UTC).isoformat()

        for rec in raw_records:
            try:
                row = self._normalize_record(rec, now)
                if row and (row.get("value") or 0) >= MIN_TRADE_VALUE:
                    transformed.append(row)
            except Exception as exc:
                self.log.debug("transform_skip", error=str(exc))

        # Deduplicate by symbol + trade_time + price
        seen: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for row in transformed:
            key = f"{row['symbol']}|{row.get('trade_time', '')}|{row.get('price', '')}"
            if key not in seen:
                seen.add(key)
                deduped.append(row)

        self.log.info("darkpool_transformed", raw=len(raw_records), transformed=len(deduped))
        return deduped

    def _normalize_record(self, rec: dict[str, Any], now: str) -> dict[str, Any] | None:
        """Normalize one record — handles both UW and FINRA formats."""

        # ── Unusual Whales format ──────────────────────────────────
        # Fields: ticker, size, price, date_of_trade, venue, tracking_id, etc.
        if "ticker" in rec or "tracking_id" in rec:
            symbol = (rec.get("ticker") or rec.get("symbol") or "").upper()
            if not symbol or symbol not in CORE_SYMBOLS:
                return None

            price = float(rec.get("price") or 0)
            size = int(rec.get("size") or rec.get("volume") or 0)
            exchange = str(rec.get("venue") or rec.get("exchange") or "DARK")
            trade_time = rec.get("date_of_trade") or rec.get("trade_time") or now

            return {
                "symbol": symbol,
                "price": price,
                "size": size,
                "exchange": exchange,
                "trade_time": trade_time,
                "created_at": now,
            }

        # ── FINRA weekly summary format ───────────────────────────
        # Fields: issueSymbolIdentifier, totalWeeklyShareQuantity,
        #         totalWeeklyTradeCount, reportedWeekDtRangeStartDate, etc.
        if "issueSymbolIdentifier" in rec:
            symbol = (rec.get("issueSymbolIdentifier") or "").upper().strip()
            if not symbol or len(symbol) > 5:  # skip ETFs with long names
                return None
            # Filter to our core watchlist only
            if symbol not in CORE_SYMBOLS:
                return None

            shares = int(rec.get("totalWeeklyShareQuantity") or 0)
            trade_count = int(rec.get("totalWeeklyTradeCount") or 0)
            if shares == 0 or trade_count == 0:
                return None

            # FINRA weekly data: use avg trade size as proxy for block size
            avg_size = shares // max(trade_count, 1)
            # No price data in FINRA weekly summary — use a placeholder
            # Real value comes from size × price; we'll estimate 0 to be honest
            week_start = rec.get("reportedWeekDtRangeStartDate") or now[:10]

            return {
                "symbol": symbol,
                "price": 0.0,  # FINRA aggregates don't include price
                "size": avg_size,
                "exchange": "FINRA_OTC",
                "trade_time": f"{week_start}T00:00:00+00:00",
                "created_at": now,
            }

        return None

    # ── Load ────────────────────────────────────────────────────────

    async def load(self, records: list[dict[str, Any]]) -> int:
        """Upsert dark pool records."""
        if not records:
            return 0

        loaded = 0
        batch_size = 50
        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            try:
                self.db.table(self.table).insert(batch).execute()
                loaded += len(batch)
            except Exception as exc:
                self.log.warning("darkpool_load_batch_failed", error=str(exc))

        self.log.info("darkpool_loaded", count=loaded)
        return loaded
