"""Chapter re-voice + transcribe endpoints (Phase 2).

Uses only the ``client`` fixture (the app is imported by the fixture,
after the audio/whisper stubs are installed) — no module-level
``backend`` import, so the stubs are never defeated.
"""
from __future__ import annotations

import io


def _project_and_chapter(client) -> tuple[str, str]:
    project = client.post(
        "/api/projects",
        json={"name": "Revoice", "language": "es", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": "", "sort_order": 0},
    ).json()
    return project["id"], chapter["id"]


def _upload_take(client, chapter_id: str) -> dict:
    resp = client.post(
        f"/api/chapters/{chapter_id}/upload-audio",
        files={"audio": ("rec.wav", io.BytesIO(b"RIFF" + b"\x00" * 40), "audio/wav")},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# --- transcribe-generation ---

def test_transcribe_generation_fills_chapter_text(client) -> None:
    project_id, chapter_id = _project_and_chapter(client)
    _upload_take(client, chapter_id)

    resp = client.post(f"/api/chapters/{chapter_id}/transcribe-generation", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["word_count"] > 0
    assert body["text"]  # the whisper stub returns canned segments
    assert body["generation_id"]

    # The transcript was written back to chapters.text.
    chapters = client.get(f"/api/projects/{project_id}/chapters").json()
    chapter = next(c for c in chapters if c["id"] == chapter_id)
    assert chapter["text"] == body["text"]


def test_transcribe_generation_without_take_is_400(client) -> None:
    _project_id, chapter_id = _project_and_chapter(client)
    resp = client.post(f"/api/chapters/{chapter_id}/transcribe-generation", json={})
    assert resp.status_code == 400


# --- apply-voice (validation only — the GPU path is exercised live) ---

def test_apply_voice_requires_a_target(client) -> None:
    _project_id, chapter_id = _project_and_chapter(client)
    _upload_take(client, chapter_id)
    # Neither catalog_voice_id nor profile_id -> 400 before any conversion.
    resp = client.post(f"/api/chapters/{chapter_id}/apply-voice", json={})
    assert resp.status_code == 400


def test_apply_voice_unknown_catalog_voice_is_400(client) -> None:
    _project_id, chapter_id = _project_and_chapter(client)
    _upload_take(client, chapter_id)
    resp = client.post(
        f"/api/chapters/{chapter_id}/apply-voice",
        json={"catalog_voice_id": "xx-XX-NotARealVoice"},
    )
    assert resp.status_code == 400


def test_source_resolution_skips_prior_conversions(client) -> None:
    """Re-voice/transcribe must source the ORIGINAL take, never a prior
    'converted' one — otherwise repeated apply-voice chains conversions and
    destroys the audio (real bug)."""
    import asyncio

    from backend.services import project_manager as pm

    _project_id, chapter_id = _project_and_chapter(client)
    up = _upload_take(client, chapter_id)

    # A prior conversion exists AND is the chapter's active take.
    loop = asyncio.new_event_loop()
    try:
        conv = loop.run_until_complete(
            pm.create_generation(
                chapter_id=chapter_id, voice_id="x", profile_id=None,
                output_format="mp3", engine="converted", chunks_total=0,
            )
        )
        loop.run_until_complete(
            pm.update_generation(
                conv["id"], status="done", file_path=up["file_path"], duration=1.0,
            )
        )
        loop.run_until_complete(
            pm.update_chapter(chapter_id, active_generation_id=conv["id"])
        )
    finally:
        loop.close()

    # Transcribe (shares _resolve_source_take with apply-voice) must pick the
    # original upload, not the active 'converted' take.
    resp = client.post(f"/api/chapters/{chapter_id}/transcribe-generation", json={})
    assert resp.status_code == 200, resp.text
    assert resp.json()["generation_id"] == up["id"]
