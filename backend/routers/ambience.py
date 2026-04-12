"""Ambient audio library + chapter mixer endpoints."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pydub import AudioSegment

from ..paths import AMBIENCE_DIR, OUTPUT_DIR
from ..services.ambience import (
    AmbienceTrack,
    delete_track,
    get_track,
    list_tracks,
    mix_narration_with_ambient,
    save_track,
)
from ..upload_utils import read_upload_safely, validate_audio_upload
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ambience", tags=["ambience"])


# ── Library CRUD ─────────────────────────────────────────────────────

@router.get("", summary="List ambient tracks")
async def list_ambience() -> dict:
    tracks = list_tracks()
    return {
        "tracks": [t.to_dict() for t in tracks],
        "count": len(tracks),
    }


@router.post("", summary="Upload an ambient track", status_code=201)
async def upload_ambience(
    audio: UploadFile = File(...),
    name: str = Form(...),
    tags: str = Form(default=""),
) -> dict:
    validate_audio_upload(audio)
    content = await read_upload_safely(audio)
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    track = save_track(
        name=name,
        audio_bytes=content,
        original_filename=audio.filename or "ambient.mp3",
        tags=tag_list,
    )
    return track.to_dict()


@router.get("/{track_id}", summary="Get ambient track metadata")
async def get_ambience(track_id: str) -> dict:
    track = get_track(track_id)
    if track is None:
        raise HTTPException(404, "Ambient track not found")
    return track.to_dict()


@router.delete("/{track_id}", summary="Delete an ambient track")
async def delete_ambience(track_id: str) -> dict:
    if not delete_track(track_id):
        raise HTTPException(404, "Ambient track not found")
    return {"status": "deleted", "id": track_id}


@router.get("/{track_id}/audio", summary="Stream the ambient audio file")
async def serve_ambience_audio(track_id: str) -> FileResponse:
    track = get_track(track_id)
    if track is None:
        raise HTTPException(404, "Ambient track not found")
    audio_path = AMBIENCE_DIR / track.filename
    if not audio_path.exists():
        raise HTTPException(404, "Audio file not found on disk")
    ext = audio_path.suffix.lstrip(".")
    return FileResponse(
        path=str(audio_path),
        media_type=f"audio/{ext}",
        filename=track.filename,
    )


# ── Mixer ────────────────────────────────────────────────────────────

class MixRequest(BaseModel):
    narration_path: str = Field(..., description="Path to the narration audio (from a generation)")
    ambient_track_id: str = Field(...)
    ambient_volume_db: float = Field(default=-15.0, ge=-40.0, le=0.0)
    fade_in_ms: int = Field(default=3000, ge=0, le=30000)
    fade_out_ms: int = Field(default=3000, ge=0, le=30000)
    output_format: str = Field(default="mp3")


@router.post("/mix", summary="Mix narration with ambient audio")
async def mix_audio(
    body: MixRequest,
    background_tasks: BackgroundTasks,
) -> FileResponse:
    """Overlay an ambient track under a narration audio file.

    The ambient loops to match narration length, is volume-adjusted,
    and fades in/out smoothly.
    """
    narration = Path(body.narration_path)
    if not narration.exists():
        raise HTTPException(400, "Narration audio file not found — generate the chapter first")

    try:
        output_path = await mix_narration_with_ambient(
            narration_path=narration,
            ambient_track_id=body.ambient_track_id,
            ambient_volume_db=body.ambient_volume_db,
            fade_in_ms=body.fade_in_ms,
            fade_out_ms=body.fade_out_ms,
            output_format=body.output_format,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    try:
        mixed = AudioSegment.from_file(str(output_path))
        duration = round(len(mixed) / 1000.0, 2)
    except Exception:
        duration = 0.0

    background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(output_path),
        media_type=f"audio/{body.output_format}",
        filename=f"mixed_{output_path.stem}.{body.output_format}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(output_path.stat().st_size),
            "X-Ambient-Track": body.ambient_track_id,
        },
    )


@router.post("/mix-chapter/{chapter_id}", summary="Mix a chapter's latest generation with ambient")
async def mix_chapter(
    chapter_id: str,
    ambient_track_id: str = Form(...),
    ambient_volume_db: float = Form(default=-15.0),
    fade_in_ms: int = Form(default=3000),
    fade_out_ms: int = Form(default=3000),
    background_tasks: BackgroundTasks = None,  # type: ignore[assignment]
) -> FileResponse:
    """Find the latest generation for a chapter and mix it with an ambient track."""
    from ..services import project_manager as pm

    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    gens = await pm.list_generations(chapter_id)
    gen = next((g for g in gens if g["status"] == "done" and g.get("file_path")), None)
    if gen is None:
        raise HTTPException(400, "No completed generation for this chapter — synthesize it first")

    narration_path = Path(gen["file_path"])
    if not narration_path.exists():
        raise HTTPException(400, "Narration audio file has been cleaned up — regenerate the chapter")

    fmt = gen.get("output_format", "mp3")

    try:
        output_path = await mix_narration_with_ambient(
            narration_path=narration_path,
            ambient_track_id=ambient_track_id,
            ambient_volume_db=max(-40.0, min(0.0, ambient_volume_db)),
            fade_in_ms=max(0, min(30000, fade_in_ms)),
            fade_out_ms=max(0, min(30000, fade_out_ms)),
            output_format=fmt,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    try:
        mixed = AudioSegment.from_file(str(output_path))
        duration = round(len(mixed) / 1000.0, 2)
    except Exception:
        duration = 0.0

    if background_tasks:
        background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(output_path),
        media_type=f"audio/{fmt}",
        filename=f"mixed_chapter_{chapter['sort_order']:02d}.{fmt}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(output_path.stat().st_size),
            "X-Ambient-Track": ambient_track_id,
        },
    )
