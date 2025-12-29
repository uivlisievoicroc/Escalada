import os
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """App settings loaded from env/.env (pydantic v2 style)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/escalada_dev",
    )
    log_sql: bool = os.getenv("LOG_SQL", "false").lower() == "true"


settings = Settings()
