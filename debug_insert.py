#!/usr/bin/env python3
"""Debug script to test data insertion"""
import traceback
from python.etl.data_loader import DataLoader
from python.etl.mock_generator import generate_market_signals

try:
    print("Generating 1 market signal...")
    signals = generate_market_signals(1)
    signal = signals[0]
    
    print(f"\nSignal data:")
    print(f"  Symbol: {signal.symbol}")
    print(f"  Direction: {signal.direction}")
    print(f"  Confidence: {signal.confidence}")
    
    # Convert to dict
    data = signal.model_dump(mode='json', exclude_none=True)
    print(f"\nSerialized data:")
    for key, value in data.items():
        print(f"  {key}: {value} ({type(value).__name__})")
    
    print("\nInitializing data loader...")
    loader = DataLoader()
    
    print("Inserting signal...")
    count = loader.insert_records("market_signals", [signal])
    
    print(f"\n✅ Success! Inserted {count} record(s)")
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    print(f"\nFull traceback:")
    traceback.print_exc()
