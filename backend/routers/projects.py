"""Projects & chapters CRUD endpoints."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..services import project_manager as pm

router = APIRouter(prefix="/projects", tags=["projects"])


# ── Request/Response models ─────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="")
    language: str = Field(default="es")
    voice_id: str = Field(default="")
    profile_id: Optional[str] = None
    output_format: str = Field(default="mp3")
    speed: int = Field(default=100, ge=50, le=200)
    pitch: int = Field(default=0, ge=-10, le=10)
    volume: int = Field(default=80, ge=0, le=100)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    language: Optional[str] = None
    voice_id: Optional[str] = None
    profile_id: Optional[str] = None
    output_format: Optional[str] = None
    speed: Optional[int] = Field(default=None, ge=50, le=200)
    pitch: Optional[int] = Field(default=None, ge=-10, le=10)
    volume: Optional[int] = Field(default=None, ge=0, le=100)


class ChapterCreate(BaseModel):
    title: str = Field(default="Chapter", max_length=200)
    text: str = Field(default="")
    sort_order: int = Field(default=0, ge=0)


class ChapterUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    text: Optional[str] = None
    sort_order: Optional[int] = Field(default=None, ge=0)


class SplitRequest(BaseModel):
    text: str = Field(..., min_length=1)
    delimiter: str = Field(default="heading", pattern="^(heading|separator)$")


# ── Project endpoints ───────────────────────────────────────────────

@router.get("")
async def list_projects() -> list[dict[str, Any]]:
    return await pm.list_projects()


@router.post("", status_code=201)
async def create_project(body: ProjectCreate) -> dict[str, Any]:
    return await pm.create_project(**body.model_dump())


@router.get("/{project_id}")
async def get_project(project_id: str) -> dict[str, Any]:
    p = await pm.get_project(project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    return p


@router.patch("/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate) -> dict[str, Any]:
    p = await pm.get_project(project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    result = await pm.update_project(project_id, **body.model_dump(exclude_none=True))
    return result  # type: ignore[return-value]


@router.delete("/{project_id}")
async def delete_project(project_id: str) -> dict[str, str]:
    if not await pm.delete_project(project_id):
        raise HTTPException(404, "Project not found")
    return {"status": "deleted", "id": project_id}


# ── Chapter endpoints ───────────────────────────────────────────────

@router.get("/{project_id}/chapters")
async def list_chapters(project_id: str) -> list[dict[str, Any]]:
    return await pm.list_chapters(project_id)


@router.post("/{project_id}/chapters", status_code=201)
async def create_chapter(project_id: str, body: ChapterCreate) -> dict[str, Any]:
    p = await pm.get_project(project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    return await pm.create_chapter(project_id, **body.model_dump())


@router.patch("/chapters/{chapter_id}")
async def update_chapter(chapter_id: str, body: ChapterUpdate) -> dict[str, Any]:
    result = await pm.update_chapter(chapter_id, **body.model_dump(exclude_none=True))
    if result is None:
        raise HTTPException(404, "Chapter not found")
    return result


@router.delete("/chapters/{chapter_id}")
async def delete_chapter(chapter_id: str) -> dict[str, str]:
    if not await pm.delete_chapter(chapter_id):
        raise HTTPException(404, "Chapter not found")
    return {"status": "deleted", "id": chapter_id}


@router.post("/{project_id}/split", status_code=201)
async def split_into_chapters(project_id: str, body: SplitRequest) -> list[dict[str, Any]]:
    """Split a long text into chapters by headings or `---` separators."""
    p = await pm.get_project(project_id)
    if p is None:
        raise HTTPException(404, "Project not found")
    return await pm.split_text_into_chapters(project_id, body.text, body.delimiter)


# ── Generation history ──────────────────────────────────────────────

@router.get("/chapters/{chapter_id}/generations")
async def list_generations(chapter_id: str) -> list[dict[str, Any]]:
    return await pm.list_generations(chapter_id)


@router.get("/generations/{generation_id}/takes")
async def list_takes(generation_id: str) -> list[dict[str, Any]]:
    return await pm.list_takes(generation_id)
