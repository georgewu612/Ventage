"""Options flow collector using CBOE delayed quotes.

Uses free CBOE delayed data as the default source. When Unusual Whales
API key is configured, switches to UW for richer unusual activity data.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from config.settings import get_settings
from etl.base import BaseCollector

# Core symbols that are always tracked
CORE_SYMBOLS = [
    "AAPL", "MSFT", "NVDA", "TSLA", "AMZN",
    "META", "GOOGL", "AMD", "NFLX", "PLTR",
]

# Maximum total symbols to query per run (CBOE rate limit friendly)
MAX_DYNAMIC_SYMBOLS = 30

CBOE_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


class OptionsFlowCollector(BaseCollector):
    """Collects options flow data from CBOE or Unusual Whales."""

    name = "options_flow"
    table = "options_flow"

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch options data from the best available source."""
        settings = get_settings()

        if settings.has_unusual_whales_config:
            return await self._collect_unusual_whales(settings.unusual_whales_api_key)

        return await self._collect_cboe()

    async def _get_dynamic_symbols(self) -> list[str]:
        """Build dynamic symbol list: core + recently active from insider trades."""
        symbols = set(CORE_SYMBOLS)

        try:
            # Query symbols with recent insider activity (last 3 days)
            result = (
                self.db.table("insider_trades")
                .select("symbol")
                .gte("filing_date", (datetime.now(timezone.utc) - timedelta(days=3)).strftime("%Y-%m-%d"))
                .execute()
            )
            if result.data:
                active_symbols = {row["symbol"] for row in result.data if row.get("symbol")}
                symbols.update(active_symbols)
        except Exception as exc:
            self.log.warning("dynamic_symbols_query_failed", error=str(exc))

        # Cap at MAX_DYNAMIC_SYMBOLS
        symbol_list = list(symbols)[:MAX_DYNAMIC_SYMBOLS]
        self.log.info("dynamic_symbols", count=len(symbol_list))
        return symbol_list

    async def _collect_cboe(self) -> list[dict[str, Any]]:
        """Fetch delayed options quotes from CBOE for dynamic symbols."""
        all_options: list[dict[str, Any]] = []
        symbols = await self._get_dynamic_symbols()

        async with httpx.AsyncClient(
            headers={
                "User-Agent": CBOE_USER_AGENT,
                "Accept": "application/json",
            },
            timeout=30.0,
        ) as client:
            for symbol in symbols:
                try:
                    options = await self._fetch_cboe_options(client, symbol)
                    all_options.extend(options)
                except Exception as exc:
                    self.log.warning(
                        "cboe_fetch_failed", symbol=symbol, error=str(exc)
                    )
                # CBOE rate limiting
                await asyncio.sleep(0.5)

        self.log.info("collected_raw", source="cboe", count=len(all_options))
        return all_options

    async def _fetch_cboe_options(
        self, client: httpx.AsyncClient, symbol: str
    ) -> list[dict[str, Any]]:
        """Fetch options chain for a single symbol from CBOE."""
        url = f"https://cdn.cboe.com/api/global/delayed_quotes/options/{symbol}.json"
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

        options_data = data.get("data", {}).get("options", [])
        results: list[dict[str, Any]] = []

        for opt in options_data:
            # CBOE returns nested option data
            option = opt.get("option", "")

            # Filter for high volume (unusual activity indicator)
            volume = opt.get("volume", 0) or 0
            open_interest = opt.get("open_interest", 0) or 0

            if volume < 100:
                continue

            # Determine call/put from option symbol
            option_type = "call" if "C" in option[len(symbol):] else "put"

            # CBOE does NOT return strike or expiration_date fields directly.
            # Both are encoded in the OCC option symbol: SYMBOL + YYMMDD + C/P + 8-digit strike
            # e.g. NKE260417P00039500 → exp=2026-04-17, strike=$39.50
            strike = opt.get("strike", 0)
            expiration = opt.get("expiration_date") or opt.get("expiration") or ""

            # Parse from OCC symbol if not provided by API
            if option and len(option) > len(symbol):
                suffix = option[len(symbol):]  # e.g. "260417C00150000"
                occ_match = re.match(r'(\d{6})[CP](\d{8})', suffix)
                if occ_match:
                    date_part = occ_match.group(1)   # "260417"
                    strike_part = occ_match.group(2)  # "00150000"
                    if not expiration:
                        expiration = f"20{date_part[:2]}-{date_part[2:4]}-{date_part[4:6]}"
                    if not strike:
                        strike = int(strike_part) / 1000  # 00150000 → 150.0

            # Calculate unusual score: volume/OI ratio capped at 100
            vol_oi_ratio = (volume / open_interest) if open_interest > 0 else 0
            unusual_score = min(100, int(vol_oi_ratio * 20))

            # Determine trade type heuristic
            bid = opt.get("bid", 0) or 0
            ask = opt.get("ask", 0) or 0
            last = opt.get("last_trade_price", 0) or 0
            mid = (bid + ask) / 2 if bid and ask else last

            if last >= ask and ask > 0:
                trade_type = "SWEEP"
            elif last >= mid and mid > 0:
                trade_type = "BLOCK"
            else:
                trade_type = "TRADE"

            results.append({
                "symbol": symbol,
                "option_type": option_type,
                "strike": strike,
                "expiration": expiration,
                "premium": last * volume * 100 if last else 0,
                "volume": volume,
                "open_interest": open_interest,
                "implied_volatility": opt.get("iv", None),
                "trade_type": trade_type,
                "unusual_score": unusual_score,
                "_source": "cboe",
            })

        # Sort by unusual_score descending, take top 20 per symbol
        results.sort(key=lambda x: x.get("unusual_score", 0), reverse=True)
        return results[:20]

    async def _collect_unusual_whales(self, api_key: str) -> list[dict[str, Any]]:
        """Fetch options flow from Unusual Whales API."""
        all_options: list[dict[str, Any]] = []

        async with httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json",
            },
            timeout=30.0,
        ) as client:
            try:
                url = "https://api.unusualwhales.com/api/option-trades/flow"
                resp = await client.get(url, params={"limit": 200})
                resp.raise_for_status()
                data = resp.json()

                for trade in data.get("data", []):
                    symbol = trade.get("underlying_symbol", "")

                    all_options.append({
                        "symbol": symbol,
                        "option_type": trade.get("put_call", "call").lower(),
                        "strike": float(trade.get("strike_price", 0)),
                        "expiration": trade.get("expires_date", ""),
                        "premium": float(trade.get("premium", 0)),
                        "volume": int(trade.get("volume", 0)),
                        "open_interest": int(trade.get("open_interest", 0)),
                        "implied_volatility": float(trade.get("iv", 0)) if trade.get("iv") else None,
                        "trade_type": trade.get("trade_type", "TRADE"),
                        "unusual_score": int(trade.get("unusual_score", 0)) if trade.get("unusual_score") else None,
                        "_source": "unusual_whales",
                    })
            except Exception as exc:
                self.log.error("unusual_whales_failed", error=str(exc))

        self.log.info("collected_raw", source="unusual_whales", count=len(all_options))
        return all_options

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Normalize options flow records."""
        normalized = []
        seen: set[str] = set()

        for record in raw_records:
            if not record.get("symbol"):
                continue

            dedup_key = (
                f"{record['symbol']}|{record.get('option_type', '')}"
                f"|{record.get('strike', '')}|{record.get('expiration', '')}|{record.get('volume', '')}"
            )
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            clean = {
                "symbol": record["symbol"].upper(),
                "option_type": record.get("option_type", "call"),
                "strike": float(record.get("strike", 0)),
                "expiration": record["expiration"],
                "premium": float(record.get("premium", 0)),
                "volume": int(record.get("volume", 0)),
                "open_interest": int(record.get("open_interest", 0)),
                "implied_volatility": record.get("implied_volatility"),
                "trade_type": record.get("trade_type"),
                "unusual_score": record.get("unusual_score"),
            }
            normalized.append(clean)

        return normalized

    async def load(self, records: list[dict[str, Any]]) -> int:
        """Insert options flow records into Supabase."""
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
