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
    assert updated["samples"] == [body["filename"]]
    assert updated["sample_filename"] == body["filename"]  # deprecated alias
    assert updated["sample_duration"] == 1.0


def test_upload_appends_second_sample(client) -> None:
    """VOZ-10: a second upload joins the conditioning set, it does not
    replace the first sample."""
    profile = client.post(
        "/api/profiles",
        data={"name": "MultiSample", "voice_id": "es-ES-AlvaroNeural"},
        files={"sample": ("first.wav", _fake_wav(), "audio/wav")},
    ).json()
    first_sample = profile["samples"][0]

    second = client.post(
        "/api/voices/upload-sample",
        files={"sample": ("second.wav", _fake_wav(), "audio/wav")},
        data={"profile_id": profile["id"]},
    ).json()

    updated = client.get(f"/api/profiles/{profile['id']}").json()
    assert updated["samples"] == [first_sample, second["filename"]]
    assert updated["sample_filename"] == first_sample  # alias = samples[0]


def test_sixth_upload_rejected_and_not_orphaned(client) -> None:
    """Profiles hold at most 5 samples; the rejected file must not stay
    on disk."""
    from backend.paths import VOICES_DIR

    profile = client.post(
        "/api/profiles",
        data={"name": "Full", "voice_id": "es-ES-AlvaroNeural"},
    ).json()

    for i in range(5):
        r = client.post(
            "/api/voices/upload-sample",
            files={"sample": (f"s{i}.wav", _fake_wav(), "audio/wav")},
            data={"profile_id": profile["id"]},
        )
        assert r.status_code == 200

    before = {p.name for p in VOICES_DIR.iterdir()}
    rejected = client.post(
        "/api/voices/upload-sample",
        files={"sample": ("s5.wav", _fake_wav(), "audio/wav")},
        data={"profile_id": profile["id"]},
    )
    assert rejected.status_code == 400
    assert rejected.json()["code"] == "invalid_sample"
    assert {p.name for p in VOICES_DIR.iterdir()} == before, (
        "rejected upload left an orphaned file in VOICES_DIR"
    )
    updated = client.get(f"/api/profiles/{profile['id']}").json()
    assert len(updated["samples"]) == 5


def test_delete_profile_sample_endpoint(client) -> None:
    """DELETE /profiles/{id}/samples/{filename} detaches the sample and
    removes the file from disk."""
    from backend.paths import VOICES_DIR

    profile = client.post(
        "/api/profiles",
        data={"name": "Detach", "voice_id": "es-ES-AlvaroNeural"},
        files={"sample": ("first.wav", _fake_wav(), "audio/wav")},
    ).json()
    first = profile["samples"][0]
    second = client.post(
        "/api/voices/upload-sample",
        files={"sample": ("second.wav", _fake_wav(), "audio/wav")},
        data={"profile_id": profile["id"]},
    ).json()["filename"]

    response = client.delete(f"/api/profiles/{profile['id']}/samples/{first}")
    assert response.status_code == 200
    assert response.json()["samples"] == [second]
    assert not (VOICES_DIR / first).exists()
    assert (VOICES_DIR / second).exists()

    missing = client.delete(f"/api/profiles/{profile['id']}/samples/ghost.wav")
    assert missing.status_code == 404


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


def test_cleanup_preserves_db_referenced_generation(client, _session_env) -> None:
    """Old OUTPUT audio referenced by a 'done' generation must survive cleanup."""
    import asyncio
    import os
    import time

    from backend.paths import OUTPUT_DIR
    from backend.services import project_manager as pm
    from backend.utils import cleanup_old_files

    old = time.time() - (25 * 3600)
    referenced = OUTPUT_DIR / "referenced_chapter.mp3"
    referenced.write_bytes(b"keep me")
    orphan = OUTPUT_DIR / "orphan_output.mp3"
    orphan.write_bytes(b"delete me")
    for f in (referenced, orphan):
        os.utime(f, (old, old))

    project = client.post(
        "/api/projects",
        json={"name": "Cleanup", "language": "es", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": "x", "sort_order": 0},
    ).json()

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(
            pm.create_generation(
                chapter_id=chapter["id"], voice_id="es-ES-AlvaroNeural",
                profile_id=None, output_format="mp3", speed=100, pitch=0,
                volume=80, engine="edge-tts", chunks_total=1,
            )
        )
        loop.run_until_complete(
            pm.update_generation(gen["id"], status="done", file_path=str(referenced))
        )
        loop.run_until_complete(cleanup_old_files(max_age_hours=24))
    finally:
        loop.close()

    assert referenced.exists(), "DB-referenced generation audio was deleted by cleanup"
    assert not orphan.exists(), "unreferenced old file should have been cleaned"
    referenced.unlink(missing_ok=True)


def test_delete_project_unlinks_generation_audio(client, _session_env) -> None:
    """Deleting a project must remove its generations' audio from disk."""
    import asyncio

    from backend.paths import OUTPUT_DIR
    from backend.services import project_manager as pm

    audio = OUTPUT_DIR / "to_delete_with_project.mp3"
    audio.write_bytes(b"audio bytes")

    project = client.post(
        "/api/projects",
        json={"name": "DelProj", "language": "es", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": "x", "sort_order": 0},
    ).json()

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(
            pm.create_generation(
                chapter_id=chapter["id"], voice_id="es-ES-AlvaroNeural",
                profile_id=None, output_format="mp3", speed=100, pitch=0,
                volume=80, engine="edge-tts", chunks_total=1,
            )
        )
        loop.run_until_complete(
            pm.update_generation(gen["id"], status="done", file_path=str(audio))
        )
        assert audio.exists()
        deleted = loop.run_until_complete(pm.delete_project(project["id"]))
    finally:
        loop.close()

    assert deleted
    assert not audio.exists(), "project delete left the generation audio on disk"
