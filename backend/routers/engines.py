"""GPU engine lifecycle — inter-process VRAM policy (PROD-01).

``gpu_lock.gpu_semaphore`` only serializes inference *inside* this
backend; ComfyUI is another process on the SAME 12 GB card, so resident
TTS models would starve it of VRAM.

**Callers MUST POST ``/api/engines/unload`` before launching heavy
visual loads.** The ComfyUI image provider (PROD-02) applies the same
policy via a direct call to ``services.engine_unload.unload_gpu_engines``
— the shared implementation behind this endpoint.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..dependencies import get_convert_engine, get_tts_engine
from ..schemas import EnginesUnloadResponse
from ..services.convert_engine import ConvertEngine
from ..services.engine_unload import unload_gpu_engines
from ..services.tts_engine import TTSEngine

router = APIRouter(prefix="/engines", tags=["engines"])


@router.post(
    "/unload",
    summary="Unload GPU models to free VRAM for external processes",
    response_model=EnginesUnloadResponse,
)
async def unload_engines(
    tts: TTSEngine = Depends(get_tts_engine),
    convert: ConvertEngine = Depends(get_convert_engine),
) -> EnginesUnloadResponse:
    """Unload XTTS + OpenVoice and empty the CUDA cache.

    Waits for the GPU semaphore so a model is never pulled out from
    under a running inference (see ``services.engine_unload``).
    """
    unloaded, cache_cleared = await unload_gpu_engines(tts, convert)
    return EnginesUnloadResponse(unloaded=unloaded, cuda_cache_cleared=cache_cleared)
