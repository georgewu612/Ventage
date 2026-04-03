"""SEC EDGAR Form 4 insider trades collector.

Fetches Form 4 filings from SEC EDGAR and parses the XML to extract
insider names, trade types, shares, prices, and ownership details.
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
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
        accession = filing.get("accession", "")
        primary_doc = filing.get("primary_doc", "")
        if not accession or not primary_doc:
            return []

        # Build URL: https://www.sec.gov/Archives/edgar/data/{cik}/{accession_no_dashes}/{doc}
        cik = filing["cik"].lstrip("0")
        accession_path = accession.replace("-", "")
        xml_url = (
            f"https://www.sec.gov/Archives/edgar/data/{cik}/"
            f"{accession_path}/{primary_doc}"
        )

        # SEC rate limit: max 10 requests/second
        await asyncio.sleep(0.15)

        resp = await client.get(xml_url)
        resp.raise_for_status()

        return self._extract_transactions_from_xml(
            resp.text, filing["symbol"], filing["filing_date"], accession
        )

    def _extract_transactions_from_xml(
        self,
        xml_text: str,
        symbol: str,
        filing_date: str,
        accession: str,
    ) -> list[dict[str, Any]]:
        """Extract transaction records from Form 4 XML content."""
        try:
            root = ET.fromstring(xml_text)
        except ET.ParseError:
            self.log.debug("xml_parse_error", accession=accession)
            return []

        # XML namespace — Form 4 uses default namespace
        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}")[0] + "}"

        # Extract reporting owner info
        owner_name = self._xml_text(root, f".//{ns}reportingOwner/{ns}reportingOwnerId/{ns}rptOwnerName")
        owner_title = self._xml_text(root, f".//{ns}reportingOwner/{ns}reportingOwnerRelationship/{ns}officerTitle")

        # Determine relationship
        rel_node = root.find(f".//{ns}reportingOwner/{ns}reportingOwnerRelationship")
        relationship = self._determine_relationship(rel_node, ns)

        transactions: list[dict[str, Any]] = []

        # Parse non-derivative transactions (common stock trades)
        for txn in root.findall(f".//{ns}nonDerivativeTransaction"):
            record = self._parse_transaction_element(
                txn, ns, symbol, owner_name, owner_title, relationship,
                filing_date, accession,
            )
            if record:
                transactions.append(record)

        # If no transactions found, still record the filing with owner info
        if not transactions:
            transactions.append({
                "symbol": symbol,
                "insider_name": owner_name or "Unknown",
                "insider_title": owner_title or None,
                "relationship": relationship,
                "trade_type": "BUY",
                "shares": 0,
                "price": None,
                "value": None,
                "shares_owned_after": None,
                "filing_date": filing_date,
                "transaction_date": None,
                "sec_form": "Form 4",
                "footnotes": None,
                "_accession": accession,
                "_source": "sec_edgar",
            })

        return transactions

    def _parse_transaction_element(
        self,
        txn: ET.Element,
        ns: str,
        symbol: str,
        owner_name: str,
        owner_title: str | None,
        relationship: str,
        filing_date: str,
        accession: str,
    ) -> dict[str, Any] | None:
        """Parse a single <nonDerivativeTransaction> element."""
        # Transaction date
        txn_date = self._xml_text(txn, f"{ns}transactionDate/{ns}value")

        # Shares
        shares_str = self._xml_text(txn, f"{ns}transactionAmounts/{ns}transactionShares/{ns}value")
        shares = float(shares_str) if shares_str else 0

        # Price per share
        price_str = self._xml_text(txn, f"{ns}transactionAmounts/{ns}transactionPricePerShare/{ns}value")
        price = float(price_str) if price_str else None

        # Acquisition (A) or Disposition (D) → BUY or SELL
        acq_disp = self._xml_text(
            txn, f"{ns}transactionAmounts/{ns}transactionAcquiredDisposedCode/{ns}value"
        )
        trade_type = "BUY" if acq_disp == "A" else "SELL"

        # Shares owned after transaction
        owned_after_str = self._xml_text(
            txn, f"{ns}postTransactionAmounts/{ns}sharesOwnedFollowingTransaction/{ns}value"
        )
        shares_owned_after = float(owned_after_str) if owned_after_str else None

        # Calculate value
        value = round(shares * price, 2) if price and shares else None

        if shares == 0 and price is None:
            return None

        return {
            "symbol": symbol,
            "insider_name": owner_name or "Unknown",
            "insider_title": owner_title or None,
            "relationship": relationship,
            "trade_type": trade_type,
            "shares": int(shares),
            "price": price,
            "value": value,
            "shares_owned_after": int(shares_owned_after) if shares_owned_after else None,
            "filing_date": filing_date,
            "transaction_date": txn_date,
            "sec_form": "Form 4",
            "footnotes": None,
            "_accession": accession,
            "_source": "sec_edgar",
        }

    def _determine_relationship(self, rel_node: ET.Element | None, ns: str) -> str:
        """Determine the insider's relationship from XML."""
        if rel_node is None:
            return "Other"
        if self._xml_text(rel_node, f"{ns}isDirector") == "1":
            return "Director"
        if self._xml_text(rel_node, f"{ns}isOfficer") == "1":
            return "Officer"
        if self._xml_text(rel_node, f"{ns}isTenPercentOwner") == "1":
            return "10% Owner"
        return "Other"

    @staticmethod
    def _xml_text(el: ET.Element, path: str) -> str | None:
        """Safely extract text from an XML element path."""
        node = el.find(path)
        return node.text.strip() if node is not None and node.text else None

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Clean and normalize insider trade records."""
        normalized = []
        seen: set[str] = set()

        for record in raw_records:
            # Skip records with no meaningful data
            if not record.get("symbol") or not record.get("filing_date"):
                continue

            # Dedup by accession + insider + shares + trade_type
            dedup_key = (
                f"{record.get('_accession')}|{record.get('insider_name')}"
                f"|{record.get('shares')}|{record.get('trade_type')}"
            )
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

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
