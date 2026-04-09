"""Reddit sentiment collector for tracked stock symbols.

Uses the public Reddit JSON API (no auth required) to fetch posts
from finance-related subreddits and analyze sentiment with TextBlob.
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timezone
from typing import Any

import httpx
from textblob import TextBlob

from etl.base import BaseCollector
from etl.cik_mapper import CIKTickerMapper

REDDIT_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"

# Finance-related subreddits to monitor
SUBREDDITS = ["wallstreetbets", "stocks", "investing", "options"]

# Valid tickers will be loaded dynamically from SEC registry
_valid_tickers: set[str] | None = None

# Common words that look like tickers but aren't
TICKER_BLACKLIST = {
    "A", "I", "AM", "AN", "AT", "BE", "BY", "DO", "GO", "HE",
    "IF", "IN", "IS", "IT", "ME", "MY", "NO", "OF", "ON", "OR",
    "SO", "TO", "UP", "US", "WE", "DD", "CEO", "IPO", "ETF",
    "ALL", "ARE", "CAN", "FOR", "HAS", "NOW", "OLD", "ONE",
    "OUT", "OWN", "PUT", "RUN", "SAY", "TWO", "WAY", "WHO",
    "BIG", "NEW", "TOP", "LOW", "HIGH", "BEST", "NEXT", "YOLO",
    "HOLD", "CALL", "GAIN", "LOSS", "SELL", "LONG", "SHORT",
}

# Pattern to match stock ticker mentions like $AAPL or standalone AAPL
TICKER_PATTERN = re.compile(r"\$([A-Z]{2,5})\b|(?<!\w)([A-Z]{2,5})(?!\w)")


class SentimentCollector(BaseCollector):
    """Collects posts from Reddit finance subreddits and analyzes sentiment."""

    name = "market_sentiment"
    table = "market_sentiment"

    async def collect(self) -> list[dict[str, Any]]:
        """Fetch recent posts from finance subreddits."""
        all_posts: list[dict[str, Any]] = []

        # Load valid tickers for extraction
        valid_tickers = await self._get_valid_tickers()
        self.log.info("valid_tickers_loaded", count=len(valid_tickers))

        async with httpx.AsyncClient(
            headers={"User-Agent": REDDIT_USER_AGENT},
            timeout=30.0,
            follow_redirects=True,
        ) as client:
            for subreddit in SUBREDDITS:
                try:
                    posts = await self._fetch_subreddit(client, subreddit, valid_tickers)
                    all_posts.extend(posts)
                except Exception as exc:
                    self.log.warning("subreddit_failed", subreddit=subreddit, error=str(exc))
                await asyncio.sleep(2)  # Respect Reddit rate limits

        self.log.info("collected_raw", posts=len(all_posts))
        return all_posts

    async def _fetch_subreddit(
        self,
        client: httpx.AsyncClient,
        subreddit: str,
        valid_tickers: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch hot + new posts from a subreddit."""
        posts: list[dict[str, Any]] = []

        for sort in ["hot", "new"]:
            url = f"https://old.reddit.com/r/{subreddit}/{sort}.json?limit=50"
            try:
                resp = await client.get(url)
                if resp.status_code == 403:
                    self.log.warning(
                        "reddit_blocked",
                        subreddit=subreddit,
                        sort=sort,
                        hint="Reddit blocks some cloud/datacenter IPs. Consider running locally or using a proxy.",
                    )
                    continue
                resp.raise_for_status()
            except httpx.HTTPStatusError as exc:
                self.log.warning("reddit_http_error", subreddit=subreddit, sort=sort, status=exc.response.status_code)
                continue
            await asyncio.sleep(1)  # Rate limit between requests
            data = resp.json()

            for child in data.get("data", {}).get("children", []):
                post = child.get("data", {})
                title = post.get("title", "")
                selftext = post.get("selftext", "")
                text = f"{title} {selftext}".strip()

                # Extract mentioned tickers
                tickers = self._extract_tickers(text, valid_tickers or set())
                if not tickers:
                    continue

                posts.append({
                    "subreddit": subreddit,
                    "title": title,
                    "selftext": selftext[:500],  # Truncate long posts
                    "text": text[:1000],
                    "score": post.get("score", 0),
                    "num_comments": post.get("num_comments", 0),
                    "created_utc": post.get("created_utc", 0),
                    "tickers": list(tickers),
                    "permalink": post.get("permalink", ""),
                })

        return posts

    async def _get_valid_tickers(self) -> set[str]:
        """Get all valid ticker symbols from SEC registry."""
        global _valid_tickers
        if _valid_tickers is None:
            _valid_tickers = await CIKTickerMapper.get_all_tickers()
        return _valid_tickers

    def _extract_tickers(self, text: str, valid_tickers: set[str]) -> set[str]:
        """Extract stock tickers mentioned in text, validated against SEC registry."""
        matches = TICKER_PATTERN.findall(text)
        tickers: set[str] = set()
        for dollar_match, plain_match in matches:
            ticker = dollar_match or plain_match
            if ticker not in TICKER_BLACKLIST and ticker in valid_tickers:
                tickers.add(ticker)
        return tickers

    def _analyze_sentiment(self, text: str) -> tuple[float, float]:
        """Analyze text sentiment using TextBlob. Returns (polarity, subjectivity)."""
        blob = TextBlob(text)
        return blob.sentiment.polarity, blob.sentiment.subjectivity

    def transform(self, raw_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Aggregate posts by symbol and compute sentiment metrics."""
        # Group posts by ticker
        by_symbol: dict[str, list[dict[str, Any]]] = {}
        for post in raw_records:
            for ticker in post.get("tickers", []):
                by_symbol.setdefault(ticker, []).append(post)

        # Compute aggregate sentiment per symbol
        now = datetime.now(timezone.utc)
        results: list[dict[str, Any]] = []

        for symbol, posts in by_symbol.items():
            polarities: list[float] = []
            bullish_count = 0
            bearish_count = 0
            sample_titles: dict[str, str] = {}

            for i, post in enumerate(posts):
                text = post.get("text", "")
                polarity, _ = self._analyze_sentiment(text)
                polarities.append(polarity)

                if polarity > 0.1:
                    bullish_count += 1
                elif polarity < -0.1:
                    bearish_count += 1

                if i < 3:
                    sample_titles[f"post{i + 1}"] = post.get("title", "")[:200]

            if not polarities:
                continue

            avg_polarity = sum(polarities) / len(polarities)
            magnitude = sum(abs(p) for p in polarities) / len(polarities)

            results.append({
                "symbol": symbol,
                "source": "reddit",
                "sentiment_score": round(avg_polarity, 4),
                "magnitude": round(magnitude, 4),
                "volume": len(posts),
                "keywords": {"bullish": bullish_count, "bearish": bearish_count},
                "sample_posts": sample_titles,
                "analysis_window": "1h",
                "created_at": now.isoformat(),
            })

        return results

    async def load(self, records: list[dict[str, Any]]) -> int:
        """Insert sentiment records into Supabase."""
        if not records:
            return 0

        try:
            result = self.db.table(self.table).insert(records).execute()
            return len(result.data) if result.data else 0
        except Exception as exc:
            self.log.error("load_failed", error=str(exc))
            return 0
