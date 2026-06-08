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
