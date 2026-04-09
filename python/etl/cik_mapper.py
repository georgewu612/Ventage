"""CIK-to-Ticker mapper using SEC's company_tickers.json.

Downloads the full SEC company registry once per day and provides
fast in-memory CIK-to-ticker lookups for all US public companies.
"""

from __future__ import annotations

import time
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()

SEC_USER_AGENT = "Ventage/1.0 (ventage-app; contact@ventage.app)"

# Cache refresh interval: 24 hours
CACHE_TTL_SECONDS = 86400


class CIKTickerMapper:
    """Maps SEC CIK numbers to stock tickers using SEC's official registry."""

    _cik_to_ticker: dict[str, str] = {}
    _ticker_to_cik: dict[str, str] = {}
    _last_refresh: float = 0

    @classmethod
    async def get_ticker(cls, cik: str) -> str | None:
        """Look up ticker by CIK number. Returns None if not found."""
        await cls._ensure_loaded()
        # Normalize CIK: strip leading zeros for lookup
        normalized = cik.lstrip("0")
        return cls._cik_to_ticker.get(normalized)

    @classmethod
    async def get_cik(cls, ticker: str) -> str | None:
        """Look up CIK by ticker symbol. Returns None if not found."""
        await cls._ensure_loaded()
        return cls._ticker_to_cik.get(ticker.upper())

    @classmethod
    async def get_all_tickers(cls) -> set[str]:
        """Return all known ticker symbols."""
        await cls._ensure_loaded()
        return set(cls._ticker_to_cik.keys())

    @classmethod
    async def _ensure_loaded(cls) -> None:
        """Load or refresh the mapping if stale."""
        now = time.time()
        if cls._cik_to_ticker and (now - cls._last_refresh) < CACHE_TTL_SECONDS:
            return
        await cls._refresh()

    @classmethod
    async def _refresh(cls) -> None:
        """Download and parse SEC company_tickers.json."""
        url = "https://www.sec.gov/files/company_tickers.json"
        log = logger.bind(component="cik_mapper")

        try:
            async with httpx.AsyncClient(
                headers={"User-Agent": SEC_USER_AGENT},
                timeout=30.0,
            ) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data: dict[str, Any] = resp.json()

            cik_to_ticker: dict[str, str] = {}
            ticker_to_cik: dict[str, str] = {}

            for _key, entry in data.items():
                cik_str = str(entry.get("cik_str", ""))
                ticker = str(entry.get("ticker", "")).upper()
                if cik_str and ticker:
                    cik_to_ticker[cik_str] = ticker
                    ticker_to_cik[ticker] = cik_str

            cls._cik_to_ticker = cik_to_ticker
            cls._ticker_to_cik = ticker_to_cik
            cls._last_refresh = time.time()

            log.info("cik_mapper_refreshed", companies=len(cik_to_ticker))

        except Exception as exc:
            log.error("cik_mapper_refresh_failed", error=str(exc))
            # Keep stale data if refresh fails
            if not cls._cik_to_ticker:
                raise
