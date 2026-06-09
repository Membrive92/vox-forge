"""Audio metadata helpers."""
from __future__ import annotations

from pathlib import Path


def duration_seconds(path: Path | str, *, default: float = 0.0) -> float:
    """Return the audio duration in seconds.

    Tries ``mutagen`` first — it reads the container header, so it's far
    cheaper than decoding the whole file just to measure its length — and
    falls back to a full ``pydub`` decode. Returns ``default`` if both fail.
    """
    p = str(path)
    try:
        from mutagen import File as MutagenFile

        info = getattr(MutagenFile(p), "info", None)
        length = getattr(info, "length", None)
        if length:
            return round(float(length), 2)
    except Exception:  # noqa: BLE001 — fall through to the pydub path
        pass
    try:
        from pydub import AudioSegment

        return round(float(len(AudioSegment.from_file(p))) / 1000.0, 2)
    except Exception:  # noqa: BLE001
        return default
