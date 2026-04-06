"""Application configuration via environment variables."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central VoxForge configuration.

    All options can be overridden via environment variables with the
    ``VOXFORGE_`` prefix. Example: ``VOXFORGE_CORS_ORIGINS='["http://localhost:3000"]'``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="VOXFORGE_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Paths
    base_dir: Path = Path(__file__).parent.parent
    data_subdir: str = "data"

    # CORS (restrict in production)
    cors_origins: list[str] = ["*"]

    # Synthesis limits
    max_text_length: int = 500_000
    chunk_max_chars: int = 3_000  # Max chars per chunk for Edge-TTS

    # Maintenance
    cleanup_max_age_hours: int = 24

    # Service
    log_level: str = "INFO"


settings = Settings()
