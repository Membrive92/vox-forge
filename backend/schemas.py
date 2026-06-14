"""Pydantic models: request, persistence, and response."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, computed_field

from .config import settings

# Max conditioning samples per voice profile (VOZ-10). XTTS accepts a
# list in ``speaker_wav`` and averages the conditioning latents; 3-5
# clean clips of 6-10s give a more stable voice than one long sample.
MAX_PROFILE_SAMPLES = 5


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
    # Pacing lever (P2): scales the inter-chunk pauses without touching the
    # audio — the artifact-free way to make narration feel measured.
    # Decoupled from ``speed`` (articulation): 1.0 = the P1 base pauses
    # (no-op), 2.5 = pauses 2.5x longer. The speech inside each chunk is
    # never stretched.
    pause_scale: float = Field(
        default=1.0, ge=1.0, le=2.5,
        description="Inter-chunk pause multiplier (1.0=base, up to 2.5)",
    )
    pitch: int = Field(default=0, ge=-10, le=10, description="Pitch in semitones")
    volume: int = Field(default=80, ge=0, le=100, description="Volume in %")
    profile_id: Optional[str] = Field(default=None, description="Profile ID (optional)")
    # Optional metadata — embedded into the exported file as ID3/Vorbis tags.
    title: Optional[str] = Field(default=None, max_length=200)
    artist: Optional[str] = Field(default=None, max_length=200)
    album: Optional[str] = Field(default=None, max_length=200)
    track_number: Optional[int] = Field(default=None, ge=1, le=9999)


class VoiceProfile(BaseModel):
    """Persisted voice profile.

    ``samples`` holds 0-5 stored sample filenames (under ``data/voices/``).
    Every file in the list is passed to XTTS as a conditioning reference
    (VOZ-10 — the model averages the conditioning latents). The
    serialized ``sample_filename`` is a **deprecated** read-only alias of
    ``samples[0]``, kept only for HTTP back-compat during the multi-sample
    transition; new code must read ``samples``.
    """

    id: str = Field(default_factory=_new_id)
    name: str = Field(..., min_length=1, max_length=100)
    voice_id: str
    language: str = Field(default="es")
    speed: int = Field(default=100, ge=50, le=200)
    pitch: int = Field(default=0, ge=-10, le=10)
    volume: int = Field(default=80, ge=0, le=100)
    samples: list[str] = Field(default_factory=list, max_length=MAX_PROFILE_SAMPLES)
    # Duration of the FIRST sample when known (display only). None when
    # there are no samples or the first one's duration wasn't measured.
    sample_duration: Optional[float] = None
    # When True, the configured Castilian reference voice is concatenated
    # in front of this profile's sample before XTTS sees it. Same trick as
    # the experimental "audio anchor" mode (E), but applied automatically
    # in the production synthesis path. Off by default — only profiles
    # explicitly created from the Castilian reference (or toggled on by
    # the user) get the pre-roll.
    castilian_anchor: bool = False
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sample_filename(self) -> Optional[str]:
        """Deprecated alias of ``samples[0]`` (HTTP back-compat, VOZ-10)."""
        return self.samples[0] if self.samples else None


class ProfileUpdate(BaseModel):
    """Partial profile update."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    voice_id: Optional[str] = None
    language: Optional[str] = None
    speed: Optional[int] = Field(default=None, ge=50, le=200)
    pitch: Optional[int] = Field(default=None, ge=-10, le=10)
    volume: Optional[int] = Field(default=None, ge=0, le=100)
    castilian_anchor: Optional[bool] = None


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


class EnginesUnloadResponse(BaseModel):
    """Result of ``POST /api/engines/unload`` (PROD-01).

    ``unloaded`` lists the engines that actually released a resident
    model (``"xtts"``, ``"openvoice"``); engines that were not loaded
    are omitted. ``cuda_cache_cleared`` is False when torch or CUDA is
    unavailable.
    """

    unloaded: list[str]
    cuda_cache_cleared: bool


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


class TranscribeAlignedRequest(BaseModel):
    """Align a known chapter text to a Studio audio file (S2).

    Exactly one text source is required: either ``source_text`` inline or
    ``chapter_id`` (the backend reads ``chapters.text``). The result is an
    SRT carrying the SOURCE words (correct proper/fantasy names) with the
    audio's word-level timings.
    """

    source_path: str = Field(..., min_length=1)
    source_text: Optional[str] = Field(
        default=None,
        description="Chapter text to align. Omit to read it from chapter_id.",
    )
    chapter_id: Optional[str] = Field(
        default=None,
        description="Read the chapter text from the DB instead of source_text.",
    )
    language: Optional[str] = Field(
        default=None,
        description="ISO code (es, en, ...). None -> auto-detect.",
    )


class AlignedSubtitlesResponse(BaseModel):
    """Aligned-subtitles result: SOURCE text on the audio timeline."""

    srt_path: str
    duration_s: float
    language: str
    engine: str
    # How well the source matched what Whisper heard, in [0, 1]. Low values
    # warn the FE that the audio may not speak this text.
    alignment_confidence: float = Field(..., ge=0.0, le=1.0)
    # True when faster-whisper supplied per-word timings; False means the
    # build degraded to segment-level anchors (still monotonic).
    word_level: bool
    entries: list[SrtEntry]


class DetectScenesRequest(BaseModel):
    """Group a transcript's SRT into ~N-second scenes (one image slot each)."""

    srt_path: str = Field(..., min_length=1)
    target_scene_seconds: float = Field(
        default=25.0, ge=5.0, le=300.0,
        description="Approximate length of each scene in seconds.",
    )


class DetectedScene(BaseModel):
    """One detected scene: a time range plus the first words spoken in it."""

    start_s: float = Field(..., ge=0)
    end_s: float = Field(..., ge=0)
    text_summary: str


class DetectScenesResponse(BaseModel):
    """Scenes detected from an SRT transcript."""

    scenes: list[DetectedScene]
    count: int


class VideoOptions(BaseModel):
    """Visual options passed to the Studio video renderer."""

    resolution: str = Field(default="1920x1080", description="1920x1080 or 1280x720")
    ken_burns: bool = True
    waveform_overlay: bool = True
    title_text: Optional[str] = Field(default=None, max_length=200)
    subtitles_mode: str = Field(default="burn", description="none | burn | soft")
    crossfade_s: float = Field(
        default=1.0, ge=0.0, le=5.0,
        description="Crossfade duration between images in a slideshow",
    )


class VideoImage(BaseModel):
    """One image in a slideshow, anchored to a start time in the audio."""

    path: str = Field(..., min_length=1)
    start_s: float = Field(..., ge=0.0)


class RenderVideoRequest(BaseModel):
    """Render a Studio source into an MP4.

    Pass ``cover_path`` alone for a static cover (Phase B.2 behaviour).
    Pass ``images`` (list) for a slideshow with one image per scene —
    each image's ``start_s`` anchors it to that moment in the audio,
    and successive images imply the previous one's end. ``cover_path``
    is optional when ``images`` is provided.
    """

    audio_path: str = Field(..., min_length=1)
    cover_path: Optional[str] = None
    subtitles_path: Optional[str] = None
    project_id: Optional[str] = None
    chapter_id: Optional[str] = None
    images: Optional[list[VideoImage]] = None
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


class GenerateImageRequest(BaseModel):
    """Generate a scene image from a text prompt."""

    prompt: str = Field(..., min_length=1, max_length=2000)
    aspect_ratio: str = Field(
        default="16:9",
        description="16:9 | 9:16 | 1:1 | 4:3",
    )
    seed: Optional[int] = Field(
        default=None, ge=0, le=2**31 - 1,
        description="Optional seed for deterministic output.",
    )


class GenerateImageResponse(BaseModel):
    filename: str
    path: str
    provider: str
    aspect_ratio: str
    seed: int
    size_kb: float


class ImageProviderStatusResponse(BaseModel):
    """Health of the configured image provider (PROD-02, plan F2).

    ``placeholder`` is always available; ``comfyui`` verifies the
    workflow export exists and probes ``GET /system_stats`` with a
    short timeout. ``error`` carries the actionable reason when
    ``available`` is False.
    """

    name: str
    available: bool
    server_url: Optional[str] = None
    error: Optional[str] = None


# ── Media library (T2I-1 / UX-03 phases M1-M2) ──────────────────────


class MediaGenerateRequest(BaseModel):
    """Generate one or more library images from a prompt.

    ``count`` images are produced sequentially (one shared GPU) and each
    becomes its own ``media_assets`` row.
    """

    prompt: str = Field(..., min_length=1, max_length=2000)
    aspect_ratio: str = Field(
        default="16:9",
        description="16:9 | 9:16 | 1:1 | 4:3",
    )
    seed: Optional[int] = Field(
        default=None, ge=0, le=2**31 - 1,
        description="Optional base seed; later images in a batch step off it.",
    )
    count: int = Field(
        default=1, ge=1, le=4,
        description="How many images to generate (1-4, sequential).",
    )


class MediaAsset(BaseModel):
    """A persisted library asset (image or clip).

    ``filename`` / ``thumb_filename`` are relative to
    ``data/studio/media/`` — never absolute. Serve via
    ``GET /api/studio/media/file/{id}``; the client never reads the path.
    """

    id: str
    kind: str
    filename: str
    thumb_filename: Optional[str] = None
    origin: str
    source_path: Optional[str] = None
    meta_json: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration_s: Optional[float] = None
    prompt: Optional[str] = None
    seed: Optional[int] = None
    aspect_ratio: Optional[str] = None
    created_at: str


class MediaAssetsResponse(BaseModel):
    assets: list[MediaAsset]
    count: int
