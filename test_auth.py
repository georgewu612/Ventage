#!/usr/bin/env python3
"""Test service role authentication"""
from supabase import create_client
import os

# Load .env manually
from dotenv import load_dotenv
load_dotenv()

url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

print(f"URL: {url}")
print(f"Service key length: {len(service_key)}")
print(f"Service key starts with: {service_key[:50]}")

try:
    client = create_client(url, service_key)
    print("\n✅ Client created successfully")
    
    # Try a simple insert
    data = {
        "symbol": "TEST",
        "signal_type": "technical",
        "direction": "bullish",
        "confidence": 0.85,
        "analysis": "Test signal"
    }
    
    print(f"\nAttempting to insert: {data}")
    response = client.table("market_signals").insert(data).execute()
    
    print(f"\n✅ Success! Response:")
    print(response.data)
    
except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
