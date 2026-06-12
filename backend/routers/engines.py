"""GPU engine lifecycle — inter-process VRAM policy (PROD-01).

``gpu_lock.gpu_semaphore`` only serializes inference *inside* this
backend. Heavy visual workloads (ComfyUI for image/video generation —
see ``img_generation_module``) run as a separate process on the SAME
12 GB card, so resident TTS models would starve them of VRAM.

**Callers MUST POST ``/api/engines/unload`` before launching heavy
visual loads.** The endpoint releases XTTS v2 (~3 GB) and OpenVoice V2
and empties the CUDA cache. Models lazy-reload on the next synthesis
or conversion request, so unloading is always safe — the only cost is
first-request latency. The ComfyUI image provider (PROD-02) invokes
this before generating.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..dependencies import get_convert_engine, get_tts_engine
from ..gpu_lock import gpu_semaphore
from ..schemas import EnginesUnloadResponse
from ..services.convert_engine import ConvertEngine
from ..services.tts_engine import TTSEngine

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/engines", tags=["engines"])


def _empty_cuda_cache() -> bool:
    """Release cached CUDA allocations; True if the cache was emptied."""
    try:
        import torch
    except ImportError:
        return False
    if not torch.cuda.is_available():
        return False
    torch.cuda.empty_cache()
    return True


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

    Acquires the shared GPU semaphore first so a model is never pulled
    out from under a running inference: the call waits until the GPU
    is idle, then unloads while still holding the lock.
    """
    unloaded: list[str] = []
    async with gpu_semaphore:
        if tts.unload_clone_engine():
            unloaded.append("xtts")
        if convert.is_loaded:
            convert.unload_model()
            unloaded.append("openvoice")
        cache_cleared = _empty_cuda_cache()
    logger.info(
        "Engines unload: unloaded=%s cuda_cache_cleared=%s", unloaded, cache_cleared,
    )
    return EnginesUnloadResponse(unloaded=unloaded, cuda_cache_cleared=cache_cleared)
