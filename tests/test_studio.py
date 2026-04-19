"""Studio module: audio editor service + router endpoints.

Backend modules are imported lazily inside helpers so the session
fixture in ``conftest.py`` can install pydub stubs and rewrite
``VOXFORGE_BASE_DIR`` before any backend code resolves on-disk paths.
"""
from __future__ import annotations

from pathlib import Path

import pytest


# ── Service ─────────────────────────────────────────────────────────


def _seed_source(name: str = "src.mp3", _client=None) -> Path:
    from backend.paths import OUTPUT_DIR

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUTPUT_DIR / name
    path.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x00" + b"\x00" * 64)
    return path


def test_apply_trim_returns_studio_file(client) -> None:
    from backend.paths import STUDIO_DIR
    from backend.services.audio_editor import EditOperation, apply_operations

    src = _seed_source("trim.mp3")
    out = apply_operations(
        src,
        [EditOperation(type="trim", params={"start_ms": 100, "end_ms": 800})],
    )
    assert out.exists()
    assert out.parent == STUDIO_DIR
    assert out.suffix == ".mp3"


def test_apply_supports_all_five_operations(client) -> None:
    from backend.services.audio_editor import EditOperation, apply_operations

    src = _seed_source("multi.mp3")
    out = apply_operations(
        src,
        [
            EditOperation(type="trim", params={"start_ms": 0, "end_ms": 900}),
            EditOperation(type="delete_region", params={"start_ms": 100, "end_ms": 200}),
            EditOperation(type="fade_in", params={"duration_ms": 50}),
            EditOperation(type="fade_out", params={"duration_ms": 50}),
            EditOperation(type="normalize", params={"headroom_db": -1.0}),
        ],
        output_format="wav",
    )
    assert out.exists()
    assert out.suffix == ".wav"


def test_apply_empty_operations_rejected(client) -> None:
    from backend.services.audio_editor import apply_operations

    src = _seed_source("empty.mp3")
    with pytest.raises(Exception) as exc:
        apply_operations(src, [])
    assert "no operations" in str(exc.value).lower()


def test_apply_unknown_operation_rejected(client) -> None:
    from backend.services.audio_editor import EditOperation, apply_operations

    src = _seed_source("unknown.mp3")
    with pytest.raises(Exception) as exc:
        apply_operations(src, [EditOperation(type="reverb", params={})])
    assert "unknown" in str(exc.value).lower()


def test_apply_unsupported_format_rejected(client) -> None:
    from backend.services.audio_editor import EditOperation, apply_operations

    src = _seed_source("bad-fmt.mp3")
    with pytest.raises(Exception) as exc:
        apply_operations(
            src,
            [EditOperation(type="trim", params={"start_ms": 0, "end_ms": 500})],
            output_format="xyz",
        )
    assert "format" in str(exc.value).lower()


def test_apply_invalid_trim_range_rejected(client) -> None:
    from backend.services.audio_editor import EditOperation, apply_operations

    src = _seed_source("bad-trim.mp3")
    with pytest.raises(Exception):
        apply_operations(
            src,
            [EditOperation(type="trim", params={"start_ms": 800, "end_ms": 100})],
        )


# ── Router: /api/studio/sources ─────────────────────────────────────


def _make_chapter_with_generation(client, file_name: str = "studio_gen.mp3") -> tuple[str, Path]:
    """Create a project + chapter + a 'done' generation pointing to a file
    that lives inside an allowed studio root. Returns (gen_id, file_path)."""
    from backend.paths import OUTPUT_DIR

    project = client.post(
        "/api/projects",
        json={"name": "Studio Project", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "Cap 1", "text": "Texto.", "sort_order": 0},
    ).json()

    gen_file = OUTPUT_DIR / file_name
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    gen_file.write_bytes(b"ID3\x04" + b"\x00" * 64)

    import asyncio

    from backend.services import project_manager

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(
            project_manager.create_generation(
                chapter_id=chapter["id"],
                voice_id="es-ES-AlvaroNeural",
            )
        )
        loop.run_until_complete(
            project_manager.update_generation(
                gen["id"],
                status="done",
                file_path=str(gen_file.resolve()),
                duration=42.0,
            )
        )
    finally:
        loop.close()
    return gen["id"], gen_file


def test_sources_returns_done_generations(client) -> None:
    gen_id, _ = _make_chapter_with_generation(client)
    response = client.get("/api/studio/sources")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    found = next((s for s in body["sources"] if s["id"] == gen_id), None)
    assert found is not None
    assert found["kind"] == "chapter"
    assert found["project_name"] == "Studio Project"
    assert found["chapter_title"] == "Cap 1"
    assert found["duration_s"] == pytest.approx(42.0)


def test_sources_skips_missing_files(client) -> None:
    """A generation row whose file no longer exists must not appear."""
    from backend.paths import OUTPUT_DIR

    project = client.post(
        "/api/projects",
        json={"name": "Ghost", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "Ghost", "text": "x", "sort_order": 0},
    ).json()

    import asyncio

    from backend.services import project_manager

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(
            project_manager.create_generation(
                chapter_id=chapter["id"],
                voice_id="es-ES-AlvaroNeural",
            )
        )
        loop.run_until_complete(
            project_manager.update_generation(
                gen["id"],
                status="done",
                file_path=str(__import__("backend.paths", fromlist=["OUTPUT_DIR"]).OUTPUT_DIR / "does_not_exist.mp3"),
            )
        )
    finally:
        loop.close()

    response = client.get("/api/studio/sources")
    assert response.status_code == 200
    ids = [s["id"] for s in response.json()["sources"]]
    assert gen["id"] not in ids


# ── Router: /api/studio/edit ────────────────────────────────────────


def test_edit_returns_audio_file(client) -> None:
    src = _seed_source("edit_in.mp3")
    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": str(src.resolve()),
            "operations": [
                {"type": "trim", "params": {"start_ms": 0, "end_ms": 900}},
                {"type": "normalize", "params": {"headroom_db": -1.0}},
            ],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("audio/")
    assert response.headers.get("X-Operations-Count") == "2"
    assert len(response.content) > 0


def test_edit_rejects_path_outside_allowed_roots(client) -> None:
    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": "/etc/passwd",
            "operations": [{"type": "trim", "params": {"start_ms": 0, "end_ms": 100}}],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_sample"


def test_edit_rejects_empty_operations(client) -> None:
    src = _seed_source("empty_ops.mp3")
    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": str(src.resolve()),
            "operations": [],
            "output_format": "mp3",
        },
    )
    # Pydantic catches min_length=1 -> 422
    assert response.status_code == 422


def test_edit_rejects_unknown_format(client) -> None:
    src = _seed_source("unknown_fmt.mp3")
    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": str(src.resolve()),
            "operations": [{"type": "trim", "params": {"start_ms": 0, "end_ms": 100}}],
            "output_format": "xyz",
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_format"


def test_edit_missing_source_returns_404(client) -> None:
    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": str((__import__("backend.paths", fromlist=["OUTPUT_DIR"]).OUTPUT_DIR / "missing.mp3").resolve()),
            "operations": [{"type": "trim", "params": {"start_ms": 0, "end_ms": 100}}],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 404


# ── Router: /api/studio/audio ───────────────────────────────────────


def test_audio_serves_file_inside_allowed_root(client) -> None:
    src = _seed_source("served.mp3")
    response = client.get("/api/studio/audio", params={"path": str(src.resolve())})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("audio/")


def test_audio_rejects_path_traversal(client) -> None:
    response = client.get(
        "/api/studio/audio",
        params={"path": str((__import__("backend.paths", fromlist=["OUTPUT_DIR"]).OUTPUT_DIR / ".." / ".." / "etc" / "passwd").resolve())},
    )
    assert response.status_code == 404


def test_audio_rejects_outside_root(client) -> None:
    response = client.get("/api/studio/audio", params={"path": "/etc/passwd"})
    assert response.status_code == 404


def test_audio_missing_file_404(client) -> None:
    response = client.get(
        "/api/studio/audio",
        params={"path": str((__import__("backend.paths", fromlist=["OUTPUT_DIR"]).OUTPUT_DIR / "does_not_exist.mp3").resolve())},
    )
    assert response.status_code == 404
