"""Durable atomic file writes.

Used by every JSON store (profiles, pronunciations, job records). The
fsync before the rename is the important part: ``os.replace`` is atomic,
but without flushing the new bytes to disk first a power loss between the
write and the rename can leave a zero-length or truncated file. For
``profiles.json`` that means silently losing every cloned voice, so the
durability guarantee matters.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_text_atomic(path: Path, content: str, *, encoding: str = "utf-8") -> None:
    """Atomically and durably replace ``path`` with ``content``.

    Writes to a temp file in the same directory, flushes + fsyncs it, then
    ``os.replace``s it into place (atomic on POSIX and Windows). On any
    failure the temp file is removed and the original is left untouched.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(suffix=".tmp", prefix=f"{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding=encoding) as fh:
            fh.write(content)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except Exception:
        Path(tmp).unlink(missing_ok=True)
        raise
