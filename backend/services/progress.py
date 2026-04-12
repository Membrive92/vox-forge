"""In-memory progress registry for long-running synthesis jobs.

Each job is identified by a client-provided ID (header `X-Synthesis-Job-ID`).
The backend records `chunks_done / chunks_total` as it processes; the client
polls `/api/synthesize/progress/{job_id}` to drive a real progress bar.

Entries are cleaned up after completion or a short TTL so the dict doesn't
grow unbounded. There's no cross-process sharing — single uvicorn worker is
assumed (which matches the local-only single-user setup).
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

_TTL_SECONDS = 600  # Drop finished jobs after 10 minutes


@dataclass
class JobProgress:
    job_id: str
    status: str = "pending"  # pending | running | done | error | cancelled
    chunks_done: int = 0
    chunks_total: int = 0
    current_step: str = ""
    started_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    error: str | None = None


class ProgressRegistry:
    """Thread-safe dict of active jobs."""

    def __init__(self) -> None:
        self._jobs: dict[str, JobProgress] = {}
        self._lock = threading.Lock()

    def start(self, job_id: str, chunks_total: int = 0, step: str = "starting") -> JobProgress:
        with self._lock:
            self._sweep_locked()
            job = JobProgress(
                job_id=job_id,
                status="running",
                chunks_total=chunks_total,
                current_step=step,
            )
            self._jobs[job_id] = job
            logger.debug("Job started: %s (%d chunks)", job_id, chunks_total)
            return job

    def update(
        self,
        job_id: str,
        *,
        chunks_done: int | None = None,
        chunks_total: int | None = None,
        step: str | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if chunks_done is not None:
                job.chunks_done = chunks_done
            if chunks_total is not None:
                job.chunks_total = chunks_total
            if step is not None:
                job.current_step = step
            job.updated_at = time.time()

    def finish(self, job_id: str, status: str = "done", error: str | None = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = status
            job.error = error
            job.updated_at = time.time()
            logger.debug("Job finished: %s (%s)", job_id, status)

    def get(self, job_id: str) -> JobProgress | None:
        with self._lock:
            return self._jobs.get(job_id)

    def _sweep_locked(self) -> None:
        """Drop stale entries. Caller must hold the lock."""
        now = time.time()
        expired = [
            jid for jid, job in self._jobs.items()
            if job.status in ("done", "error", "cancelled") and now - job.updated_at > _TTL_SECONDS
        ]
        for jid in expired:
            del self._jobs[jid]


# Module-level singleton — injected via FastAPI Depends.
registry = ProgressRegistry()
