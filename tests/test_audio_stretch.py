"""Tests for the Rubber Band stretch policy (VOZ-01..05).

All post-synthesis speed changes go through ``pedalboard.time_stretch``
(Rubber Band) in a single pass, clamped to the safe ±25% range. These
tests run against the REAL pedalboard library (it's in requirements-ci),
so they verify actual durations, not just plumbing.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pytest

_SR = 22050


def _one_second_sine(sr: int = _SR) -> np.ndarray:
    t = np.arange(sr) / sr
    return (0.5 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


# ── clamp_stretch_factor ────────────────────────────────────────────


class TestClampStretchFactor:
    def test_passes_through_safe_values(self, caplog) -> None:
        from backend.services.audio_stretch import clamp_stretch_factor

        with caplog.at_level(logging.WARNING):
            assert clamp_stretch_factor(1.0) == 1.0
            assert clamp_stretch_factor(0.75) == 0.75
            assert clamp_stretch_factor(1.25) == 1.25
        assert not caplog.records

    def test_clamps_and_warns_above_max(self, caplog) -> None:
        from backend.services.audio_stretch import clamp_stretch_factor

        with caplog.at_level(logging.WARNING):
            assert clamp_stretch_factor(2.0) == 1.25
        assert any("clamp" in r.message.lower() for r in caplog.records)

    def test_clamps_and_warns_below_min(self, caplog) -> None:
        from backend.services.audio_stretch import clamp_stretch_factor

        with caplog.at_level(logging.WARNING):
            assert clamp_stretch_factor(0.5) == 0.75
        assert any("clamp" in r.message.lower() for r in caplog.records)


# ── VoiceLabEngine._apply_pitch_and_speed ───────────────────────────


class TestApplyPitchAndSpeed:
    def test_speed_0_8_lengthens_one_second_to_1_25(self) -> None:
        """1 s at stretch factor 0.8 ⇒ 1.25 s (±2%)."""
        from backend.services.voice_lab_engine import VoiceLabEngine

        audio = _one_second_sine()
        out = VoiceLabEngine._apply_pitch_and_speed(audio, _SR, 0.0, 0.8)
        assert out.ndim == 1
        assert len(out) == pytest.approx(_SR / 0.8, rel=0.02)

    def test_speed_1_25_shortens_one_second_to_0_8(self) -> None:
        from backend.services.voice_lab_engine import VoiceLabEngine

        audio = _one_second_sine()
        out = VoiceLabEngine._apply_pitch_and_speed(audio, _SR, 0.0, 1.25)
        assert len(out) == pytest.approx(_SR / 1.25, rel=0.02)

    def test_noop_within_epsilon_returns_same_array(self) -> None:
        from backend.services.voice_lab_engine import VoiceLabEngine

        audio = _one_second_sine()
        out = VoiceLabEngine._apply_pitch_and_speed(audio, _SR, 0.005, 1.005)
        assert out is audio

    def test_pitch_only_keeps_duration(self) -> None:
        """Pitch shifting alone must not change length (single pass)."""
        from backend.services.voice_lab_engine import VoiceLabEngine

        audio = _one_second_sine()
        out = VoiceLabEngine._apply_pitch_and_speed(audio, _SR, -3.0, 1.0)
        assert len(out) == pytest.approx(_SR, rel=0.02)
        # And the content actually changed (it's not a silent no-op)
        assert not np.array_equal(out[: len(audio)], audio)

    def test_excessive_speed_is_clamped_with_warning(self, caplog) -> None:
        """Requesting 2.0× clamps to 1.25× and logs a warning."""
        from backend.services.voice_lab_engine import VoiceLabEngine

        audio = _one_second_sine()
        with caplog.at_level(logging.WARNING):
            out = VoiceLabEngine._apply_pitch_and_speed(audio, _SR, 0.0, 2.0)
        assert len(out) == pytest.approx(_SR / 1.25, rel=0.02)
        assert any("clamp" in r.message.lower() for r in caplog.records)


# ── castilian_warmup.time_stretch_wav (file-level helper) ───────────


class TestTimeStretchWavReal:
    def _write_wav(self, path: Path) -> None:
        import soundfile as sf

        sf.write(str(path), _one_second_sine(), _SR)

    def _duration_s(self, path: Path) -> float:
        import soundfile as sf

        y, sr = sf.read(str(path))
        return len(y) / sr

    def test_rate_0_8_lengthens_file(self, tmp_path) -> None:
        from backend.services.castilian_warmup import time_stretch_wav

        wav = tmp_path / "one_second.wav"
        self._write_wav(wav)

        assert time_stretch_wav(wav, 0.8) is True
        assert self._duration_s(wav) == pytest.approx(1.25, rel=0.02)

    def test_rate_above_safe_range_is_clamped(self, tmp_path, caplog) -> None:
        from backend.services.castilian_warmup import time_stretch_wav

        wav = tmp_path / "one_second.wav"
        self._write_wav(wav)

        with caplog.at_level(logging.WARNING):
            assert time_stretch_wav(wav, 2.0) is True
        # Effective rate is 1.25, not 2.0 → duration 0.8 s, not 0.5 s.
        assert self._duration_s(wav) == pytest.approx(1 / 1.25, rel=0.02)
        assert any("clamp" in r.message.lower() for r in caplog.records)


# ── Single pass through the Voice Lab chain (no stacking) ───────────


class TestSinglePassInvocation:
    @pytest.mark.asyncio
    async def test_process_invokes_time_stretch_exactly_once(
        self, tmp_path, monkeypatch
    ) -> None:
        """Pitch AND speed together must cost ONE Rubber Band pass.

        The old chain ran librosa pitch_shift + time_stretch as two
        stacked phase-vocoder passes — that stacking is the regression
        this test guards against.
        """
        import soundfile as sf

        from backend.services import voice_lab_engine as vle

        calls = {"n": 0}
        original = vle.time_stretch

        def counting_stretch(*args: object, **kwargs: object):
            calls["n"] += 1
            return original(*args, **kwargs)

        monkeypatch.setattr(vle, "time_stretch", counting_stretch)

        src = tmp_path / "in.wav"
        sf.write(str(src), _one_second_sine(), _SR)

        engine = vle.VoiceLabEngine()
        params = vle.VoiceLabParams(pitch_semitones=-2.0, speed=0.9)
        out = await engine.process(src, params, "wav")

        assert calls["n"] == 1, "pitch+speed must be ONE combined pass"
        assert out.exists()
        y, sr = sf.read(str(out))
        assert len(y) / sr == pytest.approx(1 / 0.9, rel=0.05)
        out.unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_process_skips_stretch_when_neutral(
        self, tmp_path, monkeypatch
    ) -> None:
        import soundfile as sf

        from backend.services import voice_lab_engine as vle

        calls = {"n": 0}

        def counting_stretch(*args: object, **kwargs: object):
            calls["n"] += 1
            raise AssertionError("time_stretch must not run for neutral params")

        monkeypatch.setattr(vle, "time_stretch", counting_stretch)

        src = tmp_path / "in.wav"
        sf.write(str(src), _one_second_sine(), _SR)

        engine = vle.VoiceLabEngine()
        out = await engine.process(src, vle.VoiceLabParams(), "wav")

        assert calls["n"] == 0
        assert out.exists()
        out.unlink(missing_ok=True)
