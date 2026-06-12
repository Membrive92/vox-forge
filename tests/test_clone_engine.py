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
            # Exact count depends on adaptive escalation; just verify it ran
            # within the 2-initial / 4-max candidate budget per chunk (VOZ-08).
            from backend.services.clone_engine import _CANDIDATES_PER_CHUNK, _MAX_CANDIDATES
            assert call_count >= 3 * _CANDIDATES_PER_CHUNK
            assert call_count <= 3 * _MAX_CANDIDATES
            assert path.exists()
            path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_synthesize_long_persists_job_chunks_for_resume(self, tmp_path) -> None:
        """With a job_id, every finished chunk must land in the job dir as
        chunk_NNNN.wav — that's the crash-resume payload (MED-COR-3)."""
        from backend.catalogs import AUDIO_FORMATS
        from backend.services import job_store
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine._device = "cpu"

        def fake_tts_to_file(text, speaker_wav, language, file_path, **_kwargs):
            Path(file_path).write_bytes(b"RIFF" + b"\x00" * 100)

        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        ref_wav = tmp_path / "ref.wav"
        ref_wav.write_bytes(b"RIFF" + b"\x00" * 100)
        job_id = job_store.new_job_id()

        with patch.object(type(engine), "is_available", new_callable=lambda: property(lambda self: True)):
            path, chunk_count = await engine.synthesize_long(
                chunks=["Chunk one.", "Chunk two."],
                speaker_wav=ref_wav,
                language="es",
                output_format="mp3",
                format_config=AUDIO_FORMATS["mp3"],
                job_id=job_id,
            )

        try:
            assert chunk_count == 2
            assert path.exists()
            for i in range(2):
                chunk_file = job_store.chunk_path(job_id, i, "wav")
                assert chunk_file.exists(), f"chunk {i} not persisted in job dir"
                assert chunk_file.stat().st_size > 0
        finally:
            path.unlink(missing_ok=True)
            job_store.cleanup_job(job_id)

    @pytest.mark.asyncio
    async def test_synthesize_long_resume_skips_existing_job_chunks(self, tmp_path) -> None:
        """Resuming a clone job must only synthesize the chunks that are NOT
        already on disk — no re-paying the candidates loop for finished ones."""
        from backend.catalogs import AUDIO_FORMATS
        from backend.services import job_store
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine._device = "cpu"

        synthesized_texts: list[str] = []

        def fake_tts_to_file(text, speaker_wav, language, file_path, **_kwargs):
            synthesized_texts.append(text)
            Path(file_path).write_bytes(b"RIFF" + b"\x00" * 100)

        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        ref_wav = tmp_path / "ref.wav"
        ref_wav.write_bytes(b"RIFF" + b"\x00" * 100)

        # Simulate a crash after chunks 0 and 1 completed.
        job_id = job_store.new_job_id()
        for i in (0, 1):
            seeded = job_store.chunk_path(job_id, i, "wav")
            seeded.parent.mkdir(parents=True, exist_ok=True)
            seeded.write_bytes(b"RIFF" + b"\x00" * 100)

        with patch.object(type(engine), "is_available", new_callable=lambda: property(lambda self: True)):
            path, chunk_count = await engine.synthesize_long(
                chunks=["Chunk one.", "Chunk two.", "Chunk three."],
                speaker_wav=ref_wav,
                language="es",
                output_format="mp3",
                format_config=AUDIO_FORMATS["mp3"],
                job_id=job_id,
            )

        try:
            assert chunk_count == 3
            assert path.exists()
            assert synthesized_texts, "the missing chunk must be synthesized"
            assert all(t == "Chunk three." for t in synthesized_texts), (
                f"already-persisted chunks were re-synthesized: {set(synthesized_texts)}"
            )
        finally:
            path.unlink(missing_ok=True)
            job_store.cleanup_job(job_id)

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
# 1b. ASR-in-the-loop candidate re-ranking (VOZ-08)
#
# Final candidate selection is decided by measured intelligibility
# (services/intelligibility.py); _score_audio only pre-filters obvious
# hallucinations. Budget: 2 candidates, +2 adaptive (4 max) when the
# best falls below settings.intelligibility_threshold.
# ---------------------------------------------------------------------------


def _engine_with_traceable_candidates() -> tuple[object, list[str]]:
    """CloneEngine whose fake model writes each candidate's own filename
    as its content, so the winning candidate is identifiable from the
    final output bytes."""
    from unittest.mock import MagicMock

    from backend.services.clone_engine import CloneEngine

    engine = CloneEngine()
    engine._device = "cpu"
    generated: list[str] = []

    def fake_tts_to_file(text, speaker_wav, language, file_path, **_kwargs):
        name = Path(file_path).name
        generated.append(name)
        Path(file_path).write_bytes(name.encode())

    fake_model = MagicMock()
    fake_model.tts_to_file = fake_tts_to_file
    engine._model = fake_model
    return engine, generated


def _intelligibility_by_candidate(scores: dict[int, float], calls: list[int]):
    """Fake ``score_intelligibility`` keyed by the candidate index parsed
    from the filename (``{file_id}_cand{N}.wav``)."""
    import re

    async def fake(audio_path, expected_text, *, language=None, transcriber=None):
        match = re.search(r"_cand(\d+)\.wav$", audio_path.name)
        assert match is not None, f"unexpected candidate name: {audio_path.name}"
        index = int(match.group(1))
        calls.append(index)
        return scores[index]

    return fake


class TestCandidateReranking:
    """synthesize_chunk must pick by intelligibility, not signal score."""

    @pytest.mark.asyncio
    async def test_sabotaged_candidate_loses_against_faithful(self) -> None:
        """cand0 is fluent-but-wrong (sabotaged), cand1 speaks the text:
        the faithful one must win, and no escalation happens because the
        best is above threshold."""
        from backend.services import clone_engine

        engine, generated = _engine_with_traceable_candidates()
        calls: list[int] = []
        fake_score = _intelligibility_by_candidate({0: 0.55, 1: 0.97}, calls)

        with patch.object(
            type(engine), "is_available",
            new_callable=lambda: property(lambda self: True),
        ), patch.object(clone_engine, "score_intelligibility", fake_score):
            output = await engine.synthesize_chunk("Hola mundo.", "ref.wav")

        try:
            assert output.read_bytes().decode().endswith("_cand1.wav"), (
                "the most intelligible candidate must be selected"
            )
            assert len(generated) == clone_engine._CANDIDATES_PER_CHUNK, (
                "no adaptive escalation when best >= threshold"
            )
        finally:
            output.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_adaptive_scaling_triggers_only_below_threshold(self) -> None:
        """First round all below threshold ⇒ exactly one extra round of 2
        (4 total), and the round-one candidates are NOT re-transcribed."""
        from backend.services import clone_engine

        engine, generated = _engine_with_traceable_candidates()
        calls: list[int] = []
        fake_score = _intelligibility_by_candidate(
            {0: 0.40, 1: 0.50, 2: 0.95, 3: 0.60}, calls,
        )

        with patch.object(
            type(engine), "is_available",
            new_callable=lambda: property(lambda self: True),
        ), patch.object(clone_engine, "score_intelligibility", fake_score):
            output = await engine.synthesize_chunk("Hola mundo.", "ref.wav")

        try:
            assert len(generated) == clone_engine._MAX_CANDIDATES
            assert output.read_bytes().decode().endswith("_cand2.wav")
            assert sorted(calls) == [0, 1, 2, 3], (
                "each candidate must be ASR-scored exactly once (cached)"
            )
        finally:
            output.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_accepts_best_available_with_warning_when_all_below(
        self, caplog: pytest.LogCaptureFixture,
    ) -> None:
        """If even the escalated round stays below threshold, the best
        available candidate is accepted and a warning is logged."""
        import logging

        from backend.services import clone_engine

        engine, generated = _engine_with_traceable_candidates()
        calls: list[int] = []
        fake_score = _intelligibility_by_candidate(
            {0: 0.40, 1: 0.50, 2: 0.45, 3: 0.60}, calls,
        )

        with patch.object(
            type(engine), "is_available",
            new_callable=lambda: property(lambda self: True),
        ), patch.object(clone_engine, "score_intelligibility", fake_score), \
                caplog.at_level(logging.WARNING, logger="backend.services.clone_engine"):
            output = await engine.synthesize_chunk("Hola mundo.", "ref.wav")

        try:
            assert len(generated) == clone_engine._MAX_CANDIDATES
            assert output.read_bytes().decode().endswith("_cand3.wav")
            assert "best-available" in caplog.text, (
                "accepting a below-threshold candidate must warn"
            )
        finally:
            output.unlink(missing_ok=True)


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

    def test_failed_clone_job_records_xtts_engine(self, client) -> None:
        """The crash-safe JobRecord must persist the engine the request
        actually routes to (MED-COR-3) — it was hardcoded to 'edge-tts',
        making crashed clone jobs lie in the resume UI."""
        from backend.services import job_store

        profile = _create_profile_with_sample(client)
        job_id = job_store.new_job_id()

        response = client.post(
            "/api/synthesize",
            json={
                "text": "Hello world.",
                "voice_id": "es-ES-AlvaroNeural",
                "output_format": "mp3",
                "profile_id": profile["id"],
            },
            headers={"X-Synthesis-Job-ID": job_id},
        )
        # No CUDA in tests: the clone attempt fails and leaves the record.
        assert response.status_code == 500

        try:
            jobs = client.get("/api/synthesize/incomplete").json()["jobs"]
            job = next((j for j in jobs if j["job_id"] == job_id), None)
            assert job is not None, "failed clone job must be listed as incomplete"
            assert job["engine"] == "xtts-v2"
        finally:
            client.delete(f"/api/synthesize/incomplete/{job_id}")

    def test_failed_edge_job_records_edge_engine(self, client) -> None:
        """Sanity counterpart: a sampleless request records 'edge-tts'."""
        from backend.exceptions import SynthesisError
        from backend.services import job_store
        from backend.services.tts_engine import TTSEngine

        job_id = job_store.new_job_id()
        with patch.object(
            TTSEngine, "synthesize", AsyncMock(side_effect=SynthesisError("crash")),
        ):
            response = client.post(
                "/api/synthesize",
                json={
                    "text": "Hello world.",
                    "voice_id": "es-ES-AlvaroNeural",
                    "output_format": "mp3",
                },
                headers={"X-Synthesis-Job-ID": job_id},
            )
        assert response.status_code == 500

        try:
            jobs = client.get("/api/synthesize/incomplete").json()["jobs"]
            job = next((j for j in jobs if j["job_id"] == job_id), None)
            assert job is not None
            assert job["engine"] == "edge-tts"
        finally:
            client.delete(f"/api/synthesize/incomplete/{job_id}")

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


# ---------------------------------------------------------------------------
# 4. Speed policy regression tests (VOZ-04)
#
# XTTS's native ``speed`` kwarg is NEVER forwarded: with long speaker_wavs
# the model silently ignores it, and when it acts the quality is poor (and
# it nudges Spanish toward a Latin American accent). Clone speed is always
# resolved as a Rubber Band post-stretch over natural-cadence output.
# ---------------------------------------------------------------------------


class TestSpeedNeverReachesXtts:
    """No path may forward a ``speed`` kwarg to ``tts_to_file``."""

    @pytest.mark.asyncio
    async def test_raw_synthesize_never_forwards_speed(self, tmp_path) -> None:
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        engine._device = "cpu"
        captured_kwargs: dict = {}

        def fake_tts_to_file(text, speaker_wav, language, file_path, **kwargs):
            captured_kwargs.update(kwargs)
            Path(file_path).write_bytes(b"RIFF" + b"\x00" * 100)

        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        ref_wav = tmp_path / "ref.wav"
        ref_wav.write_bytes(b"RIFF" + b"\x00" * 100)
        out_wav = tmp_path / "out.wav"

        with patch.object(
            type(engine), "is_available",
            new_callable=lambda: property(lambda self: True),
        ):
            await engine.raw_synthesize(
                text="Hello world.",
                speaker_wav=str(ref_wav),
                language="es",
                output_path=out_wav,
            )

        assert "speed" not in captured_kwargs, (
            "raw_synthesize must never forward speed to XTTS — speed is a "
            "Rubber Band post-stretch concern (VOZ-04)."
        )

    @pytest.mark.asyncio
    async def test_generate_one_never_forwards_speed(self, tmp_path) -> None:
        """The candidates path must also synthesize at natural cadence."""
        from backend.services.clone_engine import CloneEngine

        engine = CloneEngine()
        captured_kwargs: dict = {}

        def fake_tts_to_file(**kwargs):
            captured_kwargs.update(kwargs)
            Path(str(kwargs["file_path"])).write_bytes(b"RIFF" + b"\x00" * 100)

        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        await engine._generate_one("hola", "ref.wav", "es", tmp_path / "o.wav")

        assert "speed" not in captured_kwargs, (
            "_generate_one must never forward speed to XTTS (VOZ-04)."
        )

    @pytest.mark.asyncio
    async def test_synthesize_long_post_stretches_master(self, tmp_path) -> None:
        """speed != 1.0 ⇒ exactly one Rubber Band pass over the master."""
        from backend.services import clone_engine

        engine = clone_engine.CloneEngine()

        async def fake_chunk(text, speaker_wav, language, cancel_token=None):
            p = tmp_path / f"chunk_{len(text)}.wav"
            p.write_bytes(b"RIFF" + b"\x00" * 100)
            return p

        engine.synthesize_chunk = fake_chunk  # type: ignore[method-assign]

        stretch_calls: list[float] = []

        def fake_stretch(path: Path, rate: float) -> bool:
            stretch_calls.append(rate)
            return True

        with patch.object(clone_engine, "time_stretch_wav", fake_stretch):
            path, count = await engine.synthesize_long(
                chunks=["Hola mundo."],
                speaker_wav=tmp_path / "ref.wav",
                language="es",
                output_format="mp3",
                format_config={"format": "mp3", "codec": None, "parameters": []},
                speed=0.8,
            )

        assert stretch_calls == [0.8], (
            "synthesize_long must post-stretch the concatenated master "
            "exactly once with the requested rate."
        )
        assert count == 1
        path.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_synthesize_long_skips_stretch_at_natural_speed(
        self, tmp_path
    ) -> None:
        from backend.services import clone_engine

        engine = clone_engine.CloneEngine()

        async def fake_chunk(text, speaker_wav, language, cancel_token=None):
            p = tmp_path / "chunk.wav"
            p.write_bytes(b"RIFF" + b"\x00" * 100)
            return p

        engine.synthesize_chunk = fake_chunk  # type: ignore[method-assign]

        with patch.object(clone_engine, "time_stretch_wav") as stretch_spy:
            path, _ = await engine.synthesize_long(
                chunks=["Hola."],
                speaker_wav=tmp_path / "ref.wav",
                language="es",
                output_format="mp3",
                format_config={"format": "mp3", "codec": None, "parameters": []},
                speed=1.0,
            )

        stretch_spy.assert_not_called()
        path.unlink(missing_ok=True)


class TestExperimentalEndpointSpeed:
    """Verify the /experimental/cross-lingual endpoint accepts and forwards speed."""

    def test_endpoint_accepts_speed_param(self, client) -> None:
        """Endpoint must accept ``speed`` form field (returns 500 only because no CUDA)."""
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {
            "text": "Hello",
            "language": "es",
            "output_format": "mp3",
            "speed": "75",
        }
        response = client.post(
            "/api/experimental/cross-lingual",
            data=data,
            files=files,
        )
        # Without CUDA, the endpoint reaches the engine then fails — the point
        # is that the schema validation accepts the speed field (no 422).
        assert response.status_code != 422, (
            f"Endpoint rejected speed param: {response.json()}"
        )

    def test_endpoint_omitting_speed_defaults_to_100(self, client) -> None:
        """Speed is optional with default 100."""
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {
            "text": "Hello",
            "language": "es",
            "output_format": "mp3",
        }
        response = client.post(
            "/api/experimental/cross-lingual",
            data=data,
            files=files,
        )
        assert response.status_code != 422


# ---------------------------------------------------------------------------
# 5. Sampler parameters (VOZ-09)
#
# The decoding params were strangled to near-greedy emergency values
# (temperature=0.1, top_p=0.4, top_k=20, repetition_penalty=10.0) while
# candidate selection was blind to diction. With the ASR re-ranker
# (VOZ-08) as the safety net, the sampler is reopened and every value is
# read from settings so the HUMANO A/B can iterate via VOXFORGE_XTTS_*
# env vars without code changes.
# ---------------------------------------------------------------------------


class TestSamplerParams:
    """Decoding params come from settings, with the reopened defaults."""

    def test_reopened_defaults(self) -> None:
        from backend.config import settings

        assert settings.xtts_temperature == 0.70
        assert settings.xtts_top_p == 0.85
        assert settings.xtts_top_k == 50
        assert settings.xtts_repetition_penalty == 6.0
        assert settings.xtts_num_beams == 1
        assert settings.xtts_gpt_cond_len == 30

    @pytest.mark.asyncio
    async def test_generate_one_forwards_settings_values(
        self, tmp_path, monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Changing settings must reach the model on the next inference —
        no module-level snapshot frozen at import time."""
        from backend.config import settings
        from backend.services.clone_engine import CloneEngine

        monkeypatch.setattr(settings, "xtts_temperature", 0.42)
        monkeypatch.setattr(settings, "xtts_top_p", 0.66)
        monkeypatch.setattr(settings, "xtts_top_k", 33)
        monkeypatch.setattr(settings, "xtts_repetition_penalty", 4.5)
        monkeypatch.setattr(settings, "xtts_gpt_cond_len", 12)

        engine = CloneEngine()
        captured: dict = {}

        def fake_tts_to_file(**kwargs):
            captured.update(kwargs)
            Path(str(kwargs["file_path"])).write_bytes(b"RIFF" + b"\x00" * 100)

        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        await engine._generate_one("hola", "ref.wav", "es", tmp_path / "o.wav")

        assert captured["temperature"] == 0.42
        assert captured["top_p"] == 0.66
        assert captured["top_k"] == 33
        assert captured["repetition_penalty"] == 4.5
        assert captured["gpt_cond_len"] == 12
        assert captured["num_beams"] == 1, (
            "beam search is unstable in XTTS v2 — num_beams must stay 1"
        )


async def test_generate_one_holds_gpu_semaphore_per_inference(tmp_path) -> None:
    """The GPU semaphore is held during the inference and released after.

    Guards the refactor that moved the lock from the whole candidate loop
    down to each single inference (so other GPU work can interleave).
    """
    from pathlib import Path

    from backend.services import clone_engine

    engine = clone_engine.CloneEngine()
    observed = {"locked_during": None}

    class _Model:
        @staticmethod
        def tts_to_file(**kwargs: object) -> None:
            observed["locked_during"] = clone_engine._gpu_semaphore.locked()
            Path(str(kwargs["file_path"])).write_bytes(b"\x00")

    engine._model = _Model()  # type: ignore[assignment]
    await engine._generate_one("hola", "ref.wav", "es", tmp_path / "o.wav")

    assert observed["locked_during"] is True, "semaphore not held during inference"
    assert clone_engine._gpu_semaphore.locked() is False, "semaphore not released"
