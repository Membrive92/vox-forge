"""Experimental endpoints for testing cross-lingual voice cloning.

These endpoints bypass the quality system (candidates, retries, text
normalization) for fast iteration. Not for production narration.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..exceptions import InvalidSampleError, UnsupportedFormatError
from ..paths import OUTPUT_DIR, TEMP_DIR
from ..services.tts_engine import TTSEngine
from ..upload_utils import read_upload_safely, validate_audio_upload
from ..utils import cleanup_old_files

router = APIRouter(prefix="/experimental", tags=["experimental"])

_ALLOWED_LANGUAGES = {"es", "en", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "ja", "hu", "ko"}


@router.post("/cross-lingual", summary="Cross-lingual voice cloning (experimental)")
async def cross_lingual_synthesis(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    voice_sample: UploadFile = File(...),
    language: str = Form(default="es"),
    output_format: str = Form(default="mp3"),
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Synthesize text in one language using a voice sample from another."""
    # Validate output format
    if output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {output_format}. Valid: {sorted(AUDIO_FORMATS)}"
        )

    # Validate language
    if language not in _ALLOWED_LANGUAGES:
        raise InvalidSampleError(
            f"Unsupported language: {language}. Valid: {sorted(_ALLOWED_LANGUAGES)}"
        )

    # Validate upload
    validate_audio_upload(voice_sample)

    # Save sample to temp with size limit
    sample_ext = Path(voice_sample.filename or "").suffix or ".wav"
    sample_filename = f"{str(uuid.uuid4())[:8]}_xling{sample_ext}"
    sample_path = TEMP_DIR / sample_filename
    sample_content = await read_upload_safely(voice_sample)
    sample_path.write_bytes(sample_content)

    file_id = str(uuid.uuid4())[:12]
    output_wav = TEMP_DIR / f"{file_id}_xling.wav"
    output_path = OUTPUT_DIR / f"{file_id}.{output_format}"

    try:
        clone = engine._get_clone_engine()
        await clone.raw_synthesize(
            text=text,
            speaker_wav=str(sample_path),
            language=language,
            output_path=output_wav,
        )

        # Convert format
        if output_format == "wav":
            output_wav.rename(output_path)
        else:
            fmt = AUDIO_FORMATS[output_format]
            audio = AudioSegment.from_wav(str(output_wav))
            audio.export(
                str(output_path),
                format=fmt["format"],
                codec=fmt["codec"],
                parameters=fmt["parameters"],
            )
            output_wav.unlink(missing_ok=True)

        try:
            result_audio = AudioSegment.from_file(str(output_path))
            duration = round(len(result_audio) / 1000.0, 2)
        except Exception:
            duration = 0.0

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(output_path),
            media_type=f"audio/{output_format}",
            filename=f"voxforge_xling.{output_format}",
            headers={
                "X-Audio-Duration": str(duration),
                "X-Audio-Engine": "xtts-v2-crosslingual",
                "X-Target-Language": language,
            },
        )

    finally:
        sample_path.unlink(missing_ok=True)
        output_wav.unlink(missing_ok=True)
