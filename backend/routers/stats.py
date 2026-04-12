"""Basic usage statistics derived from logs and the database."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Query

from ..logging_config import APP_JSONL_FILE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stats", tags=["stats"])

_TAIL_BYTES = 1024 * 1024  # 1MB for stats scan


@router.get("", summary="Usage statistics")
async def get_stats(
    hours: int = Query(default=24, ge=1, le=168),
) -> dict:
    """Return usage statistics for the last N hours.

    Scans the JSONL log for synthesis events, errors, and timing.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()

    stats = {
        "period_hours": hours,
        "total_requests": 0,
        "synthesis_count": 0,
        "error_count": 0,
        "warning_count": 0,
        "avg_request_ms": 0.0,
        "slowest_request_ms": 0.0,
        "slowest_request_path": "",
        "top_endpoints": {},
        "engines_used": {},
    }

    if not APP_JSONL_FILE.exists():
        return stats

    size = APP_JSONL_FILE.stat().st_size
    read_bytes = min(size, _TAIL_BYTES)

    try:
        with APP_JSONL_FILE.open("rb") as fh:
            if read_bytes < size:
                fh.seek(-read_bytes, os.SEEK_END)
            raw = fh.read().decode("utf-8", errors="replace")
    except Exception:
        return stats

    lines = raw.splitlines()
    if read_bytes < size and lines:
        lines = lines[1:]

    request_durations: list[float] = []
    endpoint_counts: dict[str, int] = {}
    engine_counts: dict[str, int] = {}

    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        ts = obj.get("ts", "")
        if ts < cutoff:
            continue

        level = obj.get("level", "")
        msg = obj.get("msg", "")

        if level == "ERROR":
            stats["error_count"] += 1
        elif level == "WARNING":
            stats["warning_count"] += 1

        # Access log entries from backend.access
        logger_name = obj.get("logger", "")
        if logger_name == "backend.access" and " -> " in msg:
            stats["total_requests"] += 1

            # Parse "POST /api/synthesize -> 200 (3420.1ms)"
            parts = msg.split(" -> ")
            if len(parts) == 2:
                method_path = parts[0].strip()
                path = method_path.split(" ", 1)[1] if " " in method_path else method_path
                endpoint_counts[path] = endpoint_counts.get(path, 0) + 1

                # Extract duration
                import re
                dur_match = re.search(r"\(([\d.]+)ms\)", parts[1])
                if dur_match:
                    dur = float(dur_match.group(1))
                    request_durations.append(dur)
                    if dur > stats["slowest_request_ms"]:
                        stats["slowest_request_ms"] = dur
                        stats["slowest_request_path"] = method_path

        # Count synthesis by engine
        if "synthesize" in msg.lower() or "clone chunk" in msg.lower():
            if "edge-tts" in msg.lower() or "Edge-TTS" in msg:
                engine_counts["edge-tts"] = engine_counts.get("edge-tts", 0) + 1
            if "xtts" in msg.lower() or "clone" in msg.lower():
                engine_counts["xtts-v2"] = engine_counts.get("xtts-v2", 0) + 1

        if "Audio exported" in msg or "Clone audio exported" in msg:
            stats["synthesis_count"] += 1

    if request_durations:
        stats["avg_request_ms"] = round(sum(request_durations) / len(request_durations), 1)
    stats["slowest_request_ms"] = round(stats["slowest_request_ms"], 1)

    # Top 10 endpoints
    sorted_eps = sorted(endpoint_counts.items(), key=lambda x: x[1], reverse=True)[:10]
    stats["top_endpoints"] = dict(sorted_eps)
    stats["engines_used"] = engine_counts

    return stats
