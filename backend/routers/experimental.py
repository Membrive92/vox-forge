"""Experimental endpoints for testing cross-lingual voice cloning.

These endpoints bypass the quality system (candidates, retries, text
normalization) for fast iteration. Not for production narration.
"""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..exceptions import SynthesisError
from ..paths import OUTPUT_DIR, TEMP_DIR

router = APIRouter(prefix="/experimental", tags=["experimental"])


@router.post("/cross-lingual", summary="Cross-lingual voice cloning (experimental)")
async def cross_lingual_synthesis(
    text: str = Form(...),
    voice_sample: UploadFile = File(...),
    language: str = Form(default="es"),
    output_format: str = Form(default="mp3"),
) -> FileResponse:
    """Synthesize text in one language using a voice sample from another.

    Upload a voice sample (e.g. English speaker) and provide text in
    another language (e.g. Spanish). XTTS v2 will attempt to speak
    the target language with the timbre of the source voice.

    This is experimental — results vary. The model may produce:
    - Target language with source voice timbre (ideal)
    - Target language with source language accent (common)
    - Mixed pronunciation (possible)

    No text normalization, no candidates, no retries. Raw XTTS v2 output
    for fast experimentation.
    """
    import torch
    from TTS.api import TTS as TTSApi

    # Save sample to temp
    sample_ext = Path(voice_sample.filename or "").suffix or ".wav"
    sample_filename = f"{str(uuid.uuid4())[:8]}_xling{sample_ext}"
    sample_path = TEMP_DIR / sample_filename
    sample_content = await voice_sample.read()
    sample_path.write_bytes(sample_content)

    file_id = str(uuid.uuid4())[:12]
    output_wav = TEMP_DIR / f"{file_id}_xling.wav"
    output_path = OUTPUT_DIR / f"{file_id}.{output_format}"

    try:
        device = "cuda:0" if torch.cuda.is_available() else "cpu"

        # Load model (reuse if already loaded by clone engine)
        from ..dependencies import get_tts_engine
        engine = get_tts_engine()
        clone = engine._get_clone_engine()
        clone.load_model()
        model = clone._model

        if model is None:
            raise SynthesisError("XTTS v2 model not loaded")

        # Direct synthesis — no normalization, no candidates
        await asyncio.to_thread(
            model.tts_to_file,
            text=text,
            speaker_wav=str(sample_path),
            language=language,
            file_path=str(output_wav),
            # Use default params for experimentation
            temperature=0.3,
            top_p=0.7,
            repetition_penalty=10.0,
        )

        # Convert format
        if output_format == "wav":
            output_wav.rename(output_path)
        else:
            from ..catalogs import AUDIO_FORMATS
            fmt = AUDIO_FORMATS.get(output_format, AUDIO_FORMATS["mp3"])
            audio = AudioSegment.from_wav(str(output_wav))
            audio.export(str(output_path), format=fmt["format"], codec=fmt["codec"], parameters=fmt["parameters"])
            output_wav.unlink(missing_ok=True)

        try:
            result_audio = AudioSegment.from_file(str(output_path))
            duration = round(len(result_audio) / 1000.0, 2)
        except Exception:
            duration = 0.0

        return FileResponse(
            path=str(output_path),
            media_type=f"audio/{output_format}",
            filename=f"voxforge_xling.{output_format}",
            headers={
                "X-Audio-Duration": str(duration),
                "X-Audio-Engine": "xtts-v2-crosslingual",
                "X-Source-Language": "auto",
                "X-Target-Language": language,
            },
        )

    except Exception as exc:
        output_wav.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise SynthesisError(f"Cross-lingual error: {exc}") from exc
    finally:
        sample_path.unlink(missing_ok=True)
