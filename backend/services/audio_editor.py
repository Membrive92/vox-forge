"""Stateless audio editor. Takes a source file + list of operations and
produces a new file with all ops applied in order.

Thin wrapper over pydub. No new dependencies. Each op is pure: it takes
an AudioSegment and returns a new AudioSegment.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS
from ..exceptions import InvalidSampleError, UnsupportedFormatError
from ..paths import STUDIO_DIR

logger = logging.getLogger(__name__)

VALID_OPERATIONS = frozenset({"trim", "delete_region", "fade_in", "fade_out", "normalize"})


@dataclass(frozen=True)
class EditOperation:
    """A single edit step."""

    type: str
    params: dict[str, Any]


def apply_operations(
    source_path: Path,
    operations: list[EditOperation],
    output_format: str = "mp3",
) -> Path:
    """Apply a sequence of edit operations to an audio file.

    Returns the path to the new file in ``data/studio/``.
    Raises ``UnsupportedFormatError`` if the output format is unknown.
    Raises ``InvalidSampleError`` if the source can't be decoded or
    any operation has invalid parameters.
    """
    if output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {output_format}. Valid: {sorted(AUDIO_FORMATS)}"
        )
    if not operations:
        raise InvalidSampleError("No operations to apply")

    try:
        audio = AudioSegment.from_file(str(source_path))
    except Exception as exc:  # noqa: BLE001
        raise InvalidSampleError(
            f"Could not decode source audio: {exc}"
        ) from exc

    for idx, op in enumerate(operations):
        if op.type not in VALID_OPERATIONS:
            raise InvalidSampleError(
                f"Operation {idx} has unknown type: {op.type}"
            )
        try:
            audio = _dispatch(audio, op)
        except Exception as exc:  # noqa: BLE001
            raise InvalidSampleError(
                f"Operation {idx} ({op.type}) failed: {exc}"
            ) from exc

    STUDIO_DIR.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())[:12]
    output = STUDIO_DIR / f"edit_{file_id}.{output_format}"

    fmt_cfg = AUDIO_FORMATS[output_format]
    audio.export(
        str(output),
        format=fmt_cfg["format"],
        codec=fmt_cfg["codec"],
        parameters=fmt_cfg["parameters"],
    )
    logger.info(
        "Audio edit exported: %s (%d ops, %d ms)",
        output.name, len(operations), len(audio),
    )
    return output


# ── Operation dispatch ──────────────────────────────────────────────


def _dispatch(audio: AudioSegment, op: EditOperation) -> AudioSegment:
    handler = _HANDLERS[op.type]
    return handler(audio, op.params)


def _trim(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    start = int(params.get("start_ms", 0))
    end = int(params.get("end_ms", len(audio)))
    start = max(0, min(start, len(audio)))
    end = max(start, min(end, len(audio)))
    if end <= start:
        raise ValueError(f"trim: end ({end}) must be greater than start ({start})")
    return audio[start:end]


def _delete_region(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    start = int(params.get("start_ms", 0))
    end = int(params.get("end_ms", 0))
    start = max(0, min(start, len(audio)))
    end = max(start, min(end, len(audio)))
    if end <= start:
        raise ValueError(f"delete_region: end ({end}) must be greater than start ({start})")
    return audio[:start] + audio[end:]


def _fade_in(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    duration = int(params.get("duration_ms", 1000))
    duration = max(1, min(duration, len(audio)))
    return audio.fade_in(duration)


def _fade_out(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    duration = int(params.get("duration_ms", 1000))
    duration = max(1, min(duration, len(audio)))
    return audio.fade_out(duration)


def _normalize(audio: AudioSegment, params: dict[str, Any]) -> AudioSegment:
    headroom_db = float(params.get("headroom_db", -1.0))
    # pydub exposes max_dBFS as the peak; shift the whole clip so the
    # peak lands at -headroom. If the clip is already quieter, we still
    # lift it up to the target.
    target_peak = headroom_db
    gain = target_peak - audio.max_dBFS
    return audio.apply_gain(gain)


_HANDLERS = {
    "trim": _trim,
    "delete_region": _delete_region,
    "fade_in": _fade_in,
    "fade_out": _fade_out,
    "normalize": _normalize,
}
