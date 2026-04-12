"""Unit and integration tests for voice cloning (CloneEngine + dual routing).

Tests are structured in three layers:
1. CloneEngine unit tests (mocked model, no real XTTS)
2. TTSEngine routing tests (verifies correct engine selection)
3. API integration tests (full HTTP flow with cloned voice)
"""
from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fake_wav() -> io.BytesIO:
    buf = io.BytesIO(b"RIFF" + b"\x00" * 40)
    buf.name = "sample.wav"
    return buf


def _create_profile_with_sample(client) -> dict:
    """Create a profile with an attached audio sample via the API."""
    return client.post(
        "/api/profiles",
        data={
            "name": "Cloned Voice",
            "voice_id": "es-ES-AlvaroNeural",
            "language": "es",
            "speed": 100,
            "pitch": 0,
            "volume": 80,
        },
        files={"sample": ("voice.wav", _fake_wav(), "audio/wav")},
    ).json()


def _create_profile_without_sample(client) -> dict:
    """Create a profile without an audio sample."""
    return client.post(
        "/api/profiles",
        data={
            "name": "No Sample",
            "voice_id": "es-ES-AlvaroNeural",
            "language": "es",
            "speed": 100,
            "pitch": 0,
            "volume": 80,
        },
    ).json()


# ---------------------------------------------------------------------------
# 1. CloneEngine unit tests
# ---------------------------------------------------------------------------

class TestCloneEngineUnit:
    """Unit tests for CloneEngine with mocked internals."""

    def test_init_defaults(self) -> None:
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        assert not engine.is_loaded
        # is_available depends on torch.cuda stub (False in tests)
        assert not engine.is_available

    def test_is_loaded_after_mock_load(self) -> None:
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine._model = MagicMock()
        assert engine.is_loaded

    def test_unload_clears_model(self) -> None:
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine._model = MagicMock()
        engine.unload_model()
        assert not engine.is_loaded

    def test_unload_when_no_model_is_noop(self) -> None:
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine.unload_model()  # should not raise
        assert not engine.is_loaded

    @pytest.mark.asyncio
    async def test_synthesize_chunk_raises_without_cuda(self) -> None:
        from backend.services.clone_engine import CloneEngine
        from backend.exceptions import SynthesisError

        engine = CloneEngine()
        with pytest.raises(SynthesisError, match="CUDA"):
            await engine.synthesize_chunk("Hello", "fake.wav")

    @pytest.mark.asyncio
    async def test_synthesize_chunk_with_mocked_model(self, tmp_path) -> None:
        """Simulate a successful synthesis with a mocked XTTS model."""
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        # Pretend CUDA is available
        engine._device = "cpu"

        # Mock the model's tts_to_file
        fake_model = MagicMock()
        def fake_tts_to_file(text, speaker_wav, language, file_path, **_kwargs):
            Path(file_path).write_bytes(b"RIFF" + b"\x00" * 100)
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        # Patch is_available to return True
        with patch.object(type(engine), "is_available", new_callable=lambda: property(lambda self: True)):
            result = await engine.synthesize_chunk("Hello world.", tmp_path / "ref.wav")
            assert result.exists()
            assert result.stat().st_size > 0
            result.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_synthesize_long_concatenates_chunks(self, tmp_path) -> None:
        """Verify synthesize_long produces a single output from multiple chunks."""
        from backend.services.clone_engine import CloneEngine
        from backend.catalogs import AUDIO_FORMATS

        engine = CloneEngine()
        engine._device = "cpu"

        call_count = 0
        def fake_tts_to_file(text, speaker_wav, language, file_path, **_kwargs):
            nonlocal call_count
            call_count += 1
            Path(file_path).write_bytes(b"RIFF" + b"\x00" * 100)
        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        with patch.object(type(engine), "is_available", new_callable=lambda: property(lambda self: True)):
            ref_wav = tmp_path / "ref.wav"
            ref_wav.write_bytes(b"RIFF" + b"\x00" * 100)

            path, chunk_count = await engine.synthesize_long(
                chunks=["Chunk one.", "Chunk two.", "Chunk three."],
                speaker_wav=ref_wav,
                language="es",
                output_format="mp3",
                format_config=AUDIO_FORMATS["mp3"],
            )
            assert chunk_count == 3
            # Exact count depends on candidates and retries; just verify it ran
            from backend.services.clone_engine import _CANDIDATES_PER_CHUNK, _MAX_RETRIES
            assert call_count >= 3 * _CANDIDATES_PER_CHUNK
            assert call_count <= 3 * _CANDIDATES_PER_CHUNK * (1 + _MAX_RETRIES)
            assert path.exists()
            path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_synthesize_chunk_cleans_up_on_error(self) -> None:
        """Verify temp files are cleaned up when synthesis fails."""
        from backend.services.clone_engine import CloneEngine
        from backend.exceptions import SynthesisError

        engine = CloneEngine()
        engine._device = "cpu"

        fake_model = MagicMock()
        fake_model.tts_to_file = MagicMock(side_effect=RuntimeError("Model crashed"))
        engine._model = fake_model

        with patch.object(type(engine), "is_available", new_callable=lambda: property(lambda self: True)):
            with pytest.raises(SynthesisError, match="Model crashed"):
                await engine.synthesize_chunk("Test", "fake.wav")

    def test_load_model_is_idempotent(self) -> None:
        """Calling load_model twice doesn't reload."""
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine._model = MagicMock()
        original = engine._model
        engine.load_model()
        assert engine._model is original  # not replaced

    def test_xtts_languages_mapping(self) -> None:
        from backend.services.clone_engine import XTTS_LANGUAGES

        assert XTTS_LANGUAGES["es"] == "es"
        assert XTTS_LANGUAGES["en"] == "en"
        assert "es" in XTTS_LANGUAGES
        assert "en" in XTTS_LANGUAGES


# ---------------------------------------------------------------------------
# 2. TTSEngine routing tests
# ---------------------------------------------------------------------------

class TestDualEngineRouting:
    """Verify TTSEngine routes to the correct engine based on profile."""

    @pytest.mark.asyncio
    async def test_no_profile_uses_edge_tts(self) -> None:
        """Without a profile_id, Edge-TTS is used."""
        from backend.schemas import SynthesisRequest
        from backend.dependencies import get_tts_engine

        engine = get_tts_engine()
        request = SynthesisRequest(
            text="Hello",
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
        )
        result = await engine.synthesize(request)
        assert result.engine == "edge-tts"
        result.path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_profile_without_sample_uses_edge_tts(self) -> None:
        """A profile without a voice sample still uses Edge-TTS."""
        from backend.schemas import SynthesisRequest, VoiceProfile
        from backend.dependencies import get_profile_manager, get_tts_engine

        pm = get_profile_manager()
        profile = VoiceProfile(
            name="No Sample",
            voice_id="es-ES-AlvaroNeural",
        )
        await pm.create(profile)

        engine = get_tts_engine()
        request = SynthesisRequest(
            text="Hello",
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
            profile_id=profile.id,
        )
        result = await engine.synthesize(request)
        assert result.engine == "edge-tts"
        result.path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_profile_with_sample_routes_to_clone(self) -> None:
        """A profile with a voice sample should route to XTTS v2.

        Since CUDA is unavailable in tests, this verifies the routing
        logic by checking that SynthesisError is raised with the CUDA
        message (meaning it correctly tried to use CloneEngine).
        """
        from backend.schemas import SynthesisRequest, VoiceProfile
        from backend.dependencies import get_profile_manager, get_tts_engine
        from backend.exceptions import SynthesisError
        from backend.paths import VOICES_DIR

        pm = get_profile_manager()

        # Create a fake sample file
        sample_filename = "test_routing_sample.wav"
        (VOICES_DIR / sample_filename).write_bytes(b"RIFF" + b"\x00" * 100)

        profile = VoiceProfile(
            name="Cloned",
            voice_id="es-ES-AlvaroNeural",
            sample_filename=sample_filename,
            sample_duration=10.0,
        )
        await pm.create(profile)

        engine = get_tts_engine()
        request = SynthesisRequest(
            text="Hello",
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
            profile_id=profile.id,
        )

        # In test env, CUDA is not available, so CloneEngine raises
        with pytest.raises(SynthesisError, match="CUDA"):
            await engine.synthesize(request)

        (VOICES_DIR / sample_filename).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_profile_with_missing_sample_file_falls_back_to_edge(self) -> None:
        """If profile references a sample that doesn't exist on disk, use Edge-TTS."""
        from backend.schemas import SynthesisRequest, VoiceProfile
        from backend.dependencies import get_profile_manager, get_tts_engine

        pm = get_profile_manager()
        profile = VoiceProfile(
            name="Missing File",
            voice_id="es-ES-AlvaroNeural",
            sample_filename="nonexistent.wav",
            sample_duration=10.0,
        )
        await pm.create(profile)

        engine = get_tts_engine()
        request = SynthesisRequest(
            text="Hello",
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
            profile_id=profile.id,
        )
        result = await engine.synthesize(request)
        assert result.engine == "edge-tts"  # fallback
        result.path.unlink(missing_ok=True)

    def test_synthesis_result_dataclass(self) -> None:
        from backend.services.tts_engine import SynthesisResult

        r = SynthesisResult(path=Path("/tmp/test.mp3"), chunks=3, engine="edge-tts")
        assert r.path == Path("/tmp/test.mp3")
        assert r.chunks == 3
        assert r.engine == "edge-tts"
        # Frozen dataclass
        with pytest.raises(AttributeError):
            r.engine = "xtts-v2"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# 3. API integration tests
# ---------------------------------------------------------------------------

class TestCloneAPI:
    """Integration tests through the HTTP API."""

    def test_synthesis_without_profile_returns_edge_tts_engine(self, client) -> None:
        response = client.post("/api/synthesize", json={
            "text": "Hello world.",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "mp3",
            "speed": 100,
            "pitch": 0,
            "volume": 80,
        })
        assert response.status_code == 200
        assert response.headers.get("x-audio-engine") == "edge-tts"

    def test_synthesis_with_sampleless_profile_returns_edge_tts(self, client) -> None:
        profile = _create_profile_without_sample(client)
        response = client.post("/api/synthesize", json={
            "text": "Hello world.",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "mp3",
            "speed": 100,
            "pitch": 0,
            "volume": 80,
            "profile_id": profile["id"],
        })
        assert response.status_code == 200
        assert response.headers.get("x-audio-engine") == "edge-tts"

    def test_synthesis_with_cloned_profile_attempts_xtts(self, client) -> None:
        """Profile with sample triggers XTTS path.

        In test env (no CUDA), this returns 500 with a clear error message,
        proving the routing works and the error is handled gracefully.
        """
        profile = _create_profile_with_sample(client)
        assert profile["sample_filename"] is not None

        response = client.post("/api/synthesize", json={
            "text": "Hello world.",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "mp3",
            "speed": 100,
            "pitch": 0,
            "volume": 80,
            "profile_id": profile["id"],
        })
        # Clone engine raises SynthesisError(CUDA not available) -> 500
        assert response.status_code == 500
        body = response.json()
        assert body["code"] == "synthesis_failed"
        assert "CUDA" in body.get("technical", body.get("detail", ""))

    def test_profile_with_sample_shows_sample_info(self, client) -> None:
        """Verify the profile correctly stores sample metadata."""
        profile = _create_profile_with_sample(client)
        assert profile["sample_filename"] is not None
        assert profile["sample_filename"].endswith(".wav")
        assert profile["sample_duration"] == 1.0  # from fake AudioSegment

    def test_upload_sample_then_synthesize_routes_correctly(self, client) -> None:
        """Full flow: create profile -> upload sample -> synthesize."""
        # Create profile without sample
        profile = _create_profile_without_sample(client)

        # Synthesize with Edge-TTS (no sample yet)
        r1 = client.post("/api/synthesize", json={
            "text": "Test one.",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "mp3",
            "profile_id": profile["id"],
        })
        assert r1.status_code == 200
        assert r1.headers.get("x-audio-engine") == "edge-tts"

        # Attach a sample
        client.post(
            "/api/voices/upload-sample",
            files={"sample": ("voice.wav", _fake_wav(), "audio/wav")},
            data={"profile_id": profile["id"]},
        )

        # Now synthesize again — should route to clone (and fail with CUDA error)
        r2 = client.post("/api/synthesize", json={
            "text": "Test two.",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "mp3",
            "profile_id": profile["id"],
        })
        assert r2.status_code == 500
        body = r2.json()
        assert "CUDA" in body.get("technical", body.get("detail", ""))

    def test_delete_sample_profile_falls_back_to_edge(self, client) -> None:
        """After deleting a profile with sample, a new sampleless profile uses Edge-TTS."""
        profile = _create_profile_with_sample(client)
        profile_id = profile["id"]

        # Delete the profile
        client.delete(f"/api/profiles/{profile_id}")

        # Create new sampleless profile
        new_profile = _create_profile_without_sample(client)
        response = client.post("/api/synthesize", json={
            "text": "Test.",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "mp3",
            "profile_id": new_profile["id"],
        })
        assert response.status_code == 200
        assert response.headers.get("x-audio-engine") == "edge-tts"
