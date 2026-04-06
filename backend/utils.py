"""Utilidades de mantenimiento."""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from .config import settings
from .paths import OUTPUT_DIR, TEMP_DIR

logger = logging.getLogger(__name__)


async def cleanup_old_files(max_age_hours: int | None = None) -> int:
    """Elimina archivos generados con más de ``max_age_hours`` de antigüedad.

    Returns:
        Número de archivos eliminados.
    """
    threshold = max_age_hours or settings.cleanup_max_age_hours
    now = datetime.now().timestamp()
    count = 0
    for directory in (OUTPUT_DIR, TEMP_DIR):
        for file in _iter_files(directory):
            age_hours = (now - file.stat().st_mtime) / 3600
            if age_hours > threshold:
                file.unlink(missing_ok=True)
                count += 1
    if count:
        logger.info("Limpieza: %d archivos antiguos eliminados", count)
    return count


def _iter_files(directory: Path):
    if not directory.exists():
        return
    for entry in directory.iterdir():
        if entry.is_file():
            yield entry
