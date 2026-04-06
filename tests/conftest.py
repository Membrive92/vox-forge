"""Test suite configuration.

Goals:
- Isolate I/O: VOXFORGE_BASE_DIR points to a tmp path per session.
- No native dependencies: ``edge_tts`` and ``pydub`` are replaced by minimal
  stubs that produce valid bytes sufficient for FastAPI to serve them
  and ``ProfileManager`` to analyze them.
- Clean state per test: the profiles singleton is reset between tests.
"""
from __future__ import annotations

import os
import sys
import types
from pathlib import Path
from typing import Iterator

import pytest

# ---------------------------------------------------------------------------
# Native dependency stubs. Must be installed BEFORE importing ``backend``.
# ---------------------------------------------------------------------------

_FAKE_MP3_BYTES = b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 128


class _FakeCommunicate:
    """Fake ``edge_tts.Communicate`` that writes static bytes."""

    def __init__(self, **_: object) -> None:
        pass

    async def save(self, path: str) -> None:
        Path(path).write_bytes(_FAKE_MP3_BYTES)


async def _fake_list_voices() -> list[dict[str, str]]:
    return [
        {"ShortName": "es-ES-AlvaroNeural", "Locale": "es-ES", "Gender": "Male"},
        {"ShortName": "en-US-JennyNeural", "Locale": "en-US", "Gender": "Female"},
    ]


class _FakeAudioSegment:
    """Minimal ``pydub.AudioSegment`` fake.

    Each instance represents a 1-second clip, mono, 16-bit, 44.1 kHz.
    Supports concatenation (+=) for chunking tests.
    """

    channels = 1
    frame_rate = 44100
    sample_width = 2  # bytes -> 16 bit

    def __init__(self, duration_ms: int = 1000) -> None:
        self._duration_ms = duration_ms

    def __len__(self) -> int:
        return self._duration_ms

    def __add__(self, other: "_FakeAudioSegment") -> "_FakeAudioSegment":
        return _FakeAudioSegment(self._duration_ms + other._duration_ms)

    def __iadd__(self, other: "_FakeAudioSegment") -> "_FakeAudioSegment":
        return self.__add__(other)

    @classmethod
    def from_mp3(cls, _path: str) -> "_FakeAudioSegment":
        return cls()

    @classmethod
    def from_file(cls, _path: str) -> "_FakeAudioSegment":
        return cls()

    @classmethod
    def empty(cls) -> "_FakeAudioSegment":
        return cls(duration_ms=0)

    @classmethod
    def silent(cls, duration: int = 0, **_: object) -> "_FakeAudioSegment":
        return cls(duration_ms=duration)

    def export(self, path: str, **_: object) -> None:
        Path(path).write_bytes(_FAKE_MP3_BYTES)


def _install_stubs() -> None:
    edge_tts = types.ModuleType("edge_tts")
    edge_tts.Communicate = _FakeCommunicate  # type: ignore[attr-defined]
    edge_tts.list_voices = _fake_list_voices  # type: ignore[attr-defined]
    sys.modules.setdefault("edge_tts", edge_tts)

    pydub = types.ModuleType("pydub")
    pydub.AudioSegment = _FakeAudioSegment  # type: ignore[attr-defined]
    sys.modules.setdefault("pydub", pydub)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session", autouse=True)
def _session_env(tmp_path_factory: pytest.TempPathFactory) -> Iterator[None]:
    """Set up isolated environment and stubs before importing ``backend``."""
    tmp_base = tmp_path_factory.mktemp("voxforge")
    os.environ["VOXFORGE_BASE_DIR"] = str(tmp_base)
    os.environ["VOXFORGE_DATA_SUBDIR"] = "data"
    _install_stubs()
    yield
    os.environ.pop("VOXFORGE_BASE_DIR", None)
    os.environ.pop("VOXFORGE_DATA_SUBDIR", None)


@pytest.fixture(scope="session")
def app(_session_env: None):
    """Import the FastAPI app once stubs are installed."""
    from backend import app as fastapi_app

    return fastapi_app


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_profiles(_session_env: None) -> Iterator[None]:
    """Reset the profiles singleton to guarantee per-test isolation."""
    from backend.dependencies import get_profile_manager

    pm = get_profile_manager()
    pm._profiles.clear()  # noqa: SLF001 - controlled access in tests only
    yield
    pm._profiles.clear()  # noqa: SLF001
