"""Batch export: synthesize all chapters of a project into a ZIP file."""
from __future__ import annotations

import asyncio
import logging
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from ..cancellation import create_cancellation_token
from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..paths import OUTPUT_DIR
from ..schemas import SynthesisRequest
from ..services import mastering
from ..services import project_manager as pm
from ..services import studio_store
from ..services.export_source import resolve_export_source
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])


def _safe_title(raw: str) -> str:
    return "".join(c if c.isalnum() or c in " _-" else "_" for c in raw)


def _build_zip(
    zip_path: Path,
    resolved: list[tuple[dict, Path]],
    project_videos: list[dict],
    default_fmt: str,
) -> None:
    """Write all chapter audio + project videos into ``zip_path``.

    Blocking (DEFLATE + disk I/O) — call via ``asyncio.to_thread`` so the
    event loop isn't frozen for the whole (potentially large) zip. Audio is
    already compressed, so STORED avoids wasted CPU for no size win.
    """
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_STORED) as zf:
        for idx, (ch, fp) in enumerate(resolved):
            ext = fp.suffix.lstrip(".") or default_fmt
            arcname = f"audio/{idx + 1:02d}_{_safe_title(ch['title'])}.{ext}"
            zf.write(fp, arcname)
        for video in project_videos:
            vpath = Path(video["output_path"])
            if not vpath.exists():
                continue
            zf.write(vpath, f"videos/{vpath.name}")


@router.get("/{project_id}", summary="Export all chapters as ZIP")
async def batch_export(
    project_id: str,
    http_request: Request,
    background_tasks: BackgroundTasks,
    master: bool = Query(
        default=False,
        description="Master every chapter (denoise + loudness + compressor) "
        "before bundling; already-mastered Studio edits are reused as-is.",
    ),
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Build a ZIP with the best available audio per chapter.

    GET (not POST) on purpose: the frontend triggers the download with a
    plain anchor so the browser streams the ZIP to disk, and anchors can
    only issue GET.

    The per-chapter preference order lives in
    ``services.export_source.resolve_export_source`` (UX-02) — the same
    helper the Workbench uses to display "this audio will export", so
    the label and the bundle can't diverge:
      1. Latest Studio edit (manual or one-click master).
      2. The chapter's active take, then the latest completed generation.
      3. Fresh synthesis — only when nothing usable exists on disk.

    With ``master=true`` every chapter is run through the mastering
    preset first (skipping Studio edits that already are masters).

    In addition, if the project has persisted video renders they are
    bundled under a ``videos/`` folder so the export is a complete
    project artefact, not just the raw narration.
    """
    project = await pm.get_project(project_id)
    if project is None:
        raise HTTPException(404, "Project not found")

    chapters = await pm.list_chapters(project_id)
    if not chapters:
        raise HTTPException(400, "Project has no chapters")

    fmt = project["output_format"]
    if fmt not in AUDIO_FORMATS:
        raise HTTPException(400, f"Unsupported format: {fmt}")

    cancel_token = create_cancellation_token(http_request)
    batch_id = str(uuid.uuid4())[:8]
    zip_path = OUTPUT_DIR / f"export_{batch_id}.zip"
    # Temporary files created just for this export (fresh syntheses).
    # Existing artefacts (studio edits, past generations) are NOT in here
    # so we don't delete them at the end.
    temp_files: list[Path] = []

    async def _resolve_audio(ch: dict, idx: int) -> Path:
        # Shared priority: Studio edit > active take > latest done
        # generation > fresh synthesis (services.export_source, UX-02).
        src = await resolve_export_source(ch)
        if src.path is not None:
            if not master or src.mastered:
                return src.path
            # Master the winning audio once and persist it as a render —
            # later exports (and the Workbench chip) reuse it for free.
            render = await mastering.master_to_render(
                src.path,
                project_id=project_id,
                chapter_id=ch["id"],
                output_format=fmt,
            )
            return Path(render["output_path"])

        # Fresh synthesis — nothing usable on disk for this chapter.
        request = SynthesisRequest(
            text=ch["text"],
            voice_id=project["voice_id"],
            output_format=fmt,
            speed=project["speed"],
            pitch=project["pitch"],
            volume=project["volume"],
            profile_id=project["profile_id"],
            title=ch["title"],
            artist=project.get("description", ""),
            album=project["name"],
            track_number=idx + 1,
        )
        result = await engine.synthesize(request, cancel_token=cancel_token)
        embed_metadata(
            result.path,
            AudioMetadata(
                title=ch["title"],
                artist=project.get("description", ""),
                album=project["name"],
                track_number=idx + 1,
            ),
        )
        temp_files.append(result.path)
        if master:
            # No persisted take to hang a render on — master the throwaway
            # synthesis in place and clean both files up after zipping.
            mastered_path = await mastering.apply_mastering(result.path, fmt)
            embed_metadata(
                mastered_path,
                AudioMetadata(
                    title=ch["title"],
                    artist=project.get("description", ""),
                    album=project["name"],
                    track_number=idx + 1,
                ),
            )
            temp_files.append(mastered_path)
            return mastered_path
        return result.path

    try:
        resolved: list[tuple[dict, Path]] = []
        for i, ch in enumerate(chapters):
            text = ch["text"]
            if not text or not text.strip():
                continue
            resolved.append((ch, await _resolve_audio(ch, i)))

        videos = await studio_store.list_renders(kind="video", limit=200)
        project_videos = [v for v in videos if v.get("project_id") == project_id]

        await asyncio.to_thread(_build_zip, zip_path, resolved, project_videos, fmt)

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(zip_path),
            media_type="application/zip",
            filename=f"{project['name']}_export.zip",
        )

    finally:
        cancel_token.finish()
        for fp in temp_files:
            fp.unlink(missing_ok=True)
