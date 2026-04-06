"""Service health check endpoint."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from ..catalogs import AUDIO_FORMATS, SUPPORTED_VOICES
from ..dependencies import get_profile_manager
from ..schemas import HealthResponse
from ..services.profile_manager import ProfileManager

router = APIRouter(tags=["health"])

_VERSION = "1.0.0"


@router.get("/health", response_model=HealthResponse, summary="Service status")
async def health_check(
    profiles: ProfileManager = Depends(get_profile_manager),
) -> HealthResponse:
    return HealthResponse(
        status="healthy",
        version=_VERSION,
        profiles_count=profiles.count,
        voices={lang: len(voices) for lang, voices in SUPPORTED_VOICES.items()},
        formats=list(AUDIO_FORMATS.keys()),
    )
