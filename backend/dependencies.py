"""Service instances exposed as FastAPI dependencies."""
from __future__ import annotations

from .paths import PROFILES_FILE
from .services.convert_engine import ConvertEngine
from .services.profile_manager import ProfileManager
from .services.tts_engine import TTSEngine

_profile_manager = ProfileManager(PROFILES_FILE)
_tts_engine = TTSEngine(_profile_manager)
_convert_engine = ConvertEngine()


def get_profile_manager() -> ProfileManager:
    return _profile_manager


def get_tts_engine() -> TTSEngine:
    return _tts_engine


def get_convert_engine() -> ConvertEngine:
    return _convert_engine
