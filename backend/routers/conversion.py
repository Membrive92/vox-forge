"""Voice conversion endpoint (audio-to-audio)."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_convert_engine, get_profile_manager
from ..exceptions import InvalidSampleError, ProfileNotFound, UnsupportedFormatError
from ..paths import TEMP_DIR, VOICES_DIR
from ..services.convert_engine import ConvertEngine
from ..services.profile_manager import ProfileManager
from ..upload_utils import read_upload_safely, validate_audio_upload
from ..utils import cleanup_old_files

router = APIRouter(prefix="/convert", tags=["conversion"])


@router.post("", summary="Convert voice tone of an audio file")
async def convert_voice(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    profile_id: Optional[str] = Form(default=None),
    target_sample: Optional[UploadFile] = File(default=None),
    output_format: str = Form(default="mp3"),
    pitch_shift: float = Form(default=0.0),
    formant_shift: float = Form(default=0.0),
    bass_boost_db: float = Form(default=0.0),
    engine: ConvertEngine = Depends(get_convert_engine),
    profiles: ProfileManager = Depends(get_profile_manager),
) -> FileResponse:
    """Convert the voice tone of an uploaded audio file.

    Provide either a profile_id (uses the profile's voice sample as
    target) or a target_sample file directly. The source audio's
    speech content and prosody are preserved; only the timbre changes.
    """
    if output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {output_format}. Valid: {sorted(AUDIO_FORMATS)}"
        )

    validate_audio_upload(audio)

    # Save source audio to temp
    source_ext = Path(audio.filename or "").suffix or ".wav"
    source_filename = f"{str(uuid.uuid4())[:8]}_src{source_ext}"
    source_path = TEMP_DIR / source_filename
    source_content = await read_upload_safely(audio)
    source_path.write_bytes(source_content)

    # Resolve target voice sample
    target_path: Path | None = None

    if profile_id:
        profile = profiles.get(profile_id)
        if profile is None:
            source_path.unlink(missing_ok=True)
            raise ProfileNotFound(f"Profile not found: {profile_id}")
        if profile.sample_filename:
            candidate = VOICES_DIR / profile.sample_filename
            if candidate.exists():
                target_path = candidate

    if target_path is None and target_sample is not None:
        validate_audio_upload(target_sample)
        target_ext = Path(target_sample.filename or "").suffix or ".wav"
        target_filename = f"{str(uuid.uuid4())[:8]}_tgt{target_ext}"
        target_path = TEMP_DIR / target_filename
        target_content = await read_upload_safely(target_sample)
        target_path.write_bytes(target_content)

    if target_path is None:
        source_path.unlink(missing_ok=True)
        raise InvalidSampleError(
            "No target voice provided. Use profile_id (with voice sample) "
            "or upload a target_sample file."
        )

    try:
        output_path = await engine.convert(
            source_path=source_path,
            target_sample_path=target_path,
            output_format=output_format,
            pitch_shift=max(-12.0, min(12.0, pitch_shift)),
            formant_shift=max(-6.0, min(6.0, formant_shift)),
            bass_boost_db=max(-6.0, min(12.0, bass_boost_db)),
        )

        try:
            converted = AudioSegment.from_file(str(output_path))
            duration = round(len(converted) / 1000.0, 2)
        except Exception:
            duration = 0.0

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(output_path),
            media_type=f"audio/{output_format}",
            filename=f"voxforge_converted.{output_format}",
            headers={
                "X-Audio-Duration": str(duration),
                "X-Audio-Size": str(output_path.stat().st_size),
                "X-Audio-Engine": "openvoice-v2",
            },
        )
    finally:
        source_path.unlink(missing_ok=True)
        # Only clean target if it was a temp upload (not a profile sample)
        if target_path and TEMP_DIR in target_path.parents:
            target_path.unlink(missing_ok=True)
