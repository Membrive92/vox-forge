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


# ── Service: transcriber ────────────────────────────────────────────


def test_format_timestamp_pads_correctly(client) -> None:
    from backend.services.transcriber import _format_timestamp

    assert _format_timestamp(0.0) == "00:00:00,000"
    assert _format_timestamp(1.5) == "00:00:01,500"
    assert _format_timestamp(61.123) == "00:01:01,123"
    assert _format_timestamp(3661.999) == "01:01:01,999"


def test_transcribe_service_writes_srt(client) -> None:
    from backend.paths import STUDIO_SUBS_DIR
    from backend.services.transcriber import Transcriber

    src = _seed_source("transcribe_me.mp3")
    t = Transcriber()
    result = t.transcribe(src)

    assert result.srt_path.parent == STUDIO_SUBS_DIR
    assert result.srt_path.exists()
    assert result.engine.startswith("faster-whisper:")
    assert result.duration_s > 0
    assert len(result.segments) == 3

    srt_text = result.srt_path.read_text(encoding="utf-8")
    # Expect 3 blocks with index 1/2/3 and HH:MM:SS,mmm timestamps
    assert "1\n00:00:00,000 --> 00:00:02,000" in srt_text
    assert "2\n00:00:02,000 --> 00:00:04,000" in srt_text
    assert "3\n00:00:04,000 --> 00:00:06,000" in srt_text


def test_transcribe_service_raises_when_source_missing(client) -> None:
    from backend.paths import OUTPUT_DIR
    from backend.services.transcriber import Transcriber

    t = Transcriber()
    from backend.exceptions import InvalidSampleError
    with pytest.raises(InvalidSampleError):
        t.transcribe(OUTPUT_DIR / "does_not_exist.mp3")


# ── Router: /api/studio/transcribe ──────────────────────────────────


def test_transcribe_endpoint_returns_entries(client) -> None:
    src = _seed_source("ep_transcribe.mp3")
    response = client.post(
        "/api/studio/transcribe",
        json={"source_path": str(src.resolve())},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["engine"].startswith("faster-whisper:")
    assert body["duration_s"] > 0
    assert body["word_count"] >= 3
    assert len(body["entries"]) == 3
    assert body["entries"][0]["index"] == 1
    assert body["entries"][0]["start_s"] == 0.0
    assert body["entries"][0]["end_s"] == 2.0
    assert "srt_path" in body and body["srt_path"].endswith(".srt")


def test_transcribe_rejects_path_outside_allowed_roots(client) -> None:
    response = client.post(
        "/api/studio/transcribe",
        json={"source_path": "/etc/passwd"},
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_sample"


def test_transcribe_missing_source_returns_404(client) -> None:
    from backend.paths import OUTPUT_DIR

    response = client.post(
        "/api/studio/transcribe",
        json={"source_path": str((OUTPUT_DIR / "missing_for_transcribe.mp3").resolve())},
    )
    assert response.status_code == 404


def test_transcribe_forwards_language_to_model(client) -> None:
    """When language is provided, the SRT info should reflect it."""
    src = _seed_source("lang_es.mp3")
    response = client.post(
        "/api/studio/transcribe",
        json={"source_path": str(src.resolve()), "language": "es"},
    )
    assert response.status_code == 200
    assert response.json()["language"] == "es"


# ── Service: video_renderer argv builder ────────────────────────────


def test_build_ffmpeg_argv_minimal(client) -> None:
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import _build_ffmpeg_argv

    argv = _build_ffmpeg_argv(
        audio_path=Path("/tmp/a.wav"),
        cover_path=Path("/tmp/c.png"),
        subtitles_path=None,
        output_path=Path("/tmp/out.mp4"),
        options=VideoOptions(ken_burns=False, waveform_overlay=False),
    )
    assert argv[0] == "ffmpeg"
    assert argv[-1].endswith("out.mp4")
    assert "-i" in argv
    joined = " ".join(argv)
    # Minimal path uses a plain scale, no zoompan/showwaves/subtitles
    assert "scale=1920:1080" in joined
    assert "zoompan" not in joined
    assert "showwaves" not in joined
    assert "subtitles" not in joined


def test_build_ffmpeg_argv_with_ken_burns_and_waveform(client) -> None:
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import _build_ffmpeg_argv

    argv = _build_ffmpeg_argv(
        audio_path=Path("/tmp/a.wav"),
        cover_path=Path("/tmp/c.png"),
        subtitles_path=None,
        output_path=Path("/tmp/out.mp4"),
        options=VideoOptions(ken_burns=True, waveform_overlay=True),
    )
    joined = " ".join(argv)
    assert "zoompan" in joined
    assert "showwaves" in joined


def test_build_ffmpeg_argv_with_burn_subs(client) -> None:
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import _build_ffmpeg_argv

    argv = _build_ffmpeg_argv(
        audio_path=Path("/tmp/a.wav"),
        cover_path=Path("/tmp/c.png"),
        subtitles_path=Path("C:/data/studio/subs/x.srt"),
        output_path=Path("/tmp/out.mp4"),
        options=VideoOptions(subtitles_mode="burn"),
    )
    joined = " ".join(argv)
    # Backslashes must be converted to forward slashes for ffmpeg
    assert "C:/data/studio/subs/x.srt" in joined
    assert "subtitles=" in joined


def test_build_ffmpeg_argv_with_soft_subs(client) -> None:
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import _build_ffmpeg_argv

    argv = _build_ffmpeg_argv(
        audio_path=Path("/tmp/a.wav"),
        cover_path=Path("/tmp/c.png"),
        subtitles_path=Path("/tmp/x.srt"),
        output_path=Path("/tmp/out.mp4"),
        options=VideoOptions(subtitles_mode="soft"),
    )
    # Soft subs: third input + mov_text codec
    assert argv.count("-i") == 3
    assert "mov_text" in argv


def test_build_ffmpeg_argv_escapes_title_text(client) -> None:
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import _build_ffmpeg_argv

    argv = _build_ffmpeg_argv(
        audio_path=Path("/tmp/a.wav"),
        cover_path=Path("/tmp/c.png"),
        subtitles_path=None,
        output_path=Path("/tmp/out.mp4"),
        options=VideoOptions(title_text="Ep. 1: Hello"),
    )
    joined = " ".join(argv)
    # Colons inside the title must be escaped so drawtext doesn't split on them
    assert "drawtext=text=" in joined
    assert r"Ep. 1\: Hello" in joined


def test_validate_options_rejects_bad_resolution(client) -> None:
    from backend.exceptions import InvalidSampleError
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import validate_options

    with pytest.raises(InvalidSampleError):
        validate_options(VideoOptions(resolution="9999x9999"))


def test_validate_options_rejects_bad_subs_mode(client) -> None:
    from backend.exceptions import InvalidSampleError
    from backend.schemas import VideoOptions
    from backend.services.video_renderer import validate_options

    with pytest.raises(InvalidSampleError):
        validate_options(VideoOptions(subtitles_mode="weird"))


# ── Service: studio_store (CRUD for renders) ───────────────────────


def test_studio_store_round_trip(client) -> None:
    import asyncio

    from backend.services import studio_store

    async def run() -> dict:
        created = await studio_store.create_render(
            kind="video",
            source_path="/tmp/src.wav",
            output_path="/tmp/out.mp4",
            duration_s=12.5,
            size_bytes=999,
        )
        fetched = await studio_store.get_render(created["id"])
        listed = await studio_store.list_renders()
        deleted = await studio_store.delete_render(created["id"])
        gone = await studio_store.get_render(created["id"])
        return {
            "created": created,
            "fetched": fetched,
            "listed_ids": [r["id"] for r in listed],
            "deleted": deleted,
            "gone": gone,
        }

    loop = asyncio.new_event_loop()
    try:
        result = loop.run_until_complete(run())
    finally:
        loop.close()

    assert result["created"]["kind"] == "video"
    assert result["fetched"]["id"] == result["created"]["id"]
    assert result["created"]["id"] in result["listed_ids"]
    assert result["deleted"] is True
    assert result["gone"] is None


def test_studio_store_list_filters_by_kind(client) -> None:
    import asyncio

    from backend.services import studio_store

    async def run() -> None:
        await studio_store.create_render(
            kind="audio", source_path="/tmp/a.wav", output_path="/tmp/a-out.wav",
        )
        await studio_store.create_render(
            kind="video", source_path="/tmp/b.wav", output_path="/tmp/b-out.mp4",
        )
        audios = await studio_store.list_renders(kind="audio")
        videos = await studio_store.list_renders(kind="video")
        assert all(r["kind"] == "audio" for r in audios)
        assert all(r["kind"] == "video" for r in videos)

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(run())
    finally:
        loop.close()


# ── Router: /api/studio/upload-cover ────────────────────────────────


def test_upload_cover_accepts_png(client) -> None:
    files = {"cover": ("cover.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 32, "image/png")}
    response = client.post("/api/studio/upload-cover", files=files)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filename"].startswith("cover_")
    assert body["filename"].endswith(".png")
    assert body["content_type"] == "image/png"
    # File must actually exist on disk
    assert Path(body["path"]).exists()


def test_upload_cover_rejects_executable(client) -> None:
    files = {"cover": ("virus.exe", b"MZ" + b"\x00" * 32, "application/octet-stream")}
    response = client.post("/api/studio/upload-cover", files=files)
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_sample"


# ── Router: /api/studio/render-video ────────────────────────────────


def _seed_cover(name: str = "cover.png") -> Path:
    from backend.paths import STUDIO_COVERS_DIR

    STUDIO_COVERS_DIR.mkdir(parents=True, exist_ok=True)
    path = STUDIO_COVERS_DIR / name
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    return path


def _patch_ffmpeg_runner(monkeypatch) -> None:
    """Replace the ffmpeg subprocess call with a no-op that just touches
    the output file. Keeps tests fast and platform-agnostic."""
    from backend.services.video_renderer import VideoRenderer

    async def fake_run(self, argv, output_path):
        output_path.write_bytes(b"fake mp4 content" * 64)

    monkeypatch.setattr(VideoRenderer, "_run_command", fake_run)


def test_render_video_writes_mp4_and_persists_row(client, monkeypatch) -> None:
    _patch_ffmpeg_runner(monkeypatch)
    src = _seed_source("render_src.wav")
    cover = _seed_cover("render_cover.png")

    response = client.post(
        "/api/studio/render-video",
        json={
            "audio_path": str(src.resolve()),
            "cover_path": str(cover.resolve()),
            "options": {
                "resolution": "1280x720",
                "ken_burns": False,
                "waveform_overlay": True,
                "subtitles_mode": "none",
            },
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("video/")
    assert response.headers.get("X-Video-Resolution") == "1280x720"
    assert len(response.content) > 0

    # Persisted row exists
    listed = client.get("/api/studio/renders?kind=video").json()
    assert listed["count"] >= 1
    assert any(
        str(src.resolve()) == r["source_path"] for r in listed["renders"]
    )


def test_render_video_rejects_bad_resolution(client, monkeypatch) -> None:
    _patch_ffmpeg_runner(monkeypatch)
    src = _seed_source("bad_res_src.wav")
    cover = _seed_cover("bad_res_cover.png")
    response = client.post(
        "/api/studio/render-video",
        json={
            "audio_path": str(src.resolve()),
            "cover_path": str(cover.resolve()),
            "options": {"resolution": "4096x2160"},
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_sample"


def test_render_video_rejects_path_outside_roots(client, monkeypatch) -> None:
    _patch_ffmpeg_runner(monkeypatch)
    cover = _seed_cover("rogue_cover.png")
    response = client.post(
        "/api/studio/render-video",
        json={
            "audio_path": "/etc/passwd",
            "cover_path": str(cover.resolve()),
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_sample"


def test_render_video_rejects_missing_cover(client, monkeypatch) -> None:
    _patch_ffmpeg_runner(monkeypatch)
    from backend.paths import STUDIO_COVERS_DIR

    src = _seed_source("missing_cover_src.wav")
    response = client.post(
        "/api/studio/render-video",
        json={
            "audio_path": str(src.resolve()),
            "cover_path": str((STUDIO_COVERS_DIR / "nope.png").resolve()),
        },
    )
    # Cover path passes root check but file doesn't exist → service raises
    assert response.status_code in (400, 404)


# ── Router: /api/studio/renders + delete ────────────────────────────


def test_renders_list_supports_kind_filter(client, monkeypatch) -> None:
    _patch_ffmpeg_runner(monkeypatch)
    src = _seed_source("list_filter_src.wav")
    cover = _seed_cover("list_filter_cover.png")
    client.post(
        "/api/studio/render-video",
        json={"audio_path": str(src.resolve()), "cover_path": str(cover.resolve())},
    )

    all_resp = client.get("/api/studio/renders").json()
    videos = client.get("/api/studio/renders?kind=video").json()
    audios = client.get("/api/studio/renders?kind=audio").json()

    assert all_resp["count"] >= 1
    assert all(r["kind"] == "video" for r in videos["renders"])
    assert all(r["kind"] == "audio" for r in audios["renders"])


def test_renders_list_rejects_bad_kind(client) -> None:
    response = client.get("/api/studio/renders?kind=weird")
    assert response.status_code == 400


def test_delete_render_removes_row_and_file(client, monkeypatch) -> None:
    _patch_ffmpeg_runner(monkeypatch)
    src = _seed_source("del_src.wav")
    cover = _seed_cover("del_cover.png")
    render_resp = client.post(
        "/api/studio/render-video",
        json={"audio_path": str(src.resolve()), "cover_path": str(cover.resolve())},
    )
    assert render_resp.status_code == 200

    listed = client.get("/api/studio/renders?kind=video").json()
    target = next(
        r for r in listed["renders"]
        if r["source_path"] == str(src.resolve())
    )
    output_file = Path(target["output_path"])
    assert output_file.exists()

    del_resp = client.delete(f"/api/studio/renders/{target['id']}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"

    # Row gone
    listed_after = client.get("/api/studio/renders").json()
    assert not any(r["id"] == target["id"] for r in listed_after["renders"])
    # File gone
    assert not output_file.exists()


def test_delete_nonexistent_render_404(client) -> None:
    response = client.delete("/api/studio/renders/does_not_exist")
    assert response.status_code == 404


# ── Roundtrip: audio edit persistence + chapter filter ──────────────


def test_edit_persists_when_chapter_id_provided(client) -> None:
    """Passing chapter_id on /edit must insert a studio_renders row so
    the Workbench can surface 'edited versions' for that chapter."""
    gen_id, _ = _make_chapter_with_generation(client, "edit_persist.mp3")
    # Grab the source path from /sources so we also verify chapter_id is exposed.
    sources = client.get("/api/studio/sources").json()["sources"]
    src = next(s for s in sources if s["id"] == gen_id)
    assert src["chapter_id"] is not None
    chapter_id = src["chapter_id"]

    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": src["source_path"],
            "operations": [
                {"type": "trim", "params": {"start_ms": 0, "end_ms": 500}},
            ],
            "output_format": "mp3",
            "project_id": src["project_id"],
            "chapter_id": chapter_id,
        },
    )
    assert response.status_code == 200

    # Render row must exist and link to the chapter
    listed = client.get(f"/api/studio/renders?chapter_id={chapter_id}").json()
    assert listed["count"] == 1
    row = listed["renders"][0]
    assert row["kind"] == "audio"
    assert row["chapter_id"] == chapter_id
    assert row["project_id"] == src["project_id"]
    assert "trim" in (row["operations"] or "")


def test_edit_without_chapter_id_does_not_persist(client) -> None:
    """Ad-hoc edits (no chapter context) stay throwaway."""
    src = _seed_source("adhoc_edit.mp3")
    before = client.get("/api/studio/renders?kind=audio").json()["count"]
    response = client.post(
        "/api/studio/edit",
        json={
            "source_path": str(src.resolve()),
            "operations": [{"type": "trim", "params": {"start_ms": 0, "end_ms": 500}}],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200
    after = client.get("/api/studio/renders?kind=audio").json()["count"]
    assert after == before


def test_renders_filter_by_chapter_id(client) -> None:
    """?chapter_id=X must scope results; other chapters must not leak."""
    gen_a, _ = _make_chapter_with_generation(client, "filter_a.mp3")
    gen_b, _ = _make_chapter_with_generation(client, "filter_b.mp3")
    sources = client.get("/api/studio/sources").json()["sources"]
    src_a = next(s for s in sources if s["id"] == gen_a)
    src_b = next(s for s in sources if s["id"] == gen_b)

    for src in (src_a, src_b):
        client.post(
            "/api/studio/edit",
            json={
                "source_path": src["source_path"],
                "operations": [{"type": "trim", "params": {"start_ms": 0, "end_ms": 400}}],
                "output_format": "mp3",
                "project_id": src["project_id"],
                "chapter_id": src["chapter_id"],
            },
        )

    listed_a = client.get(f"/api/studio/renders?chapter_id={src_a['chapter_id']}").json()
    listed_b = client.get(f"/api/studio/renders?chapter_id={src_b['chapter_id']}").json()
    assert listed_a["count"] >= 1
    assert listed_b["count"] >= 1
    assert all(r["chapter_id"] == src_a["chapter_id"] for r in listed_a["renders"])
    assert all(r["chapter_id"] == src_b["chapter_id"] for r in listed_b["renders"])


def test_sources_expose_project_and_chapter_ids(client) -> None:
    gen_id, _ = _make_chapter_with_generation(client, "expose_ids.mp3")
    sources = client.get("/api/studio/sources").json()["sources"]
    src = next(s for s in sources if s["id"] == gen_id)
    assert src["project_id"] and src["chapter_id"]
