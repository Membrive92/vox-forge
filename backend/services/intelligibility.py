"""ASR-in-the-loop intelligibility scoring (VOZ-08).

Measures how faithfully an audio file speaks an expected text:
transcribe with faster-whisper, normalize BOTH texts through the same
``text_normalizer`` the synthesis pipeline uses (so "Dr." vs "Doctor"
or "3" vs "tres" never count as errors), and compare with
``rapidfuzz.fuzz.ratio``. Scores are in ``[0.0, 1.0]``.

Shared core: ``clone_engine`` uses it to re-rank XTTS candidates and the
chapter QC pass (QC-01) consumes the same functions. Designed reusable:
``text_similarity`` is a pure function and ``score_intelligibility``
accepts an injectable transcriber so tests never need a real model.

The default transcriber lazy-loads one faster-whisper model (name from
``settings.whisper_model``) and caches it as a module singleton.
Transcription runs under the shared GPU semaphore — on CUDA it competes
with the synthesis engines for the same card.
"""
from __future__ import annotations

import asyncio
import logging
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from rapidfuzz import fuzz

from ..config import settings
from ..gpu_lock import gpu_semaphore
from .text_normalizer import normalize_for_tts

if TYPE_CHECKING:
    from faster_whisper import WhisperModel

logger = logging.getLogger(__name__)


class TranscriberFn(Protocol):
    """Blocking callable that turns an audio file into plain text."""

    def __call__(self, audio_path: Path, language: str | None) -> str: ...


# Cached faster-whisper singleton (lazy: the model is only loaded the
# first time the default transcriber runs). The Studio ``Transcriber``
# keeps its own instance because it produces SRT output; both read the
# model name from ``settings.whisper_model``.
_model: WhisperModel | None = None
_model_lock = threading.Lock()


def _load_model() -> WhisperModel:
    """Load and cache the faster-whisper model (thread-safe)."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                import torch
                from faster_whisper import WhisperModel  # noqa: PLC0415

                device = "cuda" if torch.cuda.is_available() else "cpu"
                compute_type = "float16" if device == "cuda" else "int8"
                logger.info(
                    "Loading faster-whisper model=%s device=%s compute=%s for intelligibility scoring",
                    settings.whisper_model, device, compute_type,
                )
                _model = WhisperModel(settings.whisper_model, device=device, compute_type=compute_type)
    return _model


def _whisper_transcribe(audio_path: Path, language: str | None) -> str:
    """Default transcriber: faster-whisper, joined segment texts."""
    model = _load_model()
    segments, _info = model.transcribe(str(audio_path), language=language, beam_size=5)
    return " ".join(str(getattr(seg, "text", "")).strip() for seg in segments)


def text_similarity(expected: str, transcribed: str) -> float:
    """Pure similarity between expected and transcribed text, in [0, 1].

    Both sides go through ``normalize_for_tts`` so notation differences
    (abbreviations, digits, siglas, punctuation, casing) don't register
    as intelligibility errors — only actual word changes do.
    """
    norm_expected = normalize_for_tts(expected)
    norm_transcribed = normalize_for_tts(transcribed)
    if not norm_expected and not norm_transcribed:
        return 1.0
    return fuzz.ratio(norm_expected, norm_transcribed) / 100.0


async def score_intelligibility(
    audio_path: Path,
    expected_text: str,
    *,
    language: str | None = None,
    transcriber: TranscriberFn | None = None,
) -> float:
    """Score how intelligibly ``audio_path`` speaks ``expected_text``.

    Transcribes the audio (under the shared GPU semaphore — one CUDA
    inference at a time across all engines) and returns the normalized
    similarity in ``[0.0, 1.0]``. ``transcriber`` is injectable for
    tests and alternative backends; the default is the cached
    faster-whisper singleton.
    """
    transcribe = transcriber if transcriber is not None else _whisper_transcribe
    async with gpu_semaphore:
        transcribed = await asyncio.to_thread(transcribe, audio_path, language)
    score = text_similarity(expected_text, transcribed)
    logger.debug(
        "Intelligibility %.3f for %s (expected %d chars, transcribed %d chars)",
        score, audio_path.name, len(expected_text), len(transcribed),
    )
    return score
