"""Pydantic models: request, persistence, and response."""
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
    """Text-to-speech synthesis request."""

    text: str = Field(..., min_length=1, max_length=settings.max_text_length)
    voice_id: str = Field(..., description="Voice ID (e.g. es-ES-AlvaroNeural)")
    output_format: str = Field(default="mp3", description="mp3 | wav | ogg | flac")
    speed: int = Field(default=100, ge=50, le=200, description="Speed in % (50-200)")
    pitch: int = Field(default=0, ge=-10, le=10, description="Pitch in semitones")
    volume: int = Field(default=80, ge=0, le=100, description="Volume in %")
    profile_id: Optional[str] = Field(default=None, description="Profile ID (optional)")
    # Optional metadata — embedded into the exported file as ID3/Vorbis tags.
    title: Optional[str] = Field(default=None, max_length=200)
    artist: Optional[str] = Field(default=None, max_length=200)
    album: Optional[str] = Field(default=None, max_length=200)
    track_number: Optional[int] = Field(default=None, ge=1, le=9999)


class VoiceProfile(BaseModel):
    """Persisted voice profile."""

    id: str = Field(default_factory=_new_id)
    name: str = Field(..., min_length=1, max_length=100)
    voice_id: str
    language: str = Field(default="es")
    speed: int = Field(default=100, ge=50, le=200)
    pitch: int = Field(default=0, ge=-10, le=10)
    volume: int = Field(default=80, ge=0, le=100)
    sample_filename: Optional[str] = None
    sample_duration: Optional[float] = None
    extra_samples: list[str] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class ProfileUpdate(BaseModel):
    """Partial profile update."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    voice_id: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[int] = Field(default=None, ge=50, le=200)
    pitch: Optional[int] = Field(default=None, ge=-10, le=10)
    volume: Optional[int] = Field(default=None, ge=0, le=100)


class SampleUploadResponse(BaseModel):
    """Voice sample upload response."""

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


class LogEntry(BaseModel):
    """Single parsed log line."""

    timestamp: str
    level: str
    request_id: str
    logger: str
    message: str
    raw: str


class LogsResponse(BaseModel):
    """Recent log lines."""

    entries: list[LogEntry]
    source: str
    returned: int


class PronunciationEntry(BaseModel):
    word: str = Field(..., min_length=1, max_length=100)
    replacement: str = Field(..., min_length=1, max_length=200)


class PronunciationListResponse(BaseModel):
    entries: dict[str, str]
    count: int


class IncompleteJobSummary(BaseModel):
    job_id: str
    engine: str
    created_at: float
    updated_at: float
    chunks_available: int
    text_preview: str
    title: Optional[str] = None
    output_format: str
    profile_id: Optional[str] = None


class IncompleteJobsResponse(BaseModel):
    jobs: list[IncompleteJobSummary]
    count: int


class JobProgressResponse(BaseModel):
    """Real-time progress snapshot for a synthesis job."""

    job_id: str
    status: str
    chunks_done: int
    chunks_total: int
    current_step: str
    error: str | None = None


# ── Studio module ───────────────────────────────────────────────────


class StudioSource(BaseModel):
    """An audio file the Studio editor can load."""

    id: str
    kind: str  # "chapter" | "mix"
    project_id: Optional[str] = None
    chapter_id: Optional[str] = None
    project_name: str
    chapter_title: str
    source_path: str
    duration_s: float
    created_at: str


class StudioSourcesResponse(BaseModel):
    sources: list[StudioSource]
    count: int


class StudioOperation(BaseModel):
    """A single edit step in a Studio batch."""

    type: str = Field(..., description="trim | delete_region | fade_in | fade_out | normalize")
    params: dict[str, float] = Field(default_factory=dict)


class StudioEditRequest(BaseModel):
    """Apply a sequence of edit operations to a source audio file.

    ``project_id`` / ``chapter_id`` are optional but strongly encouraged
    when the source came from a chapter's generation — they let the
    persisted ``studio_renders`` row link back so the Workbench can
    surface "N edited versions" indicators.
    """

    source_path: str = Field(..., min_length=1)
    operations: list[StudioOperation] = Field(..., min_length=1)
    output_format: str = Field(default="mp3")
    project_id: Optional[str] = None
    chapter_id: Optional[str] = None


class SrtEntry(BaseModel):
    """A single line in an SRT subtitle file."""

    index: int = Field(..., ge=1)
    start_s: float = Field(..., ge=0)
    end_s: float = Field(..., ge=0)
    text: str


class TranscribeRequest(BaseModel):
    """Transcribe a Studio-visible audio file."""

    source_path: str = Field(..., min_length=1)
    model: str = Field(default="small", description="tiny|base|small|medium|large-v3")
    language: Optional[str] = Field(
        default=None,
        description="ISO code (es, en, ...). None -> auto-detect.",
    )


class TranscribeResponse(BaseModel):
    """Transcription result for a Studio source."""

    srt_path: str
    duration_s: float
    word_count: int
    language: str
    engine: str
    entries: list[SrtEntry]


class VideoOptions(BaseModel):
    """Visual options passed to the Studio video renderer."""

    resolution: str = Field(default="1920x1080", description="1920x1080 or 1280x720")
    ken_burns: bool = True
    waveform_overlay: bool = True
    title_text: Optional[str] = Field(default=None, max_length=200)
    subtitles_mode: str = Field(default="burn", description="none | burn | soft")


class RenderVideoRequest(BaseModel):
    """Render a Studio source + cover into an MP4."""

    audio_path: str = Field(..., min_length=1)
    cover_path: str = Field(..., min_length=1)
    subtitles_path: Optional[str] = None
    project_id: Optional[str] = None
    chapter_id: Optional[str] = None
    options: VideoOptions = Field(default_factory=VideoOptions)


class StudioRender(BaseModel):
    """Persisted render row (audio edit or video)."""

    id: str
    kind: str
    source_path: str
    output_path: str
    operations: Optional[str] = None
    project_id: Optional[str] = None
    chapter_id: Optional[str] = None
    duration_s: float
    size_bytes: int
    created_at: str


class StudioRendersResponse(BaseModel):
    renders: list[StudioRender]
    count: int


class CoverUploadResponse(BaseModel):
    filename: str
    path: str
    size_kb: float
    content_type: str
