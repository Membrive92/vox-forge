"""Batch export: synthesize all chapters of a project into a ZIP file."""
from __future__ import annotations

import logging
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse

from ..cancellation import create_cancellation_token
from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..paths import OUTPUT_DIR
from ..schemas import SynthesisRequest
from ..services import project_manager as pm
from ..services import studio_store
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])


def _safe_title(raw: str) -> str:
    return "".join(c if c.isalnum() or c in " _-" else "_" for c in raw)


@router.post("/{project_id}", summary="Export all chapters as ZIP")
async def batch_export(
    project_id: str,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Build a ZIP with the best available audio per chapter.

    Preference order for each chapter:
      1. Latest Studio edit (``studio_renders`` kind="audio") — the user's
         polished version.
      2. Latest completed ``generation`` file on disk — cheaper than
         re-synthesizing and preserves exactly what the user heard.
      3. Fresh synthesis — only when neither of the above exists.

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
        # (1) Latest Studio edit for this chapter
        edits = await studio_store.list_renders(kind="audio", chapter_id=ch["id"], limit=1)
        if edits:
            out = Path(edits[0]["output_path"])
            if out.exists():
                return out

        # (2) Latest completed generation
        gens = await pm.list_generations(ch["id"])
        for gen in gens:
            if gen.get("status") == "done" and gen.get("file_path"):
                out = Path(gen["file_path"])
                if out.exists():
                    return out

        # (3) Fresh synthesis
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

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx, (ch, fp) in enumerate(resolved):
                # The chapter's output extension now comes from the
                # resolved file (studio edits may be different format).
                ext = fp.suffix.lstrip(".") or fmt
                arcname = f"audio/{idx + 1:02d}_{_safe_title(ch['title'])}.{ext}"
                zf.write(fp, arcname)
            for video in project_videos:
                vpath = Path(video["output_path"])
                if not vpath.exists():
                    continue
                zf.write(vpath, f"videos/{vpath.name}")

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(zip_path),
            media_type="application/zip",
            filename=f"{project['name']}_export.zip",
        )

    finally:
        for fp in temp_files:
            fp.unlink(missing_ok=True)
