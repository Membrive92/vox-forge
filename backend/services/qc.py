"""Automatic audio QC via ASR-diff (QC-01).

For each chunk of a chapter's completed generation: locate the chunk's
audio on disk, transcribe it with the shared intelligibility core
(faster-whisper under the GPU semaphore), normalize both texts through
``text_normalizer`` and compare with ``rapidfuzz`` — exactly the same
scoring ``clone_engine`` uses to re-rank XTTS candidates (VOZ-08).
Chunks whose score falls below ``settings.intelligibility_threshold``
are flagged for the user to audition/regenerate instead of listening
to the whole chapter.

Scores are persisted on the ``takes`` row (``qc_score`` /
``qc_transcript``) so the chunk map can render badges on every load
without re-running ASR.

Audio resolution per chunk, in priority order:

1. the take's own ``file_path`` (a regenerated chunk persists it);
2. the per-chunk audio kept under ``data/jobs/{gen_id}/`` — MP3 for
   Edge-TTS (the same files ``_resplice_chapter`` relies on), WAV for
   XTTS clones. Since MED-CONC-2 the chapter takes use the engine's
   real chunk list, so clone WAV indices align with the takes;
3. for single-chunk chapters, the whole-generation audio *is* the chunk.

Chunks with no locatable audio are skipped (score ``None``, never
flagged) rather than scored against the wrong file.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..config import settings
from . import job_store
from . import project_manager as pm
from .intelligibility import TranscriberFn, text_similarity, transcribe
from .tts_engine import chunk_texts_for_engine

logger = logging.getLogger(__name__)

# Extension of the per-chunk files each engine persists in the job dir.
_JOB_CHUNK_EXT: dict[str, str] = {"edge-tts": "mp3", "xtts-v2": "wav"}


@dataclass(frozen=True)
class ChunkQCOutcome:
    """QC verdict for one chunk of a generation."""

    index: int
    expected_text: str
    transcript: str | None  # None — no per-chunk audio to transcribe
    score: float | None  # None — chunk was skipped (no audio)
    flagged: bool


def resolve_chunk_audio(
    generation: dict[str, Any],
    take: dict[str, Any] | None,
    index: int,
    total_chunks: int,
) -> Path | None:
    """Find the audio file that speaks chunk ``index``, if any exists."""
    if take and take.get("file_path"):
        path = Path(take["file_path"])
        if path.exists():
            return path

    # Chapter synthesis persists per-chunk audio under the job dir
    # (job_id == generation id) with the same indices as the takes:
    # chunk_NNNN.mp3 for Edge-TTS, chunk_NNNN.wav for XTTS clones.
    ext = _JOB_CHUNK_EXT.get(generation.get("engine", ""))
    if ext is not None:
        path = job_store.chunk_path(generation["id"], index, ext)
        if path.exists():
            return path

    # Single chunk: the full-generation audio is that chunk (modulo
    # inter-chunk pauses, which don't exist with one chunk). Covers
    # short XTTS chapters and single-chunk MP3s (whose job chunk file
    # was promoted to the output path).
    if total_chunks == 1 and generation.get("file_path"):
        path = Path(generation["file_path"])
        if path.exists():
            return path

    return None


async def run_chapter_qc(
    chapter: dict[str, Any],
    generation: dict[str, Any],
    *,
    language: str | None = None,
    threshold: float | None = None,
    transcriber: TranscriberFn | None = None,
) -> list[ChunkQCOutcome]:
    """QC every chunk of ``generation`` against the chapter text.

    Transcription runs under the shared GPU semaphore (acquired per
    chunk inside ``intelligibility.transcribe``, so synthesis jobs can
    interleave). Scores are persisted on each take; chunks without
    locatable audio are skipped (score ``None``, never flagged).
    """
    limit = threshold if threshold is not None else settings.intelligibility_threshold
    chunks = chunk_texts_for_engine(chapter["text"], generation.get("engine", "edge-tts"))
    takes = await pm.list_takes(generation["id"])
    take_map = {t["chunk_index"]: t for t in takes}

    outcomes: list[ChunkQCOutcome] = []
    for index, expected_text in enumerate(chunks):
        take = take_map.get(index)
        audio = resolve_chunk_audio(generation, take, index, len(chunks))
        if audio is None:
            outcomes.append(ChunkQCOutcome(
                index=index, expected_text=expected_text,
                transcript=None, score=None, flagged=False,
            ))
            continue

        transcript = await transcribe(audio, language=language, transcriber=transcriber)
        score = round(text_similarity(expected_text, transcript), 4)
        flagged = score < limit
        if flagged:
            logger.warning(
                "QC flagged chunk %d of generation %s: score %.3f < %.2f",
                index, generation["id"], score, limit,
            )
        if take is not None:
            await pm.update_take(take["id"], qc_score=score, qc_transcript=transcript)
        outcomes.append(ChunkQCOutcome(
            index=index, expected_text=expected_text,
            transcript=transcript, score=score, flagged=flagged,
        ))

    scored = sum(1 for o in outcomes if o.score is not None)
    logger.info(
        "QC for generation %s: %d/%d chunks scored, %d flagged (threshold %.2f)",
        generation["id"], scored, len(outcomes),
        sum(1 for o in outcomes if o.flagged), limit,
    )
    return outcomes
