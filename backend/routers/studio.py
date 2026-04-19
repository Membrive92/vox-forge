"""Studio module — audio editor.

Endpoints:
- ``GET  /api/studio/sources``   list editable chapter generations
- ``POST /api/studio/edit``      apply a queue of edit operations
- ``GET  /api/studio/audio``     serve an audio file for wavesurfer.js
"""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

import aiosqlite

from ..catalogs import AUDIO_FORMATS
from ..database import get_db
from ..exceptions import InvalidSampleError, SampleNotFound, UnsupportedFormatError
from ..paths import JOBS_DIR, OUTPUT_DIR, STUDIO_DIR
from ..schemas import (
    StudioEditRequest,
    StudioSource,
    StudioSourcesResponse,
)
from ..services.audio_editor import EditOperation, apply_operations

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/studio", tags=["studio"])

_MEDIA_TYPES: dict[str, str] = {
    "wav": "audio/wav", "mp3": "audio/mpeg",
    "ogg": "audio/ogg", "flac": "audio/flac",
}

_ALLOWED_ROOTS: tuple[Path, ...] = (
    OUTPUT_DIR.resolve(),
    STUDIO_DIR.resolve(),
    JOBS_DIR.resolve(),
)


def _is_within_allowed_roots(target: Path) -> bool:
    """Return True if ``target`` resolves inside any allowed studio root."""
    try:
        resolved = target.resolve()
    except (OSError, RuntimeError):
        return False
    for root in _ALLOWED_ROOTS:
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


@router.get(
    "/sources",
    summary="List editable audio sources",
    response_model=StudioSourcesResponse,
)
async def list_sources() -> StudioSourcesResponse:
    """Return chapter generations that have a usable audio file on disk."""
    sources: list[StudioSource] = []
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT g.id, g.file_path, g.duration, g.created_at,
                      c.title AS chapter_title,
                      p.name  AS project_name
               FROM generations g
               JOIN chapters c ON c.id = g.chapter_id
               JOIN projects p ON p.id = c.project_id
               WHERE g.status = 'done'
                 AND g.file_path IS NOT NULL
                 AND g.file_path != ''
               ORDER BY g.created_at DESC"""
        )
        rows: list[aiosqlite.Row] = await cursor.fetchall()

    for row in rows:
        path = Path(row["file_path"])
        if not path.exists() or not _is_within_allowed_roots(path):
            continue
        sources.append(
            StudioSource(
                id=row["id"],
                kind="chapter",
                project_name=row["project_name"],
                chapter_title=row["chapter_title"],
                source_path=str(path.resolve()),
                duration_s=float(row["duration"] or 0),
                created_at=row["created_at"],
            )
        )

    return StudioSourcesResponse(sources=sources, count=len(sources))


@router.post("/edit", summary="Apply a batch of edit operations")
async def edit_audio(request: StudioEditRequest) -> FileResponse:
    """Apply ``operations`` to ``source_path`` and return the new file."""
    if request.output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {request.output_format}"
        )

    source = Path(request.source_path)
    if not _is_within_allowed_roots(source):
        raise InvalidSampleError("Source path is outside allowed directories")
    if not source.exists() or not source.is_file():
        raise SampleNotFound("Source audio not found")

    ops = [EditOperation(type=op.type, params=dict(op.params)) for op in request.operations]
    output = apply_operations(source, ops, output_format=request.output_format)

    logger.info(
        "Studio edit: %s -> %s (%d ops)",
        source.name, output.name, len(ops),
    )
    return FileResponse(
        str(output),
        media_type=_MEDIA_TYPES.get(request.output_format, "audio/mpeg"),
        filename=output.name,
        headers={
            "X-Source-Path": source.name,
            "X-Operations-Count": str(len(ops)),
        },
    )


@router.get("/audio", summary="Serve an audio file by absolute path")
async def get_audio(path: str = Query(..., min_length=1)) -> FileResponse:
    """Serve audio so wavesurfer.js can stream it.

    Only paths inside ``data/output/``, ``data/studio/``, or ``data/jobs/``
    are accepted. Path traversal is blocked via ``Path.resolve`` +
    ``relative_to`` checks against each allowed root.
    """
    target = Path(path)
    if not _is_within_allowed_roots(target):
        raise SampleNotFound("Audio not found")

    resolved = target.resolve()
    if not resolved.exists() or not resolved.is_file():
        raise SampleNotFound("Audio not found")

    ext = resolved.suffix.lstrip(".").lower()
    return FileResponse(
        str(resolved),
        media_type=_MEDIA_TYPES.get(ext, "audio/mpeg"),
    )
