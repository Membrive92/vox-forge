"""Tests for the Castilian-accent warm-up helper and the experimental
endpoint variants that consume it."""
from __future__ import annotations

import io
from pathlib import Path

import pytest


def _fake_wav() -> io.BytesIO:
    buf = io.BytesIO(b"RIFF" + b"\x00" * 40)
    buf.name = "sample.wav"
    return buf


# ── Unit: text wrapping ─────────────────────────────────────────────


class TestWrapTextWithWarmup:
    def test_prepends_phrase_and_pause(self) -> None:
        from backend.services.castilian_warmup import wrap_text_with_warmup

        wrapped = wrap_text_with_warmup("Hola mundo")
        # Must contain the user's text at the end
        assert wrapped.endswith("Hola mundo")
        # Must start with Castilian-flavored words
        assert "España" in wrapped or "Barcelona" in wrapped
        # Must include some pause cue (sequence of periods)
        assert "." in wrapped

    def test_handles_empty_text(self) -> None:
        from backend.services.castilian_warmup import wrap_text_with_warmup

        wrapped = wrap_text_with_warmup("")
        # Even empty input should produce the warm-up phrase (caller decides)
        assert len(wrapped) > 0


# ── Unit: reference voice discovery ─────────────────────────────────


class TestReferenceVoice:
    def test_returns_none_when_directory_empty(self, tmp_path, monkeypatch) -> None:
        from backend.services import castilian_warmup as mod

        empty_dir = tmp_path / "ref"
        empty_dir.mkdir()
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", empty_dir)

        assert mod.get_reference_voice() is None

    def test_returns_first_audio_file_alphabetically(
        self, tmp_path, monkeypatch
    ) -> None:
        from backend.services import castilian_warmup as mod

        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        # Create out of order to verify sorting
        (ref_dir / "z_zebra.wav").write_bytes(b"RIFF\x00\x00\x00\x00")
        (ref_dir / "a_castilian.wav").write_bytes(b"RIFF\x00\x00\x00\x00")
        # Non-audio file should be ignored
        (ref_dir / "readme.txt").write_text("ignore me")
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", ref_dir)

        result = mod.get_reference_voice()
        assert result is not None
        assert result.name == "a_castilian.wav"

    def test_ignores_non_audio_files(self, tmp_path, monkeypatch) -> None:
        from backend.services import castilian_warmup as mod

        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        (ref_dir / "manifest.json").write_text("{}")
        (ref_dir / "voice.wav").write_bytes(b"RIFF\x00\x00\x00\x00")
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", ref_dir)

        result = mod.get_reference_voice()
        assert result is not None
        assert result.suffix == ".wav"

    def test_returns_none_when_dir_missing(self, tmp_path, monkeypatch) -> None:
        from backend.services import castilian_warmup as mod

        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", tmp_path / "nonexistent")
        assert mod.get_reference_voice() is None


# ── Unit: trim helper ───────────────────────────────────────────────


class TestTrimWarmupAudio:
    """The trim helper relies on pydub.silence.detect_silence. Our
    pytest stub for AudioSegment doesn't expose a real waveform, so
    these tests verify the helper degrades gracefully rather than
    crashing — the actual trim is exercised end-to-end by E2E."""

    def test_returns_false_when_pydub_missing(self, tmp_path, monkeypatch) -> None:
        import sys

        from backend.services import castilian_warmup as mod

        # Force the import inside the function to fail
        original_silence = sys.modules.pop("pydub.silence", None)
        if "pydub.silence" in sys.modules:
            del sys.modules["pydub.silence"]
        # Make pydub.silence raise on import
        sys.modules["pydub.silence"] = None  # type: ignore[assignment]
        try:
            result = mod.trim_warmup_audio(tmp_path / "missing.wav")
            assert result is False
        finally:
            if original_silence is not None:
                sys.modules["pydub.silence"] = original_silence
            else:
                sys.modules.pop("pydub.silence", None)

    def test_returns_false_on_unreadable_file(self, tmp_path) -> None:
        from backend.services.castilian_warmup import trim_warmup_audio

        # Path that doesn't exist — pydub will raise; helper must swallow it
        result = trim_warmup_audio(tmp_path / "does_not_exist.wav")
        assert result is False


# ── Endpoint integration: new params accepted ───────────────────────


class TestExperimentalEndpointFlags:
    """The single-take endpoint must accept the new flags without
    422 validation errors. Actual synthesis fails at the engine layer
    (no CUDA in tests), but we only assert the schema."""

    def test_accepts_castilian_warmup_flag(self, client) -> None:
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {
            "text": "hola",
            "language": "es",
            "output_format": "mp3",
            "castilian_warmup": "true",
        }
        r = client.post("/api/experimental/cross-lingual", data=data, files=files)
        assert r.status_code != 422, r.json()

    def test_accepts_use_castilian_reference_flag(self, client) -> None:
        # No reference voice configured in test env, so we expect 400 — but
        # crucially NOT 422 (schema validation pass).
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {
            "text": "hola",
            "language": "es",
            "output_format": "mp3",
            "use_castilian_reference": "true",
        }
        r = client.post("/api/experimental/cross-lingual", data=data, files=files)
        assert r.status_code in (400, 500), r.json()
        if r.status_code == 400:
            assert "reference" in r.json().get("detail", "").lower()

    def test_use_reference_succeeds_when_configured(
        self, client, tmp_path, monkeypatch
    ) -> None:
        """When a reference file is dropped under the configured dir, the
        D1 flag should NOT 400; it should reach the engine (and 500 only
        because there's no CUDA in tests)."""
        from backend.services import castilian_warmup as mod

        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        (ref_dir / "castilian.wav").write_bytes(b"RIFF" + b"\x00" * 40)
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", ref_dir)

        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {
            "text": "hola",
            "language": "es",
            "use_castilian_reference": "true",
        }
        r = client.post("/api/experimental/cross-lingual", data=data, files=files)
        # 500 (no CUDA) is fine; 400 (no reference) is the regression we guard against.
        assert r.status_code != 400, r.json()


class TestCandidatesEndpoint:
    def test_rejects_zero_candidates(self, client) -> None:
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {"text": "hola", "candidates": "0"}
        r = client.post(
            "/api/experimental/cross-lingual/candidates", data=data, files=files
        )
        assert r.status_code == 400

    def test_rejects_more_than_max(self, client) -> None:
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {"text": "hola", "candidates": "10"}
        r = client.post(
            "/api/experimental/cross-lingual/candidates", data=data, files=files
        )
        assert r.status_code == 400

    def test_accepts_valid_candidate_count(self, client) -> None:
        files = {"voice_sample": ("ref.wav", _fake_wav(), "audio/wav")}
        data = {"text": "hola", "candidates": "3"}
        r = client.post(
            "/api/experimental/cross-lingual/candidates", data=data, files=files
        )
        # 500 = synthesis failed (no CUDA); 200 = unlikely in tests.
        # Importantly, NOT 400 or 422.
        assert r.status_code not in (400, 422), r.json()


class TestReferenceVoiceEndpoint:
    def test_reports_unconfigured_in_clean_test_env(
        self, client, tmp_path, monkeypatch
    ) -> None:
        from backend.services import castilian_warmup as mod

        empty = tmp_path / "ref"
        empty.mkdir()
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", empty)

        r = client.get("/api/experimental/reference-voice")
        assert r.status_code == 200
        body = r.json()
        assert body["configured"] is False

    def test_reports_configured_with_filename(
        self, client, tmp_path, monkeypatch
    ) -> None:
        from backend.services import castilian_warmup as mod

        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        (ref_dir / "alvaro_castellano.wav").write_bytes(b"RIFF" + b"\x00" * 40)
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", ref_dir)

        r = client.get("/api/experimental/reference-voice")
        assert r.status_code == 200
        body = r.json()
        assert body["configured"] is True
        assert body["filename"] == "alvaro_castellano.wav"


# ── Plumbing: warmup wraps text before synthesis ────────────────────


class TestTimeStretch:
    """Post-synthesis time-stretching replaces XTTS's unreliable speed kwarg.

    The model silently ignores ``speed`` when the speaker_wav is long
    (e.g. with audio anchor), so we stretch the output ourselves with
    pedalboard's Rubber Band ``time_stretch``. These tests guard the
    helper's no-op cases — real durations and the ±25% clamp are
    covered in ``test_audio_stretch.py``.
    """

    def test_returns_false_when_rate_is_one(self, tmp_path) -> None:
        from backend.services.castilian_warmup import time_stretch_wav

        # File doesn't even need to exist — the early-out kicks in before
        # any I/O happens.
        result = time_stretch_wav(tmp_path / "missing.wav", 1.0)
        assert result is False

    def test_returns_false_when_rate_close_to_one(self, tmp_path) -> None:
        from backend.services.castilian_warmup import time_stretch_wav

        # Within ±0.01 of 1.0 is treated as a no-op to avoid wasting
        # CPU on imperceptible changes.
        assert time_stretch_wav(tmp_path / "x.wav", 1.005) is False
        assert time_stretch_wav(tmp_path / "x.wav", 0.995) is False

    def test_returns_false_on_load_failure(self, tmp_path) -> None:
        from backend.services.castilian_warmup import time_stretch_wav

        # rate != 1.0 but the file doesn't exist → soundfile.read raises,
        # the helper swallows it and returns False (caller sees the
        # un-stretched audio rather than crashing the whole take).
        result = time_stretch_wav(tmp_path / "does_not_exist.wav", 0.75)
        assert result is False


class TestAudioAnchor:
    """E — When a reference voice is configured AND castilian_warmup=True,
    the endpoint must concatenate reference + user_sample into a single
    speaker_wav (audio anchor) instead of mangling the text."""

    def test_build_anchored_speaker_wav_concatenates(self, tmp_path) -> None:
        from backend.services.castilian_warmup import build_anchored_speaker_wav

        ref = tmp_path / "ref.wav"
        # Real-ish wav header so pydub stub accepts it
        ref.write_bytes(b"RIFF" + b"\x00" * 100)
        user = tmp_path / "user.wav"
        user.write_bytes(b"RIFF" + b"\x00" * 100)
        out = tmp_path / "anchored.wav"

        result = build_anchored_speaker_wav(user, ref, out)
        assert result == out
        assert out.exists()

    @pytest.mark.asyncio
    async def test_resolve_plan_uses_anchor_when_ref_and_warmup(
        self, tmp_path, monkeypatch
    ) -> None:
        from backend.routers import experimental as exp_mod
        from backend.services import castilian_warmup as mod

        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        ref_file = ref_dir / "castilian.wav"
        ref_file.write_bytes(b"RIFF" + b"\x00" * 100)
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", ref_dir)

        # Point TEMP_DIR somewhere writable for the anchored output
        monkeypatch.setattr(exp_mod, "TEMP_DIR", tmp_path)

        user_sample = tmp_path / "user.wav"
        user_sample.write_bytes(b"RIFF" + b"\x00" * 100)

        plan = exp_mod._resolve_speaker_plan(
            user_sample, use_reference=False, castilian_warmup=True,
        )
        # Should NOT use the user_sample directly — it should anchor
        assert plan.speaker_wav != user_sample
        assert plan.speaker_wav != ref_file
        # And no text warmup, because audio is doing the job
        assert plan.use_text_warmup is False
        assert plan.speaker_wav.exists()

    @pytest.mark.asyncio
    async def test_resolve_plan_falls_back_to_text_warmup_without_ref(
        self, tmp_path, monkeypatch
    ) -> None:
        from backend.routers import experimental as exp_mod
        from backend.services import castilian_warmup as mod

        empty = tmp_path / "ref"
        empty.mkdir()
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", empty)

        user_sample = tmp_path / "user.wav"
        user_sample.write_bytes(b"RIFF" + b"\x00" * 100)

        plan = exp_mod._resolve_speaker_plan(
            user_sample, use_reference=False, castilian_warmup=True,
        )
        # No reference → use_text_warmup must be True, speaker_wav untouched
        assert plan.speaker_wav == user_sample
        assert plan.use_text_warmup is True

    @pytest.mark.asyncio
    async def test_resolve_plan_pure_reference_when_d1(
        self, tmp_path, monkeypatch
    ) -> None:
        from backend.routers import experimental as exp_mod
        from backend.services import castilian_warmup as mod

        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        ref_file = ref_dir / "castilian.wav"
        ref_file.write_bytes(b"RIFF" + b"\x00" * 100)
        monkeypatch.setattr(mod, "REFERENCE_VOICES_DIR", ref_dir)

        user_sample = tmp_path / "user.wav"
        user_sample.write_bytes(b"RIFF" + b"\x00" * 100)

        plan = exp_mod._resolve_speaker_plan(
            user_sample, use_reference=True, castilian_warmup=False,
        )
        # D1: pure reference, no text warmup
        assert plan.speaker_wav == ref_file
        assert plan.use_text_warmup is False


class TestWarmupReachesEngine:
    """When ``castilian_warmup=True``, the text passed to raw_synthesize
    must include the warm-up phrase."""

    @pytest.mark.asyncio
    async def test_warmup_wraps_text_before_synthesis(
        self, tmp_path, monkeypatch
    ) -> None:
        from backend.services.clone_engine import CloneEngine
        from backend.services import castilian_warmup as mod
        from unittest.mock import MagicMock, patch

        engine = CloneEngine()
        engine._device = "cpu"

        captured_text: list[str] = []

        def fake_tts_to_file(text, speaker_wav, language, file_path, **_kwargs):
            captured_text.append(text)
            Path(file_path).write_bytes(b"RIFF" + b"\x00" * 100)

        fake_model = MagicMock()
        fake_model.tts_to_file = fake_tts_to_file
        engine._model = fake_model

        # We're testing the text wrapping helper here, not the endpoint —
        # the endpoint is exercised by the integration tests above.
        wrapped = mod.wrap_text_with_warmup("texto del usuario")

        ref_wav = tmp_path / "ref.wav"
        ref_wav.write_bytes(b"RIFF" + b"\x00" * 100)
        out_wav = tmp_path / "out.wav"

        with patch.object(
            type(engine), "is_available",
            new_callable=lambda: property(lambda self: True),
        ):
            await engine.raw_synthesize(
                text=wrapped,
                speaker_wav=str(ref_wav),
                language="es",
                output_path=out_wav,
            )

        assert len(captured_text) == 1
        assert "texto del usuario" in captured_text[0]
        assert captured_text[0] != "texto del usuario"  # was wrapped


# ── Profile flag (castilian_anchor) end-to-end ──────────────────────


class TestProfileCastilianAnchor:
    """The castilian_anchor flag on a profile must (1) round-trip through
    create + get + update, and (2) cause the production synthesis path
    to wrap the speaker_wav with the reference voice before XTTS sees it.
    """

    def test_profile_create_accepts_anchor_flag(self, client) -> None:
        files = {"sample": ("voice.wav", _fake_wav(), "audio/wav")}
        r = client.post(
            "/api/profiles",
            data={
                "name": "Anchored",
                "voice_id": "es-ES-AlvaroNeural",
                "castilian_anchor": "true",
            },
            files=files,
        )
        assert r.status_code == 200, r.json()
        body = r.json()
        assert body["castilian_anchor"] is True

    def test_profile_create_default_is_off(self, client) -> None:
        r = client.post(
            "/api/profiles",
            data={"name": "NotAnchored", "voice_id": "es-ES-AlvaroNeural"},
        )
        assert r.status_code == 200
        assert r.json()["castilian_anchor"] is False

    def test_profile_update_can_toggle_anchor(self, client) -> None:
        created = client.post(
            "/api/profiles",
            data={"name": "Toggle", "voice_id": "es-ES-AlvaroNeural"},
        ).json()
        pid = created["id"]
        r = client.patch(f"/api/profiles/{pid}", json={"castilian_anchor": True})
        assert r.status_code == 200, r.json()
        assert r.json()["castilian_anchor"] is True

        r2 = client.patch(f"/api/profiles/{pid}", json={"castilian_anchor": False})
        assert r2.status_code == 200
        assert r2.json()["castilian_anchor"] is False

    @pytest.mark.asyncio
    async def test_synthesis_with_anchor_concatenates_reference(
        self, tmp_path, monkeypatch
    ) -> None:
        """When a profile is anchor-flagged, _synthesize_cloned must build
        an anchored speaker_wav (reference + sample) and pass it to the
        clone engine instead of the raw sample."""
        from unittest.mock import AsyncMock, MagicMock, patch

        from backend.services import castilian_warmup as cw_mod
        from backend.services.tts_engine import TTSEngine
        from backend.schemas import SynthesisRequest

        # Configure a reference voice
        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        ref_file = ref_dir / "castilian.wav"
        ref_file.write_bytes(b"RIFF" + b"\x00" * 100)
        monkeypatch.setattr(cw_mod, "REFERENCE_VOICES_DIR", ref_dir)

        # Capture what speaker_wav synthesize_long actually receives
        captured_speaker_wav: list[Path] = []

        async def fake_synth_long(*, speaker_wav, **kwargs):
            captured_speaker_wav.append(Path(speaker_wav))
            out = tmp_path / "out.mp3"
            out.write_bytes(b"\xff\xfb\x90\x00")
            return out, 1

        # Build engine and stub clone path
        from backend.dependencies import get_profile_manager
        engine = TTSEngine(get_profile_manager())
        fake_clone = MagicMock()
        fake_clone.synthesize_long = AsyncMock(side_effect=fake_synth_long)
        engine._get_clone_engine = lambda: fake_clone  # type: ignore[method-assign]

        sample = tmp_path / "user_sample.wav"
        sample.write_bytes(b"RIFF" + b"\x00" * 100)

        request = SynthesisRequest(
            text="Hola mundo.",
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
        )

        with patch("backend.services.tts_engine.split_into_clone_chunks", return_value=["Hola mundo."]):
            await engine._synthesize_cloned(
                request, sample, "es", castilian_anchor=True,
            )

        assert len(captured_speaker_wav) == 1
        # The speaker_wav passed to XTTS is NOT the user's raw sample —
        # it's the temp anchored file we built.
        assert captured_speaker_wav[0] != sample
        assert captured_speaker_wav[0].name.endswith("_anchored.wav")

    @pytest.mark.asyncio
    async def test_synthesis_without_anchor_uses_raw_sample(
        self, tmp_path, monkeypatch
    ) -> None:
        """The default path is unchanged: profiles without the flag pass
        their raw sample straight to XTTS."""
        from unittest.mock import AsyncMock, MagicMock

        from backend.services import castilian_warmup as cw_mod
        from backend.services.tts_engine import TTSEngine
        from backend.schemas import SynthesisRequest

        # Even with a reference present, if anchor=False we must NOT use it
        ref_dir = tmp_path / "ref"
        ref_dir.mkdir()
        (ref_dir / "castilian.wav").write_bytes(b"RIFF" + b"\x00" * 100)
        monkeypatch.setattr(cw_mod, "REFERENCE_VOICES_DIR", ref_dir)

        captured: list[Path] = []

        async def fake_synth_long(*, speaker_wav, **kwargs):
            captured.append(Path(speaker_wav))
            out = tmp_path / "out.mp3"
            out.write_bytes(b"\xff\xfb\x90\x00")
            return out, 1

        from backend.dependencies import get_profile_manager
        engine = TTSEngine(get_profile_manager())
        fake_clone = MagicMock()
        fake_clone.synthesize_long = AsyncMock(side_effect=fake_synth_long)
        engine._get_clone_engine = lambda: fake_clone  # type: ignore[method-assign]

        sample = tmp_path / "user_sample.wav"
        sample.write_bytes(b"RIFF" + b"\x00" * 100)

        request = SynthesisRequest(
            text="Hola.",
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
        )

        from unittest.mock import patch
        with patch("backend.services.tts_engine.split_into_clone_chunks", return_value=["Hola."]):
            await engine._synthesize_cloned(request, sample, "es")

        assert len(captured) == 1
        # Without the flag we pass the raw sample through unchanged.
        assert captured[0] == sample
