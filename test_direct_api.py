#!/usr/bin/env python3
"""Test direct API call"""
import os
import httpx
from dotenv import load_dotenv

load_dotenv()

url = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

api_url = f"{url}/rest/v1/market_signals"

headers = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

data = {
    "symbol": "DIRECT",
    "signal_type": "technical",
    "direction": "bullish",
    "confidence": "0.88"
}

print(f"API URL: {api_url}")
print(f"Headers: apikey length={len(headers['apikey'])}")
print(f"Data: {data}")

try:
    response = httpx.post(api_url, json=data, headers=headers)
    print(f"\n✅ Status: {response.status_code}")
    print(f"Response: {response.text}")
    
    if response.status_code == 201:
        print("\n🎉 Direct API call successful!")
    else:
        print(f"\n❌ Failed with status {response.status_code}")
        
except Exception as e:
    print(f"\n❌ Error: {e}")
    import traceback
    traceback.print_exc()
