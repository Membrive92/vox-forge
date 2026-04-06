"""Integration tests: sample uploads, profile creation with sample, sample serving."""
from __future__ import annotations

import io


def _fake_wav() -> io.BytesIO:
    """Generate a minimal fake WAV file."""
    buf = io.BytesIO(b"RIFF" + b"\x00" * 40)
    buf.name = "sample.wav"
    return buf


def _fake_mp3() -> io.BytesIO:
    buf = io.BytesIO(b"ID3\x04\x00" + b"\x00" * 128)
    buf.name = "sample.mp3"
    return buf


# --- Sample upload ---

def test_upload_sample_returns_analysis(client) -> None:
    response = client.post(
        "/api/voices/upload-sample",
        files={"sample": ("test.wav", _fake_wav(), "audio/wav")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["filename"].endswith(".wav")
    assert body["duration_seconds"] == 1.0  # fake AudioSegment devuelve 1s
    assert body["channels"] == 1
    assert body["sample_rate"] == 44100
    assert body["bit_depth"] == 16
    assert body["size_kb"] >= 0
    assert body["profile_id"] is None


def test_upload_sample_attached_to_profile(client) -> None:
    # Crear perfil primero
    profile = client.post(
        "/api/profiles",
        data={"name": "With sample", "voice_id": "es-ES-AlvaroNeural"},
    ).json()

    response = client.post(
        "/api/voices/upload-sample",
        files={"sample": ("clip.wav", _fake_wav(), "audio/wav")},
        data={"profile_id": profile["id"]},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["profile_id"] == profile["id"]

    # Verificar que el perfil se actualizó
    updated = client.get(f"/api/profiles/{profile['id']}").json()
    assert updated["sample_filename"] == body["filename"]
    assert updated["sample_duration"] == 1.0


def test_upload_replaces_old_sample(client) -> None:
    # Crear perfil con primera muestra
    profile = client.post(
        "/api/profiles",
        data={"name": "Replacement", "voice_id": "es-ES-AlvaroNeural"},
        files={"sample": ("first.wav", _fake_wav(), "audio/wav")},
    ).json()
    first_sample = profile["sample_filename"]
    assert first_sample is not None

    # Subir segunda muestra
    client.post(
        "/api/voices/upload-sample",
        files={"sample": ("second.wav", _fake_wav(), "audio/wav")},
        data={"profile_id": profile["id"]},
    )

    updated = client.get(f"/api/profiles/{profile['id']}").json()
    assert updated["sample_filename"] != first_sample


# --- Sample serving ---

def test_serve_uploaded_sample(client) -> None:
    upload = client.post(
        "/api/voices/upload-sample",
        files={"sample": ("serve.wav", _fake_wav(), "audio/wav")},
    ).json()

    response = client.get(f"/api/voices/samples/{upload['filename']}")
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert len(response.content) > 0


# --- Create profile with sample via POST /api/profiles ---

def test_create_profile_with_sample(client) -> None:
    response = client.post(
        "/api/profiles",
        data={
            "name": "With audio",
            "voice_id": "es-MX-DaliaNeural",
            "language": "es",
            "speed": "90",
            "pitch": "0",
            "volume": "75",
        },
        files={"sample": ("test.mp3", _fake_mp3(), "audio/mpeg")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "With audio"
    assert body["sample_filename"] is not None
    assert body["sample_filename"].endswith(".mp3")


def test_create_profile_rejects_bad_content_type(client) -> None:
    response = client.post(
        "/api/profiles",
        data={"name": "Bad", "voice_id": "es-ES-AlvaroNeural"},
        files={"sample": ("bad.txt", io.BytesIO(b"text"), "text/plain")},
    )
    assert response.status_code == 400
    assert "unsupported" in response.json()["detail"].lower() or "code" in response.json()


# --- Cleanup de archivos ---

async def test_cleanup_removes_old_files(client, _session_env) -> None:
    """The cleanup task deletes old files."""
    import os
    import time

    from backend.paths import OUTPUT_DIR
    from backend.utils import cleanup_old_files

    old_file = OUTPUT_DIR / "ancient.mp3"
    old_file.write_bytes(b"data")
    old_time = time.time() - (25 * 3600)
    os.utime(old_file, (old_time, old_time))

    recent_file = OUTPUT_DIR / "fresh.mp3"
    recent_file.write_bytes(b"new")

    count = await cleanup_old_files(max_age_hours=24)
    assert count >= 1
    assert not old_file.exists()
    assert recent_file.exists()
    recent_file.unlink()
