"""Voice synthesis engine with dual backend: Edge-TTS and XTTS v2 cloning."""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import edge_tts
from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS, all_voice_ids
from ..config import settings
from ..exceptions import SynthesisError, UnsupportedFormatError, UnsupportedVoiceError
from ..paths import OUTPUT_DIR, TEMP_DIR
from ..schemas import SynthesisRequest
from .clone_engine import CloneEngine
from .profile_manager import ProfileManager
from .text_normalizer import normalize_for_tts

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class SynthesisResult:
    """Result of a synthesis operation."""

    path: Path
    chunks: int
    engine: str  # "edge-tts" or "xtts-v2"


# Regex to split at sentence boundaries (preserving the delimiter).
_SENTENCE_RE = re.compile(r"(?<=[.!?…;])\s+")


def _rate_str(speed: int) -> str:
    delta = speed - 100
    return f"+{delta}%" if delta >= 0 else f"{delta}%"


def _pitch_str(pitch: int) -> str:
    """Convert semitones to Hz offset (approximation: 1 st ~ 16 Hz)."""
    hz = pitch * 16
    return f"+{hz}Hz" if hz >= 0 else f"{hz}Hz"


def _volume_str(volume: int) -> str:
    delta = volume - 100
    return f"+{delta}%" if delta >= 0 else f"{delta}%"


def split_into_chunks(text: str, max_chars: int | None = None) -> list[str]:
    """Split long text into chunks suitable for Edge-TTS.

    Strategy:
    1. Split by paragraphs (double newline).
    2. If a paragraph exceeds max_chars, subdivide by sentences.
    3. Group short consecutive sentences to minimize chunk count.

    Never cuts in the middle of a sentence.
    """
    limit = max_chars or settings.chunk_max_chars
    if len(text) <= limit:
        return [text]

    paragraphs = re.split(r"\n\s*\n", text.strip())
    chunks: list[str] = []

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) <= limit:
            chunks.append(para)
            continue

        # Long paragraph -> split by sentences
        sentences = _SENTENCE_RE.split(para)
        current = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            if current and len(current) + len(sentence) + 1 > limit:
                chunks.append(current)
                current = sentence
            else:
                current = f"{current} {sentence}".strip() if current else sentence
        if current:
            chunks.append(current)

    return chunks if chunks else [text]


# Pause types and their durations in milliseconds.
# Used by CloneEngine to insert natural pauses between chunks.
CLONE_PAUSE_COMMA_MS = 200      # Short breath pause
CLONE_PAUSE_SENTENCE_MS = 500   # End of sentence
CLONE_PAUSE_PARAGRAPH_MS = 900  # Paragraph break

# Marker used to tag chunk boundaries with pause type.
_PAUSE_TAG_COMMA = "\x01"
_PAUSE_TAG_SENTENCE = "\x02"
_PAUSE_TAG_PARAGRAPH = "\x03"








@dataclass(frozen=True)
class _CloneChunk:
    """A text chunk with its trailing pause type."""

    text: str
    pause_ms: int


# XTTS v2 tokenizer limit. Chunks exceeding this get split at commas.
_XTTS_MAX_CHARS = 230


def split_into_clone_chunks(text: str) -> list[_CloneChunk]:
    """Split text into sentence-level chunks for XTTS v2.

    Split at sentence endings (. ! ?). If a sentence still exceeds
    the XTTS tokenizer limit (~239 chars), split further at commas.
    Commas inside short sentences stay — the model handles them fine.

    Pauses inserted by pydub:
      - Between sentences  → 500ms
      - Between paragraphs → 900ms
      - At comma splits    → 200ms
    """
    text = normalize_for_tts(text)
    paragraphs = re.split(r"\n\s*\n", text.strip())
    chunks: list[_CloneChunk] = []

    for p_idx, para in enumerate(paragraphs):
        para = para.strip()
        if not para:
            continue

        sentences = [s for s in re.split(r"(?<=[.!?])\s*", para) if s.strip()]

        for s_idx, sentence in enumerate(sentences):
            clean = sentence.rstrip(" .!?")
            if not clean or len(clean) < 2:
                continue

            is_last_sentence = s_idx == len(sentences) - 1
            is_last_paragraph = p_idx == len(paragraphs) - 1

            if is_last_sentence and not is_last_paragraph:
                sentence_pause = CLONE_PAUSE_PARAGRAPH_MS
            else:
                sentence_pause = CLONE_PAUSE_SENTENCE_MS

            # If sentence fits in XTTS limit, add as single chunk
            if len(clean) <= _XTTS_MAX_CHARS:
                chunks.append(_CloneChunk(text=clean, pause_ms=sentence_pause))
            else:
                # Split long sentence at commas
                clauses = re.split(r",\s*", clean)
                for c_idx, clause in enumerate(clauses):
                    clause = clause.strip()
                    if not clause:
                        continue
                    is_last_clause = c_idx == len(clauses) - 1
                    pause = sentence_pause if is_last_clause else CLONE_PAUSE_COMMA_MS
                    chunks.append(_CloneChunk(text=clause, pause_ms=pause))

    if not chunks:
        return [_CloneChunk(text=text.rstrip(" .!?") or text, pause_ms=0)]

    # Last chunk gets no trailing pause
    last = chunks[-1]
    chunks[-1] = _CloneChunk(text=last.text, pause_ms=0)

    return chunks


class TTSEngine:
    """Dual engine: Edge-TTS for system voices, XTTS v2 for voice cloning.

    Routes automatically based on whether the selected profile has a
    voice sample attached. If it does, XTTS v2 is used for cloning;
    otherwise, Edge-TTS is used with Microsoft neural voices.
    """

    def __init__(self, profiles: ProfileManager) -> None:
        self._profiles = profiles
        self._clone_engine: CloneEngine | None = None

    def _get_clone_engine(self) -> CloneEngine:
        """Lazy-init the clone engine (avoids loading model at startup)."""
        if self._clone_engine is None:
            from .clone_engine import CloneEngine

            self._clone_engine = CloneEngine()
        return self._clone_engine

    async def synthesize(self, request: SynthesisRequest) -> SynthesisResult:
        """Synthesize text and return the result with engine info.

        Routes to XTTS v2 if the profile has a voice sample, otherwise
        uses Edge-TTS. Long texts are chunked in both cases.
        """
        if request.output_format not in AUDIO_FORMATS:
            raise UnsupportedFormatError(
                f"Unsupported format: {request.output_format}. "
                f"Valid: {sorted(AUDIO_FORMATS)}"
            )

        # Resolve profile and check for voice sample
        sample_path: Path | None = None
        profile_language: str = "es"

        if request.profile_id:
            profile = self._profiles.get(request.profile_id)
            if profile is not None:
                request.voice_id = profile.voice_id
                request.speed = profile.speed
                request.pitch = profile.pitch
                request.volume = profile.volume
                profile_language = profile.language
                if profile.sample_filename:
                    from ..paths import VOICES_DIR

                    candidate = VOICES_DIR / profile.sample_filename
                    if candidate.exists():
                        sample_path = candidate

        # Route to clone engine if we have a sample
        if sample_path is not None:
            return await self._synthesize_cloned(request, sample_path, profile_language)

        # Otherwise use Edge-TTS
        if request.voice_id not in all_voice_ids():
            raise UnsupportedVoiceError(
                f"Unsupported voice: {request.voice_id}"
            )

        chunks = split_into_chunks(request.text)
        file_id = str(uuid.uuid4())[:12]
        output_path = OUTPUT_DIR / f"{file_id}.{request.output_format}"
        temp_files: list[Path] = []

        try:
            for i, chunk in enumerate(chunks):
                temp_mp3 = TEMP_DIR / f"{file_id}_chunk{i}.mp3"
                temp_files.append(temp_mp3)
                communicate = edge_tts.Communicate(
                    text=chunk,
                    voice=request.voice_id,
                    rate=_rate_str(request.speed),
                    pitch=_pitch_str(request.pitch),
                    volume=_volume_str(request.volume),
                )
                await communicate.save(str(temp_mp3))
                logger.info(
                    "Chunk %d/%d synthesized: %d bytes",
                    i + 1, len(chunks), temp_mp3.stat().st_size,
                )

            # Single chunk + MP3: skip pydub entirely (no ffmpeg needed)
            if len(temp_files) == 1 and request.output_format == "mp3":
                temp_files[0].replace(output_path)
            else:
                # Multiple chunks or format conversion: requires ffmpeg
                if len(temp_files) == 1:
                    combined = AudioSegment.from_mp3(str(temp_files[0]))
                else:
                    combined = AudioSegment.empty()
                    # 400ms pause between paragraphs for natural narration
                    pause = AudioSegment.silent(duration=400)
                    for j, tf in enumerate(temp_files):
                        segment = AudioSegment.from_mp3(str(tf))
                        if j > 0:
                            combined += pause
                        combined += segment

                fmt_cfg = AUDIO_FORMATS[request.output_format]
                combined.export(
                    str(output_path),
                    format=fmt_cfg["format"],
                    codec=fmt_cfg["codec"],
                    parameters=fmt_cfg["parameters"],
                )

            logger.info(
                "Audio exported: %s (%d bytes, %d chunks)",
                output_path, output_path.stat().st_size, len(chunks),
            )
            return SynthesisResult(path=output_path, chunks=len(chunks), engine="edge-tts")

        except (UnsupportedFormatError, UnsupportedVoiceError):
            raise
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            logger.error("Synthesis error: %s", exc)
            raise SynthesisError(f"Synthesis error: {exc}") from exc
        finally:
            for tf in temp_files:
                tf.unlink(missing_ok=True)

    async def _synthesize_cloned(
        self,
        request: SynthesisRequest,
        sample_path: Path,
        language: str,
    ) -> SynthesisResult:
        """Synthesize text using XTTS v2 voice cloning."""
        logger.info("Using XTTS v2 cloning with sample: %s", sample_path.name)
        clone = self._get_clone_engine()
        chunks = split_into_clone_chunks(request.text)
        logger.info("Text split into %d clone chunks (clause-level, no internal punctuation)", len(chunks))
        fmt_cfg = AUDIO_FORMATS[request.output_format]
        path, chunk_count = await clone.synthesize_long(
            chunks=chunks,
            speaker_wav=sample_path,
            language=language,
            output_format=request.output_format,
            format_config=fmt_cfg,
        )
        return SynthesisResult(path=path, chunks=chunk_count, engine="xtts-v2")

    @staticmethod
    async def discover_voices() -> dict[str, list[dict[str, str]]]:
        """Discover available Edge-TTS voices (ES, EN)."""
        voices = await edge_tts.list_voices()
        result: dict[str, list[dict[str, str]]] = {"es": [], "en": []}
        for voice in voices:
            locale: str = voice["Locale"]
            lang = locale.split("-", 1)[0]
            if lang not in result:
                continue
            result[lang].append({
                "id": voice["ShortName"],
                "name": voice["ShortName"].split("-")[-1].replace("Neural", ""),
                "gender": voice["Gender"],
                "locale": locale,
            })
        return result
