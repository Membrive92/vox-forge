"""Tests for the voice sample quality analyzer (/analyze).

Focus: the VOZ-10 rhythm metric (approximate syllables/second from
energy bursts) and its presence in the API response.
"""
from __future__ import annotations

import io


def _fake_wav() -> io.BytesIO:
    buf = io.BytesIO(b"RIFF" + b"\x00" * 40)
    buf.name = "sample.wav"
    return buf


# --- _estimate_rhythm unit tests -------------------------------------------


def test_estimate_rhythm_counts_energy_bursts() -> None:
    """Three energy bursts over 5 speech windows of 50ms = 3 / 0.25s."""
    from backend.routers.analyze import _estimate_rhythm

    series = [-50.0, -20.0, -30.0, -20.0, -30.0, -20.0, -50.0]
    assert _estimate_rhythm(series, window_ms=50) == 12.0


def test_estimate_rhythm_pure_silence_is_zero() -> None:
    from backend.routers.analyze import _estimate_rhythm

    assert _estimate_rhythm([-50.0] * 10, window_ms=50) == 0.0
    assert _estimate_rhythm([], window_ms=50) == 0.0


def test_estimate_rhythm_flat_speech_has_no_bursts() -> None:
    """Constant energy (no local maxima) counts zero syllable nuclei."""
    from backend.routers.analyze import _estimate_rhythm

    assert _estimate_rhythm([-20.0] * 20, window_ms=50) == 0.0


def test_estimate_rhythm_ignores_silent_peaks() -> None:
    """A local maximum below the silence floor must not count."""
    from backend.routers.analyze import _estimate_rhythm

    series = [-60.0, -45.0, -60.0]  # peak at -45 is still silence
    assert _estimate_rhythm(series, window_ms=50) == 0.0


# --- API ---------------------------------------------------------------------


def test_analyze_endpoint_returns_rhythm_field(client) -> None:
    response = client.post(
        "/api/analyze/sample",
        files={"audio": ("sample.wav", _fake_wav(), "audio/wav")},
    )
    assert response.status_code == 200
    body = response.json()
    assert "rhythm_sps" in body
    assert isinstance(body["rhythm_sps"], (int, float))
    assert body["rhythm_sps"] >= 0
    # Existing contract intact
    assert body["duration_s"] == 1.0
    assert body["rating"] in {"excellent", "good", "fair", "poor"}
