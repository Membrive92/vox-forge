"""Studio module — audio editor + video renderer.

Endpoints:
- ``GET  /api/studio/sources``        list editable chapter generations
- ``POST /api/studio/edit``           apply a queue of edit operations
- ``GET  /api/studio/audio``          serve an audio file for wavesurfer.js
- ``POST /api/studio/transcribe``     speech-to-text → SRT (Phase B.1)
- ``POST /api/studio/upload-cover``   upload cover image for video render (Phase B.2)
- ``POST /api/studio/render-video``   compose MP4 via ffmpeg (Phase B.2)
- ``GET  /api/studio/renders``        list persisted renders (Phase B.2)
- ``DELETE /api/studio/renders/{id}`` remove a render record (Phase B.2)
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse

import aiosqlite

from ..catalogs import AUDIO_FORMATS
from ..database import get_db
from ..dependencies import get_transcriber, get_video_renderer
from ..exceptions import InvalidSampleError, SampleNotFound, UnsupportedFormatError
from ..paths import JOBS_DIR, OUTPUT_DIR, STUDIO_COVERS_DIR, STUDIO_DIR
from ..schemas import (
    CoverUploadResponse,
    RenderVideoRequest,
    SrtEntry,
    StudioEditRequest,
    StudioRender,
    StudioRendersResponse,
    StudioSource,
    StudioSourcesResponse,
    TranscribeRequest,
    TranscribeResponse,
)
from ..services import studio_store
from ..services.audio_editor import EditOperation, apply_operations
from ..services.transcriber import Transcriber
from ..services.video_renderer import VideoRenderer
from ..upload_utils import read_upload_safely, validate_image_upload

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
    # A chapter lists at most one source: its ``active_generation_id``
    # (explicitly chosen) or else the newest "done" generation. Older
    # takes are still reachable via the multi-take selector in the
    # chapter card + the Recent Renders scope filter.
    async with get_db() as db:
        cursor = await db.execute(
            """SELECT g.id, g.file_path, g.duration, g.created_at,
                      g.chapter_id,
                      c.title     AS chapter_title,
                      c.project_id,
                      c.active_generation_id,
                      p.name      AS project_name
               FROM generations g
               JOIN chapters c ON c.id = g.chapter_id
               JOIN projects p ON p.id = c.project_id
               WHERE g.status = 'done'
                 AND g.file_path IS NOT NULL
                 AND g.file_path != ''
               ORDER BY g.created_at DESC"""
        )
        rows: list[aiosqlite.Row] = await cursor.fetchall()

    # Bucket rows per chapter, preferring the active one; fall back to
    # newest (rows are already DESC by created_at).
    per_chapter: dict[str, aiosqlite.Row] = {}
    for row in rows:
        cid = row["chapter_id"]
        active_id = row["active_generation_id"]
        if active_id and row["id"] == active_id:
            per_chapter[cid] = row
        elif cid not in per_chapter:
            per_chapter[cid] = row
    rows = list(per_chapter.values())

    for row in rows:
        path = Path(row["file_path"])
        if not path.exists() or not _is_within_allowed_roots(path):
            continue
        sources.append(
            StudioSource(
                id=row["id"],
                kind="chapter",
                project_id=row["project_id"],
                chapter_id=row["chapter_id"],
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
    """Apply ``operations`` to ``source_path`` and return the new file.

    When ``chapter_id`` is provided the output is also persisted to
    ``studio_renders`` (kind="audio") so the Workbench can discover
    "N edited versions" of a chapter and the Recent Renders panel
    surfaces it automatically.
    """
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

    # Duration of the resulting audio so the Workbench can show "2.3s"
    # next to each edited version without a second HEAD request.
    try:
        from pydub import AudioSegment
        duration_s = float(len(AudioSegment.from_file(str(output)))) / 1000.0
    except Exception:  # noqa: BLE001
        duration_s = 0.0

    # Only persist when the caller linked the edit to a chapter — free
    # ad-hoc edits (someone trimming an ambient sample) stay throwaway.
    if request.chapter_id:
        await studio_store.create_render(
            kind="audio",
            source_path=str(source.resolve()),
            output_path=str(output.resolve()),
            operations=json.dumps([op.model_dump() for op in request.operations]),
            project_id=request.project_id,
            chapter_id=request.chapter_id,
            duration_s=duration_s,
            size_bytes=output.stat().st_size,
        )

    logger.info(
        "Studio edit: %s -> %s (%d ops, chapter=%s)",
        source.name, output.name, len(ops), request.chapter_id or "-",
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


@router.post(
    "/transcribe",
    summary="Transcribe a Studio source audio file to SRT",
    response_model=TranscribeResponse,
)
async def transcribe(
    request: TranscribeRequest,
    transcriber: Transcriber = Depends(get_transcriber),
) -> TranscribeResponse:
    """Run faster-whisper on ``source_path`` and return the SRT + parsed entries."""
    source = Path(request.source_path)
    if not _is_within_allowed_roots(source):
        raise InvalidSampleError("Source path is outside allowed directories")
    if not source.exists() or not source.is_file():
        raise SampleNotFound("Source audio not found")

    result = await transcriber.transcribe_async(source, language=request.language)
    entries = [
        SrtEntry(index=s.index, start_s=s.start, end_s=s.end, text=s.text)
        for s in result.segments
    ]
    logger.info(
        "Studio transcribe: %s -> %s (%d segments, %s)",
        source.name, result.srt_path.name, len(entries), result.engine,
    )
    return TranscribeResponse(
        srt_path=str(result.srt_path.resolve()),
        duration_s=result.duration_s,
        word_count=result.word_count,
        language=result.language,
        engine=result.engine,
        entries=entries,
    )


@router.post(
    "/upload-cover",
    summary="Upload a cover image for video rendering",
    response_model=CoverUploadResponse,
)
async def upload_cover(cover: UploadFile = File(...)) -> CoverUploadResponse:
    validate_image_upload(cover)
    ext = Path(cover.filename or "").suffix.lower() or ".png"
    if ext not in (".png", ".jpg", ".jpeg", ".webp"):
        ext = ".png"
    filename = f"cover_{str(uuid.uuid4())[:12]}{ext}"
    filepath = STUDIO_COVERS_DIR / filename

    STUDIO_COVERS_DIR.mkdir(parents=True, exist_ok=True)
    content = await read_upload_safely(cover)
    filepath.write_bytes(content)

    logger.info("Cover uploaded: %s (%d bytes)", filename, len(content))
    return CoverUploadResponse(
        filename=filename,
        path=str(filepath.resolve()),
        size_kb=round(len(content) / 1024, 1),
        content_type=cover.content_type or "application/octet-stream",
    )


@router.post("/render-video", summary="Render an MP4 from audio + cover or slideshow")
async def render_video(
    request: RenderVideoRequest,
    renderer: VideoRenderer = Depends(get_video_renderer),
) -> FileResponse:
    audio_path = Path(request.audio_path)
    cover_path = Path(request.cover_path) if request.cover_path else None
    subs_path = Path(request.subtitles_path) if request.subtitles_path else None

    # Build a list of image objects (if slideshow mode) and use it to
    # gate the cover_path requirement.
    from ..schemas import VideoImage as _VideoImage  # local to avoid cycle
    image_list: list[_VideoImage] | None = request.images if request.images else None

    if not image_list and cover_path is None:
        raise InvalidSampleError("Either cover_path or images must be provided")

    # All input paths must live inside one of the allowed Studio roots —
    # same guard as /edit and /audio so a request cannot pull arbitrary
    # files off disk and ship them through ffmpeg. Slideshow images go
    # through the same check individually.
    paths_to_check: list[Path] = [audio_path]
    if cover_path is not None:
        paths_to_check.append(cover_path)
    if subs_path is not None:
        paths_to_check.append(subs_path)
    if image_list:
        paths_to_check.extend(Path(img.path) for img in image_list)
    for p in paths_to_check:
        if not _is_within_allowed_roots(p):
            raise InvalidSampleError("Input path is outside allowed directories")

    result = await renderer.render(
        audio_path=audio_path,
        cover_path=cover_path,
        subtitles_path=subs_path,
        options=request.options,
        images=image_list,
    )

    # Persist a history row so the FE can show recent renders.
    await studio_store.create_render(
        kind="video",
        source_path=str(audio_path.resolve()),
        output_path=str(result.output_path.resolve()),
        operations=json.dumps(request.options.model_dump()),
        project_id=request.project_id,
        chapter_id=request.chapter_id,
        duration_s=result.duration_s,
        size_bytes=result.size_bytes,
    )

    logger.info(
        "Studio video rendered: %s (%.1fs, %d KB)",
        result.output_path.name, result.duration_s, result.size_bytes // 1024,
    )
    return FileResponse(
        str(result.output_path),
        media_type="video/mp4",
        filename=result.output_path.name,
        headers={
            "X-Video-Duration": f"{result.duration_s:.2f}",
            "X-Video-Size": str(result.size_bytes),
            "X-Video-Resolution": request.options.resolution,
        },
    )


@router.get(
    "/renders",
    summary="List persisted renders (audio edits + videos)",
    response_model=StudioRendersResponse,
)
async def list_renders(
    kind: str | None = Query(default=None, description="audio | video"),
    chapter_id: str | None = Query(default=None, description="Filter by chapter"),
    limit: int = Query(default=50, ge=1, le=200),
) -> StudioRendersResponse:
    if kind is not None and kind not in ("audio", "video"):
        raise InvalidSampleError(f"Invalid kind: {kind}. Valid: audio, video")
    rows = await studio_store.list_renders(kind=kind, chapter_id=chapter_id, limit=limit)
    renders = [StudioRender(**row) for row in rows]
    return StudioRendersResponse(renders=renders, count=len(renders))


@router.delete("/renders/{render_id}", summary="Delete a render record")
async def delete_render(render_id: str) -> dict[str, str]:
    row = await studio_store.get_render(render_id)
    if not row:
        raise SampleNotFound(f"Render not found: {render_id}")
    # Best-effort delete of the actual file; the row is authoritative.
    output = Path(row["output_path"])
    if output.exists() and _is_within_allowed_roots(output):
        try:
            output.unlink()
        except OSError as exc:  # noqa: PERF203
            logger.warning("Could not delete render file %s: %s", output, exc)
    await studio_store.delete_render(render_id)
    return {"status": "deleted", "id": render_id}


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
