from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Ventage API"
    app_env: str = "development"
    app_port: int = 8000

    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""

    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Frontend URL for CORS (production)
    frontend_url: str = ""

    # External data APIs (optional — ETL collectors degrade gracefully)
    polygon_api_key: str = ""
    unusual_whales_api_key: str = ""

    @property
    def has_supabase_config(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def has_polygon_config(self) -> bool:
        return bool(self.polygon_api_key)

    @property
    def has_unusual_whales_config(self) -> bool:
        return bool(self.unusual_whales_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
