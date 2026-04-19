"""WallStreetCN live news collector — 7x24 financial news feed.

Uses the public WallStreetCN API to fetch real-time financial news
from multiple channels (global, US stock, etc.).  No authentication
required.
"""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, datetime
from typing import Any

import httpx

from etl.base import BaseCollector

WSCN_API_BASE = "https://api.wallstreetcn.com/apiv1/content/lives"

# Channels to monitor — covers global macro + US equity news
CHANNELS = [
    "global-channel",
    "us-stock-channel",
]

# How many items to fetch per channel per run
ITEMS_PER_CHANNEL = 30

# HTML tag stripper
_HTML_TAG_RE = re.compile(r"<[^>]+>")


class NewsCollector(BaseCollector):
    """Collects live financial news from WallStreetCN."""

    name = "market_news"
    table = "market_news"

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch recent news items from all configured channels."""
        all_items: list[dict[str, Any]] = []

        async with httpx.AsyncClient(
            headers={
                "User-Agent": "Ventage/1.0",
                "Accept": "application/json",
            },
            timeout=30.0,
        ) as client:
            for channel in CHANNELS:
                try:
                    items = await self._fetch_channel(client, channel)
                    all_items.extend(items)
                except Exception as exc:
                    self.log.warning(
                        "channel_fetch_failed",
                        channel=channel,
                        error=str(exc),
                    )
                # Be polite between channel requests
                await asyncio.sleep(1)

        self.log.info("collected_raw", count=len(all_items))
        return all_items

    async def _fetch_channel(
        self,
        client: httpx.AsyncClient,
        channel: str,
    ) -> list[dict[str, Any]]:
        """Fetch news from a single WallStreetCN channel."""
        resp = await client.get(
            WSCN_API_BASE,
            params={
                "channel": channel,
                "limit": ITEMS_PER_CHANNEL,
                "client": "pc",
            },
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("code") != 20000:
            self.log.warning(
                "wscn_api_error",
                channel=channel,
                code=data.get("code"),
                message=data.get("message"),
            )
            return []

        items: list[dict[str, Any]] = []
        for item in data.get("data", {}).get("items", []):
            # Use content_text (plain text) if available, fall back to
            # stripping HTML from content field
            content = item.get("content_text") or ""
            if not content:
                html = item.get("content") or ""
                content = _HTML_TAG_RE.sub("", html).strip()

            # Also grab extended content if present
            content_more = item.get("content_more") or ""
            if content_more:
                more_text = _HTML_TAG_RE.sub("", content_more).strip()
                if more_text:
                    content = f"{content}\n{more_text}"

            if not content:
                continue

            title = (item.get("title") or "").strip()
            display_time = item.get("display_time", 0)

            items.append(
                {
                    "source": "wallstreetcn",
                    "source_id": str(item.get("id", "")),
                    "title": title or None,
                    "content": content[:2000],  # Cap content length
                    "channels": item.get("channels", []),
                    "importance": item.get("score", 1),
                    "symbols": item.get("symbols", []),
                    "published_at": datetime.fromtimestamp(display_time, tz=UTC).isoformat()
                    if display_time
                    else datetime.now(UTC).isoformat(),
                    "_channel": channel,  # Internal, stripped in transform
                }
            )

        self.log.info(
            "channel_fetched",
            channel=channel,
            count=len(items),
        )
        return items

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Deduplicate and clean news records."""
        seen: set[str] = set()
        results: list[dict[str, Any]] = []

        for record in raw_records:
            source_id = record.get("source_id", "")
            if not source_id or source_id in seen:
                continue
            seen.add(source_id)

            clean = {
                "source": record["source"],
                "source_id": source_id,
                "title": record.get("title"),
                "content": record.get("content", ""),
                "channels": record.get("channels", []),
                "importance": record.get("importance", 1),
                "symbols": record.get("symbols", []),
                "published_at": record["published_at"],
            }
            results.append(clean)

        return results

    async def load(self, records: list[dict[str, Any]]) -> int:
        """Upsert news records into Supabase (skip duplicates)."""
        if not records:
            return 0

        batch_size = 50
        total_loaded = 0

        for i in range(0, len(records), batch_size):
            batch = records[i : i + batch_size]
            try:
                result = (
                    self.db.table(self.table)
                    .upsert(batch, on_conflict="source,source_id")
                    .execute()
                )
                total_loaded += len(result.data) if result.data else 0
            except Exception as exc:
                self.log.error("load_batch_failed", batch_index=i, error=str(exc))

        return total_loaded
