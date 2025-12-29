import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:postgres@localhost:5432/escalada_dev",
    )
    log_sql: bool = os.getenv("LOG_SQL", "false").lower() == "true"

    class Config:
        env_file = ".env"


settings = Settings()
