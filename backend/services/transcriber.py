"""Speech-to-text via faster-whisper.

Thin wrapper that lazy-loads the Whisper model on first use (like
``CloneEngine``) and keeps it resident. Produces SRT output plus a
parsed list of entries so the frontend can render without a second
fetch.

Tests stub ``faster_whisper`` in ``tests/conftest.py``; the real package
is not needed in CI.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from ..exceptions import InvalidSampleError
from ..paths import STUDIO_SUBS_DIR

logger = logging.getLogger(__name__)

# Passed to the FE so it can show which engine produced the captions.
_ENGINE_PREFIX = "faster-whisper"


@dataclass(frozen=True)
class SrtSegment:
    """A single transcribed segment with timestamps in seconds."""

    index: int
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class TranscriptionResult:
    srt_path: Path
    duration_s: float
    word_count: int
    language: str
    engine: str
    segments: list[SrtSegment]


class Transcriber:
    """Lazy-loaded faster-whisper wrapper."""

    def __init__(self, model_name: str = "small") -> None:
        self._model_name = model_name
        self._model: object | None = None

    def _load(self) -> object:
        if self._model is not None:
            return self._model

        import torch
        from faster_whisper import WhisperModel  # type: ignore[import-not-found]

        device = "cuda" if torch.cuda.is_available() else "cpu"
        # int8 on CPU keeps memory small; float16 on GPU is the sweet spot
        # for 4070-class cards running the small/medium models.
        compute_type = "float16" if device == "cuda" else "int8"
        logger.info(
            "Loading faster-whisper model=%s device=%s compute=%s",
            self._model_name, device, compute_type,
        )
        self._model = WhisperModel(self._model_name, device=device, compute_type=compute_type)
        return self._model

    def transcribe(
        self,
        audio_path: Path,
        language: str | None = None,
    ) -> TranscriptionResult:
        if not audio_path.exists() or not audio_path.is_file():
            raise InvalidSampleError(f"Audio not found: {audio_path}")

        model = self._load()
        try:
            segments_iter, info = model.transcribe(  # type: ignore[attr-defined]
                str(audio_path),
                language=language,
                beam_size=5,
            )
            segments = _to_segments(segments_iter)
        except Exception as exc:  # noqa: BLE001
            raise InvalidSampleError(f"Transcription failed: {exc}") from exc

        srt_path = _write_srt(segments, audio_path.stem)
        word_count = sum(len(s.text.split()) for s in segments)
        return TranscriptionResult(
            srt_path=srt_path,
            duration_s=float(getattr(info, "duration", 0.0)),
            word_count=word_count,
            language=str(getattr(info, "language", "")),
            engine=f"{_ENGINE_PREFIX}:{self._model_name}",
            segments=segments,
        )

    async def transcribe_async(
        self,
        audio_path: Path,
        language: str | None = None,
    ) -> TranscriptionResult:
        """Run the blocking transcribe on a worker thread."""
        return await asyncio.to_thread(self.transcribe, audio_path, language)


# ── Helpers ─────────────────────────────────────────────────────────


def _to_segments(raw: Iterable[object]) -> list[SrtSegment]:
    out: list[SrtSegment] = []
    for idx, seg in enumerate(raw, start=1):
        out.append(
            SrtSegment(
                index=idx,
                start=float(getattr(seg, "start", 0.0)),
                end=float(getattr(seg, "end", 0.0)),
                text=str(getattr(seg, "text", "")).strip(),
            )
        )
    return out


def _format_timestamp(seconds: float) -> str:
    """Format seconds as ``HH:MM:SS,mmm`` for SRT."""
    if seconds < 0:
        seconds = 0.0
    total_ms = int(round(seconds * 1000))
    hours, total_ms = divmod(total_ms, 3_600_000)
    minutes, total_ms = divmod(total_ms, 60_000)
    secs, ms = divmod(total_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _write_srt(segments: list[SrtSegment], stem: str) -> Path:
    STUDIO_SUBS_DIR.mkdir(parents=True, exist_ok=True)
    # Short UUID suffix prevents collisions when transcribing the same
    # source multiple times (e.g. with different models).
    filename = f"{stem}_{str(uuid.uuid4())[:8]}.srt"
    out = STUDIO_SUBS_DIR / filename

    lines: list[str] = []
    for seg in segments:
        lines.append(str(seg.index))
        lines.append(f"{_format_timestamp(seg.start)} --> {_format_timestamp(seg.end)}")
        lines.append(seg.text)
        lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")
    logger.info("SRT written: %s (%d segments)", out.name, len(segments))
    return out
