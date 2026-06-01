from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache
from typing import Optional

class Settings(BaseSettings):
    app_env: str = Field(default="production", env="APP_ENV")
    app_name: str = Field(default="WaxPrep", env="APP_NAME")
    app_version: str = Field(default="1.0.0", env="APP_VERSION")
    app_secret_key: str = Field(default="change-this-in-production", env="APP_SECRET_KEY")
    debug: bool = Field(default=False, env="DEBUG")
    log_level: str = Field(default="INFO", env="LOG_LEVEL")

    whatsapp_access_token: str = Field(default="", env="WHATSAPP_ACCESS_TOKEN")
    whatsapp_phone_number_id: str = Field(default="", env="WHATSAPP_PHONE_NUMBER_ID")
    whatsapp_business_account_id: str = Field(default="", env="WHATSAPP_BUSINESS_ACCOUNT_ID")
    whatsapp_verify_token: str = Field(default="waxprep_verify", env="WHATSAPP_VERIFY_TOKEN")
    whatsapp_app_secret: str = Field(default="", env="WHATSAPP_APP_SECRET")

    telegram_bot_token: str = Field(default="", env="TELEGRAM_BOT_TOKEN")
    telegram_webhook_secret: str = Field(default="waxprep_telegram", env="TELEGRAM_WEBHOOK_SECRET")

    supabase_url: str = Field(default="", env="SUPABASE_URL")
    supabase_key: str = Field(default="", env="SUPABASE_KEY")
    supabase_service_key: str = Field(default="", env="SUPABASE_SERVICE_KEY")

    groq_api_key: str = Field(default="", env="GROQ_API_KEY")
    groq_api_key_2: str = Field(default="", env="GROQ_API_KEY_2")
    groq_api_key_3: str = Field(default="", env="GROQ_API_KEY_3")
    groq_primary_model: str = Field(default="llama-3.3-70b-versatile", env="GROQ_PRIMARY_MODEL")
    groq_fast_model: str = Field(default="llama-3.1-8b-instant", env="GROQ_FAST_MODEL")
    groq_max_tokens: int = Field(default=1024, env="GROQ_MAX_TOKENS")
    groq_temperature: float = Field(default=0.7, env="GROQ_TEMPERATURE")

    gemini_api_key: str = Field(default="", env="GEMINI_API_KEY")
    gemini_model: str = Field(default="gemini-1.5-flash", env="GEMINI_MODEL")

    redis_url: str = Field(default="redis://localhost:6379/0", env="REDIS_URL")

    sentry_dsn: Optional[str] = Field(default=None, env="SENTRY_DSN")

    session_timeout_minutes: int = Field(default=30, env="SESSION_TIMEOUT_MINUTES")
    spaced_rep_default_interval_days: int = Field(default=3, env="SPACED_REP_DEFAULT_INTERVAL_DAYS")

    @property
    def all_groq_keys(self) -> list:
        keys = [self.groq_api_key, self.groq_api_key_2, self.groq_api_key_3]
        return [k for k in keys if k]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
