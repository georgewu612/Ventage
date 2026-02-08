#!/usr/bin/env python3
"""
Mock Data Generator CLI
Usage: python3 -m python.scripts.generate_mock_data --count 10
"""
import argparse
import logging

from python.etl.data_loader import DataLoader
from python.etl.mock_generator import (
    generate_dark_pool_orders,
    generate_earnings_forecasts,
    generate_insider_trades,
    generate_market_sentiment,
    generate_market_signals,
    generate_options_flow,
    generate_put_call_ratios,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Generate and load mock data into Supabase")
    parser.add_argument(
        "--signals", type=int, default=10, help="Number of market signals to generate"
    )
    parser.add_argument(
        "--options", type=int, default=15, help="Number of options flow records to generate"
    )
    parser.add_argument(
        "--darkpool", type=int, default=10, help="Number of dark pool orders to generate"
    )
    parser.add_argument(
        "--earnings", type=int, default=5, help="Number of earnings forecasts to generate"
    )
    parser.add_argument(
        "--sentiment", type=int, default=10, help="Number of sentiment records to generate"
    )
    parser.add_argument(
        "--insider", type=int, default=8, help="Number of insider trades to generate"
    )
    parser.add_argument(
        "--putcall", type=int, default=5, help="Number of put/call ratios to generate"
    )
    parser.add_argument(
        "--clear", action="store_true", help="Clear existing data before inserting"
    )
    
    args = parser.parse_args()
    
    loader = DataLoader()
    
    # Clear tables if requested
    if args.clear:
        logger.info("Clearing existing data...")
        tables = [
            "market_signals", "options_flow", "dark_pool_orders",
            "earnings_forecasts", "market_sentiment", "insider_trades",
            "put_call_ratios"
        ]
        for table in tables:
            try:
                loader.clear_table(table)
            except Exception as e:
                logger.warning(f"Could not clear {table}: {e}")
    
    # Generate and insert data
    logger.info("Generating mock data...")
    
    total_inserted = 0
    
    # Market signals
    signals = generate_market_signals(args.signals)
    count = loader.insert_records("market_signals", signals)
    total_inserted += count
    logger.info(f"✓ Inserted {count} market signals")
    
    # Options flow
    options = generate_options_flow(args.options)
    count = loader.insert_records("options_flow", options)
    total_inserted += count
    logger.info(f"✓ Inserted {count} options flow records")
    
    # Dark pool orders
    darkpool = generate_dark_pool_orders(args.darkpool)
    count = loader.insert_records("dark_pool_orders", darkpool)
    total_inserted += count
    logger.info(f"✓ Inserted {count} dark pool orders")
    
    # Earnings forecasts
    earnings = generate_earnings_forecasts(args.earnings)
    count = loader.insert_records("earnings_forecasts", earnings)
    total_inserted += count
    logger.info(f"✓ Inserted {count} earnings forecasts")
    
    # Market sentiment
    sentiment = generate_market_sentiment(args.sentiment)
    count = loader.insert_records("market_sentiment", sentiment)
    total_inserted += count
    logger.info(f"✓ Inserted {count} market sentiment records")
    
    # Insider trades
    insider = generate_insider_trades(args.insider)
    count = loader.insert_records("insider_trades", insider)
    total_inserted += count
    logger.info(f"✓ Inserted {count} insider trades")
    
    # Put/call ratios
    putcall = generate_put_call_ratios(args.putcall)
    count = loader.insert_records("put_call_ratios", putcall)
    total_inserted += count
    logger.info(f"✓ Inserted {count} put/call ratios")
    
    logger.info(f"\n🎉 Successfully inserted {total_inserted} total records!")


if __name__ == "__main__":
    main()
