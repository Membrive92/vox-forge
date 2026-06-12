"""One-click mastering preset (UX-02).

Runs the Studio edit engine headless — no editor session — applying the
audiobook preset [denoise -> loudness -16 LUFS -> compressor] to a
chapter's take audio. The output registers as a ``studio_renders`` row
(kind="audio") so the export priority picks it up like any manual edit;
the editor stays available for surgery, mastering is the pipeline step.
"""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from ..audio_meta import duration_seconds
from . import studio_store
from .audio_editor import EditOperation, apply_operations

# Op types of the preset, in plan order. Also the fingerprint used to
# recognize a render as "mastered" (vs a manual Studio edit).
MASTERING_OP_TYPES: tuple[str, ...] = ("denoise", "loudness", "compressor")


def mastering_operations() -> list[EditOperation]:
    """The headless preset: denoise -> loudness -16 LUFS -> compressor."""
    return [
        EditOperation(type="denoise", params={"strength": 0.5}),
        EditOperation(type="loudness", params={"target_lufs": -16.0}),
        EditOperation(type="compressor", params={"amount": 0.5, "threshold_db": -18.0}),
    ]


def operations_json() -> str:
    """Preset serialized exactly like /studio/edit persists operations."""
    return json.dumps(
        [{"type": op.type, "params": op.params} for op in mastering_operations()]
    )


def is_mastering_ops(operations_field: str | None) -> bool:
    """True when a render's persisted operations match the preset.

    Lets the UI show "Mastered" instead of a generic "Studio edit" and
    lets master-all exports skip chapters that are already mastered.
    """
    if not operations_field:
        return False
    try:
        ops = json.loads(operations_field)
    except (TypeError, ValueError):
        return False
    if not isinstance(ops, list):
        return False
    types = tuple(op.get("type") for op in ops if isinstance(op, dict))
    return types == MASTERING_OP_TYPES


async def apply_mastering(source: Path, output_format: str) -> Path:
    """Run the preset off the event loop; returns the new file in
    ``data/studio/``. Raises ``InvalidSampleError`` like any edit."""
    return await asyncio.to_thread(
        apply_operations, source, mastering_operations(), output_format=output_format
    )


async def master_to_render(
    source: Path,
    *,
    project_id: str | None,
    chapter_id: str,
    output_format: str,
) -> dict[str, Any]:
    """Master ``source`` and persist the result as a studio render.

    The render links to ``chapter_id`` so the export-source resolution
    (``export_source.resolve_export_source``) picks it up immediately.
    """
    output = await apply_mastering(source, output_format)
    duration_s = await asyncio.to_thread(duration_seconds, output)
    return await studio_store.create_render(
        kind="audio",
        source_path=str(source.resolve()),
        output_path=str(output.resolve()),
        operations=operations_json(),
        project_id=project_id,
        chapter_id=chapter_id,
        duration_s=duration_s,
        size_bytes=output.stat().st_size,
    )
