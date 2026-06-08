"""Security regression tests: job-id path-traversal guards.

A ``job_id`` flows straight into filesystem paths (record file + chunk
dir) and the ``X-Synthesis-Job-ID`` header is client-controlled, so it is
a security boundary. These guard against re-introducing the traversal.
"""
from __future__ import annotations

import pytest


def test_is_valid_job_id_accepts_generated_ids() -> None:
    from backend.services import job_store

    assert job_store.is_valid_job_id(job_store.new_job_id())
    assert job_store.is_valid_job_id("a1b2c3d4-e5f")
    assert job_store.is_valid_job_id("abc123_DEF")


@pytest.mark.parametrize(
    "evil",
    [
        "../../etc/passwd",
        "..\\..\\windows\\system32",
        "a/b",
        "a\\b",
        "..",
        ".",
        "foo/../bar",
        "with space",
        "semi;colon",
        "x" * 65,  # too long
        "",
    ],
)
def test_is_valid_job_id_rejects_unsafe(evil: str) -> None:
    from backend.services import job_store

    assert not job_store.is_valid_job_id(evil)


def test_validate_job_id_raises_on_traversal() -> None:
    from backend.services import job_store

    with pytest.raises(job_store.InvalidJobId):
        job_store.validate_job_id("../../etc/passwd")


def test_jobrecord_rejects_unsafe_id() -> None:
    from backend.services import job_store

    with pytest.raises(job_store.InvalidJobId):
        job_store.JobRecord(job_id="../evil", request={}, engine="edge-tts")


def test_cleanup_job_refuses_to_rmtree_outside_jobs_dir(tmp_path) -> None:
    """cleanup_job must no-op on an unsafe id, never rmtree an escaped path."""
    from backend.services import job_store

    victim = tmp_path / "victim"
    victim.mkdir()
    keep = victim / "keep.txt"
    keep.write_text("important")

    # An id that would traverse out of JOBS_DIR if concatenated naively.
    job_store.cleanup_job("../" * 8 + "victim")

    assert keep.exists(), "cleanup_job escaped JOBS_DIR and deleted external data"


def test_chunk_path_rejects_unsafe_id() -> None:
    from backend.services import job_store

    with pytest.raises(job_store.InvalidJobId):
        job_store.chunk_path("../../oops", 0, "mp3")


# ── Upload content sniffing ─────────────────────────────────────────

def test_validate_audio_bytes_accepts_known_audio() -> None:
    from backend.upload_utils import validate_audio_bytes

    # WAV (RIFF....WAVE) and MP3 (ID3) headers must pass.
    validate_audio_bytes(b"RIFF\x00\x00\x00\x00WAVEfmt ")
    validate_audio_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x00\x00")
    # Ambiguous binary (no known magic, not texty) is allowed — ffmpeg decides.
    validate_audio_bytes(b"\x00\x01\x02\x03\x04\x05\x06\x07\x08\x09\x0a\x0b\x0c")


@pytest.mark.parametrize(
    "payload",
    [
        b"<!DOCTYPE html><html><body>hi</body></html>",
        b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00",  # PE executable
        b"%PDF-1.7\n%...",
        b"#!/bin/sh\nrm -rf /\n",
    ],
)
def test_validate_audio_bytes_rejects_non_audio(payload: bytes) -> None:
    from backend.exceptions import InvalidSampleError
    from backend.upload_utils import validate_audio_bytes

    with pytest.raises(InvalidSampleError):
        validate_audio_bytes(payload)


def test_escape_subtitles_path_escapes_drive_colon() -> None:
    from pathlib import Path

    from backend.services.video_renderer import _escape_subtitles_path

    out = _escape_subtitles_path(Path(r"C:\data\studio\subs\x.srt"))
    assert out == r"C\:/data/studio/subs/x.srt"


def test_progress_snapshot_is_isolated_from_mutation() -> None:
    from backend.services.progress import ProgressRegistry

    reg = ProgressRegistry()
    reg.start("abc", chunks_total=10)
    snap = reg.snapshot("abc")
    assert snap is not None
    reg.update("abc", chunks_done=5)
    # The snapshot was a copy — later mutations must not change it.
    assert snap.chunks_done == 0


def test_normalizer_keeps_common_uppercase_words() -> None:
    from backend.services.text_normalizer import _spell_unknown_siglas

    # Real words in caps must NOT be spelled out letter by letter.
    assert "ene o" not in _spell_unknown_siglas("¡NO puede ser!")
    # Genuine unknown acronyms still get spelled.
    assert _spell_unknown_siglas("la XYZ") != "la XYZ"
