"""Text-to-speech synthesis endpoint."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..dependencies import get_tts_engine
from ..schemas import SynthesisRequest
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

router = APIRouter(tags=["synthesis"])


@router.post("/synthesize", summary="Synthesize text to audio")
async def synthesize_text(
    request: SynthesisRequest,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Convert text to audio and return the generated file.

    Long texts are automatically split into chunks and concatenated.
    """
    output_path, chunk_count = await engine.synthesize(request)

    try:
        audio = AudioSegment.from_file(str(output_path))
        duration = round(len(audio) / 1000.0, 2)
    except Exception:
        duration = 0.0

    background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(output_path),
        media_type=f"audio/{request.output_format}",
        filename=f"voxforge_output.{request.output_format}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(output_path.stat().st_size),
            "X-Audio-Chunks": str(chunk_count),
            "X-Text-Length": str(len(request.text)),
        },
    )
