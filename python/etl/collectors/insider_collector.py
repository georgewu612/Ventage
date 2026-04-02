"""SEC EDGAR Form 4 insider trades collector.

Uses the free SEC EDGAR full-text search API to fetch recent Form 4 filings.
Docs: https://efts.sec.gov/LATEST/search-index?q=%22form-type%22&dateRange=custom
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from etl.base import BaseCollector

# SEC requires a User-Agent identifying the requester
SEC_USER_AGENT = "Ventage/1.0 (ventage-app; contact@ventage.app)"

# Tracked symbols — expand as needed
TRACKED_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN",
    "META", "GOOGL", "AMD", "NFLX", "PLTR",
]

# CIK lookup for tracked companies (SEC uses CIK, not ticker)
# Source: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=&CIK=AAPL&type=4&dateb=&owner=include&count=10&search_text=&action=getcompany
TICKER_TO_CIK: dict[str, str] = {
    "AAPL": "0000320193",
    "MSFT": "0000789019",
    "NVDA": "0001045810",
    "TSLA": "0001318605",
    "AMZN": "0001018724",
    "META": "0001326801",
    "GOOGL": "0001652044",
    "AMD": "0000002488",
    "NFLX": "0001065280",
    "PLTR": "0001321655",
}


class InsiderTradesCollector(BaseCollector):
    """Collects Form 4 insider trading filings from SEC EDGAR."""

    name = "insider_trades"
    table = "insider_trades"

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch recent Form 4 filings from SEC EDGAR for tracked symbols."""
        all_filings: list[dict[str, Any]] = []

        async with httpx.AsyncClient(
            headers={"User-Agent": SEC_USER_AGENT},
            timeout=30.0,
        ) as client:
            for symbol in TRACKED_SYMBOLS:
                cik = TICKER_TO_CIK.get(symbol)
                if not cik:
                    continue

                try:
                    filings = await self._fetch_form4_for_cik(client, cik, symbol)
                    all_filings.extend(filings)
                except Exception as exc:
                    self.log.warning("symbol_fetch_failed", symbol=symbol, error=str(exc))

        self.log.info("collected_raw", count=len(all_filings))
        return all_filings

    async def _fetch_form4_for_cik(
        self,
        client: httpx.AsyncClient,
        cik: str,
        symbol: str,
    ) -> list[dict[str, Any]]:
        """Fetch recent Form 4 filings for a single company CIK."""
        # Use SEC EDGAR company filings API
        url = f"https://data.sec.gov/submissions/CIK{cik}.json"
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

        filings: list[dict[str, Any]] = []
        recent = data.get("filings", {}).get("recent", {})
        if not recent:
            return filings

        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accessions = recent.get("accessionNumber", [])
        primary_docs = recent.get("primaryDocument", [])

        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")

        for i, form_type in enumerate(forms):
            if form_type != "4":
                continue
            filing_date = dates[i] if i < len(dates) else None
            if not filing_date or filing_date < cutoff:
                continue

            filings.append({
                "symbol": symbol,
                "cik": cik,
                "filing_date": filing_date,
                "accession": accessions[i] if i < len(accessions) else None,
                "primary_doc": primary_docs[i] if i < len(primary_docs) else None,
                "company_name": data.get("name", ""),
            })

        # Fetch transaction details from each Form 4 XML
        detailed: list[dict[str, Any]] = []
        for filing in filings[:10]:  # Limit to 10 most recent per symbol
            try:
                txns = await self._parse_form4(client, filing)
                detailed.extend(txns)
            except Exception as exc:
                self.log.debug("form4_parse_error", accession=filing.get("accession"), error=str(exc))

        return detailed

    async def _parse_form4(
        self,
        client: httpx.AsyncClient,
        filing: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Parse a Form 4 XML filing to extract transaction details."""
        accession = filing.get("accession", "").replace("-", "")
        primary_doc = filing.get("primary_doc", "")
        if not accession or not primary_doc:
            return []

        # Try to get the JSON index for this filing
        cik = filing["cik"].lstrip("0")
        index_url = f"https://data.sec.gov/submissions/CIK{filing['cik']}.json"

        # For now, extract what we can from the filing metadata
        # Full XML parsing would require additional logic
        return [{
            "symbol": filing["symbol"],
            "insider_name": "",  # Would come from XML parsing
            "insider_title": "",
            "relationship": "Officer",
            "trade_type": "BUY",  # Default, would come from XML
            "shares": 0,
            "price": None,
            "value": None,
            "shares_owned_after": None,
            "filing_date": filing["filing_date"],
            "transaction_date": None,
            "sec_form": "Form 4",
            "footnotes": None,
            "_accession": filing.get("accession"),
            "_source": "sec_edgar",
        }]

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Clean and normalize insider trade records."""
        normalized = []
        seen_accessions: set[str] = set()

        for record in raw_records:
            accession = record.get("_accession")
            if accession and accession in seen_accessions:
                continue
            if accession:
                seen_accessions.add(accession)

            # Skip records with no meaningful data
            if not record.get("symbol") or not record.get("filing_date"):
                continue

            clean = {
                "symbol": record["symbol"].upper(),
                "insider_name": record.get("insider_name") or "Unknown",
                "insider_title": record.get("insider_title") or None,
                "relationship": record.get("relationship") or None,
                "trade_type": record.get("trade_type", "BUY").upper(),
                "shares": record.get("shares") or 0,
                "price": record.get("price"),
                "value": record.get("value"),
                "shares_owned_after": record.get("shares_owned_after"),
                "filing_date": record["filing_date"],
                "transaction_date": record.get("transaction_date"),
                "sec_form": "Form 4",
                "footnotes": record.get("footnotes"),
            }
            normalized.append(clean)

        return normalized

    async def load(self, records: list[dict[str, Any]]) -> int:
        """Upsert insider trade records into Supabase."""
        if not records:
            return 0

        # Insert in batches to avoid payload limits
        batch_size = 50
        total_loaded = 0

        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            try:
                result = self.db.table(self.table).insert(batch).execute()
                total_loaded += len(result.data) if result.data else 0
            except Exception as exc:
                self.log.error("load_batch_failed", batch_index=i, error=str(exc))

        return total_loaded
