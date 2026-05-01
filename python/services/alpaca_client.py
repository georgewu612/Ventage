"""Alpaca data client — multi-timeframe (intraday) bars.

Used for 4h confirmation overlay on top of daily strategy signals.

Free tier (Basic plan) provides:
    - IEX feed only (covers most US equities, slight latency)
    - 60 days of historical 1m/5m/15m/1h bars
    - Real-time delayed by 15 min

API docs: https://docs.alpaca.markets/reference/stockbars

For production we'll switch to:
    - Alpaca Algo Trader Plus ($99/mo) — SIP feed + unlimited history
    - or Polygon (separate provider)

Public API:
    AlpacaClient(api_key, secret_key)
        .get_bars(symbol, timeframe, start, end) -> pd.DataFrame
        .get_4h_bars(symbol, lookback_days=14)   -> pd.DataFrame
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

UTC = timezone.utc

import httpx
import pandas as pd

logger = logging.getLogger(__name__)

BASE_URL = "https://data.alpaca.markets"


class AlpacaError(Exception):
    """Raised when Alpaca returns an error or auth fails."""


class AlpacaClient:
    """Thin wrapper around Alpaca Market Data v2 REST API."""

    def __init__(self, api_key: str, secret_key: str):
        if not api_key or not secret_key:
            raise AlpacaError("Alpaca API key and secret are required")
        self.api_key = api_key
        self.secret_key = secret_key
        self.headers = {
            "APCA-API-KEY-ID": api_key.strip(),
            "APCA-API-SECRET-KEY": secret_key.strip(),
            "accept": "application/json",
        }

    # ── Low-level fetch ───────────────────────────────────────────────────────

    def get_bars(
        self,
        symbol: str,
        timeframe: str = "1Hour",
        start: datetime | None = None,
        end: datetime | None = None,
        limit: int = 1000,
        feed: str = "iex",   # free tier
    ) -> pd.DataFrame:
        """Fetch OHLCV bars from Alpaca.

        Args:
            symbol: e.g. "NVDA"
            timeframe: Alpaca format — "1Min", "5Min", "15Min", "1Hour", "4Hour", "1Day"
            start: UTC datetime (default: 60 days ago)
            end: UTC datetime (default: now)
            limit: max bars to return (default 1000)
            feed: "iex" (free) or "sip" (paid)

        Returns:
            DataFrame indexed by timestamp with columns Open/High/Low/Close/Volume.
            Empty if no data.
        """
        if start is None:
            start = datetime.now(UTC) - timedelta(days=60)
        if end is None:
            end = datetime.now(UTC)

        url = f"{BASE_URL}/v2/stocks/{symbol.upper()}/bars"
        params = {
            "timeframe": timeframe,
            "start": start.isoformat().replace("+00:00", "Z"),
            "end": end.isoformat().replace("+00:00", "Z"),
            "limit": limit,
            "feed": feed,
            "adjustment": "split",
        }

        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(url, headers=self.headers, params=params)
                if resp.status_code == 401:
                    raise AlpacaError("Invalid Alpaca credentials (401)")
                if resp.status_code == 403:
                    raise AlpacaError(
                        f"Alpaca 403 — likely SIP feed requested on free plan: {resp.text[:200]}"
                    )
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPError as exc:
            raise AlpacaError(f"Alpaca request failed: {exc}") from exc

        bars = data.get("bars") or []
        if not bars:
            return pd.DataFrame()

        df = pd.DataFrame(bars)
        # Alpaca columns: t (timestamp), o, h, l, c, v, n, vw
        df = df.rename(
            columns={
                "t": "timestamp",
                "o": "Open",
                "h": "High",
                "l": "Low",
                "c": "Close",
                "v": "Volume",
            }
        )
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.set_index("timestamp").sort_index()
        return df[["Open", "High", "Low", "Close", "Volume"]]

    # ── Convenience: 4h bars ──────────────────────────────────────────────────

    def get_4h_bars(self, symbol: str, lookback_days: int = 14) -> pd.DataFrame:
        """Get 4-hour bars for the last N days.

        Built by aggregating 1Hour bars (Alpaca's "4Hour" timeframe is
        not always available on free tier, so 1H→4H aggregation is safer).
        """
        start = datetime.now(UTC) - timedelta(days=lookback_days)
        df_1h = self.get_bars(symbol, timeframe="1Hour", start=start, limit=1000)
        if df_1h.empty:
            return df_1h

        # Aggregate 1H → 4H using regular trading hours boundaries
        df_4h = (
            df_1h.resample("4h")
            .agg(
                {
                    "Open": "first",
                    "High": "max",
                    "Low": "min",
                    "Close": "last",
                    "Volume": "sum",
                }
            )
            .dropna()
        )
        return df_4h


# ── Module-level singleton ────────────────────────────────────────────────────

_client: AlpacaClient | None = None


def get_alpaca_client() -> AlpacaClient | None:
    """Return a shared client, or None if Alpaca isn't configured."""
    global _client
    if _client is not None:
        return _client

    from config.settings import get_settings
    s = get_settings()
    if not s.has_alpaca_config:
        logger.info("alpaca_not_configured")
        return None
    try:
        _client = AlpacaClient(s.alpaca_api_key, s.alpaca_secret_key)
        return _client
    except AlpacaError as exc:
        logger.warning("alpaca_client_init_failed: %s", exc)
        return None
