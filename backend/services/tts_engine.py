"""Motor de síntesis de voz (Edge-TTS) con chunking para textos largos."""
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

# Regex para dividir por fin de frase (preservando el delimitador).
_SENTENCE_RE = re.compile(r"(?<=[.!?…;])\s+")


def _rate_str(speed: int) -> str:
    delta = speed - 100
    return f"+{delta}%" if delta >= 0 else f"{delta}%"


def _pitch_str(pitch: int) -> str:
    """Convierte semitonos a offset Hz (aproximación: 1 st ≈ 16 Hz)."""
    hz = pitch * 16
    return f"+{hz}Hz" if hz >= 0 else f"{hz}Hz"


def _volume_str(volume: int) -> str:
    delta = volume - 100
    return f"+{delta}%" if delta >= 0 else f"{delta}%"


def split_into_chunks(text: str, max_chars: int | None = None) -> list[str]:
    """Divide texto largo en chunks aptos para Edge-TTS.

    Estrategia:
    1. Dividir por párrafos (doble salto de línea).
    2. Si un párrafo excede max_chars, subdividir por frases.
    3. Agrupar frases cortas consecutivas para minimizar chunks.

    Nunca corta a mitad de frase.
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

        # Párrafo largo → dividir por frases
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
    """Wrapper sobre Edge-TTS con chunking automático y concatenación."""

    def __init__(self, profiles: ProfileManager) -> None:
        self._profiles = profiles

    async def synthesize(self, request: SynthesisRequest) -> tuple[Path, int]:
        """Sintetiza texto y devuelve (ruta del archivo, número de chunks).

        Textos largos se dividen automáticamente en chunks, se sintetizan
        por separado y se concatenan en un solo archivo de salida.
        """
        if request.output_format not in AUDIO_FORMATS:
            raise UnsupportedFormatError(
                f"Formato no soportado: {request.output_format}. "
                f"Válidos: {sorted(AUDIO_FORMATS)}"
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
                f"Voz no soportada: {request.voice_id}"
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

            # Concatenar chunks
            if len(temp_files) == 1:
                combined = AudioSegment.from_mp3(str(temp_files[0]))
            else:
                combined = AudioSegment.empty()
                # Pausa de 400ms entre párrafos para narración natural
                pause = AudioSegment.silent(duration=400)
                for j, tf in enumerate(temp_files):
                    segment = AudioSegment.from_mp3(str(tf))
                    if j > 0:
                        combined += pause
                    combined += segment

            # Exportar al formato solicitado
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
            logger.error("Error en síntesis: %s", exc)
            raise SynthesisError(f"Error en síntesis: {exc}") from exc
        finally:
            for tf in temp_files:
                tf.unlink(missing_ok=True)

    @staticmethod
    async def discover_voices() -> dict[str, list[dict[str, str]]]:
        """Descubre voces disponibles en Edge-TTS (ES, EN)."""
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
