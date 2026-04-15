"""SEC EDGAR Form 4 insider trades collector — expanded market coverage.

Uses the reliable per-CIK EDGAR submissions API with a dynamic,
expanded company list sourced from CIKTickerMapper.
"""

from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from etl.base import BaseCollector
from etl.cik_mapper import CIKTickerMapper

# SEC requires a User-Agent identifying the requester
SEC_USER_AGENT = "Ventage/1.0 (ventage-app; contact@ventage.app)"

# Core symbols that are always tracked
CORE_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN",
    "META", "GOOGL", "AMD", "NFLX", "PLTR",
]

# Extended watchlist — major US stocks across sectors
EXTENDED_SYMBOLS = [
    # Semiconductors
    "INTC", "QCOM", "AVGO", "MU", "MRVL", "ON",
    # Finance
    "JPM", "GS", "BAC", "V", "MA", "C", "WFC", "MS",
    # Healthcare
    "JNJ", "PFE", "UNH", "LLY", "ABBV", "MRK", "BMY",
    # Tech
    "CRM", "ORCL", "ADBE", "UBER", "COIN", "SNAP", "SQ", "SHOP",
    "PYPL", "ROKU", "DDOG", "NET", "ZS", "CRWD",
    # Consumer
    "DIS", "NKE", "SBUX", "MCD", "WMT", "TGT", "COST", "HD",
    # Energy
    "XOM", "CVX", "COP",
    # EV / Auto
    "RIVN", "LCID", "F", "GM",
    # Other popular
    "BA", "CAT", "DE", "RTX", "LMT",
    "SOFI", "HOOD", "MARA", "RIOT",
]

# Maximum Form 4 filings to parse per symbol per run
MAX_FILINGS_PER_SYMBOL = 5

# Maximum total symbols per run (rotate through extended list)
MAX_SYMBOLS_PER_RUN = 30


class InsiderTradesCollector(BaseCollector):
    """Collects Form 4 insider trading filings from SEC EDGAR — expanded coverage."""

    name = "insider_trades"
    table = "insider_trades"

    # Track rotation offset for extended symbols
    _rotation_offset: int = 0

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch recent Form 4 filings using per-CIK API with expanded symbol list."""
        all_filings: list[dict[str, Any]] = []

        # Build this run's symbol list
        symbols = await self._get_symbols_for_run()
        self.log.info("tracking_symbols", count=len(symbols), symbols=symbols[:10])

        async with httpx.AsyncClient(
            headers={"User-Agent": SEC_USER_AGENT},
            timeout=30.0,
        ) as client:
            for symbol in symbols:
                cik = await CIKTickerMapper.get_cik(symbol)
                if not cik:
                    continue

                try:
                    filings = await self._fetch_form4_for_cik(
                        client, cik.zfill(10), symbol
                    )
                    all_filings.extend(filings)
                except Exception as exc:
                    self.log.warning(
                        "symbol_fetch_failed", symbol=symbol, error=str(exc)
                    )

                # SEC rate limit: max 10 requests/second
                await asyncio.sleep(0.15)

        self.log.info("collected_raw", count=len(all_filings))
        return all_filings

    async def _get_symbols_for_run(self) -> list[str]:
        """Build a symbol list for this run: core + rotating extended subset."""
        symbols = list(CORE_SYMBOLS)

        # Add a rotating subset of extended symbols
        extended = EXTENDED_SYMBOLS.copy()
        remaining_slots = MAX_SYMBOLS_PER_RUN - len(symbols)

        if remaining_slots > 0:
            start = InsiderTradesCollector._rotation_offset
            # Wrap around the extended list
            selected = []
            for i in range(remaining_slots):
                idx = (start + i) % len(extended)
                sym = extended[idx]
                if sym not in symbols:
                    selected.append(sym)
            symbols.extend(selected)

            # Advance rotation offset for next run
            InsiderTradesCollector._rotation_offset = (
                start + remaining_slots
            ) % len(extended)

        return symbols

    async def _fetch_form4_for_cik(
        self,
        client: httpx.AsyncClient,
        cik: str,
        symbol: str,
    ) -> list[dict[str, Any]]:
        """Fetch recent Form 4 filings for a single company CIK."""
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
        for filing in filings[:MAX_FILINGS_PER_SYMBOL]:
            try:
                txns = await self._parse_form4(client, filing)
                detailed.extend(txns)
            except Exception as exc:
                self.log.debug(
                    "form4_parse_error",
                    accession=filing.get("accession"),
                    error=str(exc),
                )

        return detailed

    async def _parse_form4(
        self,
        client: httpx.AsyncClient,
        filing: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Parse a Form 4 XML filing to extract transaction details."""
        accession = filing.get("accession", "")
        primary_doc = filing.get("primary_doc", "")
        if not accession:
            return []

        cik = filing["cik"].lstrip("0")
        accession_path = accession.replace("-", "")

        # Try to find the XML document for this filing
        xml_url = await self._find_form4_xml_url(
            client, cik, accession_path, primary_doc
        )
        if not xml_url:
            self.log.debug("no_xml_found", accession=accession)
            return []

        # SEC rate limit
        await asyncio.sleep(0.15)

        resp = await client.get(xml_url)
        resp.raise_for_status()

        # Verify we got XML, not HTML
        content = resp.text.strip()
        if content.startswith("<!DOCTYPE") or content.startswith("<html"):
            self.log.debug("got_html_not_xml", accession=accession, url=xml_url)
            return []

        return self._extract_transactions_from_xml(
            content, filing["symbol"], filing["filing_date"], accession
        )

    async def _find_form4_xml_url(
        self,
        client: httpx.AsyncClient,
        cik: str,
        accession_path: str,
        primary_doc: str,
    ) -> str | None:
        """Find the actual Form 4 XML document URL from the filing index.

        SEC EDGAR primary_doc paths often include an XSL prefix like
        ``xslF345X06/filename.xml`` which triggers server-side XSLT and
        returns HTML instead of raw XML.  We strip that prefix to get the
        raw XML document directly.
        """
        base = f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_path}"

        if not primary_doc:
            return None

        # Strip the xslF345X0{N}/ prefix that causes SEC to return HTML
        # e.g. "xslF345X06/wk-form4_1774051862.xml" → "wk-form4_1774051862.xml"
        clean_doc = re.sub(r"^xslF345X\d+/", "", primary_doc)

        if clean_doc.lower().endswith(".xml"):
            return f"{base}/{clean_doc}"

        # Fallback: fetch filing index to find the XML file
        try:
            await asyncio.sleep(0.15)
            index_url = f"{base}/index.json"
            resp = await client.get(index_url)
            resp.raise_for_status()
            index_data = resp.json()

            for item in index_data.get("directory", {}).get("item", []):
                name = item.get("name", "")
                if name.lower().endswith(".xml"):
                    if name.lower() in ("filingsummary.xml", "r1.xml"):
                        continue
                    return f"{base}/{name}"
        except Exception as exc:
            self.log.debug("index_fetch_failed", error=str(exc))

        # Last resort: try original primary_doc
        return f"{base}/{clean_doc}"

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

        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}")[0] + "}"

        owner_name = self._xml_text(
            root, f".//{ns}reportingOwner/{ns}reportingOwnerId/{ns}rptOwnerName"
        )
        owner_title = self._xml_text(
            root,
            f".//{ns}reportingOwner/{ns}reportingOwnerRelationship/{ns}officerTitle",
        )

        rel_node = root.find(
            f".//{ns}reportingOwner/{ns}reportingOwnerRelationship"
        )
        relationship = self._determine_relationship(rel_node, ns)

        transactions: list[dict[str, Any]] = []

        # Parse non-derivative transactions (direct stock buys/sells)
        for txn in root.findall(f".//{ns}nonDerivativeTransaction"):
            record = self._parse_transaction_element(
                txn, ns, symbol, owner_name, owner_title, relationship,
                filing_date, accession,
            )
            if record:
                transactions.append(record)

        # Also parse derivative transactions (options exercises, RSU vesting)
        for txn in root.findall(f".//{ns}derivativeTransaction"):
            record = self._parse_transaction_element(
                txn, ns, symbol, owner_name, owner_title, relationship,
                filing_date, accession,
            )
            if record:
                transactions.append(record)

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
        txn_date = self._xml_text(txn, f"{ns}transactionDate/{ns}value")

        shares_str = self._xml_text(
            txn, f"{ns}transactionAmounts/{ns}transactionShares/{ns}value"
        )
        shares = float(shares_str) if shares_str else 0

        price_str = self._xml_text(
            txn, f"{ns}transactionAmounts/{ns}transactionPricePerShare/{ns}value"
        )
        price = float(price_str) if price_str else None

        acq_disp = self._xml_text(
            txn,
            f"{ns}transactionAmounts/{ns}transactionAcquiredDisposedCode/{ns}value",
        )
        trade_type = "BUY" if acq_disp == "A" else "SELL"

        owned_after_str = self._xml_text(
            txn,
            f"{ns}postTransactionAmounts/{ns}sharesOwnedFollowingTransaction/{ns}value",
        )
        shares_owned_after = float(owned_after_str) if owned_after_str else None

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
            if not record.get("symbol") or not record.get("filing_date"):
                continue

            # Skip placeholder records with no actual trade data
            if not record.get("shares") and not record.get("value"):
                continue

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
