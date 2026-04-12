"""Batch export: synthesize all chapters of a project into a ZIP file."""
from __future__ import annotations

import logging
import uuid
import zipfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..cancellation import create_cancellation_token
from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..paths import OUTPUT_DIR
from ..schemas import SynthesisRequest
from ..services import project_manager as pm
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/export", tags=["export"])


@router.post("/{project_id}", summary="Export all chapters as ZIP")
async def batch_export(
    project_id: str,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
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
    chapter_files: list[Path] = []

    try:
        for i, ch in enumerate(chapters):
            text = ch["text"]
            if not text or not text.strip():
                continue

            request = SynthesisRequest(
                text=text,
                voice_id=project["voice_id"],
                output_format=fmt,
                speed=project["speed"],
                pitch=project["pitch"],
                volume=project["volume"],
                profile_id=project["profile_id"],
                title=ch["title"],
                artist=project.get("description", ""),
                album=project["name"],
                track_number=i + 1,
            )

            result = await engine.synthesize(request, cancel_token=cancel_token)
            embed_metadata(
                result.path,
                AudioMetadata(
                    title=ch["title"],
                    artist=project.get("description", ""),
                    album=project["name"],
                    track_number=i + 1,
                ),
            )
            chapter_files.append(result.path)

        # Create ZIP
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for idx, fp in enumerate(chapter_files):
                ch = chapters[idx]
                safe_title = "".join(c if c.isalnum() or c in " _-" else "_" for c in ch["title"])
                arcname = f"{idx + 1:02d}_{safe_title}.{fmt}"
                zf.write(fp, arcname)

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(zip_path),
            media_type="application/zip",
            filename=f"{project['name']}_export.zip",
        )

    finally:
        for fp in chapter_files:
            fp.unlink(missing_ok=True)
