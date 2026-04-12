"""CRUD operations for projects, chapters, generations, and takes.

All methods use `get_db()` for async SQLite access. IDs are short UUIDs.
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


# ── Projects ────────────────────────────────────────────────────────

async def list_projects() -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC"
        )
        return [_row_to_dict(r) for r in await cursor.fetchall()]


async def get_project(project_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None


async def create_project(
    name: str,
    language: str = "es",
    description: str = "",
    voice_id: str = "",
    profile_id: str | None = None,
    output_format: str = "mp3",
    speed: int = 100,
    pitch: int = 0,
    volume: int = 80,
) -> dict[str, Any]:
    pid = _new_id()
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO projects
               (id, name, description, language, voice_id, profile_id,
                speed, pitch, volume, output_format, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (pid, name, description, language, voice_id, profile_id,
             speed, pitch, volume, output_format, now, now),
        )
        await db.commit()
    return (await get_project(pid))  # type: ignore[return-value]


async def update_project(project_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {
        "name", "description", "language", "voice_id", "profile_id",
        "speed", "pitch", "volume", "output_format",
    }
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return await get_project(project_id)
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [project_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE projects SET {set_clause} WHERE id = ?", values,  # noqa: S608
        )
        await db.commit()
    return await get_project(project_id)


async def delete_project(project_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        await db.commit()
        return cursor.rowcount > 0


# ── Chapters ────────────────────────────────────────────────────────

async def list_chapters(project_id: str) -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM chapters WHERE project_id = ? ORDER BY sort_order",
            (project_id,),
        )
        return [_row_to_dict(r) for r in await cursor.fetchall()]


async def get_chapter(chapter_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM chapters WHERE id = ?", (chapter_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None


async def create_chapter(
    project_id: str,
    title: str = "Chapter",
    text: str = "",
    sort_order: int = 0,
) -> dict[str, Any]:
    cid = _new_id()
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO chapters (id, project_id, title, text, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (cid, project_id, title, text, sort_order, now, now),
        )
        await db.commit()
    return (await get_chapter(cid))  # type: ignore[return-value]


async def update_chapter(chapter_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {"title", "text", "sort_order"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return await get_chapter(chapter_id)
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [chapter_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE chapters SET {set_clause} WHERE id = ?", values,  # noqa: S608
        )
        await db.commit()
    return await get_chapter(chapter_id)


async def delete_chapter(chapter_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM chapters WHERE id = ?", (chapter_id,))
        await db.commit()
        return cursor.rowcount > 0


async def split_text_into_chapters(
    project_id: str,
    full_text: str,
    delimiter: str = "heading",
) -> list[dict[str, Any]]:
    """Split text by headings (`# ...`) or separators (`---`) and create chapters.

    Existing chapters for this project are deleted first.
    """
    import re

    if delimiter == "separator":
        parts = re.split(r"\n---+\n", full_text.strip())
    else:
        parts = re.split(r"(?m)^(#{1,3}\s+.+)$", full_text.strip())
        # re.split with group keeps the delimiter — pair them up
        chapters_raw: list[tuple[str, str]] = []
        i = 0
        while i < len(parts):
            part = parts[i].strip()
            if re.match(r"^#{1,3}\s+", part):
                title = re.sub(r"^#{1,3}\s+", "", part).strip()
                body = parts[i + 1].strip() if i + 1 < len(parts) else ""
                chapters_raw.append((title, body))
                i += 2
            else:
                if part:
                    chapters_raw.append(("Introduction", part))
                i += 1
        if not chapters_raw:
            chapters_raw = [("Chapter 1", full_text.strip())]

        # Delete existing chapters
        async with get_db() as db:
            await db.execute("DELETE FROM chapters WHERE project_id = ?", (project_id,))
            await db.commit()

        result: list[dict[str, Any]] = []
        for idx, (title, body) in enumerate(chapters_raw):
            ch = await create_chapter(project_id, title=title, text=body, sort_order=idx)
            result.append(ch)
        return result

    # separator path
    async with get_db() as db:
        await db.execute("DELETE FROM chapters WHERE project_id = ?", (project_id,))
        await db.commit()

    result = []
    for idx, part in enumerate(parts):
        part = part.strip()
        if not part:
            continue
        ch = await create_chapter(
            project_id,
            title=f"Chapter {idx + 1}",
            text=part,
            sort_order=idx,
        )
        result.append(ch)
    return result


# ── Generations ─────────────────────────────────────────────────────

async def list_generations(chapter_id: str) -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM generations WHERE chapter_id = ? ORDER BY created_at DESC",
            (chapter_id,),
        )
        return [_row_to_dict(r) for r in await cursor.fetchall()]


async def get_generation(gen_id: str) -> dict[str, Any] | None:
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM generations WHERE id = ?", (gen_id,))
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else None


async def create_generation(
    chapter_id: str,
    voice_id: str,
    profile_id: str | None = None,
    output_format: str = "mp3",
    speed: int = 100,
    pitch: int = 0,
    volume: int = 80,
    engine: str = "edge-tts",
    chunks_total: int = 0,
) -> dict[str, Any]:
    gid = _new_id()
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO generations
               (id, chapter_id, voice_id, profile_id, output_format,
                speed, pitch, volume, engine, chunks_total, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)""",
            (gid, chapter_id, voice_id, profile_id, output_format,
             speed, pitch, volume, engine, chunks_total, now, now),
        )
        await db.commit()
    return (await get_generation(gid))  # type: ignore[return-value]


async def update_generation(gen_id: str, **fields: Any) -> None:
    allowed = {
        "status", "error", "duration", "file_path",
        "chunks_done", "chunks_total", "engine",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    updates["updated_at"] = _now()
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [gen_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE generations SET {set_clause} WHERE id = ?", values,  # noqa: S608
        )
        await db.commit()


async def delete_generation(gen_id: str) -> bool:
    async with get_db() as db:
        cursor = await db.execute("DELETE FROM generations WHERE id = ?", (gen_id,))
        await db.commit()
        return cursor.rowcount > 0


# ── Takes ───────────────────────────────────────────────────────────

async def list_takes(generation_id: str) -> list[dict[str, Any]]:
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT * FROM takes WHERE generation_id = ? ORDER BY chunk_index",
            (generation_id,),
        )
        return [_row_to_dict(r) for r in await cursor.fetchall()]


async def create_take(
    generation_id: str,
    chunk_index: int,
    chunk_text: str,
    file_path: str | None = None,
    duration: float = 0,
    score: float = 0,
    status: str = "pending",
) -> dict[str, Any]:
    tid = _new_id()
    now = _now()
    async with get_db() as db:
        await db.execute(
            """INSERT INTO takes
               (id, generation_id, chunk_index, chunk_text, file_path,
                duration, score, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (tid, generation_id, chunk_index, chunk_text, file_path,
             duration, score, status, now),
        )
        await db.commit()
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM takes WHERE id = ?", (tid,))
        row = await cursor.fetchone()
        return _row_to_dict(row) if row else {}


async def update_take(take_id: str, **fields: Any) -> None:
    allowed = {"file_path", "duration", "score", "status"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [take_id]
    async with get_db() as db:
        await db.execute(
            f"UPDATE takes SET {set_clause} WHERE id = ?", values,  # noqa: S608
        )
        await db.commit()
