"""Voice laboratory endpoints for audio manipulation."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS
from ..exceptions import InvalidSampleError, UnsupportedFormatError
from ..paths import TEMP_DIR
from ..services.voice_lab_engine import (
    BUILTIN_PRESETS,
    VoiceLabEngine,
    VoiceLabParams,
    VoicePreset,
    generate_random_preset,
)
from ..upload_utils import read_upload_safely, validate_audio_upload
from ..utils import cleanup_old_files

router = APIRouter(prefix="/voice-lab", tags=["voice-lab"])

_engine = VoiceLabEngine()


class PresetResponse(BaseModel):
    name: str
    description: str
    category: str
    params: dict


class PresetsListResponse(BaseModel):
    presets: list[PresetResponse]


def _preset_to_response(p: VoicePreset) -> PresetResponse:
    return PresetResponse(
        name=p.name,
        description=p.description,
        category=p.category,
        params={
            "noise_reduction": p.params.noise_reduction,
            "pitch_semitones": p.params.pitch_semitones,
            "formant_shift": p.params.formant_shift,
            "bass_boost_db": p.params.bass_boost_db,
            "warmth_db": p.params.warmth_db,
            "compression": p.params.compression,
            "reverb": p.params.reverb,
            "speed": p.params.speed,
        },
    )


@router.get("/presets", summary="List built-in voice presets", response_model=PresetsListResponse)
async def list_presets() -> PresetsListResponse:
    """Return all built-in voice presets organized by category."""
    return PresetsListResponse(
        presets=[_preset_to_response(p) for p in BUILTIN_PRESETS],
    )


@router.get("/presets/random", summary="Generate a random voice preset", response_model=PresetResponse)
async def random_preset() -> PresetResponse:
    """Generate a random RPG-style voice preset with name and parameters."""
    return _preset_to_response(generate_random_preset())


@router.post("/process", summary="Process audio with voice lab effects")
async def process_audio(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    noise_reduction: float = Form(default=0),
    pitch_semitones: float = Form(default=0),
    formant_shift: float = Form(default=0),
    bass_boost_db: float = Form(default=0),
    warmth_db: float = Form(default=0),
    compression: float = Form(default=0),
    reverb: float = Form(default=0),
    speed: float = Form(default=1.0),
    output_format: str = Form(default="mp3"),
) -> FileResponse:
    """Apply voice lab effects to an uploaded audio file.

    All parameters are optional — only non-zero values produce changes.
    Processing is CPU-based and fast (~5s for 20 minutes of audio).
    """
    if output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {output_format}. Valid: {sorted(AUDIO_FORMATS)}"
        )

    validate_audio_upload(audio)

    ext = Path(audio.filename or "").suffix or ".wav"
    input_filename = f"{str(uuid.uuid4())[:8]}_input{ext}"
    input_path = TEMP_DIR / input_filename
    content = await read_upload_safely(audio)
    input_path.write_bytes(content)

    params = VoiceLabParams(
        noise_reduction=max(0, min(100, noise_reduction)),
        pitch_semitones=max(-12, min(12, pitch_semitones)),
        formant_shift=max(-6, min(6, formant_shift)),
        bass_boost_db=max(-6, min(12, bass_boost_db)),
        warmth_db=max(-3, min(6, warmth_db)),
        compression=max(0, min(100, compression)),
        reverb=max(0, min(100, reverb)),
        speed=max(0.5, min(2.0, speed)),
    )

    try:
        try:
            output_path = await _engine.process(input_path, params, output_format)
        except Exception as exc:
            raise InvalidSampleError(
                f"Could not process audio: the file may be corrupted or in an unsupported format. ({exc})"
            ) from exc

        try:
            processed = AudioSegment.from_file(str(output_path))
            duration = round(len(processed) / 1000.0, 2)
        except Exception:
            duration = 0.0

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(output_path),
            media_type=f"audio/{output_format}",
            filename=f"voxforge_lab.{output_format}",
            headers={
                "X-Audio-Duration": str(duration),
                "X-Audio-Size": str(output_path.stat().st_size),
                "X-Audio-Engine": "voice-lab",
            },
        )
    finally:
        input_path.unlink(missing_ok=True)
