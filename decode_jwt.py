#!/usr/bin/env python3
"""Decode JWT to verify service role"""
import os
import json
import base64
from dotenv import load_dotenv

load_dotenv()

service_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

print(f"Service key length: {len(service_key)}")
print(f"First 50 chars: {service_key[:50]}")
print(f"Last 10 chars: ...{service_key[-10:]}")

# Try to decode JWT
try:
    # JWT format: header.payload.signature
    parts = service_key.split('.')
    print(f"\nJWT has {len(parts)} parts (should be 3)")
    
    if len(parts) == 3:
        # Decode payload (add padding if needed)
        payload = parts[1]
        # Add padding
        payload += '=' * (4 - len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload)
        data = json.loads(decoded)
        
        print(f"\n✅ JWT Decoded successfully:")
        print(json.dumps(data, indent=2))
        
        if 'role' in data:
            print(f"\n🔑 Role: {data['role']}")
            if data['role'] == 'service_role':
                print("✅ Role is correct!")
            else:
                print(f"❌ Role should be 'service_role' but is '{data['role']}'")
        else:
            print("❌ No role field in JWT!")
            
except Exception as e:
    print(f"\n❌ Failed to decode JWT: {e}")
    import traceback
    traceback.print_exc()
