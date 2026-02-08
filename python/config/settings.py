from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    # Supabase Configuration
    # Mapping NEXT_PUBLIC_ vars for consistency with frontend
    supabase_url: str = Field(validation_alias="NEXT_PUBLIC_SUPABASE_URL")
    supabase_anon_key: str = Field(validation_alias="NEXT_PUBLIC_SUPABASE_ANON_KEY")
    supabase_service_role_key: str = Field(validation_alias="SUPABASE_SERVICE_ROLE_KEY")

    # API Configuration
    openclaw_api_url: str = "http://localhost:18789"
    
    # Telegram Configuration
    telegram_bot_token: str | None = None
    telegram_chat_id: str | None = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False
    )

settings = Settings()
