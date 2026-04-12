"""Embed ID3/Vorbis/FLAC metadata tags into generated audio files.

Uses `mutagen` to write cross-format tags. Silent no-op if mutagen is
missing so the rest of the pipeline keeps working — metadata is a
quality-of-life feature, not a hard dependency.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AudioMetadata:
    title: str | None = None
    artist: str | None = None
    album: str | None = None
    track_number: int | None = None

    @property
    def is_empty(self) -> bool:
        return not any((self.title, self.artist, self.album, self.track_number))


def embed_metadata(path: Path, meta: AudioMetadata) -> None:
    """Write tags to *path* in place. Best-effort — logs warnings on failure."""
    if meta.is_empty:
        return
    try:
        import mutagen
    except ImportError:
        logger.warning("mutagen not installed; skipping metadata embedding")
        return

    suffix = path.suffix.lower().lstrip(".")
    try:
        if suffix == "mp3":
            _embed_mp3(path, meta)
        elif suffix in ("ogg", "opus"):
            _embed_vorbis(path, meta)
        elif suffix == "flac":
            _embed_flac(path, meta)
        elif suffix == "wav":
            # WAV has INFO chunks but mutagen support is minimal; skip quietly
            logger.debug("WAV metadata embedding not supported; skipping")
        else:
            logger.debug("Unknown format for metadata embedding: %s", suffix)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to embed metadata in %s: %s", path.name, exc)


def _embed_mp3(path: Path, meta: AudioMetadata) -> None:
    from mutagen.id3 import ID3, ID3NoHeaderError, TALB, TIT2, TPE1, TRCK

    try:
        tags = ID3(str(path))
    except ID3NoHeaderError:
        tags = ID3()

    if meta.title:
        tags["TIT2"] = TIT2(encoding=3, text=meta.title)
    if meta.artist:
        tags["TPE1"] = TPE1(encoding=3, text=meta.artist)
    if meta.album:
        tags["TALB"] = TALB(encoding=3, text=meta.album)
    if meta.track_number is not None:
        tags["TRCK"] = TRCK(encoding=3, text=str(meta.track_number))

    tags.save(str(path))


def _embed_vorbis(path: Path, meta: AudioMetadata) -> None:
    from mutagen.oggvorbis import OggVorbis

    audio = OggVorbis(str(path))
    if meta.title:
        audio["title"] = meta.title
    if meta.artist:
        audio["artist"] = meta.artist
    if meta.album:
        audio["album"] = meta.album
    if meta.track_number is not None:
        audio["tracknumber"] = str(meta.track_number)
    audio.save()


def _embed_flac(path: Path, meta: AudioMetadata) -> None:
    from mutagen.flac import FLAC

    audio = FLAC(str(path))
    if meta.title:
        audio["title"] = meta.title
    if meta.artist:
        audio["artist"] = meta.artist
    if meta.album:
        audio["album"] = meta.album
    if meta.track_number is not None:
        audio["tracknumber"] = str(meta.track_number)
    audio.save()
