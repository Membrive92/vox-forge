"""Workbench-related endpoints: projects, chapters, chunk synthesis,
character casting, pronunciation, activity, stats, and the B7 regression."""
from __future__ import annotations


# ── Projects CRUD ────────────────────────────────────────────────────

def _create_project(client, name: str = "Test Project") -> dict:
    response = client.post(
        "/api/projects",
        json={
            "name": name,
            "language": "es",
            "voice_id": "es-ES-AlvaroNeural",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_project_crud_full_cycle(client) -> None:
    # Create
    project = _create_project(client, "Cycle Test")
    pid = project["id"]
    assert project["name"] == "Cycle Test"
    assert project["language"] == "es"

    # List
    list_resp = client.get("/api/projects")
    assert list_resp.status_code == 200
    assert any(p["id"] == pid for p in list_resp.json())

    # Get
    get_resp = client.get(f"/api/projects/{pid}")
    assert get_resp.status_code == 200
    assert get_resp.json()["id"] == pid

    # Update
    patch_resp = client.patch(f"/api/projects/{pid}", json={"name": "Renamed"})
    assert patch_resp.status_code == 200
    assert patch_resp.json()["name"] == "Renamed"

    # Delete
    del_resp = client.delete(f"/api/projects/{pid}")
    assert del_resp.status_code == 200
    assert client.get(f"/api/projects/{pid}").status_code == 404


def test_project_create_empty_name_rejected(client) -> None:
    response = client.post("/api/projects", json={"name": ""})
    assert response.status_code == 422


def test_project_get_nonexistent_404(client) -> None:
    assert client.get("/api/projects/nonexistent").status_code == 404


def test_project_delete_nonexistent_404(client) -> None:
    assert client.delete("/api/projects/nonexistent").status_code == 404


# ── Chapters CRUD ────────────────────────────────────────────────────

def test_chapter_crud(client) -> None:
    project = _create_project(client)
    pid = project["id"]

    create = client.post(
        f"/api/projects/{pid}/chapters",
        json={"title": "Cap 1", "text": "Texto de prueba.", "sort_order": 0},
    )
    assert create.status_code == 201
    cid = create.json()["id"]

    listed = client.get(f"/api/projects/{pid}/chapters")
    assert listed.status_code == 200
    assert len(listed.json()) == 1

    update = client.patch(
        f"/api/projects/chapters/{cid}",
        json={"text": "Texto actualizado"},
    )
    assert update.status_code == 200
    assert update.json()["text"] == "Texto actualizado"

    deleted = client.delete(f"/api/projects/chapters/{cid}")
    assert deleted.status_code == 200


def test_chapter_split_by_heading(client) -> None:
    project = _create_project(client)
    pid = project["id"]
    text = "# Intro\nHola mundo.\n# Capitulo 2\nMas texto aqui."
    response = client.post(
        f"/api/projects/{pid}/split",
        json={"text": text, "delimiter": "heading"},
    )
    assert response.status_code == 201
    chapters = response.json()
    assert len(chapters) == 2
    titles = [c["title"] for c in chapters]
    assert "Intro" in titles
    assert "Capitulo 2" in titles


def test_chapter_split_by_separator(client) -> None:
    project = _create_project(client)
    pid = project["id"]
    response = client.post(
        f"/api/projects/{pid}/split",
        json={"text": "Part one\n---\nPart two", "delimiter": "separator"},
    )
    assert response.status_code == 201
    assert len(response.json()) == 2


def test_chapter_split_invalid_delimiter(client) -> None:
    project = _create_project(client)
    pid = project["id"]
    response = client.post(
        f"/api/projects/{pid}/split",
        json={"text": "x", "delimiter": "invalid"},
    )
    assert response.status_code == 422


# ── Chapter synthesis + chunk map + regen ────────────────────────────

def test_chapter_synthesize_and_chunk_map(client) -> None:
    project = _create_project(client)
    pid = project["id"]

    create = client.post(
        f"/api/projects/{pid}/chapters",
        json={"title": "C1", "text": "Hola mundo de prueba.", "sort_order": 0},
    )
    cid = create.json()["id"]

    # Synthesize
    synth = client.post(f"/api/chapters/{cid}/synthesize")
    assert synth.status_code == 200
    assert synth.headers.get("x-audio-engine") == "edge-tts"
    assert "x-generation-id" in synth.headers

    # Chunk map
    chunks = client.get(f"/api/chapters/{cid}/chunks")
    assert chunks.status_code == 200
    body = chunks.json()
    assert body["generation_id"] is not None
    assert body["total"] >= 1
    assert all(c["status"] == "done" for c in body["chunks"])


def test_chapter_regenerate_chunk(client) -> None:
    project = _create_project(client)
    pid = project["id"]
    create = client.post(
        f"/api/projects/{pid}/chapters",
        json={"title": "C1", "text": "Texto corto.", "sort_order": 0},
    )
    cid = create.json()["id"]
    client.post(f"/api/chapters/{cid}/synthesize")

    regen = client.post(f"/api/chapters/{cid}/regenerate-chunk/0")
    assert regen.status_code == 200

    out_of_range = client.post(f"/api/chapters/{cid}/regenerate-chunk/999")
    assert out_of_range.status_code == 400


def test_chapter_synthesize_nonexistent_404(client) -> None:
    assert client.post("/api/chapters/nonexistent/synthesize").status_code == 404


# ── Character casting ────────────────────────────────────────────────

def test_extract_characters(client) -> None:
    response = client.post(
        "/api/character-synth/extract-characters",
        json={"text": "[Narrator] It was dark.\n[Kael] I told you.\n[Narrator] He laughed."},
    )
    assert response.status_code == 200
    assert response.json()["characters"] == ["Narrator", "Kael"]


def test_extract_characters_no_tags(client) -> None:
    response = client.post(
        "/api/character-synth/extract-characters",
        json={"text": "plain text without any tags"},
    )
    assert response.status_code == 200
    assert response.json()["characters"] == []


def test_cast_synthesize_with_mappings(client) -> None:
    response = client.post(
        "/api/character-synth/synthesize",
        json={
            "text": "[Narrator] Hello.\n[Kael] World.",
            "cast": [
                {"character": "Narrator", "voice_id": "es-ES-AlvaroNeural"},
                {"character": "Kael", "voice_id": "es-ES-AlvaroNeural"},
            ],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("x-audio-segments") is not None
    # No unmapped characters
    assert response.headers.get("x-unmapped-characters", "") == ""


def test_cast_synthesize_unmapped_warning(client) -> None:
    response = client.post(
        "/api/character-synth/synthesize",
        json={
            "text": "[Narrator] Hello.\n[Stranger] Who am I?",
            "cast": [{"character": "Narrator", "voice_id": "es-ES-AlvaroNeural"}],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200
    # Unmapped header should list "Stranger"
    assert "Stranger" in response.headers.get("x-unmapped-characters", "")


# ── Pronunciation dictionary ─────────────────────────────────────────

def test_pronunciation_crud(client) -> None:
    initial = client.get("/api/pronunciations")
    assert initial.status_code == 200

    create = client.post(
        "/api/pronunciations",
        json={"word": "Caelthir", "replacement": "Quelzir"},
    )
    assert create.status_code == 200

    listed = client.get("/api/pronunciations")
    assert "Caelthir" in listed.json()["entries"]

    deleted = client.delete("/api/pronunciations/Caelthir")
    assert deleted.status_code == 200


def test_pronunciation_empty_word_rejected(client) -> None:
    response = client.post(
        "/api/pronunciations",
        json={"word": "", "replacement": "x"},
    )
    assert response.status_code == 422


def test_pronunciation_delete_nonexistent_404(client) -> None:
    assert client.delete("/api/pronunciations/NoExiste").status_code == 404


# ── Activity + Stats + Logs ──────────────────────────────────────────

def test_activity_feed(client) -> None:
    response = client.get("/api/activity")
    assert response.status_code == 200
    body = response.json()
    assert "generations" in body
    assert "errors" in body
    assert "disk" in body
    assert "total" in body["disk"]


def test_stats_endpoint(client) -> None:
    response = client.get("/api/stats?hours=1")
    assert response.status_code == 200
    body = response.json()
    assert "total_requests" in body
    assert "synthesis_count" in body
    assert "error_count" in body
    assert "avg_request_ms" in body


def test_logs_recent(client) -> None:
    response = client.get("/api/logs/recent?lines=10&source=app")
    assert response.status_code == 200


def test_logs_invalid_source_rejected(client) -> None:
    response = client.get("/api/logs/recent?source=invalid")
    assert response.status_code == 422


def test_logs_invalid_level_rejected(client) -> None:
    response = client.get("/api/logs/recent?level=INVALID")
    assert response.status_code == 400


def test_error_count(client) -> None:
    response = client.get("/api/logs/error-count?minutes=60")
    assert response.status_code == 200
    body = response.json()
    assert "errors" in body
    assert "warnings" in body


# ── Ambience library ─────────────────────────────────────────────────

def test_ambience_list_empty(client) -> None:
    response = client.get("/api/ambience")
    assert response.status_code == 200
    assert "tracks" in response.json()


def test_ambience_get_nonexistent_404(client) -> None:
    assert client.get("/api/ambience/nonexistent").status_code == 404


def test_ambience_delete_nonexistent_404(client) -> None:
    assert client.delete("/api/ambience/nonexistent").status_code == 404


# ── B7 regression: invalid profile_id must NOT create ghost job ──────

def test_invalid_profile_id_no_ghost_job(client) -> None:
    """Regression for B7: when profile_id is invalid, the synth must
    fail with 404 AND must NOT leave a job record on disk."""
    before = client.get("/api/synthesize/incomplete").json()["count"]

    response = client.post(
        "/api/synthesize",
        json={
            "text": "Test",
            "voice_id": "es-ES-AlvaroNeural",
            "profile_id": "nonexistent999",
        },
    )
    assert response.status_code == 404
    assert response.json()["code"] == "profile_not_found"

    after = client.get("/api/synthesize/incomplete").json()["count"]
    assert after == before, "Invalid profile_id must not create a ghost job"


def test_invalid_format_no_ghost_job(client) -> None:
    """Regression for B2: same protection for invalid output_format."""
    before = client.get("/api/synthesize/incomplete").json()["count"]

    response = client.post(
        "/api/synthesize",
        json={
            "text": "Test",
            "voice_id": "es-ES-AlvaroNeural",
            "output_format": "xyz",
        },
    )
    assert response.status_code == 400

    after = client.get("/api/synthesize/incomplete").json()["count"]
    assert after == before, "Invalid format must not create a ghost job"


# ── A1: upload-audio + A3: active_generation_id ─────────────────────

def _create_chapter(client, project_id: str, title: str = "C1") -> dict:
    response = client.post(
        f"/api/projects/{project_id}/chapters",
        json={"title": title, "text": "some text", "sort_order": 0},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_upload_chapter_audio_creates_generation(client) -> None:
    project = _create_project(client, "Upload Test")
    chapter = _create_chapter(client, project["id"])

    files = {"audio": ("narration.wav", b"RIFF" + b"\x00" * 64, "audio/wav")}
    response = client.post(
        f"/api/chapters/{chapter['id']}/upload-audio",
        files=files,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["engine"] == "upload"
    assert body["status"] == "done"
    assert body["chapter_id"] == chapter["id"]
    assert body["file_path"].endswith(".wav")

    # It becomes the chapter's active generation
    refreshed = client.get(f"/api/projects/chapters/{chapter['id']}/generations").json()
    assert len(refreshed) == 1
    assert refreshed[0]["id"] == body["id"]


def test_upload_chapter_audio_rejects_bad_mime(client) -> None:
    project = _create_project(client, "Bad Mime")
    chapter = _create_chapter(client, project["id"])

    files = {"audio": ("virus.exe", b"MZ" + b"\x00" * 32, "application/octet-stream")}
    response = client.post(
        f"/api/chapters/{chapter['id']}/upload-audio",
        files=files,
    )
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_sample"


def test_upload_chapter_audio_nonexistent_chapter_404(client) -> None:
    files = {"audio": ("a.wav", b"RIFF" + b"\x00" * 16, "audio/wav")}
    response = client.post("/api/chapters/does_not_exist/upload-audio", files=files)
    assert response.status_code == 404


def test_upload_chapter_audio_sets_active_generation(client) -> None:
    """After upload, ``chapter.active_generation_id`` points at the new row."""
    project = _create_project(client, "Active")
    chapter = _create_chapter(client, project["id"])

    files = {"audio": ("a.wav", b"RIFF" + b"\x00" * 64, "audio/wav")}
    up = client.post(f"/api/chapters/{chapter['id']}/upload-audio", files=files).json()

    # Patch would expose this, but we read chapter directly via list endpoint
    chapters = client.get(f"/api/projects/{project['id']}/chapters").json()
    target = next(c for c in chapters if c["id"] == chapter["id"])
    assert target["active_generation_id"] == up["id"]


def test_active_generation_id_can_be_cleared(client) -> None:
    """PATCH with null clears the override so chapter falls back to newest."""
    project = _create_project(client, "Clearable")
    chapter = _create_chapter(client, project["id"])
    files = {"audio": ("a.wav", b"RIFF" + b"\x00" * 64, "audio/wav")}
    client.post(f"/api/chapters/{chapter['id']}/upload-audio", files=files)

    response = client.patch(
        f"/api/projects/chapters/{chapter['id']}",
        json={"active_generation_id": None},
    )
    assert response.status_code == 200
    assert response.json()["active_generation_id"] is None


def test_chapter_update_accepts_active_generation_id(client) -> None:
    """PATCH can explicitly set an older generation as active."""
    project = _create_project(client, "Switch")
    chapter = _create_chapter(client, project["id"])
    files = {"audio": ("a.wav", b"RIFF" + b"\x00" * 64, "audio/wav")}
    first = client.post(f"/api/chapters/{chapter['id']}/upload-audio", files=files).json()
    files2 = {"audio": ("b.wav", b"RIFF" + b"\x00" * 64, "audio/wav")}
    second = client.post(f"/api/chapters/{chapter['id']}/upload-audio", files=files2).json()

    # After two uploads, the second is active. Switch back to the first.
    response = client.patch(
        f"/api/projects/chapters/{chapter['id']}",
        json={"active_generation_id": first["id"]},
    )
    assert response.status_code == 200
    assert response.json()["active_generation_id"] == first["id"]
    assert first["id"] != second["id"]
