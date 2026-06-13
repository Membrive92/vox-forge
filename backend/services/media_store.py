"""CRUD for the ``media_assets`` table (media library, T2I-1 / UX-03).

Each row is one source asset in the library — a generated, uploaded or
imported image (and, later, a clip). The montage timeline (UX-03 M3+)
reads the same table, so this stays a thin, generic store: no business
logic about how an asset was produced lives here.

Mirrors ``studio_store.py``: 12-char uuid id, ISO-utc timestamps, dict
row factory. ``filename`` / ``thumb_filename`` are relative to
``STUDIO_MEDIA_DIR`` — the router resolves them to disk paths so serving
is always by id, never by a client-supplied path.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from ..database import get_db

_VALID_KINDS: frozenset[str] = frozenset({"image", "clip"})
_VALID_ORIGINS: frozenset[str] = frozenset({"upload", "imported", "generated"})


def _new_id() -> str:
    return str(uuid.uuid4())[:12]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: aiosqlite.Row) -> dict[str, Any]:
    return dict(row)


async def create_asset(
    *,
    kind: str,
    filename: str,
    origin: str,
    thumb_filename: str | None = None,
    source_path: str | None = None,
    meta_json: str | None = None,
    width: int | None = None,
    height: int | None = None,
    duration_s: float | None = None,
    prompt: str | None = None,
    seed: int | None = None,
    aspect_ratio: str | None = None,
) -> dict[str, Any]:
    if kind not in _VALID_KINDS:
        raise ValueError(f"Invalid kind: {kind}")
    if origin not in _VALID_ORIGINS:
        raise ValueError(f"Invalid origin: {origin}")
    aid = _new_id()
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO media_assets
               (id, kind, filename, thumb_filename, origin, source_path,
                meta_json, width, height, duration_s, prompt, seed,
                aspect_ratio, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (aid, kind, filename, thumb_filename, origin, source_path,
             meta_json, width, height, duration_s, prompt, seed,
             aspect_ratio, now),
        )
        await db.commit()
    return (await get_asset(aid))  # type: ignore[return-value]


async def get_asset(asset_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM media_assets WHERE id = ?", (asset_id,),
        )
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None


async def list_assets(
    *,
    kind: str | None = None,
    origin: str | None = None,
    query: str | None = None,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Return assets newest-first.

    ``kind`` / ``origin`` filter exactly; ``query`` is a case-insensitive
    substring match against the stored ``prompt`` (used by the gallery
    search box).
    """
    sql = "SELECT * FROM media_assets"
    where: list[str] = []
    params: list[Any] = []
    if kind is not None:
        where.append("kind = ?")
        params.append(kind)
    if origin is not None:
        where.append("origin = ?")
        params.append(origin)
    if query:
        where.append("prompt LIKE ? ESCAPE '\\'")
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    async with get_db() as db:
        cursor = await db.execute(sql, params)
        return [_row_to_dict(r) for r in await cursor.fetchall()]


async def delete_asset(asset_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute(
            "DELETE FROM media_assets WHERE id = ?", (asset_id,),
        )
        await db.commit()
        return cursor.rowcount > 0
