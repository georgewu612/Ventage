"""Base collector class for all ETL data sources."""

from __future__ import annotations

import abc
import time
from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

logger = structlog.get_logger()


class BaseCollector(abc.ABC):
    """Abstract base class for data collectors.

    Subclasses must implement `collect()` and `load()`.
    The `run()` method orchestrates: collect -> transform -> load.
    """

    name: str = "base"
    max_retries: int = 3
    retry_backoff: float = 2.0  # seconds, multiplied by attempt number

    def __init__(self, supabase_client: Any) -> None:
        self.db = supabase_client
        self.log = logger.bind(collector=self.name)

    @abc.abstractmethod
    async def collect(self) -> list[dict[str, Any]]:
        """Fetch raw data from external source. Returns list of raw records."""

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Transform raw records into normalized format. Override if needed."""
        return raw_records

    @abc.abstractmethod
    async def load(self, records: list[dict[str, Any]]) -> int:
        """Load normalized records into Supabase. Returns count of inserted rows."""

    async def run(self) -> dict[str, Any]:
        """Execute full ETL cycle: collect -> transform -> load."""
        started_at = datetime.now(timezone.utc)
        result = {
            "collector": self.name,
            "started_at": started_at.isoformat(),
            "status": "success",
            "collected": 0,
            "loaded": 0,
            "errors": [],
        }

        try:
            self.log.info("collecting")
            raw = await self._collect_with_retry()
            result["collected"] = len(raw)

            if not raw:
                self.log.info("no_data")
                return result

            self.log.info("transforming", count=len(raw))
            normalized = self.transform(raw)

            self.log.info("loading", count=len(normalized))
            loaded = await self.load(normalized)
            result["loaded"] = loaded

            elapsed = (datetime.now(timezone.utc) - started_at).total_seconds()
            self.log.info("completed", loaded=loaded, elapsed_s=round(elapsed, 2))

        except Exception as exc:
            result["status"] = "error"
            result["errors"].append(str(exc))
            self.log.error("failed", error=str(exc))

        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        return result

    async def _collect_with_retry(self) -> list[dict[str, Any]]:
        """Retry collection on transient failures."""
        last_exc: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                return await self.collect()
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as exc:
                last_exc = exc
                wait = self.retry_backoff * attempt
                self.log.warning("retry", attempt=attempt, wait_s=wait, error=str(exc))
                time.sleep(wait)
        raise RuntimeError(f"Collection failed after {self.max_retries} retries: {last_exc}")
