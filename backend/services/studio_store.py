"""CRUD for the ``studio_renders`` table (Studio Phase B).

Each row represents either an audio edit (Phase A outputs, once we start
persisting them) or a video render (Phase B). The schema is shared so
the FE can list both under a single "Recent renders" panel.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from ..database import get_db


def _new_id() -> str:
    return str(uuid.uuid4())[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    return dict(row)


async def create_render(
    *,
    kind: str,
    source_path: str,
    output_path: str,
    operations: str | None = None,
    project_id: str | None = None,
    chapter_id: str | None = None,
    duration_s: float = 0.0,
    size_bytes: int = 0,
) -> dict[str, Any]:
    if kind not in ("audio", "video"):
        raise ValueError(f"Invalid kind: {kind}")
    rid = _new_id()
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO studio_renders
               (id, kind, source_path, output_path, operations,
                project_id, chapter_id, duration_s, size_bytes, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (rid, kind, source_path, output_path, operations,
             project_id, chapter_id, duration_s, size_bytes, now),
        )
        await db.commit()
    return (await get_render(rid))  # type: ignore[return-value]


async def get_render(render_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM studio_renders WHERE id = ?", (render_id,),
        )
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None


async def list_renders(
    *,
    kind: str | None = None,
    chapter_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return renders ordered by newest first.

    ``kind`` filters to ``audio`` or ``video``. ``chapter_id`` scopes
    the list to a single chapter — used by the Workbench to count and
    link edited versions of a specific chapter.
    """
    query = "SELECT * FROM studio_renders"
    where: list[str] = []
    params: list[Any] = []
    if kind is not None:
        where.append("kind = ?")
        params.append(kind)
    if chapter_id is not None:
        where.append("chapter_id = ?")
        params.append(chapter_id)
    if where:
        query += " WHERE " + " AND ".join(where)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    async with get_db() as db:
        cursor = await db.execute(query, params)
        return [_row_to_dict(r) for r in await cursor.fetchall()]


async def delete_render(render_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM studio_renders WHERE id = ?", (render_id,),
        )
        await db.commit()
        return cursor.rowcount > 0
