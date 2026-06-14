"""Tests for the catalog tone-color reference helper (Phase 1 re-voice).

``edge_tts`` is stubbed in conftest, so synthesis writes static bytes and
no network/GPU is touched. ``CATALOG_REFS_DIR`` is monkeypatched to a
tmp dir so the real ``data/voices/`` is never written.
"""
from __future__ import annotations

from pathlib import Path

import pytest

# NOTE: ``backend.*`` is imported INSIDE each test, never at module level —
# importing it triggers ``backend/__init__`` -> ``from .main import app``,
# which pulls in the real pydub at COLLECTION time and defeats the
# ``setdefault`` audio stubs installed by the ``_session_env`` fixture.


async def test_unknown_voice_raises(monkeypatch, tmp_path: Path) -> None:
    from backend.exceptions import UnsupportedVoiceError
    from backend.services import catalog_reference as cr

    monkeypatch.setattr(cr, "CATALOG_REFS_DIR", tmp_path)
    with pytest.raises(UnsupportedVoiceError):
        await cr.get_or_create_catalog_reference("not-a-real-voice")


async def test_synthesizes_then_caches(monkeypatch, tmp_path: Path) -> None:
    from backend.services import catalog_reference as cr

    monkeypatch.setattr(cr, "CATALOG_REFS_DIR", tmp_path)
    voice_id = "es-ES-AlvaroNeural"

    first = await cr.get_or_create_catalog_reference(voice_id)
    assert first.exists() and first.stat().st_size > 0
    assert first.parent == tmp_path
    assert first.name == f"{voice_id}.mp3"

    # A second call reuses the cached file without re-synthesizing: the
    # early-return path never touches the file, so mtime is unchanged.
    mtime = first.stat().st_mtime
    second = await cr.get_or_create_catalog_reference(voice_id)
    assert second == first
    assert second.stat().st_mtime == mtime


async def test_english_voice_uses_english_text(monkeypatch, tmp_path: Path) -> None:
    """Reference text is chosen by the voice's locale prefix."""
    from backend.services import catalog_reference as cr

    monkeypatch.setattr(cr, "CATALOG_REFS_DIR", tmp_path)
    assert "quick brown fox" in cr._reference_text("en-US-JennyNeural")
    assert "murciélago" in cr._reference_text("es-MX-DaliaNeural")
