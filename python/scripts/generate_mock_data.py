from __future__ import annotations

import json
import random
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from supabase import create_client

PYTHON_ROOT = Path(__file__).resolve().parents[1]
if str(PYTHON_ROOT) not in sys.path:
    sys.path.insert(0, str(PYTHON_ROOT))

from config.settings import get_settings

SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL", "AMD", "NFLX", "PLTR"]
SOURCES = ["reddit", "twitter", "news"]
MODULES = ["options_flow", "insider_trades", "market_sentiment", "dark_pool"]
SIGNAL_TYPES = ["technical", "fundamental", "sentiment", "composite"]
BULLISH_SUMMARIES = ["大量看涨期权流入", "内部人士连续增持", "社交情绪显著转强", "暗池出现大额买单"]
BEARISH_SUMMARIES = ["看跌期权成交放量", "内部人士减持加速", "社交情绪明显转弱", "暗池出现大额卖单"]
NAMES = ["Tim Cook", "Satya Nadella", "Jensen Huang", "Mark Zuckerberg", "Sundar Pichai"]
TITLES = ["CEO", "CFO", "CTO", "Director", "VP"]


def _generate_factor(module: str, direction: str) -> dict[str, object]:
    factor = {
        "unusual_volume": random.choice([True, False]),
        "premium_spent": random.randint(200000, 5000000),
        "call_put_ratio": round(random.uniform(0.5, 4.2), 2),
    }
    if module == "insider_trades":
        factor["insider_net_value"] = random.randint(-3000000, 3000000)
    elif module == "market_sentiment":
        factor["sentiment_score"] = round(random.uniform(-1, 1), 3)
    elif module == "dark_pool":
        factor["dark_pool_value"] = random.randint(500000, 12000000)

    if direction == "bearish" and factor["call_put_ratio"] > 1:
        factor["call_put_ratio"] = round(random.uniform(0.4, 0.95), 2)
    return factor


def _generate_market_signal() -> dict[str, object]:
    direction = random.choice(["bullish", "bearish"])
    module = random.choice(MODULES)
    summary_pool = BULLISH_SUMMARIES if direction == "bullish" else BEARISH_SUMMARIES

    created_at = datetime.now(UTC) - timedelta(
        days=random.randint(0, 6), hours=random.randint(0, 23), minutes=random.randint(0, 59)
    )
    score = random.randint(20, 95)

    return {
        "symbol": random.choice(SYMBOLS),
        "signal_type": random.choice(SIGNAL_TYPES),
        "direction": direction,
        "confidence": round(score / 100, 4),
        "analysis": random.choice(summary_pool),
        "factors": {"module": module, "signal_score": score, **_generate_factor(module, direction)},
        "valid_until": (created_at + timedelta(hours=24)).isoformat().replace("+00:00", "Z"),
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
    }


def _generate_option_row() -> dict[str, object]:
    created_at = datetime.now(UTC) - timedelta(
        days=random.randint(0, 6), hours=random.randint(0, 23)
    )
    return {
        "symbol": random.choice(SYMBOLS),
        "option_type": random.choice(["call", "put"]),
        "strike": round(random.uniform(50, 600), 2),
        "expiration": (created_at.date() + timedelta(days=random.randint(7, 120))).isoformat(),
        "premium": round(random.uniform(100000, 8000000), 2),
        "volume": random.randint(100, 30000),
        "open_interest": random.randint(1000, 80000),
        "implied_volatility": round(random.uniform(0.15, 0.95), 4),
        "unusual_score": round(random.uniform(20, 99), 2),
        "trade_type": random.choice(["sweep", "block", "split"]),
        "sentiment": random.choice(["bullish", "bearish"]),
        "created_at": created_at.isoformat().replace("+00:00", "Z"),
    }


def _generate_insider_row() -> dict[str, object]:
    tx_date = datetime.now(UTC).date() - timedelta(days=random.randint(1, 30))
    filing_date = tx_date + timedelta(days=random.randint(1, 5))
    shares = random.randint(1000, 120000)
    price = round(random.uniform(20, 500), 4)
    return {
        "symbol": random.choice(SYMBOLS),
        "insider_name": random.choice(NAMES),
        "insider_title": random.choice(TITLES),
        "relationship": random.choice(["Officer", "Director", "10% Owner"]),
        "trade_type": random.choice(["BUY", "SELL"]),
        "shares": shares,
        "price": price,
        "value": round(shares * price, 2),
        "shares_owned_after": random.randint(20000, 3000000),
        "filing_date": filing_date.isoformat(),
        "transaction_date": tx_date.isoformat(),
        "sec_form": "Form 4",
        "footnotes": None,
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def _generate_sentiment_row() -> dict[str, object]:
    sentiment_score = round(random.uniform(-1, 1), 4)
    return {
        "symbol": random.choice(SYMBOLS),
        "source": random.choice(SOURCES),
        "sentiment_score": sentiment_score,
        "magnitude": round(abs(sentiment_score) + random.uniform(0.05, 0.5), 4),
        "volume": random.randint(500, 20000),
        "keywords": {"bullish": random.randint(5, 100), "bearish": random.randint(5, 100)},
        "sample_posts": {"post1": "Sample post content", "post2": "Another post"},
        "analysis_window": random.choice(["1h", "24h", "7d"]),
        "created_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def _save_json(path: Path, payload: list[dict[str, object]]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    settings = get_settings()

    market_signals = [_generate_market_signal() for _ in range(50)]
    options_flow = [_generate_option_row() for _ in range(30)]
    insider_trades = [_generate_insider_row() for _ in range(30)]
    market_sentiment = [_generate_sentiment_row() for _ in range(30)]

    base_dir = Path(__file__).resolve().parent
    _save_json(base_dir / "mock_market_signals.json", market_signals)
    _save_json(base_dir / "mock_options_flow.json", options_flow)
    _save_json(base_dir / "mock_insider_trades.json", insider_trades)
    _save_json(base_dir / "mock_market_sentiment.json", market_sentiment)

    print("Generated mock data files:")
    print(f"- market_signals: {len(market_signals)}")
    print(f"- options_flow: {len(options_flow)}")
    print(f"- insider_trades: {len(insider_trades)}")
    print(f"- market_sentiment: {len(market_sentiment)}")

    if settings.has_supabase_config:
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        inserted_signals = len(
            client.table("market_signals").insert(market_signals).execute().data or []
        )
        inserted_options = len(
            client.table("options_flow").insert(options_flow).execute().data or []
        )
        inserted_insider = len(
            client.table("insider_trades").insert(insider_trades).execute().data or []
        )
        inserted_sentiment = len(
            client.table("market_sentiment").insert(market_sentiment).execute().data or []
        )

        print("Inserted to Supabase:")
        print(f"- market_signals: {inserted_signals}")
        print(f"- options_flow: {inserted_options}")
        print(f"- insider_trades: {inserted_insider}")
        print(f"- market_sentiment: {inserted_sentiment}")
    else:
        print("Skipped Supabase insert: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")

    print("Sample market signal:")
    print(json.dumps(market_signals[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
