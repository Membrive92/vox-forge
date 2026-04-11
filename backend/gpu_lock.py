"""Shared GPU inference lock.

Only one GPU operation runs at a time across all engines (CloneEngine,
ConvertEngine, experimental endpoints). This prevents VRAM contention,
cuBLAS errors, and hangs when multiple tabs send requests in parallel.
"""
from __future__ import annotations

import asyncio

# Module-level semaphore shared by every GPU-using service.
# Acquire with `async with gpu_semaphore:` around any cuda inference.
gpu_semaphore: asyncio.Semaphore = asyncio.Semaphore(1)
