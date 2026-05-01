from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
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

    @field_validator("telegram_chat_id", "telegram_bot_token", mode="before")
    @classmethod
    def _strip_telegram_fields(cls, v: str) -> str:
        """Strip accidental whitespace/newlines that Railway can inject."""
        return str(v).strip() if v else v

    # Frontend URL for CORS (production)
    frontend_url: str = ""

    # OpenAI API (for AI-driven analysis reports)
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"  # gpt-4o-mini for cost efficiency, gpt-4o for quality

    # Alpha Vantage (for TradingAgents market data)
    alphavantage_api_key: str = ""

    # External data APIs (optional — ETL collectors degrade gracefully)
    polygon_api_key: str = ""
    unusual_whales_api_key: str = ""
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""

    @property
    def has_alpaca_config(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_secret_key)

    @property
    def has_supabase_config(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)

    @property
    def has_openai_config(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def has_polygon_config(self) -> bool:
        return bool(self.polygon_api_key)

    @property
    def has_unusual_whales_config(self) -> bool:
        return bool(self.unusual_whales_api_key)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
