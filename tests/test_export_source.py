"""UX-02: export-source resolution, one-click mastering and discard-edit.

Covers the shared priority helper (Studio edit > active take > latest
generation > fresh synthesis), its endpoint, the headless mastering
endpoint (editor stubbed — no real ffmpeg/noisereduce/pedalboard), the
master-all batch export flag, and the discard-edit fallback.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import pytest


def _run(coro):
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _create_chapter(client, *, text: str = "Texto del capitulo.") -> tuple[str, str]:
    """Project + chapter; returns (project_id, chapter_id)."""
    project = client.post(
        "/api/projects",
        json={"name": "ExportSource", "language": "es", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "Cap 1", "text": text, "sort_order": 0},
    ).json()
    return project["id"], chapter["id"]


def _seed_generation(chapter_id: str, filename: str, *, active: bool = False) -> tuple[str, Path]:
    """A 'done' generation with a real file in OUTPUT_DIR."""
    from backend.paths import OUTPUT_DIR
    from backend.services import project_manager as pm

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    audio = OUTPUT_DIR / filename
    audio.write_bytes(b"ID3\x04" + filename.encode() + b"\x00" * 32)

    async def seed() -> str:
        gen = await pm.create_generation(chapter_id, voice_id="v", engine="edge-tts")
        await pm.update_generation(
            gen["id"], status="done", file_path=str(audio.resolve()), duration=1.0
        )
        if active:
            await pm.update_chapter(chapter_id, active_generation_id=gen["id"])
        return gen["id"]

    return _run(seed()), audio


def _seed_studio_render(
    chapter_id: str, filename: str, *, operations: str | None = '[{"type": "trim", "params": {}}]'
) -> tuple[str, Path]:
    """A persisted Studio edit (kind=audio) with a real file in STUDIO_DIR."""
    from backend.paths import STUDIO_DIR
    from backend.services import studio_store

    STUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out = STUDIO_DIR / filename
    out.write_bytes(b"ID3\x04" + filename.encode() + b"\x00" * 32)

    render = _run(
        studio_store.create_render(
            kind="audio",
            source_path="ignored",
            output_path=str(out.resolve()),
            operations=operations,
            chapter_id=chapter_id,
        )
    )
    return render["id"], out


def _resolve(client, chapter_id: str) -> dict:
    response = client.get(f"/api/chapters/{chapter_id}/export-source")
    assert response.status_code == 200, response.text
    return response.json()


# ── Priority resolution (helper exposed via the endpoint) ───────────


def test_studio_edit_wins_over_active_and_latest(client) -> None:
    _, chapter_id = _create_chapter(client)
    _seed_generation(chapter_id, "es_active.mp3", active=True)
    _seed_generation(chapter_id, "es_newer.mp3")
    render_id, _ = _seed_studio_render(chapter_id, "es_edit.mp3")

    body = _resolve(client, chapter_id)
    assert body["kind"] == "studio_edit"
    assert body["render_id"] == render_id
    assert body["mastered"] is False
    assert body["created_at"]


def test_active_take_wins_when_no_studio_edit(client) -> None:
    _, chapter_id = _create_chapter(client)
    active_id, _ = _seed_generation(chapter_id, "es_active2.mp3", active=True)
    _seed_generation(chapter_id, "es_newer2.mp3")  # newer but not active

    body = _resolve(client, chapter_id)
    assert body["kind"] == "active_take"
    assert body["generation_id"] == active_id


def test_latest_generation_when_no_active_marked(client) -> None:
    _, chapter_id = _create_chapter(client)
    _seed_generation(chapter_id, "es_old.mp3")
    newest_id, _ = _seed_generation(chapter_id, "es_new.mp3")

    body = _resolve(client, chapter_id)
    assert body["kind"] == "latest_generation"
    assert body["generation_id"] == newest_id


def test_fresh_synthesis_when_nothing_on_disk(client) -> None:
    _, chapter_id = _create_chapter(client)
    body = _resolve(client, chapter_id)
    assert body["kind"] == "fresh_synthesis"
    assert body["render_id"] is None
    assert body["generation_id"] is None


def test_missing_edit_file_falls_through_to_take(client) -> None:
    """A render row whose file vanished must not win the export."""
    _, chapter_id = _create_chapter(client)
    active_id, _ = _seed_generation(chapter_id, "es_fallback.mp3", active=True)
    _, edit_file = _seed_studio_render(chapter_id, "es_gone.mp3")
    edit_file.unlink()

    body = _resolve(client, chapter_id)
    assert body["kind"] == "active_take"
    assert body["generation_id"] == active_id


def test_export_source_unknown_chapter_404(client) -> None:
    assert client.get("/api/chapters/nope/export-source").status_code == 404


# ── Discard edit: deleting the render flips the export source ───────


def test_discard_edit_restores_take_priority(client) -> None:
    _, chapter_id = _create_chapter(client)
    active_id, _ = _seed_generation(chapter_id, "es_keep.mp3", active=True)
    render_id, edit_file = _seed_studio_render(chapter_id, "es_discard.mp3")

    assert _resolve(client, chapter_id)["kind"] == "studio_edit"

    response = client.delete(f"/api/studio/renders/{render_id}")
    assert response.status_code == 200
    assert not edit_file.exists()

    body = _resolve(client, chapter_id)
    assert body["kind"] == "active_take"
    assert body["generation_id"] == active_id


# ── One-click mastering (headless, editor stubbed) ──────────────────


@pytest.fixture()
def stub_editor(monkeypatch):
    """Replace apply_operations with a copy so no DSP/ffmpeg runs; records
    every call so tests can assert how often mastering actually ran."""
    from backend.paths import STUDIO_DIR
    from backend.services import mastering

    calls: list[tuple[Path, list, str]] = []

    def fake_apply(source: Path, operations, output_format: str = "mp3") -> Path:
        STUDIO_DIR.mkdir(parents=True, exist_ok=True)
        out = STUDIO_DIR / f"mastered_{len(calls)}_{Path(source).name}"
        out.write_bytes(b"MASTERED:" + Path(source).read_bytes())
        calls.append((Path(source), list(operations), output_format))
        return out

    monkeypatch.setattr(mastering, "apply_operations", fake_apply)
    return calls


def test_master_endpoint_creates_render_and_wins_export(client, stub_editor) -> None:
    _, chapter_id = _create_chapter(client)
    _, audio = _seed_generation(chapter_id, "es_master_src.mp3", active=True)

    response = client.post(f"/api/chapters/{chapter_id}/master")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["chapter_id"] == chapter_id
    assert body["operations"] == ["denoise", "loudness", "compressor"]

    # The preset ran once, over the take audio, in plan order.
    assert len(stub_editor) == 1
    source, ops, _fmt = stub_editor[0]
    assert source == audio.resolve()
    assert [op.type for op in ops] == ["denoise", "loudness", "compressor"]
    assert ops[1].params["target_lufs"] == -16.0

    # Persisted as a studio render linked to the chapter…
    listed = client.get(f"/api/studio/renders?chapter_id={chapter_id}").json()
    assert listed["count"] == 1
    assert listed["renders"][0]["id"] == body["render_id"]
    assert listed["renders"][0]["kind"] == "audio"

    # …and it now wins the export, flagged as mastered.
    src = _resolve(client, chapter_id)
    assert src["kind"] == "studio_edit"
    assert src["render_id"] == body["render_id"]
    assert src["mastered"] is True


def test_master_endpoint_masters_manual_edit_not_raw_take(client, stub_editor) -> None:
    """If a manual Studio edit currently wins the export, mastering must
    process THAT audio — not silently revert to the raw take."""
    _, chapter_id = _create_chapter(client)
    _seed_generation(chapter_id, "es_raw_take.mp3", active=True)
    _, edit_file = _seed_studio_render(chapter_id, "es_manual_edit.mp3")

    response = client.post(f"/api/chapters/{chapter_id}/master")
    assert response.status_code == 200, response.text
    assert stub_editor[0][0] == edit_file.resolve()


def test_master_endpoint_rejects_double_mastering(client, stub_editor) -> None:
    _, chapter_id = _create_chapter(client)
    _seed_generation(chapter_id, "es_double.mp3", active=True)

    assert client.post(f"/api/chapters/{chapter_id}/master").status_code == 200
    response = client.post(f"/api/chapters/{chapter_id}/master")
    assert response.status_code == 400
    assert "master" in response.json()["detail"].lower()
    assert len(stub_editor) == 1


def test_master_endpoint_no_audio_400(client, stub_editor) -> None:
    _, chapter_id = _create_chapter(client)
    response = client.post(f"/api/chapters/{chapter_id}/master")
    assert response.status_code == 400


def test_master_endpoint_unknown_chapter_404(client, stub_editor) -> None:
    assert client.post("/api/chapters/nope/master").status_code == 404


# ── Batch export: master-all flag ───────────────────────────────────


def test_batch_export_master_flag_masters_each_chapter(client, stub_editor) -> None:
    import io
    import zipfile

    project_id, chapter_id = _create_chapter(client)
    _seed_generation(chapter_id, "es_zip_take.mp3", active=True)

    response = client.get(f"/api/export/{project_id}?master=true")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        audio_entries = [n for n in zf.namelist() if n.startswith("audio/")]
        assert len(audio_entries) == 1
        assert zf.read(audio_entries[0]).startswith(b"MASTERED:")

    # The mastered output persisted as a render → the chapter shows the chip…
    assert _resolve(client, chapter_id)["mastered"] is True

    # …and a second master-all export reuses it instead of re-mastering.
    again = client.get(f"/api/export/{project_id}?master=true")
    assert again.status_code == 200
    assert len(stub_editor) == 1


def test_batch_export_without_flag_keeps_raw_take(client, stub_editor) -> None:
    import io
    import zipfile

    project_id, chapter_id = _create_chapter(client)
    _, audio = _seed_generation(chapter_id, "es_zip_raw.mp3", active=True)

    response = client.get(f"/api/export/{project_id}")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        audio_entries = [n for n in zf.namelist() if n.startswith("audio/")]
        assert zf.read(audio_entries[0]) == audio.read_bytes()
    assert len(stub_editor) == 0
