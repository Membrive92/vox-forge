"""Workbench-related endpoints: projects, chapters, chunk synthesis,
character casting, pronunciation, activity, stats, and the B7 regression."""
from __future__ import annotations

import io


def _fake_wav() -> io.BytesIO:
    buf = io.BytesIO(b"RIFF" + b"\x00" * 40)
    buf.name = "sample.wav"
    return buf


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


def test_chapter_regenerate_chunk_routes_through_engine_for_cloned_profile(
    client,
) -> None:
    """Regression: regenerate-chunk used to call edge_tts.Communicate
    directly, ignoring whether the chapter was generated with a cloned
    voice (XTTS profile). That broke the user's narrator voice on
    regen. The fix routes through TTSEngine.synthesize() so:
      - a cloned profile -> clone engine (errors out with no CUDA in
        tests, surfacing as 500; that's the right path)
      - no profile / no sample -> edge-tts (still 200)

    Here we create a generation that points at a profile WITH a sample.
    The pre-fix code would have happily called edge-tts and returned
    200, silently losing the cloned voice. With the fix, it must NOT
    return 200 — it routes through the engine which can't synthesize
    without CUDA in the test stub.
    """
    import asyncio

    from backend.services import project_manager as pm

    # Create a profile with an attached sample (triggers the clone path)
    profile = client.post(
        "/api/profiles",
        data={
            "name": "Cloned narrator",
            "voice_id": "es-ES-AlvaroNeural",
            "language": "es",
            "speed": 100, "pitch": 0, "volume": 80,
        },
        files={"sample": ("voice.wav", _fake_wav(), "audio/wav")},
    ).json()
    assert profile["sample_filename"] is not None

    project = _create_project(client)
    pid = project["id"]
    chapter = client.post(
        f"/api/projects/{pid}/chapters",
        json={"title": "C1", "text": "Texto corto.", "sort_order": 0},
    ).json()
    cid = chapter["id"]

    # Manually insert a generation as if it had been synthesized with
    # the cloned profile. We can't go through /synthesize because
    # there's no CUDA in tests, but the BD shape is what matters for
    # the regenerate path.
    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(pm.create_generation(
            chapter_id=cid,
            voice_id="es-ES-AlvaroNeural",
            profile_id=profile["id"],
            output_format="mp3",
            speed=100, pitch=0, volume=80,
            engine="xtts-v2",
            chunks_total=1,
        ))
        # Mark the generation as done so regen can find it
        loop.run_until_complete(pm.update_generation(
            gen["id"], status="done", output_path="/fake/output.mp3",
        ))
    finally:
        loop.close()

    # Now regenerate. Without the fix, this would return 200 (edge-tts).
    # With the fix, it routes to the clone engine which raises because
    # there's no CUDA — surfaced as 500 by the global error handler.
    regen = client.post(f"/api/chapters/{cid}/regenerate-chunk/0")
    assert regen.status_code != 200, (
        "regenerate-chunk silently fell back to edge-tts for a cloned "
        "profile — this is the regression we're guarding against."
    )
    # Specifically, it should be a CUDA-related synthesis error
    body = regen.json()
    technical = body.get("technical", body.get("detail", ""))
    assert "CUDA" in technical or "synthesis" in technical.lower(), (
        f"unexpected error shape: {body}"
    )


def test_chapter_synthesize_nonexistent_404(client) -> None:
    assert client.post("/api/chapters/nonexistent/synthesize").status_code == 404


# ── MED-CONC-2: bookkeeping must use the engine's real chunk list ────

_CONC2_TEXT = (
    "Primera frase del capitulo. Segunda frase distinta. Tercera y ultima frase."
)


def _make_cloned_profile(client, name: str = "Narrador clonado") -> dict:
    response = client.post(
        "/api/profiles",
        data={
            "name": name,
            "voice_id": "es-ES-AlvaroNeural",
            "language": "es",
            "speed": 100, "pitch": 0, "volume": 80,
        },
        files={"sample": ("voice.wav", _fake_wav(), "audio/wav")},
    )
    profile = response.json()
    assert profile["sample_filename"] is not None
    return profile


def test_chapter_synthesis_registers_clone_chunks_for_xtts_profile(
    client, monkeypatch,
) -> None:
    """MED-CONC-2: when the profile routes to XTTS, ``chunks_total``,
    the takes and the chunk map must mirror the clause-level clone
    chunking — this text is 1 Edge chunk but 3 clone chunks."""
    from backend.paths import OUTPUT_DIR
    from backend.services import tts_engine as te

    clone_texts = [c.text for c in te.split_into_clone_chunks(_CONC2_TEXT)]
    assert len(clone_texts) == 3
    assert len(te.split_into_chunks(_CONC2_TEXT)) == 1  # the old, wrong basis

    async def fake_cloned(
        self, request, sample_paths, language,
        cancel_token=None, job_id=None, *, castilian_anchor=False,
    ):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUTPUT_DIR / "fake_clone_chapter.mp3"
        out.write_bytes(b"ID3fake-clone-audio")
        return te.SynthesisResult(path=out, chunks=len(clone_texts), engine="xtts-v2")

    monkeypatch.setattr(te.TTSEngine, "_synthesize_cloned", fake_cloned)

    profile = _make_cloned_profile(client)
    project = _create_project(client, "Clone chunks")
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": _CONC2_TEXT, "sort_order": 0},
    ).json()
    patched = client.patch(
        f"/api/projects/chapters/{chapter['id']}",
        json={"profile_id": profile["id"]},
    )
    assert patched.status_code == 200, patched.text

    synth = client.post(f"/api/chapters/{chapter['id']}/synthesize")
    assert synth.status_code == 200, synth.text
    assert synth.headers["x-audio-engine"] == "xtts-v2"
    assert synth.headers["x-audio-chunks"] == "3"

    gens = client.get(f"/api/projects/chapters/{chapter['id']}/generations").json()
    assert len(gens) == 1
    gen = gens[0]
    assert gen["engine"] == "xtts-v2"
    assert gen["chunks_total"] == 3
    assert gen["chunks_done"] == 3

    chunk_map = client.get(f"/api/chapters/{chapter['id']}/chunks").json()
    assert chunk_map["total"] == 3
    assert [c["text"] for c in chunk_map["chunks"]] == clone_texts
    assert all(c["status"] == "done" and c["take_id"] for c in chunk_map["chunks"])


def test_failed_clone_chapter_records_real_engine_and_chunk_count(client) -> None:
    """Even when XTTS synthesis fails (no CUDA in tests), the generation
    row must carry the resolved engine and the clone chunk count — not
    the hardcoded edge-tts + Edge chunking the route used to write."""
    profile = _make_cloned_profile(client, "Narrador sin GPU")
    project = _create_project(client, "Clone failure")
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": _CONC2_TEXT, "sort_order": 0},
    ).json()
    client.patch(
        f"/api/projects/chapters/{chapter['id']}",
        json={"profile_id": profile["id"]},
    )

    synth = client.post(f"/api/chapters/{chapter['id']}/synthesize")
    assert synth.status_code != 200

    gens = client.get(f"/api/projects/chapters/{chapter['id']}/generations").json()
    assert len(gens) == 1
    assert gens[0]["engine"] == "xtts-v2"
    assert gens[0]["status"] == "error"
    assert gens[0]["chunks_total"] == 3


# ── MED-PERF-4: latest done generation resolved with SQL LIMIT 1 ─────


def test_get_latest_done_generation_returns_newest_done(client) -> None:
    """The helper must pick the most recent ``done`` generation, ignoring
    newer rows that errored, and return None when nothing completed."""
    import asyncio

    from backend.services import project_manager as pm

    project = _create_project(client, "LatestDone")
    chapter = _create_chapter(client, project["id"])
    cid = chapter["id"]

    async def seed() -> tuple[str, str]:
        assert await pm.get_latest_done_generation(cid) is None
        old_done = await pm.create_generation(cid, voice_id="v", engine="edge-tts")
        await pm.update_generation(old_done["id"], status="done", file_path="/a.mp3")
        new_done = await pm.create_generation(cid, voice_id="v", engine="edge-tts")
        await pm.update_generation(new_done["id"], status="done", file_path="/b.mp3")
        newer_error = await pm.create_generation(cid, voice_id="v", engine="edge-tts")
        await pm.update_generation(newer_error["id"], status="error", error="boom")
        return old_done["id"], new_done["id"]

    loop = asyncio.new_event_loop()
    try:
        _old_id, new_id = loop.run_until_complete(seed())
        latest = loop.run_until_complete(pm.get_latest_done_generation(cid))
    finally:
        loop.close()

    assert latest is not None
    assert latest["id"] == new_id


def test_batch_export_reuses_latest_done_generation(client, monkeypatch) -> None:
    """Export must bundle the newest completed generation's audio without
    re-synthesizing when one exists on disk."""
    import asyncio
    import io
    import zipfile

    from backend.paths import OUTPUT_DIR
    from backend.services import project_manager as pm
    from backend.services.tts_engine import TTSEngine

    project = _create_project(client, "ExportReuse")
    chapter = _create_chapter(client, project["id"])
    cid = chapter["id"]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    old_audio = OUTPUT_DIR / "export_old.mp3"
    old_audio.write_bytes(b"OLD-GEN-AUDIO")
    new_audio = OUTPUT_DIR / "export_new.mp3"
    new_audio.write_bytes(b"NEW-GEN-AUDIO")

    async def seed() -> None:
        old = await pm.create_generation(cid, voice_id="v", engine="edge-tts")
        await pm.update_generation(old["id"], status="done", file_path=str(old_audio))
        new = await pm.create_generation(cid, voice_id="v", engine="edge-tts")
        await pm.update_generation(new["id"], status="done", file_path=str(new_audio))

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(seed())
    finally:
        loop.close()

    async def must_not_synthesize(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("export re-synthesized a chapter that has audio")

    monkeypatch.setattr(TTSEngine, "synthesize", must_not_synthesize)

    # GET on purpose: the frontend downloads via a plain anchor (UX-02).
    response = client.get(f"/api/export/{project['id']}")
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
        audio_entries = [n for n in zf.namelist() if n.startswith("audio/")]
        assert len(audio_entries) == 1
        assert zf.read(audio_entries[0]) == b"NEW-GEN-AUDIO"


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


# ── Character-cast concat: silence pattern + temp cleanup (BAJO-34) ──


def _spy_on_silence(monkeypatch) -> list[int]:
    """Record every ``AudioSegment.silent`` duration the cast router asks
    for, while keeping the stub's behavior (a clip of that length)."""
    from backend.routers import character_synth as cs

    calls: list[int] = []
    original = cs.AudioSegment.silent.__func__

    def spy(cls, duration=0, **kwargs):
        calls.append(duration)
        return original(cls, duration=duration, **kwargs)

    monkeypatch.setattr(cs.AudioSegment, "silent", classmethod(spy))
    return calls


def test_cast_concat_inserts_600ms_pause_on_character_switch(client, monkeypatch) -> None:
    """Three segments (Ana/Luis/Ana) → two character switches. Each stub
    segment is 1000ms, so the duration header proves the two 600ms pauses
    actually landed in the concatenated audio."""
    silent_calls = _spy_on_silence(monkeypatch)

    response = client.post(
        "/api/character-synth/synthesize",
        json={
            "text": "[Ana] Hola.\n[Luis] Buenas noches.\n[Ana] Adiós.",
            "cast": [
                {"character": "Ana", "voice_id": "es-ES-AlvaroNeural"},
                {"character": "Luis", "voice_id": "es-ES-AlvaroNeural"},
            ],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200, response.text
    assert response.headers["x-audio-segments"] == "3"
    # 3 × 1000ms segments + 2 × 600ms switch pauses = 4.2s
    assert response.headers["x-audio-duration"] == "4.2"
    assert 600 in silent_calls


def test_cast_concat_uses_300ms_pause_between_same_character_segments(client, monkeypatch) -> None:
    """Adjacent segments by the SAME character get the short 300ms breath,
    not the 600ms switch pause. The parser merges same-character lines, so
    the segment list is injected to exercise the branch."""
    from backend.routers import character_synth as cs
    from backend.services.character_parser import CharacterSegment

    monkeypatch.setattr(
        cs,
        "parse_character_markup",
        lambda _text: [
            CharacterSegment(character="Ana", text="Hola."),
            CharacterSegment(character="Ana", text="Sigo siendo yo."),
            CharacterSegment(character="Luis", text="Adiós."),
        ],
    )
    silent_calls = _spy_on_silence(monkeypatch)

    response = client.post(
        "/api/character-synth/synthesize",
        json={
            "text": "ignored by the patched parser",
            "cast": [
                {"character": "Ana", "voice_id": "es-ES-AlvaroNeural"},
                {"character": "Luis", "voice_id": "es-ES-AlvaroNeural"},
            ],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200, response.text
    # One 600ms pause object built up front + one 300ms same-character gap.
    assert silent_calls == [600, 300]
    # 3 × 1000ms + 300ms (same char) + 600ms (switch) = 3.9s
    assert response.headers["x-audio-duration"] == "3.9"


def test_cast_synthesize_cleans_per_segment_temp_files(client) -> None:
    """The per-segment synth outputs are intermediates: after the request,
    only the final cast_*.mp3 may remain in the output dir."""
    from backend.paths import OUTPUT_DIR

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    before = set(OUTPUT_DIR.iterdir())

    response = client.post(
        "/api/character-synth/synthesize",
        json={
            "text": "[Ana] Hola.\n[Luis] Adiós.",
            "cast": [
                {"character": "Ana", "voice_id": "es-ES-AlvaroNeural"},
                {"character": "Luis", "voice_id": "es-ES-AlvaroNeural"},
            ],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 200

    new_files = set(OUTPUT_DIR.iterdir()) - before
    assert len(new_files) == 1, f"segment temp files leaked: {new_files}"
    assert next(iter(new_files)).name.startswith("cast_")


def test_cast_synthesize_failure_cleans_partial_segments(client) -> None:
    """If a later segment fails (invalid voice), the already-synthesized
    segment files must not be left behind."""
    from backend.paths import OUTPUT_DIR

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    before = set(OUTPUT_DIR.iterdir())

    response = client.post(
        "/api/character-synth/synthesize",
        json={
            "text": "[Ana] Hola.\n[Luis] Adiós.",
            "cast": [
                {"character": "Ana", "voice_id": "es-ES-AlvaroNeural"},
                {"character": "Luis", "voice_id": "voz-inexistente"},
            ],
            "output_format": "mp3",
        },
    )
    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_voice"
    assert set(OUTPUT_DIR.iterdir()) == before, "partial segment audio leaked"


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


def test_regenerate_chunk_resplices_edge_chapter(client, _session_env) -> None:
    """Edge-TTS regen must rebuild generation.file_path and report respliced.

    Guards the 'false success' regression: previously regen updated only
    the take and left the chapter audio stale while reporting 200.
    """
    import asyncio

    from backend.paths import OUTPUT_DIR
    from backend.services import job_store
    from backend.services import project_manager as pm

    project = _create_project(client, "Resplice")
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": "Texto corto.", "sort_order": 0},
    ).json()
    cid = chapter["id"]

    chapter_audio = OUTPUT_DIR / "chapter_resplice.mp3"
    chapter_audio.write_bytes(b"OLD CHAPTER AUDIO")

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(pm.create_generation(
            chapter_id=cid, voice_id="es-ES-AlvaroNeural", profile_id=None,
            output_format="mp3", speed=100, pitch=0, volume=80,
            engine="edge-tts", chunks_total=1,
        ))
        loop.run_until_complete(pm.update_generation(
            gen["id"], status="done", file_path=str(chapter_audio), duration=1.0,
        ))
        loop.run_until_complete(pm.create_take(
            generation_id=gen["id"], chunk_index=0, chunk_text="Texto corto.", status="done",
        ))
    finally:
        loop.close()

    # The original Edge synthesis would have left chunk_0000.mp3 in the job dir.
    job_chunk = job_store.chunk_path(gen["id"], 0, "mp3")
    job_chunk.parent.mkdir(parents=True, exist_ok=True)
    job_chunk.write_bytes(b"chunk0")

    resp = client.post(f"/api/chapters/{cid}/regenerate-chunk/0")
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("X-Chapter-Respliced") == "true"
    # The chapter audio must have been rewritten (no longer the stale bytes).
    assert chapter_audio.read_bytes() != b"OLD CHAPTER AUDIO"


def test_regenerate_chunk_without_persisted_chunks_reports_not_respliced(
    client, _session_env,
) -> None:
    """A multi-chunk chapter whose other chunks aren't on disk can't be
    re-spliced — regen updates only the take, reports respliced=false, and
    leaves the chapter audio untouched (no corruption)."""
    import asyncio

    from backend.paths import OUTPUT_DIR
    from backend.services import project_manager as pm
    from backend.services.tts_engine import split_into_chunks

    # Long enough to split into 2+ chunks (chunk_max_chars defaults to 3000).
    long_text = "Una frase de prueba. " * 300
    assert len(split_into_chunks(long_text)) >= 2

    project = _create_project(client, "NoResplice")
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": long_text, "sort_order": 0},
    ).json()
    cid = chapter["id"]

    chapter_audio = OUTPUT_DIR / "chapter_no_resplice.mp3"
    chapter_audio.write_bytes(b"KEEP ME")

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(pm.create_generation(
            chapter_id=cid, voice_id="es-ES-AlvaroNeural", profile_id=None,
            output_format="mp3", speed=100, pitch=0, volume=80,
            engine="edge-tts", chunks_total=2,
        ))
        loop.run_until_complete(pm.update_generation(
            gen["id"], status="done", file_path=str(chapter_audio), duration=1.0,
        ))
    finally:
        loop.close()

    # Only chunk 0 gets written by regen; the other chunk's audio is absent.
    resp = client.post(f"/api/chapters/{cid}/regenerate-chunk/0")
    assert resp.status_code == 200, resp.text
    assert resp.headers.get("X-Chapter-Respliced") == "false"
    assert chapter_audio.read_bytes() == b"KEEP ME", "chapter audio must be untouched"


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
