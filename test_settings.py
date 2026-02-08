from python.config.settings import settings

print(f"Supabase URL: {settings.supabase_url}")
# Mask keys security
print(f"Anon Key Loaded: {bool(settings.supabase_anon_key)}")
print(f"Service Role Key Loaded: {bool(settings.supabase_service_role_key)}")
