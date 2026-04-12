"""Crash-safe job persistence for long-running synthesis jobs.

Each job gets:
- a JSON record at `data/jobs/{job_id}.json` with the full synthesis
  request (text, voice, profile, format, metadata)
- a directory `data/jobs/{job_id}/` where finished chunk audio files
  are stashed as they complete

On success, both are deleted. On crash (process killed, power loss,
error), they survive and the UI can list + resume them.

Resume relies on split functions being deterministic for the same
input text — chunks are re-computed in the same order, and any
chunk file already present on disk is skipped.
"""
from __future__ import annotations

import json
import logging
import os
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..paths import DATA_DIR

logger = logging.getLogger(__name__)

JOBS_DIR: Path = DATA_DIR / "jobs"


@dataclass
class JobRecord:
    """Persisted synthesis job state."""

    job_id: str
    request: dict[str, Any]
    engine: str  # "edge-tts" | "xtts-v2"
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    @property
    def chunks_dir(self) -> Path:
        return JOBS_DIR / self.job_id

    @property
    def record_path(self) -> Path:
        return JOBS_DIR / f"{self.job_id}.json"

    def to_json(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "request": self.request,
            "engine": self.engine,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> JobRecord:
        return cls(
            job_id=data["job_id"],
            request=data["request"],
            engine=data.get("engine", "edge-tts"),
            created_at=float(data.get("created_at", time.time())),
            updated_at=float(data.get("updated_at", time.time())),
        )


def new_job_id() -> str:
    return str(uuid.uuid4())[:12]


def _write_atomic(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", prefix="job_", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(content)
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise


def save_record(record: JobRecord) -> None:
    record.updated_at = time.time()
    record.chunks_dir.mkdir(parents=True, exist_ok=True)
    _write_atomic(record.record_path, json.dumps(record.to_json(), ensure_ascii=False, indent=2))


def load_record(job_id: str) -> JobRecord | None:
    path = JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return JobRecord.from_json(data)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load job %s: %s", job_id, exc)
        return None


def list_incomplete() -> list[JobRecord]:
    if not JOBS_DIR.exists():
        return []
    out: list[JobRecord] = []
    for path in JOBS_DIR.glob("*.json"):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            out.append(JobRecord.from_json(data))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Skipping unreadable job %s: %s", path.name, exc)
    out.sort(key=lambda r: r.updated_at, reverse=True)
    return out


def cleanup_job(job_id: str) -> None:
    """Delete the record file and chunk directory for a completed/cancelled job."""
    record_path = JOBS_DIR / f"{job_id}.json"
    chunks_dir = JOBS_DIR / job_id
    record_path.unlink(missing_ok=True)
    if chunks_dir.exists():
        shutil.rmtree(chunks_dir, ignore_errors=True)


def chunk_path(job_id: str, index: int, extension: str) -> Path:
    """Deterministic filename for chunk N of a job."""
    return JOBS_DIR / job_id / f"chunk_{index:04d}.{extension.lstrip('.')}"
