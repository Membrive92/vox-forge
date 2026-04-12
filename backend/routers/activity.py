"""User-facing activity feed: recent generations, disk usage, translated errors."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Query

from ..database import get_db
from ..logging_config import APP_JSONL_FILE
from ..paths import DATA_DIR, OUTPUT_DIR, TEMP_DIR

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/activity", tags=["activity"])

_ERROR_TRANSLATIONS: dict[str, str] = {
    "synthesis_failed": "Synthesis failed — the audio engine encountered an error",
    "profile_not_found": "A voice profile was not found — it may have been deleted",
    "unsupported_format": "An unsupported audio format was requested",
    "invalid_sample": "An uploaded audio file was corrupted or unreadable",
    "unsupported_voice": "A selected voice was not available",
}

_TAIL_BYTES = 256 * 1024


@router.get("", summary="User-facing activity feed")
async def get_activity(
    limit: int = Query(default=20, ge=1, le=100),
) -> dict:
    """Return recent activity for the user dashboard.

    Includes: recent generations, disk usage, and recent errors
    translated into user-friendly language.
    """
    generations = await _recent_generations(limit)
    disk = _disk_usage()
    errors = _recent_errors(minutes=120)

    return {
        "generations": generations,
        "disk": disk,
        "errors": errors,
    }


async def _recent_generations(limit: int) -> list[dict]:
    """Fetch recent generation records from SQLite."""
    try:
        async with get_db() as db:
            cursor = await db.execute(
                """SELECT g.id, g.status, g.engine, g.duration, g.chunks_total,
                          g.chunks_done, g.error, g.created_at, g.output_format,
                          c.title AS chapter_title, p.name AS project_name
                   FROM generations g
                   JOIN chapters c ON g.chapter_id = c.id
                   JOIN projects p ON c.project_id = p.id
                   ORDER BY g.created_at DESC
                   LIMIT ?""",
                (limit,),
            )
            rows = await cursor.fetchall()
            return [dict(r) for r in rows]
    except Exception:
        return []


def _disk_usage() -> dict:
    """Calculate disk space used by VoxForge data directories."""
    def dir_size(path: Path) -> int:
        if not path.exists():
            return 0
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())

    output_bytes = dir_size(OUTPUT_DIR)
    temp_bytes = dir_size(TEMP_DIR)
    voices_bytes = dir_size(DATA_DIR / "voices")
    logs_bytes = dir_size(DATA_DIR / "logs")
    jobs_bytes = dir_size(DATA_DIR / "jobs")
    db_path = DATA_DIR / "voxforge.db"
    db_bytes = db_path.stat().st_size if db_path.exists() else 0

    total = output_bytes + temp_bytes + voices_bytes + logs_bytes + jobs_bytes + db_bytes

    def fmt(b: int) -> str:
        if b < 1024:
            return f"{b} B"
        if b < 1024 * 1024:
            return f"{b / 1024:.1f} KB"
        return f"{b / (1024 * 1024):.1f} MB"

    return {
        "total": fmt(total),
        "total_bytes": total,
        "output": fmt(output_bytes),
        "voices": fmt(voices_bytes),
        "logs": fmt(logs_bytes),
        "temp": fmt(temp_bytes),
        "jobs": fmt(jobs_bytes),
        "database": fmt(db_bytes),
    }


def _recent_errors(minutes: int = 120) -> list[dict]:
    """Extract user-relevant errors from the JSONL log.

    Filters for domain errors (codes we recognize) and translates
    them. Ignores internal errors the user can't act on.
    """
    if not APP_JSONL_FILE.exists():
        return []

    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    size = APP_JSONL_FILE.stat().st_size
    read_bytes = min(size, _TAIL_BYTES)

    try:
        with APP_JSONL_FILE.open("rb") as fh:
            if read_bytes < size:
                fh.seek(-read_bytes, os.SEEK_END)
            raw = fh.read().decode("utf-8", errors="replace")
    except Exception:
        return []

    lines = raw.splitlines()
    if read_bytes < size and lines:
        lines = lines[1:]

    errors: list[dict] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        ts = obj.get("ts", "")
        if ts < cutoff:
            continue
        if obj.get("level") != "ERROR":
            continue

        msg = obj.get("msg", "")
        rid = obj.get("rid", "-")

        # Try to extract a domain error code from the message
        friendly = msg
        for code, translation in _ERROR_TRANSLATIONS.items():
            if code in msg.lower():
                friendly = translation
                break

        # Skip noisy internal errors the user can't do anything about
        if "Unhandled exception" in msg and not any(c in msg.lower() for c in _ERROR_TRANSLATIONS):
            friendly = "An unexpected error occurred — check with the developer if it persists"

        errors.append({
            "timestamp": ts[:19].replace("T", " "),
            "message": friendly,
            "request_id": rid,
        })

    return errors[-20:]  # Last 20 errors max
