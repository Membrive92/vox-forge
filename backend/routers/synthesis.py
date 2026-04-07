"""Text-to-speech synthesis endpoint."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..cancellation import create_cancellation_token
from ..dependencies import get_tts_engine
from ..schemas import SynthesisRequest
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

router = APIRouter(tags=["synthesis"])


@router.post("/synthesize", summary="Synthesize text to audio")
async def synthesize_text(
    request: SynthesisRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Convert text to audio and return the generated file.

    Routes to XTTS v2 (voice cloning) if the profile has a voice sample,
    otherwise uses Edge-TTS (Microsoft neural voices).
    Automatically cancels if the client disconnects mid-generation.
    """
    cancel_token = create_cancellation_token(http_request)
    result = await engine.synthesize(request, cancel_token=cancel_token)

    try:
        audio = AudioSegment.from_file(str(result.path))
        duration = round(len(audio) / 1000.0, 2)
    except Exception:
        size = result.path.stat().st_size
        duration = round(size / 16000, 1) if size > 0 else 0.0

    background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(result.path),
        media_type=f"audio/{request.output_format}",
        filename=f"voxforge_output.{request.output_format}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(result.path.stat().st_size),
            "X-Audio-Chunks": str(result.chunks),
            "X-Audio-Engine": result.engine,
            "X-Text-Length": str(len(request.text)),
        },
    )
