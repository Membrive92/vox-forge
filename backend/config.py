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

    # CORS — local-first: only the local dev frontends may call the API
    # cross-origin. The app itself talks to the backend through Vite's
    # same-origin proxy, so this allowlist doesn't affect normal use; it
    # just stops arbitrary websites from scripting the local API. Override
    # via VOXFORGE_CORS_ORIGINS='["http://host:port", ...]' if needed.
    cors_origins: list[str] = [
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:3001", "http://127.0.0.1:3001",
        "http://localhost:5173", "http://127.0.0.1:5173",
    ]

    # Synthesis limits
    max_text_length: int = 500_000
    chunk_max_chars: int = 3_000  # Max chars per chunk for Edge-TTS

    # Maintenance
    cleanup_max_age_hours: int = 24

    # Service
    log_level: str = "INFO"


settings = Settings()
