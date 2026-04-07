"""Voice catalog and audio sample endpoints."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..catalogs import SUPPORTED_VOICES, VoiceMeta
from ..dependencies import get_profile_manager
from ..exceptions import InvalidSampleError, ProfileNotFound, SampleNotFound
from ..paths import VOICES_DIR
from ..schemas import SampleUploadResponse
from ..services.profile_manager import ProfileManager
from ..services.tts_engine import TTSEngine

router = APIRouter(prefix="/voices", tags=["voices"])

_ALLOWED_SAMPLE_TYPES: set[str] = {
    "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
    "audio/ogg", "audio/flac",
}
_MEDIA_TYPES: dict[str, str] = {
    "wav": "audio/wav", "mp3": "audio/mpeg",
    "ogg": "audio/ogg", "flac": "audio/flac",
}


@router.get("", summary="List curated voices")
async def list_voices() -> dict[str, dict[str, VoiceMeta]]:
    return SUPPORTED_VOICES


@router.get("/all", summary="List all Edge-TTS voices")
async def list_all_voices() -> dict[str, list[dict[str, str]]]:
    return await TTSEngine.discover_voices()


@router.post(
    "/upload-sample",
    summary="Upload voice sample",
    response_model=SampleUploadResponse,
)
async def upload_voice_sample(
    sample: UploadFile = File(...),
    profile_id: Optional[str] = Form(default=None),
    profiles: ProfileManager = Depends(get_profile_manager),
) -> SampleUploadResponse:
    """Upload an audio sample; optionally attach it to a profile."""
    ext = Path(sample.filename or "").suffix or ".wav"
    filename = f"{str(uuid.uuid4())[:8]}{ext}"
    filepath = VOICES_DIR / filename

    content = await sample.read()
    filepath.write_bytes(content)

    duration: float | None = None
    channels = 1
    sample_rate = 44100
    bit_depth = 16

    try:
        import shutil

        if not shutil.which("ffprobe"):
            raise FileNotFoundError("ffprobe not found")
        audio = AudioSegment.from_file(str(filepath))
        duration = round(len(audio) / 1000.0, 1)
        channels = audio.channels
        sample_rate = audio.frame_rate
        bit_depth = audio.sample_width * 8
    except Exception:
        # ffmpeg not installed — store the file but skip audio analysis
        pass

    if profile_id:
        try:
            await profiles.attach_sample(profile_id, filename, duration)
        except ProfileNotFound:
            # Keep the sample on disk even if the profile doesn't exist.
            pass

    return SampleUploadResponse(
        filename=filename,
        duration_seconds=duration,
        channels=channels,
        sample_rate=sample_rate,
        bit_depth=bit_depth,
        size_kb=round(len(content) / 1024, 1),
        profile_id=profile_id,
    )


@router.get("/samples/{filename}", summary="Serve voice sample")
async def get_voice_sample(filename: str) -> FileResponse:
    filepath = VOICES_DIR / filename
    if not filepath.exists():
        raise SampleNotFound("Sample not found")
    ext = filepath.suffix.lstrip(".")
    return FileResponse(str(filepath), media_type=_MEDIA_TYPES.get(ext, "audio/wav"))
