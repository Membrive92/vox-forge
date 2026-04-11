"""Voice profile CRUD endpoints."""
from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydub import AudioSegment

from ..dependencies import get_profile_manager
from ..exceptions import ProfileNotFound
from ..paths import VOICES_DIR
from ..schemas import DeletedResponse, ProfileUpdate, VoiceProfile
from ..services.profile_manager import ProfileManager
from ..upload_utils import read_upload_safely, validate_audio_upload

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("", response_model=list[VoiceProfile], summary="List profiles")
async def list_profiles(
    profiles: ProfileManager = Depends(get_profile_manager),
) -> list[VoiceProfile]:
    return profiles.list_all()


@router.get("/{profile_id}", response_model=VoiceProfile, summary="Get profile")
async def get_profile(
    profile_id: str,
    profiles: ProfileManager = Depends(get_profile_manager),
) -> VoiceProfile:
    profile = profiles.get(profile_id)
    if profile is None:
        raise ProfileNotFound(f"Profile not found: {profile_id}")
    return profile


@router.post("", response_model=VoiceProfile, summary="Create profile")
async def create_profile(
    name: str = Form(...),
    voice_id: str = Form(...),
    language: str = Form(default="es"),
    speed: int = Form(default=100),
    pitch: int = Form(default=0),
    volume: int = Form(default=80),
    sample: Optional[UploadFile] = File(default=None),
    profiles: ProfileManager = Depends(get_profile_manager),
) -> VoiceProfile:
    """Create a profile. Audio sample is optional."""
    sample_filename: Optional[str] = None
    sample_duration: Optional[float] = None

    if sample is not None:
        validate_audio_upload(sample)

        ext = Path(sample.filename or "").suffix or ".wav"
        sample_filename = f"{str(uuid.uuid4())[:8]}{ext}"
        sample_path = VOICES_DIR / sample_filename
        content = await read_upload_safely(sample)
        sample_path.write_bytes(content)

        try:
            import shutil

            if not shutil.which("ffprobe"):
                raise FileNotFoundError("ffprobe not found")
            audio = AudioSegment.from_file(str(sample_path))
            sample_duration = round(len(audio) / 1000.0, 1)
        except Exception:
            sample_duration = None

    profile = VoiceProfile(
        name=name,
        voice_id=voice_id,
        language=language,
        speed=speed,
        pitch=pitch,
        volume=volume,
        sample_filename=sample_filename,
        sample_duration=sample_duration,
    )
    return await profiles.create(profile)


@router.patch("/{profile_id}", response_model=VoiceProfile, summary="Update profile")
async def update_profile(
    profile_id: str,
    updates: ProfileUpdate,
    profiles: ProfileManager = Depends(get_profile_manager),
) -> VoiceProfile:
    return await profiles.update(profile_id, updates)


@router.delete("/{profile_id}", response_model=DeletedResponse, summary="Delete profile")
async def delete_profile(
    profile_id: str,
    profiles: ProfileManager = Depends(get_profile_manager),
) -> DeletedResponse:
    await profiles.delete(profile_id)
    return DeletedResponse(status="deleted", id=profile_id)
