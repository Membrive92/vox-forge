"""Automatic audio QC via ASR-diff (QC-01).

The transcriber is stubbed by monkeypatching the default whisper
transcriber of the shared intelligibility core — the same injection
point the VOZ-08 tests use — so no real model ever loads. Chapter
synthesis itself runs against the stubbed Edge-TTS engine from
``conftest.py``, which persists per-chunk MP3s under the job dir
exactly like production does.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest


def _create_chapter(client, text: str) -> str:
    project = client.post(
        "/api/projects",
        json={"name": "QC Project", "language": "es", "voice_id": "es-ES-AlvaroNeural"},
    ).json()
    chapter = client.post(
        f"/api/projects/{project['id']}/chapters",
        json={"title": "C1", "text": text, "sort_order": 0},
    ).json()
    return chapter["id"]


def _multichunk_text() -> str:
    """Three paragraphs, total > chunk_max_chars, so split_into_chunks
    yields exactly one chunk per paragraph."""
    sentence = "La noche era oscura y tranquila en el pueblo costero. "
    para = (sentence * 26).strip()  # ~1400 chars, under the 3000 limit
    return "\n\n".join([para, para, para])  # ~4300 chars total


def _patch_transcriber(monkeypatch: pytest.MonkeyPatch, fake) -> None:
    """Replace the default whisper transcriber used when none is injected."""
    from backend.services import intelligibility

    monkeypatch.setattr(intelligibility, "_whisper_transcribe", fake)


# ── Endpoint: faithful vs sabotaged ──────────────────────────────────


def test_qc_faithful_chunk_not_flagged(client, monkeypatch) -> None:
    text = "La noche era oscura y tranquila en el pueblo costero."
    cid = _create_chapter(client, text)
    assert client.post(f"/api/chapters/{cid}/synthesize").status_code == 200

    def faithful(_path: Path, language: str | None) -> str:
        assert language == "es"  # project language must reach the ASR
        return text

    _patch_transcriber(monkeypatch, faithful)
    res = client.post(f"/api/chapters/{cid}/qc")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["scored"] == 1
    assert body["flagged"] == 0
    assert body["skipped"] == 0
    assert body["chunks"][0]["qc_score"] == 1.0
    assert body["chunks"][0]["qc_flagged"] is False


def test_qc_flags_exactly_the_sabotaged_chunk(client, monkeypatch) -> None:
    """Acceptance for QC-01: one deliberately sabotaged chunk in a
    multi-chunk chapter gets flagged — and only that one."""
    from backend.services.tts_engine import split_into_chunks

    text = _multichunk_text()
    expected_chunks = split_into_chunks(text)
    assert len(expected_chunks) == 3, "test text must split into 3 chunks"
    sabotaged_index = 1

    cid = _create_chapter(client, text)
    assert client.post(f"/api/chapters/{cid}/synthesize").status_code == 200

    def per_chunk(path: Path, _language: str | None) -> str:
        match = re.search(r"chunk_(\d{4})", path.name)
        assert match is not None, f"unexpected audio path: {path}"
        index = int(match.group(1))
        if index == sabotaged_index:
            # XTTS-style failure: half the chunk's words never spoken.
            full = expected_chunks[index]
            return full[: len(full) // 2]
        return expected_chunks[index]

    _patch_transcriber(monkeypatch, per_chunk)
    res = client.post(f"/api/chapters/{cid}/qc")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 3
    assert body["scored"] == 3
    assert body["flagged"] == 1
    flagged = [c["index"] for c in body["chunks"] if c["qc_flagged"]]
    assert flagged == [sabotaged_index]
    bad = body["chunks"][sabotaged_index]
    assert bad["qc_score"] is not None and bad["qc_score"] < 0.9
    assert bad["transcript"] is not None

    # Scores persist on the takes: the chunk map carries them on reload.
    chunk_map = client.get(f"/api/chapters/{cid}/chunks").json()
    flags = [c["qc_flagged"] for c in chunk_map["chunks"]]
    assert flags == [False, True, False]
    assert chunk_map["chunks"][0]["qc_score"] == 1.0
    assert chunk_map["chunks"][sabotaged_index]["qc_transcript"] is not None


def test_qc_normalization_avoids_dr_doctor_false_positive(client, monkeypatch) -> None:
    """The chapter says 'Dr.' and '3'; the ASR hears 'Doctor' and
    'tres'. Both normalize identically — no flag."""
    cid = _create_chapter(client, "El Dr. García llegó a las 3.")
    assert client.post(f"/api/chapters/{cid}/synthesize").status_code == 200

    _patch_transcriber(
        monkeypatch, lambda _p, _l: "El Doctor García llegó a las tres.",
    )
    body = client.post(f"/api/chapters/{cid}/qc").json()
    assert body["flagged"] == 0
    assert body["chunks"][0]["qc_score"] == 1.0


# ── Endpoint: error and skip paths ───────────────────────────────────


def test_qc_chapter_not_found_404(client) -> None:
    assert client.post("/api/chapters/nonexistent/qc").status_code == 404


def test_qc_without_done_generation_400(client) -> None:
    cid = _create_chapter(client, "Texto sin sintetizar.")
    res = client.post(f"/api/chapters/{cid}/qc")
    assert res.status_code == 400


def test_qc_skips_clone_chunks_without_audio_on_disk(client, monkeypatch) -> None:
    """A clone generation with no job-dir WAVs and no take audio has
    nothing to transcribe — QC must skip every chunk (score None, never
    flagged) instead of scoring the wrong audio. Since MED-CONC-2 the
    chunk list itself is the clause-level clone chunking."""
    import asyncio

    from backend.services import project_manager as pm
    from backend.services.tts_engine import split_into_clone_chunks

    text = _multichunk_text()
    clone_total = len(split_into_clone_chunks(text))
    assert clone_total > 3, "clone chunking must be finer than the 3 Edge chunks"
    cid = _create_chapter(client, text)

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(pm.create_generation(
            chapter_id=cid,
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
            engine="xtts-v2",
            chunks_total=clone_total,
        ))
        loop.run_until_complete(pm.update_generation(
            gen["id"], status="done", file_path="/fake/clone.mp3",
        ))
    finally:
        loop.close()

    def must_not_run(_path: Path, _language: str | None) -> str:
        raise AssertionError("QC transcribed audio it should have skipped")

    _patch_transcriber(monkeypatch, must_not_run)
    body = client.post(f"/api/chapters/{cid}/qc").json()
    assert body["total"] == clone_total
    assert body["skipped"] == clone_total
    assert body["flagged"] == 0
    assert all(c["qc_score"] is None for c in body["chunks"])


def test_qc_scores_clone_chunks_from_job_dir_wavs(client, monkeypatch) -> None:
    """Since MED-CONC-2 the takes of an XTTS generation use the clone
    chunk list, so the clause-level ``chunk_NNNN.wav`` files in the job
    dir are index-aligned and QC can transcribe them directly."""
    import asyncio

    from backend.services import job_store
    from backend.services import project_manager as pm
    from backend.services.tts_engine import split_into_clone_chunks

    text = "La noche era oscura. El mar estaba en calma. Una luz brillaba a lo lejos."
    clone_texts = [c.text for c in split_into_clone_chunks(text)]
    assert len(clone_texts) == 3
    cid = _create_chapter(client, text)

    loop = asyncio.new_event_loop()
    try:
        gen = loop.run_until_complete(pm.create_generation(
            chapter_id=cid,
            voice_id="es-ES-AlvaroNeural",
            output_format="mp3",
            engine="xtts-v2",
            chunks_total=3,
        ))
        loop.run_until_complete(pm.update_generation(
            gen["id"], status="done", file_path="/fake/clone.mp3",
        ))
    finally:
        loop.close()

    for i in range(3):
        wav = job_store.chunk_path(gen["id"], i, "wav")
        wav.parent.mkdir(parents=True, exist_ok=True)
        wav.write_bytes(b"RIFF" + b"\x00" * 64)

    sabotaged_index = 2

    def per_chunk(path: Path, _language: str | None) -> str:
        assert path.suffix == ".wav", f"expected the job-dir WAV, got {path}"
        match = re.search(r"chunk_(\d{4})", path.name)
        assert match is not None, f"unexpected audio path: {path}"
        index = int(match.group(1))
        if index == sabotaged_index:
            return "algo completamente distinto sin relacion alguna"
        return clone_texts[index]

    _patch_transcriber(monkeypatch, per_chunk)
    body = client.post(f"/api/chapters/{cid}/qc").json()
    assert body["total"] == 3
    assert body["scored"] == 3
    assert body["skipped"] == 0
    flagged = [c["index"] for c in body["chunks"] if c["qc_flagged"]]
    assert flagged == [sabotaged_index]


def test_regenerating_a_chunk_clears_its_qc_verdict(client, monkeypatch) -> None:
    """The QC verdict describes the old audio; a regen must reset it so
    a stale flag (or a stale pass) never lies about the new take."""
    text = "La noche era oscura y tranquila en el pueblo costero."
    cid = _create_chapter(client, text)
    assert client.post(f"/api/chapters/{cid}/synthesize").status_code == 200

    _patch_transcriber(monkeypatch, lambda _p, _l: "Texto completamente distinto al esperado.")
    assert client.post(f"/api/chapters/{cid}/qc").json()["flagged"] == 1
    before = client.get(f"/api/chapters/{cid}/chunks").json()["chunks"][0]
    assert before["qc_flagged"] is True

    assert client.post(f"/api/chapters/{cid}/regenerate-chunk/0").status_code == 200
    after = client.get(f"/api/chapters/{cid}/chunks").json()["chunks"][0]
    assert after["qc_score"] is None
    assert after["qc_flagged"] is False


# ── Schema migration (takes QC columns; user_version stamp) ──────────


def test_takes_table_carries_qc_columns_and_schema_stamped(client) -> None:
    import asyncio

    from backend.database import SCHEMA_VERSION, get_db

    # The takes QC columns arrived in v3; the version only moves forward.
    assert SCHEMA_VERSION >= 3

    async def inspect() -> tuple[int, set[str]]:
        async with get_db() as db:
            cursor = await db.execute("PRAGMA user_version")
            version = (await cursor.fetchone())[0]
            cursor = await db.execute("PRAGMA table_info(takes)")
            columns = {row[1] for row in await cursor.fetchall()}
            return version, columns

    loop = asyncio.new_event_loop()
    try:
        version, columns = loop.run_until_complete(inspect())
    finally:
        loop.close()
    assert version == SCHEMA_VERSION
    assert {"qc_score", "qc_transcript"} <= columns
