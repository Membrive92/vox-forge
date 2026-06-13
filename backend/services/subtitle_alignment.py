"""Light forced-alignment of a known source text to an audio timeline (S2).

For audiobooks the chapter script is authoritative: Whisper may misspell
proper or fantasy names, so the subtitles must show the EXACT
``source_text`` synced to the voice, not the ASR re-transcription.

Strategy (no new deps):
1. Transcribe with word-level timestamps (``Transcriber`` ``word_timestamps``).
2. Split the source text into readable subtitle blocks.
3. Map each source word onto the Whisper word timeline **proportionally**,
   which is monotonic by construction (block N+1 never starts before N).
4. Score how well the source matches what Whisper heard via
   ``intelligibility.text_similarity`` (reused QC normalization).

When the faster-whisper build exposes no per-word timings, the caller
passes the segment list instead and we degrade to segment-level anchors.
"""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

from ..paths import STUDIO_SUBS_DIR
from .intelligibility import text_similarity
from .transcriber import SrtSegment, SrtWord, _format_timestamp

logger = logging.getLogger(__name__)

# Soft cap on characters per subtitle block before we force a split. Kept
# generous for v1 (legibility line-splitting is S3); this only prevents a
# whole paragraph landing in one block.
_MAX_BLOCK_CHARS = 84
# A word followed by one of these ends a subtitle block when the block is
# already long enough to be worth showing on its own.
_MIN_BLOCK_CHARS = 24
_SENTENCE_END = re.compile(r"[.!?…]+[\"'»)\]]?$")


@dataclass(frozen=True)
class AlignedEntry:
    """One aligned subtitle block: SOURCE text with audio timings."""

    index: int
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class AlignmentResult:
    srt_path: Path
    entries: list[AlignedEntry]
    confidence: float
    used_word_timestamps: bool


def _tokenize(text: str) -> list[str]:
    """Split into whitespace-delimited tokens, preserving the originals.

    Order and content are kept verbatim so the SRT shows the exact
    source words (including their accents and capitalization).
    """
    return text.split()


def _split_into_blocks(words: list[str]) -> list[list[int]]:
    """Group source word indices into subtitle blocks.

    Breaks on sentence-ending punctuation once a block is long enough, and
    hard-breaks before a block exceeds ``_MAX_BLOCK_CHARS``. Returns a list
    of index lists into ``words`` (never empty for non-empty input).
    """
    blocks: list[list[int]] = []
    current: list[int] = []
    current_chars = 0
    for i, word in enumerate(words):
        # Hard break BEFORE adding if this word would overflow the block.
        if current and current_chars + 1 + len(word) > _MAX_BLOCK_CHARS:
            blocks.append(current)
            current = []
            current_chars = 0
        current.append(i)
        current_chars += (1 if current_chars else 0) + len(word)
        # Soft break on sentence end once the block carries enough text.
        if current_chars >= _MIN_BLOCK_CHARS and _SENTENCE_END.search(word):
            blocks.append(current)
            current = []
            current_chars = 0
    if current:
        blocks.append(current)
    return blocks


def _word_timeline_from_words(words: list[SrtWord]) -> list[tuple[float, float]]:
    """Per-word (start, end) anchors from Whisper word timestamps."""
    return [(w.start, w.end) for w in words]


def _word_timeline_from_segments(
    segments: list[SrtSegment],
) -> list[tuple[float, float]]:
    """Per-word anchors when only segment timings exist (degraded path).

    Each segment's time span is spread evenly over the words it contains,
    keeping the result monotonic.
    """
    anchors: list[tuple[float, float]] = []
    for seg in segments:
        seg_words = seg.text.split()
        n = len(seg_words)
        if n == 0:
            continue
        span = max(seg.end - seg.start, 0.0)
        step = span / n
        for k in range(n):
            start = seg.start + step * k
            end = seg.start + step * (k + 1)
            anchors.append((start, end))
    return anchors


def _project_source_words(
    n_source: int,
    timeline: list[tuple[float, float]],
    total_duration: float,
) -> list[tuple[float, float]]:
    """Map ``n_source`` source words onto the audio timeline, monotonically.

    The number of source words and Whisper words rarely match (ASR splits
    or merges), so we project by *relative position*: source word ``i``
    borrows the start of the timeline word at the same fractional index
    and the end of the next anchor. Falls back to even spacing over
    ``total_duration`` when no timeline is available.
    """
    if n_source <= 0:
        return []

    if not timeline:
        # No per-word anchors at all — spread evenly over the duration.
        dur = total_duration if total_duration > 0 else float(n_source)
        step = dur / n_source
        return [(step * i, step * (i + 1)) for i in range(n_source)]

    m = len(timeline)
    out: list[tuple[float, float]] = []
    prev_start = timeline[0][0]
    for i in range(n_source):
        # Fractional position of this source word in [0, m).
        j = int(i * m / n_source)
        j = min(j, m - 1)
        start = timeline[j][0]
        # End: start of the next source word, or this anchor's end for the
        # last word. Clamp so we never go backwards (monotonic guarantee).
        if i + 1 < n_source:
            j_next = min(int((i + 1) * m / n_source), m - 1)
            end = timeline[j_next][0]
        else:
            end = timeline[j][1]
        start = max(start, prev_start)
        end = max(end, start)
        out.append((start, end))
        prev_start = start
    return out


def align_source_to_audio(
    source_text: str,
    *,
    words: list[SrtWord],
    segments: list[SrtSegment],
    duration_s: float,
) -> tuple[list[AlignedEntry], float, bool]:
    """Align ``source_text`` to the audio, returning entries + confidence.

    Prefers Whisper word timestamps; degrades to segment timings when the
    build doesn't expose words. ``confidence`` is the normalized similarity
    between the source and what Whisper actually heard, in ``[0, 1]``.
    """
    source_words = _tokenize(source_text)
    used_words = bool(words)
    timeline = (
        _word_timeline_from_words(words)
        if used_words
        else _word_timeline_from_segments(segments)
    )
    projected = _project_source_words(len(source_words), timeline, duration_s)

    entries: list[AlignedEntry] = []
    blocks = _split_into_blocks(source_words)
    for idx, block in enumerate(blocks, start=1):
        first, last = block[0], block[-1]
        start = projected[first][0] if projected else 0.0
        end = projected[last][1] if projected else duration_s
        # Defensive monotonic clamp against the previous block's end.
        if entries and start < entries[-1].end:
            start = entries[-1].end
        end = max(end, start)
        text = " ".join(source_words[i] for i in block)
        entries.append(AlignedEntry(index=idx, start=start, end=end, text=text))

    transcribed = " ".join(s.text for s in segments)
    confidence = text_similarity(source_text, transcribed)
    logger.info(
        "Aligned source (%d words, %d blocks) to audio; words=%s confidence=%.3f",
        len(source_words), len(entries), used_words, confidence,
    )
    return entries, confidence, used_words


def write_aligned_srt(entries: list[AlignedEntry], stem: str) -> Path:
    """Write aligned entries to an SRT file under ``STUDIO_SUBS_DIR``."""
    STUDIO_SUBS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{stem}_aligned_{str(uuid.uuid4())[:8]}.srt"
    out = STUDIO_SUBS_DIR / filename

    lines: list[str] = []
    for entry in entries:
        lines.append(str(entry.index))
        lines.append(
            f"{_format_timestamp(entry.start)} --> {_format_timestamp(entry.end)}"
        )
        lines.append(entry.text)
        lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")
    logger.info("Aligned SRT written: %s (%d entries)", out.name, len(entries))
    return out
