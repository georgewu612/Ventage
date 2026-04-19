"""Tests for the SEC EDGAR insider trades collector."""

from unittest.mock import MagicMock

from etl.collectors.insider_collector import InsiderTradesCollector

SAMPLE_FORM4_XML = """<?xml version="1.0" encoding="UTF-8"?>
<ownershipDocument>
    <reportingOwner>
        <reportingOwnerId>
            <rptOwnerCik>0001234567</rptOwnerCik>
            <rptOwnerName>John Smith</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerRelationship>
            <isDirector>0</isDirector>
            <isOfficer>1</isOfficer>
            <officerTitle>Chief Executive Officer</officerTitle>
        </reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable>
        <nonDerivativeTransaction>
            <transactionDate><value>2026-04-01</value></transactionDate>
            <transactionAmounts>
                <transactionShares><value>10000</value></transactionShares>
                <transactionPricePerShare><value>150.25</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>50000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
        </nonDerivativeTransaction>
        <nonDerivativeTransaction>
            <transactionDate><value>2026-04-02</value></transactionDate>
            <transactionAmounts>
                <transactionShares><value>5000</value></transactionShares>
                <transactionPricePerShare><value>148.00</value></transactionPricePerShare>
                <transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode>
            </transactionAmounts>
            <postTransactionAmounts>
                <sharesOwnedFollowingTransaction><value>45000</value></sharesOwnedFollowingTransaction>
            </postTransactionAmounts>
        </nonDerivativeTransaction>
    </nonDerivativeTable>
</ownershipDocument>"""


SAMPLE_FORM4_XML_DIRECTOR = """<?xml version="1.0" encoding="UTF-8"?>
<ownershipDocument>
    <reportingOwner>
        <reportingOwnerId>
            <rptOwnerName>Jane Director</rptOwnerName>
        </reportingOwnerId>
        <reportingOwnerRelationship>
            <isDirector>1</isDirector>
            <isOfficer>0</isOfficer>
        </reportingOwnerRelationship>
    </reportingOwner>
    <nonDerivativeTable/>
</ownershipDocument>"""


class TestXMLParsing:
    """Test Form 4 XML parsing."""

    def setup_method(self):
        self.collector = InsiderTradesCollector(MagicMock())

    def test_extracts_owner_name(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "0001234-56-789"
        )
        assert all(t["insider_name"] == "John Smith" for t in txns)

    def test_extracts_officer_title(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "0001234-56-789"
        )
        assert txns[0]["insider_title"] == "Chief Executive Officer"

    def test_extracts_buy_trade(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "0001234-56-789"
        )
        buy = txns[0]
        assert buy["trade_type"] == "BUY"
        assert buy["shares"] == 10000
        assert buy["price"] == 150.25
        assert buy["value"] == 1502500.0
        assert buy["shares_owned_after"] == 50000

    def test_extracts_sell_trade(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "0001234-56-789"
        )
        sell = txns[1]
        assert sell["trade_type"] == "SELL"
        assert sell["shares"] == 5000
        assert sell["price"] == 148.00

    def test_extracts_transaction_date(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "0001234-56-789"
        )
        assert txns[0]["transaction_date"] == "2026-04-01"
        assert txns[1]["transaction_date"] == "2026-04-02"

    def test_officer_relationship(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "acc123"
        )
        assert txns[0]["relationship"] == "Officer"

    def test_director_relationship(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML_DIRECTOR, "MSFT", "2026-04-01", "acc456"
        )
        # No transactions, but filing record should exist
        assert len(txns) == 1
        assert txns[0]["relationship"] == "Director"
        assert txns[0]["insider_name"] == "Jane Director"

    def test_invalid_xml_returns_empty(self):
        txns = self.collector._extract_transactions_from_xml(
            "not valid xml <><>", "AAPL", "2026-04-01", "acc789"
        )
        assert txns == []

    def test_two_transactions_from_one_filing(self):
        txns = self.collector._extract_transactions_from_xml(
            SAMPLE_FORM4_XML, "AAPL", "2026-04-01", "acc123"
        )
        assert len(txns) == 2


class TestTransform:
    """Test data normalization and dedup."""

    def setup_method(self):
        self.collector = InsiderTradesCollector(MagicMock())

    def test_normalizes_symbol_to_upper(self):
        records = [
            {
                "symbol": "aapl",
                "filing_date": "2026-04-01",
                "trade_type": "BUY",
                "_accession": "acc1",
                "insider_name": "Test",
                "shares": 100,
            }
        ]
        result = self.collector.transform(records)
        assert result[0]["symbol"] == "AAPL"

    def test_dedup_by_composite_key(self):
        records = [
            {
                "symbol": "AAPL",
                "filing_date": "2026-04-01",
                "trade_type": "BUY",
                "_accession": "acc1",
                "insider_name": "Test",
                "shares": 100,
            },
            {
                "symbol": "AAPL",
                "filing_date": "2026-04-01",
                "trade_type": "BUY",
                "_accession": "acc1",
                "insider_name": "Test",
                "shares": 100,
            },  # duplicate
        ]
        result = self.collector.transform(records)
        assert len(result) == 1

    def test_different_trades_not_deduped(self):
        records = [
            {
                "symbol": "AAPL",
                "filing_date": "2026-04-01",
                "trade_type": "BUY",
                "_accession": "acc1",
                "insider_name": "Test",
                "shares": 100,
            },
            {
                "symbol": "AAPL",
                "filing_date": "2026-04-01",
                "trade_type": "SELL",
                "_accession": "acc1",
                "insider_name": "Test",
                "shares": 200,
            },
        ]
        result = self.collector.transform(records)
        assert len(result) == 2

    def test_skips_missing_symbol(self):
        records = [{"symbol": "", "filing_date": "2026-04-01"}]
        result = self.collector.transform(records)
        assert result == []

    def test_skips_missing_date(self):
        records = [{"symbol": "AAPL", "filing_date": ""}]
        result = self.collector.transform(records)
        assert result == []
