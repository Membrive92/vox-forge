"""Voice synthesis engine (Edge-TTS) with chunking for long texts."""
from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path

import edge_tts
from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS, all_voice_ids
from ..config import settings
from ..exceptions import SynthesisError, UnsupportedFormatError, UnsupportedVoiceError
from ..paths import OUTPUT_DIR, TEMP_DIR
from ..schemas import SynthesisRequest
from .profile_manager import ProfileManager

logger = logging.getLogger(__name__)

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


class TTSEngine:
    """Edge-TTS wrapper with automatic chunking and concatenation."""

    def __init__(self, profiles: ProfileManager) -> None:
        self._profiles = profiles

    async def synthesize(self, request: SynthesisRequest) -> tuple[Path, int]:
        """Synthesize text and return (output file path, chunk count).

        Long texts are automatically split into chunks, synthesized
        separately, and concatenated into a single output file.
        """
        if request.output_format not in AUDIO_FORMATS:
            raise UnsupportedFormatError(
                f"Unsupported format: {request.output_format}. "
                f"Valid: {sorted(AUDIO_FORMATS)}"
            )

        if request.profile_id:
            profile = self._profiles.get(request.profile_id)
            if profile is not None:
                request.voice_id = profile.voice_id
                request.speed = profile.speed
                request.pitch = profile.pitch
                request.volume = profile.volume

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
                    "Chunk %d/%d sintetizado: %d bytes",
                    i + 1, len(chunks), temp_mp3.stat().st_size,
                )

            # Concatenate chunks
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

            # Export to requested format
            if request.output_format == "mp3":
                fmt_cfg = AUDIO_FORMATS["mp3"]
            else:
                fmt_cfg = AUDIO_FORMATS[request.output_format]

            combined.export(
                str(output_path),
                format=fmt_cfg["format"],
                codec=fmt_cfg["codec"],
                parameters=fmt_cfg["parameters"],
            )

            logger.info(
                "Audio exportado: %s (%d bytes, %d chunks)",
                output_path, output_path.stat().st_size, len(chunks),
            )
            return output_path, len(chunks)

        except (UnsupportedFormatError, UnsupportedVoiceError):
            raise
        except Exception as exc:
            output_path.unlink(missing_ok=True)
            logger.error("Synthesis error: %s", exc)
            raise SynthesisError(f"Synthesis error: {exc}") from exc
        finally:
            for tf in temp_files:
                tf.unlink(missing_ok=True)

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
