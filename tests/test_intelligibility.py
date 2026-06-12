"""Tests for ASR-in-the-loop intelligibility scoring (VOZ-08).

The transcriber is injectable, so no real Whisper model is ever loaded;
the default path is exercised against the ``faster_whisper`` stub from
``conftest.py``.
"""
from __future__ import annotations

from pathlib import Path

import pytest


# ---------------------------------------------------------------------------
# text_similarity — pure function
# ---------------------------------------------------------------------------


class TestTextSimilarity:
    def test_identical_texts_score_one(self) -> None:
        from backend.services.intelligibility import text_similarity

        assert text_similarity("La noche era oscura.", "La noche era oscura.") == 1.0

    def test_normalization_makes_dr_and_doctor_agree(self) -> None:
        """The expected text says 'Dr.' but ASR transcribes 'Doctor':
        both must normalize identically — no false intelligibility error."""
        from backend.services.intelligibility import text_similarity

        score = text_similarity(
            "El Dr. García llegó a las 3.",
            "El Doctor García llegó a las tres.",
        )
        assert score == 1.0

    def test_wrong_words_score_low(self) -> None:
        from backend.services.intelligibility import text_similarity

        score = text_similarity(
            "La noche era oscura y tranquila en el pueblo.",
            "Quiero comprar manzanas rojas para el mercado.",
        )
        assert score < 0.5

    def test_empty_both_sides_is_perfect(self) -> None:
        from backend.services.intelligibility import text_similarity

        assert text_similarity("", "") == 1.0


# ---------------------------------------------------------------------------
# score_intelligibility — injectable transcriber
# ---------------------------------------------------------------------------


class TestScoreIntelligibility:
    async def test_faithful_audio_beats_sabotaged(self, tmp_path: Path) -> None:
        """A candidate that speaks the expected words must outscore one
        whose transcription drifted (the stub returns a different text
        per file)."""
        from backend.services.intelligibility import score_intelligibility

        faithful = tmp_path / "faithful.wav"
        sabotaged = tmp_path / "sabotaged.wav"
        faithful.write_bytes(b"\x00")
        sabotaged.write_bytes(b"\x00")

        def fake_transcribe(audio_path: Path, language: str | None) -> str:
            if audio_path == faithful:
                return "La noche era oscura y tranquila."
            return "La noche era whisky en el bar abierto."

        expected = "La noche era oscura y tranquila."
        faithful_score = await score_intelligibility(
            faithful, expected, transcriber=fake_transcribe,
        )
        sabotaged_score = await score_intelligibility(
            sabotaged, expected, transcriber=fake_transcribe,
        )

        assert faithful_score == 1.0
        assert sabotaged_score < faithful_score

    async def test_transcription_runs_under_gpu_semaphore(self, tmp_path: Path) -> None:
        """The semaphore must be held during transcription and released
        after — ASR competes with the synthesis engines for the GPU."""
        from backend.gpu_lock import gpu_semaphore
        from backend.services.intelligibility import score_intelligibility

        observed: dict[str, bool] = {}

        def spy_transcribe(audio_path: Path, language: str | None) -> str:
            observed["locked_during"] = gpu_semaphore.locked()
            return "hola"

        await score_intelligibility(
            tmp_path / "a.wav", "hola", transcriber=spy_transcribe,
        )
        assert observed["locked_during"] is True, "semaphore not held during ASR"
        assert gpu_semaphore.locked() is False, "semaphore not released"

    async def test_language_is_forwarded_to_transcriber(self, tmp_path: Path) -> None:
        from backend.services.intelligibility import score_intelligibility

        seen: dict[str, str | None] = {}

        def spy_transcribe(audio_path: Path, language: str | None) -> str:
            seen["language"] = language
            return "hola"

        await score_intelligibility(
            tmp_path / "a.wav", "hola", language="es", transcriber=spy_transcribe,
        )
        assert seen["language"] == "es"


# ---------------------------------------------------------------------------
# Default transcriber — lazy cached singleton over faster-whisper
# ---------------------------------------------------------------------------


class TestDefaultTranscriber:
    def test_model_is_cached_singleton(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from backend.services import intelligibility

        monkeypatch.setattr(intelligibility, "_model", None)
        first = intelligibility._load_model()
        second = intelligibility._load_model()
        assert first is second, "WhisperModel must be loaded once and cached"

    def test_default_transcriber_joins_segments(self, tmp_path: Path) -> None:
        """End-to-end over the conftest ``faster_whisper`` stub (the same
        path CI uses — no model download)."""
        from backend.services import intelligibility

        audio = tmp_path / "x.wav"
        audio.write_bytes(b"\x00")
        text = intelligibility._whisper_transcribe(audio, "en")
        assert text == "Fake transcription line one. Line two of fake text. Final line."

    def test_settings_expose_model_and_threshold(self) -> None:
        from backend.config import settings

        assert settings.whisper_model == "small"
        assert settings.intelligibility_threshold == 0.90
