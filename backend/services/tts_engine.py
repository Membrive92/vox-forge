"""Voice synthesis engine with dual backend: Edge-TTS and XTTS v2 cloning."""
from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import edge_tts
from pydub import AudioSegment

from ..cancellation import CancellationToken
from ..catalogs import AUDIO_FORMATS, all_voice_ids
from ..config import settings
from ..exceptions import (
    ProfileNotFound,
    SynthesisError,
    UnsupportedFormatError,
    UnsupportedVoiceError,
)
from ..paths import OUTPUT_DIR, TEMP_DIR, VOICES_DIR
from ..schemas import SynthesisRequest
from .clone_engine import CloneEngine
from .job_store import chunk_path as job_chunk_path
from .profile_manager import ProfileManager
from .progress import registry as progress_registry
from .text_normalizer import normalize_for_tts

logger = logging.getLogger(__name__)

@dataclass(frozen=True)
class SynthesisResult:
    """Result of a synthesis operation."""

    path: Path
    chunks: int
    engine: str  # "edge-tts" or "xtts-v2"


@dataclass(frozen=True)
class RoutingDecision:
    """Resolved profile data plus which engine a request will route to.

    ``sample_paths`` carries EVERY stored profile sample that exists on
    disk (VOZ-10): XTTS accepts a list in ``speaker_wav`` and averages
    the conditioning latents. An empty list routes to Edge-TTS.
    """

    sample_paths: list[Path]
    voice_id: str
    language: str
    castilian_anchor: bool

    @property
    def engine(self) -> str:
        return "xtts-v2" if self.sample_paths else "edge-tts"


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


def chunk_texts_for_engine(text: str, engine: str) -> list[str]:
    """Return the chunk texts a given engine actually synthesizes.

    Edge-TTS splits at paragraph/sentence level (``split_into_chunks``)
    while XTTS splits at clause level (``split_into_clone_chunks``).
    Chapter bookkeeping — ``chunks_total``, takes, chunk map, QC — must
    mirror the real chunk list of the generation's engine, never assume
    Edge chunking (MED-CONC-2).
    """
    if engine == "xtts-v2":
        return [chunk.text for chunk in split_into_clone_chunks(text)]
    return split_into_chunks(text)


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

    def resolve_routing(self, request: SynthesisRequest) -> RoutingDecision:
        """Resolve profile data and decide which engine will handle a request.

        Used by ``synthesize`` for the actual routing and by the synthesis
        router to persist the real engine on the crash-safe ``JobRecord``
        (a resumed XTTS job must not be replayed as Edge-TTS).
        """
        sample_paths: list[Path] = []
        language = "es"
        voice_id = request.voice_id
        castilian_anchor = False

        if request.profile_id:
            profile = self._profiles.get(request.profile_id)
            if profile is None:
                raise ProfileNotFound(f"Profile not found: {request.profile_id}")
            # Override voice_id from profile for routing. Speed/pitch/volume
            # come from the request (frontend sliders), not the profile.
            voice_id = profile.voice_id
            language = profile.language
            castilian_anchor = profile.castilian_anchor
            # Every stored sample that exists on disk joins the XTTS
            # conditioning list (VOZ-10).
            for sample in profile.samples:
                candidate = VOICES_DIR / sample
                if candidate.exists():
                    sample_paths.append(candidate)

        return RoutingDecision(
            sample_paths=sample_paths,
            voice_id=voice_id,
            language=language,
            castilian_anchor=castilian_anchor,
        )

    async def synthesize(
        self,
        request: SynthesisRequest,
        cancel_token: CancellationToken | None = None,
        job_id: str | None = None,
    ) -> SynthesisResult:
        """Synthesize text and return the result with engine info.

        Routes to XTTS v2 if the profile has a voice sample, otherwise
        uses Edge-TTS. Long texts are chunked in both cases.
        """
        if request.output_format not in AUDIO_FORMATS:
            raise UnsupportedFormatError(
                f"Unsupported format: {request.output_format}. "
                f"Valid: {sorted(AUDIO_FORMATS)}"
            )

        routing = self.resolve_routing(request)

        # Route to clone engine if we have at least one sample
        if routing.sample_paths:
            return await self._synthesize_cloned(
                request, routing.sample_paths, routing.language, cancel_token, job_id,
                castilian_anchor=routing.castilian_anchor,
            )

        # Otherwise use Edge-TTS
        voice_id = routing.voice_id
        if voice_id not in all_voice_ids():
            raise UnsupportedVoiceError(
                f"Unsupported voice: {voice_id}"
            )

        chunks = split_into_chunks(request.text)
        file_id = str(uuid.uuid4())[:12]
        output_path = OUTPUT_DIR / f"{file_id}.{request.output_format}"
        temp_files: list[Path] = []
        # When job_id is set, chunks are persisted to data/jobs/{id}/ so the
        # job can be resumed on crash. Already-existing chunks are skipped.
        use_job_dir = job_id is not None

        if job_id:
            progress_registry.update(job_id, chunks_total=len(chunks), step="synthesizing")

        try:
            for i, chunk in enumerate(chunks):
                if use_job_dir:
                    chunk_file = job_chunk_path(job_id, i, "mp3")
                    chunk_file.parent.mkdir(parents=True, exist_ok=True)
                else:
                    chunk_file = TEMP_DIR / f"{file_id}_chunk{i}.mp3"
                temp_files.append(chunk_file)

                if use_job_dir and chunk_file.exists() and chunk_file.stat().st_size > 0:
                    logger.info("Chunk %d/%d already present, skipping", i + 1, len(chunks))
                    if job_id:
                        progress_registry.update(job_id, chunks_done=i + 1)
                    continue

                communicate = edge_tts.Communicate(
                    text=chunk,
                    voice=voice_id,
                    rate=_rate_str(request.speed),
                    pitch=_pitch_str(request.pitch),
                    volume=_volume_str(request.volume),
                )
                if use_job_dir:
                    # Write to a temp name and promote with an atomic
                    # os.replace: a crash mid-write must never leave a
                    # truncated chunk_*.mp3 that a later resume would
                    # silently keep. The "incoming_" prefix also keeps the
                    # partial file out of the chunk_*.* resume glob.
                    partial = chunk_file.with_name(f"incoming_{chunk_file.name}")
                    await communicate.save(str(partial))
                    partial.replace(chunk_file)
                else:
                    await communicate.save(str(chunk_file))
                logger.info(
                    "Chunk %d/%d synthesized: %d bytes",
                    i + 1, len(chunks), chunk_file.stat().st_size,
                )
                if job_id:
                    progress_registry.update(job_id, chunks_done=i + 1)

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
            # Keep chunk files when they live in a job dir — the router
            # cleans them up on success. On crash they're what makes
            # resume possible.
            if not use_job_dir:
                for tf in temp_files:
                    tf.unlink(missing_ok=True)

    @staticmethod
    def _apply_volume(path: Path, volume: int) -> None:
        """Apply volume adjustment to a generated audio file.

        XTTS v2 doesn't support volume natively. Speed is resolved as a
        Rubber Band post-stretch inside ``CloneEngine.synthesize_long``
        (never via the model's ``speed`` kwarg — see VOZ-04 policy).
        Volume: 80 = default (0dB), 0 = -40dB, 100 = +10dB.

        Preserves codec and bitrate parameters from AUDIO_FORMATS
        to avoid silent quality degradation on re-export.
        """
        if volume == 80:
            return
        try:
            audio = AudioSegment.from_file(str(path))
            db_change = (volume - 80) * 0.5
            adjusted = audio + db_change
            audio_format = path.suffix.lstrip(".")
            fmt_cfg = AUDIO_FORMATS.get(audio_format)
            if fmt_cfg is not None:
                adjusted.export(
                    str(path),
                    format=fmt_cfg["format"],
                    codec=fmt_cfg["codec"],
                    parameters=fmt_cfg["parameters"],
                )
            else:
                adjusted.export(str(path), format=audio_format)
            logger.info("Volume adjusted: %.1fdB (volume=%d)", db_change, volume)
        except Exception as exc:
            logger.warning("Could not adjust volume: %s", exc)

    async def _synthesize_cloned(
        self,
        request: SynthesisRequest,
        sample_paths: list[Path],
        language: str,
        cancel_token: CancellationToken | None = None,
        job_id: str | None = None,
        *,
        castilian_anchor: bool = False,
    ) -> SynthesisResult:
        """Synthesize text using XTTS v2 voice cloning.

        The full ``sample_paths`` list goes to XTTS as ``speaker_wav``
        (VOZ-10): the model averages the conditioning latents across all
        samples, which stabilizes the cloned voice versus a single clip.
        """
        logger.info(
            "Using XTTS v2 cloning with %d sample(s): %s",
            len(sample_paths), ", ".join(p.name for p in sample_paths),
        )
        clone = self._get_clone_engine()

        # Audio anchor: if the profile is flagged, prepend the configured
        # Castilian reference voice to the FIRST (primary) sample so XTTS
        # hears Castilian articulation first when computing the speaker
        # embedding. The remaining samples join the conditioning list
        # untouched. The anchored file is a temp wav cleaned up after
        # synthesis.
        speaker_wavs: list[Path] = list(sample_paths)
        anchor_temp: Path | None = None
        if castilian_anchor:
            from .castilian_warmup import build_anchored_speaker_wav, get_reference_voice
            ref = get_reference_voice()
            if ref is not None:
                anchor_temp = TEMP_DIR / f"{uuid.uuid4().hex[:8]}_anchored.wav"
                build_anchored_speaker_wav(sample_paths[0], ref, anchor_temp)
                speaker_wavs[0] = anchor_temp
                logger.info(
                    "Castilian anchor active: prepended %s to %s",
                    ref.name, sample_paths[0].name,
                )
            else:
                logger.warning(
                    "Profile has castilian_anchor=True but no reference voice "
                    "is configured under data/voices/reference/ — falling back "
                    "to raw speaker_wav.",
                )

        chunks = split_into_clone_chunks(request.text)
        logger.info("Text split into %d clone chunks (clause-level, no internal punctuation)", len(chunks))
        fmt_cfg = AUDIO_FORMATS[request.output_format]
        # Clone speed: 1.0 = normal, converted from our 50-200% scale.
        # Applied as a Rubber Band post-stretch on natural-cadence output
        # (clamped to ±25% downstream) — XTTS never sees a speed kwarg.
        xtts_speed = request.speed / 100.0

        if job_id:
            progress_registry.update(job_id, chunks_total=len(chunks), step="cloning")

        try:
            path, chunk_count = await clone.synthesize_long(
                chunks=chunks,
                speaker_wav=speaker_wavs,
                language=language,
                output_format=request.output_format,
                format_config=fmt_cfg,
                cancel_token=cancel_token,
                speed=xtts_speed,
                job_id=job_id,
            )
        finally:
            if anchor_temp is not None:
                anchor_temp.unlink(missing_ok=True)

        # Volume post-processing (XTTS v2 doesn't support volume natively)
        self._apply_volume(path, request.volume)

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
