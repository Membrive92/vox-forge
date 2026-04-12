"""Pronunciation dictionary CRUD endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import DeletedResponse, PronunciationEntry, PronunciationListResponse
from ..services.pronunciation import manager

router = APIRouter(prefix="/pronunciations", tags=["pronunciations"])


@router.get("", response_model=PronunciationListResponse, summary="List all entries")
async def list_pronunciations() -> PronunciationListResponse:
    entries = manager.list_entries()
    return PronunciationListResponse(entries=entries, count=len(entries))


@router.post("", response_model=PronunciationEntry, summary="Create or update an entry")
async def upsert_pronunciation(entry: PronunciationEntry) -> PronunciationEntry:
    try:
        await manager.upsert(entry.word, entry.replacement)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return entry


@router.delete("/{word}", response_model=DeletedResponse, summary="Delete an entry")
async def delete_pronunciation(word: str) -> DeletedResponse:
    removed = await manager.delete(word)
    if not removed:
        raise HTTPException(status_code=404, detail=f"Pronunciation not found: {word}")
    return DeletedResponse(status="deleted", id=word)
