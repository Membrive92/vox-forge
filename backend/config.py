"""Configuración de la aplicación vía variables de entorno."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuración central de VoxForge.

    Todas las opciones pueden sobreescribirse vía entorno con prefijo
    ``VOXFORGE_``. Ejemplo: ``VOXFORGE_CORS_ORIGINS='["http://localhost:3000"]'``.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="VOXFORGE_",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Rutas
    base_dir: Path = Path(__file__).parent.parent
    data_subdir: str = "data"

    # CORS (en producción, restringir)
    cors_origins: list[str] = ["*"]

    # Límites de síntesis
    max_text_length: int = 500_000
    chunk_max_chars: int = 3_000  # Máx caracteres por chunk para Edge-TTS

    # Mantenimiento
    cleanup_max_age_hours: int = 24

    # Servicio
    log_level: str = "INFO"


settings = Settings()
