"""Catálogos estáticos: voces curadas y formatos de audio soportados."""
from __future__ import annotations

from typing import TypedDict


class VoiceMeta(TypedDict):
    name: str
    gender: str
    accent: str


class FormatConfig(TypedDict):
    format: str
    codec: str
    parameters: list[str]


# Formatos de audio soportados con parámetros de conversión ffmpeg/pydub.
AUDIO_FORMATS: dict[str, FormatConfig] = {
    "mp3":  {"format": "mp3",  "codec": "libmp3lame", "parameters": ["-q:a", "2"]},
    "wav":  {"format": "wav",  "codec": "pcm_s16le",  "parameters": []},
    "ogg":  {"format": "ogg",  "codec": "libvorbis",  "parameters": ["-q:a", "6"]},
    "flac": {"format": "flac", "codec": "flac",       "parameters": []},
}


# Subconjunto curado de voces Edge-TTS (descubrir el resto con /api/voices/all).
SUPPORTED_VOICES: dict[str, dict[str, VoiceMeta]] = {
    "es": {
        "es-ES-AlvaroNeural":   {"name": "Álvaro",   "gender": "M", "accent": "España"},
        "es-ES-ElviraNeural":   {"name": "Elvira",   "gender": "F", "accent": "España"},
        "es-MX-DaliaNeural":    {"name": "Dalia",    "gender": "F", "accent": "México"},
        "es-MX-JorgeNeural":    {"name": "Jorge",    "gender": "M", "accent": "México"},
        "es-AR-ElenaNeural":    {"name": "Elena",    "gender": "F", "accent": "Argentina"},
        "es-CO-GonzaloNeural":  {"name": "Gonzalo",  "gender": "M", "accent": "Colombia"},
    },
    "en": {
        "en-US-GuyNeural":      {"name": "Guy",      "gender": "M", "accent": "US"},
        "en-US-JennyNeural":    {"name": "Jenny",    "gender": "F", "accent": "US"},
        "en-GB-RyanNeural":     {"name": "Ryan",     "gender": "M", "accent": "UK"},
        "en-GB-SoniaNeural":    {"name": "Sonia",    "gender": "F", "accent": "UK"},
        "en-AU-NatashaNeural":  {"name": "Natasha",  "gender": "F", "accent": "AU"},
        "en-AU-WilliamNeural":  {"name": "William",  "gender": "M", "accent": "AU"},
    },
}


def all_voice_ids() -> set[str]:
    """Conjunto plano de IDs de voces soportadas."""
    return {vid for lang in SUPPORTED_VOICES.values() for vid in lang}
