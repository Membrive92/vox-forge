"""SQLite database for projects, chapters, generations, and takes.

Schema auto-migrates on first connection. All access goes through
`get_db()` which returns an aiosqlite connection. The database lives
at `data/voxforge.db`.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

import aiosqlite

from .paths import DATA_DIR

logger = logging.getLogger(__name__)

DB_PATH: Path = DATA_DIR / "voxforge.db"

_SCHEMA_SQL = """
-- Projects (stories / audiobooks)
CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT 'es',
    voice_id    TEXT NOT NULL DEFAULT '',
    profile_id  TEXT DEFAULT NULL,
    speed       INTEGER NOT NULL DEFAULT 100,
    pitch       INTEGER NOT NULL DEFAULT 0,
    volume      INTEGER NOT NULL DEFAULT 80,
    output_format TEXT NOT NULL DEFAULT 'mp3',
    cover_path  TEXT DEFAULT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Chapters within a project. ``voice_id`` and ``profile_id`` are
-- per-chapter overrides; when NULL the chapter inherits from the
-- project. Useful for audiobooks with multiple narrators (a POV
-- change, epistolary sections, etc.).
CREATE TABLE IF NOT EXISTS chapters (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL DEFAULT 'Chapter',
    text        TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    voice_id    TEXT DEFAULT NULL,
    profile_id  TEXT DEFAULT NULL,
    -- The "canonical" generation for this chapter (overrides the
    -- default "most recent done"). Used by /sources and /export.
    -- No FK constraint so a deleted generation doesn't break the row.
    active_generation_id TEXT DEFAULT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Generations (complete synthesis runs for a chapter)
CREATE TABLE IF NOT EXISTS generations (
    id              TEXT PRIMARY KEY,
    chapter_id      TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    voice_id        TEXT NOT NULL,
    profile_id      TEXT DEFAULT NULL,
    output_format   TEXT NOT NULL DEFAULT 'mp3',
    speed           INTEGER NOT NULL DEFAULT 100,
    pitch           INTEGER NOT NULL DEFAULT 0,
    volume          INTEGER NOT NULL DEFAULT 80,
    engine          TEXT NOT NULL DEFAULT 'edge-tts',
    duration        REAL NOT NULL DEFAULT 0,
    file_path       TEXT DEFAULT NULL,
    chunks_total    INTEGER NOT NULL DEFAULT 0,
    chunks_done     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending',
    error           TEXT DEFAULT NULL,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- Individual chunk takes within a generation
CREATE TABLE IF NOT EXISTS takes (
    id              TEXT PRIMARY KEY,
    generation_id   TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    chunk_text      TEXT NOT NULL,
    file_path       TEXT DEFAULT NULL,
    duration        REAL NOT NULL DEFAULT 0,
    score           REAL NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      TEXT NOT NULL
);

-- Studio module: audio edits + video renders (Phase B)
-- ``project_id`` / ``chapter_id`` are nullable because a user may
-- edit a standalone audio file (e.g. an ambient mix) that isn't tied
-- to a chapter. Intentionally no FK constraint — renders are
-- historical artefacts and should survive chapter/project deletions.
CREATE TABLE IF NOT EXISTS studio_renders (
    id            TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,         -- "audio" | "video"
    source_path   TEXT NOT NULL,
    output_path   TEXT NOT NULL,
    operations    TEXT,                  -- JSON (audio edits) or video options
    project_id    TEXT,
    chapter_id    TEXT,
    duration_s    REAL NOT NULL DEFAULT 0,
    size_bytes    INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_generations_chapter ON generations(chapter_id);
CREATE INDEX IF NOT EXISTS idx_takes_generation ON takes(generation_id, chunk_index);
CREATE INDEX IF NOT EXISTS idx_studio_renders_chapter ON studio_renders(chapter_id);
CREATE INDEX IF NOT EXISTS idx_studio_renders_created ON studio_renders(created_at DESC);
"""


async def init_db() -> None:
    """Create database and tables if they don't exist."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(DB_PATH)) as db:
        await db.executescript(_SCHEMA_SQL)
        # In-place migration: add columns introduced after a DB was
        # first created. SQLite has no ``ADD COLUMN IF NOT EXISTS``, so
        # we try/except on the duplicate-column error.
        for column_def in (
            "ALTER TABLE projects ADD COLUMN cover_path TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN voice_id TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN profile_id TEXT DEFAULT NULL",
            "ALTER TABLE chapters ADD COLUMN active_generation_id TEXT DEFAULT NULL",
        ):
            try:
                await db.execute(column_def)
            except aiosqlite.OperationalError as exc:  # noqa: PERF203
                if "duplicate column" not in str(exc).lower():
                    raise
        await db.commit()
    logger.info("Database initialized at %s", DB_PATH)


@asynccontextmanager
async def get_db() -> AsyncIterator[aiosqlite.Connection]:
    """Yield an aiosqlite connection with WAL mode and foreign keys enabled."""
    db = await aiosqlite.connect(str(DB_PATH))
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()
