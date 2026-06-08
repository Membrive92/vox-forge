"""Maintenance utilities."""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

from .config import settings
from .paths import OUTPUT_DIR, TEMP_DIR

logger = logging.getLogger(__name__)


async def cleanup_old_files(max_age_hours: int | None = None) -> int:
    """Delete generated files older than ``max_age_hours``.

    ``TEMP_DIR`` is always disposable. ``OUTPUT_DIR`` also holds the
    *persisted* audio of chapter generations/takes and Studio renders,
    which the database references by path — those must never be deleted by
    an age sweep. We load the set of referenced paths first and skip them;
    if the database can't be read, we skip ``OUTPUT_DIR`` entirely rather
    than risk destroying a chapter's audio.

    Returns:
        Number of deleted files.
    """
    threshold = max_age_hours or settings.cleanup_max_age_hours
    now = datetime.now().timestamp()

    # TEMP_DIR: scratch files, always safe to purge by age.
    count = _purge_dir(TEMP_DIR, threshold, now, protected=frozenset())

    # OUTPUT_DIR: only purge files NOT referenced by the database.
    try:
        protected = await _referenced_paths()
    except Exception as exc:  # noqa: BLE001 — fail safe: never delete on doubt
        logger.warning(
            "Cleanup: skipping OUTPUT_DIR — could not load referenced paths: %s", exc
        )
    else:
        count += _purge_dir(OUTPUT_DIR, threshold, now, protected=protected)

    if count:
        logger.info("Cleanup: %d old files deleted", count)
    return count


async def _referenced_paths() -> frozenset[str]:
    """Resolved paths the database still points at (must be kept)."""
    from .database import get_db  # local import avoids any import cycle

    queries = (
        "SELECT file_path FROM generations WHERE file_path IS NOT NULL AND file_path != ''",
        "SELECT file_path FROM takes WHERE file_path IS NOT NULL AND file_path != ''",
        "SELECT output_path FROM studio_renders WHERE output_path IS NOT NULL AND output_path != ''",
        "SELECT source_path FROM studio_renders WHERE source_path IS NOT NULL AND source_path != ''",
    )
    paths: set[str] = set()
    async with get_db() as db:
        for sql in queries:
            cursor = await db.execute(sql)
            for row in await cursor.fetchall():
                value = row[0]
                if value:
                    paths.add(_resolve_str(Path(value)))
    return frozenset(paths)


def _resolve_str(path: Path) -> str:
    try:
        return str(path.resolve())
    except (OSError, RuntimeError):
        return str(path)


def _purge_dir(
    directory: Path, threshold: float, now: float, *, protected: frozenset[str]
) -> int:
    count = 0
    for file in _iter_files(directory):
        if _resolve_str(file) in protected:
            continue
        age_hours = (now - file.stat().st_mtime) / 3600
        if age_hours > threshold:
            file.unlink(missing_ok=True)
            count += 1
    return count


def _iter_files(directory: Path):
    if not directory.exists():
        return
    for entry in directory.iterdir():
        if entry.is_file():
            yield entry
