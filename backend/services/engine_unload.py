"""Shared GPU unload logic — inter-process VRAM policy (PROD-01).

``gpu_lock.gpu_semaphore`` only serializes inference *inside* this
backend; ComfyUI runs as a separate process on the SAME 12 GB card.
This module is the single implementation behind ``POST
/api/engines/unload`` and the in-process call the ComfyUI image
provider (PROD-02) makes before submitting a diffusion job — never
HTTP-to-self.
"""
from __future__ import annotations

import logging

from ..gpu_lock import gpu_semaphore
from .convert_engine import ConvertEngine
from .tts_engine import TTSEngine

logger = logging.getLogger(__name__)


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


async def unload_gpu_engines(tts: TTSEngine, convert: ConvertEngine) -> tuple[list[str], bool]:
    """Unload XTTS + OpenVoice and empty the CUDA cache.

    Acquires the shared GPU semaphore first so a model is never pulled
    out from under a running inference: the call waits until the GPU is
    idle, then unloads while still holding the lock. Models lazy-reload
    on the next synthesis or conversion request, so unloading is always
    safe — the only cost is first-request latency.

    Returns ``(unloaded, cuda_cache_cleared)`` where ``unloaded`` names
    the engines that actually released a resident model.
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
    return unloaded, cache_cleared
