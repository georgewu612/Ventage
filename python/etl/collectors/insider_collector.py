"""SEC EDGAR Form 4 insider trades collector — full market coverage.

Fetches ALL recent Form 4 filings from SEC EDGAR's full-text search API,
then parses each XML to extract insider names, trade types, shares, prices,
and ownership details. No longer limited to a hardcoded symbol list.
"""

from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from etl.base import BaseCollector
from etl.cik_mapper import CIKTickerMapper

# SEC requires a User-Agent identifying the requester
SEC_USER_AGENT = "Ventage/1.0 (ventage-app; contact@ventage.app)"

# Maximum Form 4 filings to process per run (control API usage)
MAX_FILINGS_PER_RUN = 50

# Core symbols that are always tracked (for options/sentiment follow-up)
CORE_SYMBOLS = {
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN",
    "META", "GOOGL", "AMD", "NFLX", "PLTR",
}


class InsiderTradesCollector(BaseCollector):
    """Collects Form 4 insider trading filings from SEC EDGAR — full market."""

    name = "insider_trades"
    table = "insider_trades"

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch recent Form 4 filings from SEC EDGAR full-text search."""
        all_filings: list[dict[str, Any]] = []

        async with httpx.AsyncClient(
            headers={"User-Agent": SEC_USER_AGENT},
            timeout=30.0,
        ) as client:
            # Use EDGAR full-text search to get ALL recent Form 4 filings
            filings_meta = await self._fetch_recent_form4s(client)
            self.log.info("form4_index_fetched", filings=len(filings_meta))

            # Parse each filing's XML for transaction details
            for filing in filings_meta[:MAX_FILINGS_PER_RUN]:
                try:
                    txns = await self._parse_form4(client, filing)
                    all_filings.extend(txns)
                except Exception as exc:
                    self.log.debug(
                        "form4_parse_error",
                        accession=filing.get("accession"),
                        error=str(exc),
                    )

        self.log.info("collected_raw", count=len(all_filings))
        return all_filings

    async def _fetch_recent_form4s(
        self, client: httpx.AsyncClient
    ) -> list[dict[str, Any]]:
        """Fetch recent Form 4 filings from EDGAR full-text search API."""
        # EFTS (EDGAR Full-Text Search) returns recent filings across ALL companies
        cutoff = (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d")
        url = "https://efts.sec.gov/LATEST/search-index"
        params = {
            "q": '"4"',
            "dateRange": "custom",
            "startdt": cutoff,
            "forms": "4",
            "from": 0,
            "size": MAX_FILINGS_PER_RUN,
        }

        await asyncio.sleep(0.15)  # SEC rate limit
        resp = await client.get(url, params=params)

        # If EFTS is unavailable, fall back to the RSS feed
        if resp.status_code != 200:
            self.log.warning("efts_unavailable", status=resp.status_code)
            return await self._fetch_form4_rss(client)

        data = resp.json()
        hits = data.get("hits", {}).get("hits", [])

        filings: list[dict[str, Any]] = []
        for hit in hits:
            source = hit.get("_source", {})
            entity = source.get("entity_name", "")
            cik = str(source.get("entity_id", ""))
            filing_date = source.get("file_date", "")
            accession = source.get("file_num", "") or hit.get("_id", "")

            # Look up the ticker from CIK
            ticker = await CIKTickerMapper.get_ticker(cik)
            if not ticker:
                continue

            # Get the primary document URL
            file_url = source.get("file_url", "")

            filings.append({
                "symbol": ticker,
                "cik": cik.zfill(10),
                "filing_date": filing_date,
                "accession": accession,
                "primary_doc": file_url,
                "company_name": entity,
            })

        return filings

    async def _fetch_form4_rss(
        self, client: httpx.AsyncClient
    ) -> list[dict[str, Any]]:
        """Fallback: Fetch recent Form 4 filings from EDGAR RSS feed."""
        url = (
            "https://www.sec.gov/cgi-bin/browse-edgar"
            "?action=getcurrent&type=4&dateb=&owner=include"
            f"&count={MAX_FILINGS_PER_RUN}&search_text=&start=0&output=atom"
        )

        await asyncio.sleep(0.15)
        resp = await client.get(url)
        resp.raise_for_status()

        filings: list[dict[str, Any]] = []
        try:
            root = ET.fromstring(resp.text)
            ns = "{http://www.w3.org/2005/Atom}"

            for entry in root.findall(f"{ns}entry"):
                title = entry.findtext(f"{ns}title", "")
                if "4 -" not in title and "4-" not in title:
                    continue

                # Extract CIK from the link
                link_el = entry.find(f"{ns}link")
                link = link_el.get("href", "") if link_el is not None else ""

                # Try to extract CIK from link
                cik = ""
                if "/cgi-bin/browse-edgar" in link and "CIK=" in link:
                    cik = link.split("CIK=")[1].split("&")[0]

                updated = entry.findtext(f"{ns}updated", "")
                filing_date = updated[:10] if updated else ""

                # Look up ticker
                ticker = await CIKTickerMapper.get_ticker(cik) if cik else None
                if not ticker:
                    continue

                # Extract accession from content
                content = entry.findtext(f"{ns}summary", "")
                accession = ""

                filings.append({
                    "symbol": ticker,
                    "cik": cik.zfill(10),
                    "filing_date": filing_date,
                    "accession": accession,
                    "primary_doc": "",
                    "company_name": title.split(" -")[0] if " -" in title else "",
                })

        except ET.ParseError:
            self.log.warning("rss_parse_error")

        return filings

    async def _parse_form4(
        self,
        client: httpx.AsyncClient,
        filing: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """Parse a Form 4 XML filing to extract transaction details."""
        accession = filing.get("accession", "")
        primary_doc = filing.get("primary_doc", "")

        # If we have a direct URL, use it
        if primary_doc and primary_doc.startswith("http"):
            xml_url = primary_doc
        elif accession and primary_doc:
            # Build URL from CIK + accession
            cik = filing["cik"].lstrip("0")
            accession_path = accession.replace("-", "")
            xml_url = (
                f"https://www.sec.gov/Archives/edgar/data/{cik}/"
                f"{accession_path}/{primary_doc}"
            )
        else:
            return []

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

        # XML namespace
        ns = ""
        if root.tag.startswith("{"):
            ns = root.tag.split("}")[0] + "}"

        # Extract reporting owner info
        owner_name = self._xml_text(
            root, f".//{ns}reportingOwner/{ns}reportingOwnerId/{ns}rptOwnerName"
        )
        owner_title = self._xml_text(
            root,
            f".//{ns}reportingOwner/{ns}reportingOwnerRelationship/{ns}officerTitle",
        )

        # Determine relationship
        rel_node = root.find(
            f".//{ns}reportingOwner/{ns}reportingOwnerRelationship"
        )
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
