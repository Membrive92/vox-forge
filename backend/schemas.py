"""Modelos Pydantic: entrada, persistencia y respuesta."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from .config import settings


def _new_id() -> str:
    return str(uuid.uuid4())[:8]


def _now_iso() -> str:
    return datetime.now().isoformat()


class SynthesisRequest(BaseModel):
    """Petición de síntesis de texto a voz."""

    text: str = Field(..., min_length=1, max_length=settings.max_text_length)
    voice_id: str = Field(..., description="ID de la voz (ej: es-ES-AlvaroNeural)")
    output_format: str = Field(default="mp3", description="mp3 | wav | ogg | flac")
    speed: int = Field(default=100, ge=50, le=200, description="Velocidad en % (50-200)")
    pitch: int = Field(default=0, ge=-10, le=10, description="Tono en semitonos")
    volume: int = Field(default=80, ge=0, le=100, description="Volumen en %")
    profile_id: Optional[str] = Field(default=None, description="ID de perfil (opcional)")


class VoiceProfile(BaseModel):
    """Perfil de voz persistido."""

    id: str = Field(default_factory=_new_id)
    name: str = Field(..., min_length=1, max_length=100)
    voice_id: str
    language: str = Field(default="es")
    speed: int = Field(default=100, ge=50, le=200)
    pitch: int = Field(default=0, ge=-10, le=10)
    volume: int = Field(default=80, ge=0, le=100)
    sample_filename: Optional[str] = None
    sample_duration: Optional[float] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class ProfileUpdate(BaseModel):
    """Actualización parcial de un perfil."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    voice_id: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[int] = Field(default=None, ge=50, le=200)
    pitch: Optional[int] = Field(default=None, ge=-10, le=10)
    volume: Optional[int] = Field(default=None, ge=0, le=100)


class SampleUploadResponse(BaseModel):
    """Respuesta de subida de muestra de voz."""

    filename: str
    duration_seconds: Optional[float]
    channels: int
    sample_rate: int
    bit_depth: int
    size_kb: float
    profile_id: Optional[str]


class HealthResponse(BaseModel):
    status: str
    version: str
    profiles_count: int
    voices: dict[str, int]
    formats: list[str]


class DeletedResponse(BaseModel):
    status: str
    id: str
