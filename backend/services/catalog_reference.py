"""Tone-color reference clips for catalog (Edge-TTS) voices.

OpenVoice conversion needs a real audio reference for the TARGET timbre,
but the curated Edge-TTS catalog voices are synthetic — they have no
stored sample on disk. This module synthesizes a short clip with the
chosen Edge-TTS voice ONCE, caches it under ``data/voices/catalog_refs/``,
and reuses it. That lets a user re-voice their own narration with the
timbre of any system voice (the source's prosody is preserved by
OpenVoice; only the tone color is taken from this reference).
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

import edge_tts

from ..catalogs import all_voice_ids
from ..exceptions import SynthesisError, UnsupportedVoiceError
from ..paths import CATALOG_REFS_DIR

logger = logging.getLogger(__name__)

# ~12-15s of phonetically varied speech per language. The CONTENT is
# irrelevant to OpenVoice (it extracts timbre, not words); the language
# only keeps the phonetics natural for the voice's locale.
_REFERENCE_TEXT: dict[str, str] = {
    "es": (
        "Hola, esta es una breve muestra de voz para extraer el tono. "
        "El veloz murciélago hindú comía feliz cardillo y kiwi. "
        "La cigüeña tocaba el saxofón detrás del palenque de paja. "
        "Aquí quedan registrados los matices, las pausas y la entonación."
    ),
    "en": (
        "Hello, this is a short voice sample used to capture the tone. "
        "The quick brown fox jumps over the lazy dog by the riverbank. "
        "Bright vivid jackdaws quiz my big sphinx of quartz at dawn. "
        "Here the timbre, the pauses and the intonation are all recorded."
    ),
}


def _reference_text(voice_id: str) -> str:
    lang = voice_id.split("-", 1)[0]
    return _REFERENCE_TEXT.get(lang, _REFERENCE_TEXT["es"])


async def get_or_create_catalog_reference(voice_id: str) -> Path:
    """Return a cached tone-color reference clip for a catalog voice.

    Synthesizes the clip with Edge-TTS on first use and caches it under
    ``CATALOG_REFS_DIR`` (NOT temp), so the convert router never deletes
    it. Subsequent conversions against the same voice reuse the file.

    Raises ``UnsupportedVoiceError`` for an unknown ``voice_id`` and
    ``SynthesisError`` if the Edge-TTS synthesis fails.
    """
    if voice_id not in all_voice_ids():
        raise UnsupportedVoiceError(f"Unsupported voice: {voice_id}")

    CATALOG_REFS_DIR.mkdir(parents=True, exist_ok=True)
    ref_path = CATALOG_REFS_DIR / f"{voice_id}.mp3"
    if ref_path.exists() and ref_path.stat().st_size > 0:
        return ref_path

    logger.info("Synthesizing catalog tone-color reference for %s", voice_id)
    # Unique partial name so two concurrent first-time conversions against
    # the same voice can't clobber each other's in-progress file; the
    # atomic replace means last writer wins with valid content either way.
    partial = ref_path.with_name(f"incoming_{voice_id}_{uuid.uuid4().hex[:8]}.mp3")
    try:
        communicate = edge_tts.Communicate(text=_reference_text(voice_id), voice=voice_id)
        await communicate.save(str(partial))
        partial.replace(ref_path)
    except Exception as exc:
        partial.unlink(missing_ok=True)
        logger.error("Catalog reference synthesis failed for %s: %s", voice_id, exc)
        raise SynthesisError(
            f"Could not synthesize a reference clip for voice {voice_id}: {exc}"
        ) from exc

    return ref_path
