"""Ambient audio library + 2-track mixer.

Manages a collection of ambient sounds (forest, rain, tavern, etc.)
stored in `data/ambience/`. Each file gets a metadata sidecar JSON.

The mixer takes a narration audio + an ambient audio and produces
a single mixed file. The ambient track is:
- Looped if shorter than the narration
- Trimmed if longer
- Volume-adjusted independently
- Fade-in at the start, fade-out at the end
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from pydub import AudioSegment

from ..paths import AMBIENCE_DIR, OUTPUT_DIR, TEMP_DIR

logger = logging.getLogger(__name__)


@dataclass
class AmbienceTrack:
    id: str
    name: str
    filename: str
    duration_s: float
    size_bytes: int
    tags: list[str]

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "filename": self.filename,
            "duration_s": self.duration_s,
            "size_bytes": self.size_bytes,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, d: dict) -> AmbienceTrack:
        return cls(
            id=d["id"],
            name=d["name"],
            filename=d["filename"],
            duration_s=d.get("duration_s", 0),
            size_bytes=d.get("size_bytes", 0),
            tags=d.get("tags", []),
        )


def _meta_path(track_id: str) -> Path:
    return AMBIENCE_DIR / f"{track_id}.json"


def _save_meta(track: AmbienceTrack) -> None:
    _meta_path(track.id).write_text(
        json.dumps(track.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_meta(path: Path) -> AmbienceTrack | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return AmbienceTrack.from_dict(data)
    except Exception:
        return None


def list_tracks() -> list[AmbienceTrack]:
    if not AMBIENCE_DIR.exists():
        return []
    tracks: list[AmbienceTrack] = []
    for meta_file in AMBIENCE_DIR.glob("*.json"):
        track = _load_meta(meta_file)
        if track:
            audio_path = AMBIENCE_DIR / track.filename
            if audio_path.exists():
                tracks.append(track)
    tracks.sort(key=lambda t: t.name.lower())
    return tracks


def get_track(track_id: str) -> AmbienceTrack | None:
    meta = _meta_path(track_id)
    if not meta.exists():
        return None
    return _load_meta(meta)


def save_track(name: str, audio_bytes: bytes, original_filename: str, tags: list[str] | None = None) -> AmbienceTrack:
    """Save an ambient audio file and its metadata."""
    track_id = str(uuid.uuid4())[:8]
    ext = Path(original_filename).suffix.lower() or ".mp3"
    filename = f"{track_id}{ext}"
    audio_path = AMBIENCE_DIR / filename

    AMBIENCE_DIR.mkdir(parents=True, exist_ok=True)
    audio_path.write_bytes(audio_bytes)

    try:
        seg = AudioSegment.from_file(str(audio_path))
        duration_s = round(len(seg) / 1000.0, 2)
    except Exception:
        duration_s = 0.0

    track = AmbienceTrack(
        id=track_id,
        name=name,
        filename=filename,
        duration_s=duration_s,
        size_bytes=len(audio_bytes),
        tags=tags or [],
    )
    _save_meta(track)
    logger.info("Ambience track saved: %s (%s, %.1fs)", name, filename, duration_s)
    return track


def delete_track(track_id: str) -> bool:
    track = get_track(track_id)
    if track is None:
        return False
    audio_path = AMBIENCE_DIR / track.filename
    audio_path.unlink(missing_ok=True)
    _meta_path(track_id).unlink(missing_ok=True)
    logger.info("Ambience track deleted: %s", track.name)
    return True


async def mix_narration_with_ambient(
    narration_path: Path,
    ambient_track_id: str,
    ambient_volume_db: float = -15.0,
    fade_in_ms: int = 3000,
    fade_out_ms: int = 3000,
    output_format: str = "mp3",
) -> Path:
    """Mix narration with an ambient track.

    The ambient is looped to match narration length, volume-adjusted,
    and faded in/out. Returns the path to the mixed output file.
    """
    track = get_track(ambient_track_id)
    if track is None:
        raise ValueError(f"Ambient track not found: {ambient_track_id}")

    ambient_path = AMBIENCE_DIR / track.filename

    def _do_mix() -> Path:
        narration = AudioSegment.from_file(str(narration_path))
        ambient = AudioSegment.from_file(str(ambient_path))

        narration_len = len(narration)

        # Loop ambient to cover full narration length
        if len(ambient) < narration_len:
            repeats = (narration_len // len(ambient)) + 1
            ambient = ambient * repeats

        # Trim to narration length
        ambient = ambient[:narration_len]

        # Apply volume adjustment
        ambient = ambient + ambient_volume_db

        # Apply fade in/out
        if fade_in_ms > 0:
            ambient = ambient.fade_in(min(fade_in_ms, narration_len // 2))
        if fade_out_ms > 0:
            ambient = ambient.fade_out(min(fade_out_ms, narration_len // 2))

        # Overlay ambient under narration
        mixed = narration.overlay(ambient)

        # Export
        from ..catalogs import AUDIO_FORMATS
        file_id = str(uuid.uuid4())[:8]
        output_path = OUTPUT_DIR / f"mixed_{file_id}.{output_format}"
        fmt_cfg = AUDIO_FORMATS.get(output_format, AUDIO_FORMATS["mp3"])
        mixed.export(
            str(output_path),
            format=fmt_cfg["format"],
            codec=fmt_cfg["codec"],
            parameters=fmt_cfg["parameters"],
        )

        logger.info(
            "Mixed audio exported: %s (narration %.1fs + ambient '%s' at %+.0fdB)",
            output_path.name, narration_len / 1000.0, track.name, ambient_volume_db,
        )
        return output_path

    return await asyncio.to_thread(_do_mix)
