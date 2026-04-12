"""Read-only endpoints to inspect the server log files from the UI.

Supports both the text log (regex-parsed) and the JSONL log (native JSON).
The JSONL path is preferred — faster, lossless, and handles stack traces.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from ..logging_config import APP_JSONL_FILE, APP_LOG_FILE, ERROR_LOG_FILE
from ..schemas import LogEntry, LogsResponse

router = APIRouter(prefix="/logs", tags=["logs"])

_VALID_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}

# How many bytes to read from the end of the file for seek-based tail.
# 512KB covers ~3000-5000 log lines. Much cheaper than reading the full 10MB.
_TAIL_BYTES = 512 * 1024


def _tail_seek(path: Path, max_lines: int) -> list[str]:
    """Read the last *max_lines* from a file using seek from the end.

    Reads at most _TAIL_BYTES from the tail. For a 10MB rotated file
    this means ~5% I/O instead of 100%.
    """
    if not path.exists():
        return []
    size = path.stat().st_size
    if size == 0:
        return []
    read_bytes = min(size, _TAIL_BYTES)
    with path.open("rb") as fh:
        fh.seek(-read_bytes, os.SEEK_END)
        raw = fh.read().decode("utf-8", errors="replace")
    lines = raw.splitlines()
    # The first line is likely partial (we seeked into the middle of it)
    if read_bytes < size and lines:
        lines = lines[1:]
    return lines[-max_lines:]


def _parse_jsonl_lines(lines: list[str]) -> list[LogEntry]:
    """Parse JSON lines into LogEntry objects, grouping stack traces."""
    entries: list[LogEntry] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            entries.append(LogEntry(
                timestamp="", level="", request_id="-",
                logger="", message=line, raw=line,
            ))
            continue

        msg = obj.get("msg", "")
        exc = obj.get("exc")
        if exc:
            msg = f"{msg}\n{exc}"

        entries.append(LogEntry(
            timestamp=obj.get("ts", ""),
            level=obj.get("level", ""),
            request_id=obj.get("rid", "-"),
            logger=obj.get("logger", ""),
            message=msg,
            raw=line,
        ))
    return entries


@router.get("/recent", response_model=LogsResponse, summary="Tail recent log lines")
async def recent_logs(
    lines: int = Query(default=200, ge=1, le=5000),
    level: str | None = Query(default=None, description="Filter by level"),
    source: str = Query(default="app", pattern="^(app|errors)$"),
    request_id: str | None = Query(default=None, alias="rid", description="Filter by request ID"),
    since: str | None = Query(default=None, description="ISO timestamp lower bound"),
    until: str | None = Query(default=None, description="ISO timestamp upper bound"),
) -> LogsResponse:
    """Return the last *lines* entries from the chosen log source.

    Prefers the JSONL file (lossless, with grouped stack traces).
    Falls back to the text log if JSONL is not available.
    """
    # Prefer JSONL for the app source — it has structured data + stack traces
    if source == "app" and APP_JSONL_FILE.exists():
        raw_lines = _tail_seek(APP_JSONL_FILE, lines)
        entries = _parse_jsonl_lines(raw_lines)
    else:
        path = APP_LOG_FILE if source == "app" else ERROR_LOG_FILE
        raw_lines = _tail_seek(path, lines)
        entries = _parse_text_lines(raw_lines)

    # Apply filters
    if level:
        upper = level.upper()
        if upper not in _VALID_LEVELS:
            raise HTTPException(status_code=400, detail=f"Invalid level: {level}")
        entries = [e for e in entries if e.level == upper]

    if request_id:
        entries = [e for e in entries if request_id in e.request_id]

    if since:
        entries = [e for e in entries if e.timestamp >= since]

    if until:
        entries = [e for e in entries if e.timestamp and e.timestamp <= until]

    return LogsResponse(entries=entries, source=source, returned=len(entries))


@router.get("/download", summary="Download the raw log file")
async def download_log(
    source: str = Query(default="app", pattern="^(app|errors|jsonl)$"),
) -> FileResponse:
    path_map = {"app": APP_LOG_FILE, "errors": ERROR_LOG_FILE, "jsonl": APP_JSONL_FILE}
    path = path_map[source]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Log file not found")
    return FileResponse(
        path=str(path),
        media_type="application/jsonl" if source == "jsonl" else "text/plain",
        filename=path.name,
    )


@router.get("/error-count", summary="Count recent errors")
async def error_count(
    minutes: int = Query(default=60, ge=1, le=1440),
) -> dict[str, int]:
    """Count ERROR and WARNING entries in the last N minutes.

    Used by the frontend to show an error badge on the Logs tab.
    """
    from datetime import datetime, timedelta, timezone
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()

    if APP_JSONL_FILE.exists():
        raw_lines = _tail_seek(APP_JSONL_FILE, 2000)
        entries = _parse_jsonl_lines(raw_lines)
    else:
        raw_lines = _tail_seek(ERROR_LOG_FILE, 2000)
        entries = _parse_text_lines(raw_lines)

    errors = 0
    warnings = 0
    for e in entries:
        if e.timestamp and e.timestamp >= cutoff:
            if e.level == "ERROR":
                errors += 1
            elif e.level == "WARNING":
                warnings += 1

    return {"errors": errors, "warnings": warnings, "minutes": minutes}


# ── Text log fallback parser ────────────────────────────────────────

import re

_LINE_RE = re.compile(
    r"^(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+"
    r"\[(?P<level>[A-Z]+)\s*\]\s+"
    r"\[(?P<rid>[^\]]+)\]\s+"
    r"(?P<logger>[^:]+):\s+"
    r"(?P<msg>.*)$"
)


def _parse_text_lines(lines: list[str]) -> list[LogEntry]:
    """Parse text log lines, grouping continuation lines (stack traces)
    with their parent entry."""
    entries: list[LogEntry] = []

    for line in lines:
        match = _LINE_RE.match(line)
        if match:
            entries.append(LogEntry(
                timestamp=match.group("ts"),
                level=match.group("level").strip(),
                request_id=match.group("rid"),
                logger=match.group("logger"),
                message=match.group("msg"),
                raw=line,
            ))
        elif entries:
            # Continuation line — append to the last entry's message
            last = entries[-1]
            entries[-1] = LogEntry(
                timestamp=last.timestamp,
                level=last.level,
                request_id=last.request_id,
                logger=last.logger,
                message=f"{last.message}\n{line}",
                raw=f"{last.raw}\n{line}",
            )
        else:
            entries.append(LogEntry(
                timestamp="", level="", request_id="-",
                logger="", message=line, raw=line,
            ))

    return entries
