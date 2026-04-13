"""Text-to-speech synthesis endpoint."""
from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..cancellation import create_cancellation_token
from ..dependencies import get_profile_manager, get_tts_engine
from ..exceptions import ProfileNotFound, UnsupportedFormatError
from ..catalogs import AUDIO_FORMATS
from ..schemas import (
    IncompleteJobsResponse,
    IncompleteJobSummary,
    JobProgressResponse,
    SynthesisRequest,
)
from ..services import job_store
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.profile_manager import ProfileManager
from ..services.progress import registry as progress_registry
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

router = APIRouter(tags=["synthesis"])


@router.post("/synthesize", summary="Synthesize text to audio")
async def synthesize_text(
    request: SynthesisRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
    profiles: ProfileManager = Depends(get_profile_manager),
) -> FileResponse:
    """Convert text to audio and return the generated file.

    Routes to XTTS v2 (voice cloning) if the profile has a voice sample,
    otherwise uses Edge-TTS (Microsoft neural voices).
    Automatically cancels if the client disconnects mid-generation.
    """
    # Validate format AND profile_id early — before creating a job record
    # that would become a ghost if we reject the request. The engine
    # checks both again, but we can't let it get that far when the input
    # is clearly bad.
    if request.output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {request.output_format}. "
            f"Valid: {sorted(AUDIO_FORMATS)}"
        )
    if request.profile_id and profiles.get(request.profile_id) is None:
        raise ProfileNotFound(f"Profile not found: {request.profile_id}")

    cancel_token = create_cancellation_token(http_request)
    job_id = http_request.headers.get("x-synthesis-job-id") or job_store.new_job_id()
    progress_registry.start(job_id, chunks_total=0, step="starting")

    record = job_store.JobRecord(
        job_id=job_id,
        request=request.model_dump(),
        engine="edge-tts",
    )
    job_store.save_record(record)

    try:
        result = await engine.synthesize(request, cancel_token=cancel_token, job_id=job_id)
    except Exception as exc:
        progress_registry.finish(job_id, status="error", error=str(exc))
        # Leave the record + chunks_dir on disk so /incomplete can list it
        raise
    progress_registry.finish(job_id, status="done")
    # Success: tear down the job record and its chunk dir.
    job_store.cleanup_job(job_id)

    try:
        audio = AudioSegment.from_file(str(result.path))
        duration = round(len(audio) / 1000.0, 2)
    except Exception:
        size = result.path.stat().st_size
        duration = round(size / 16000, 1) if size > 0 else 0.0

    embed_metadata(
        result.path,
        AudioMetadata(
            title=request.title,
            artist=request.artist,
            album=request.album,
            track_number=request.track_number,
        ),
    )

    background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(result.path),
        media_type=f"audio/{request.output_format}",
        filename=f"voxforge_output.{request.output_format}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(result.path.stat().st_size),
            "X-Audio-Chunks": str(result.chunks),
            "X-Audio-Engine": result.engine,
            "X-Text-Length": str(len(request.text)),
        },
    )


@router.get("/synthesize/progress/{job_id}", response_model=JobProgressResponse)
async def get_progress(job_id: str) -> JobProgressResponse:
    """Return the current progress snapshot for a running synthesis job."""
    job = progress_registry.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobProgressResponse(
        job_id=job.job_id,
        status=job.status,
        chunks_done=job.chunks_done,
        chunks_total=job.chunks_total,
        current_step=job.current_step,
        error=job.error,
    )


@router.get(
    "/synthesize/incomplete",
    response_model=IncompleteJobsResponse,
    summary="List crashed/interrupted synthesis jobs",
)
async def list_incomplete() -> IncompleteJobsResponse:
    records = job_store.list_incomplete()
    jobs: list[IncompleteJobSummary] = []
    for rec in records:
        # Count how many chunk files are already on disk for this job.
        available = 0
        if rec.chunks_dir.exists():
            available = sum(1 for _ in rec.chunks_dir.glob("chunk_*.*"))
        text = str(rec.request.get("text", ""))
        jobs.append(
            IncompleteJobSummary(
                job_id=rec.job_id,
                engine=rec.engine,
                created_at=rec.created_at,
                updated_at=rec.updated_at,
                chunks_available=available,
                text_preview=text[:120] + ("…" if len(text) > 120 else ""),
                title=rec.request.get("title"),
                output_format=rec.request.get("output_format", "mp3"),
                profile_id=rec.request.get("profile_id"),
            )
        )
    return IncompleteJobsResponse(jobs=jobs, count=len(jobs))


@router.post("/synthesize/resume/{job_id}", summary="Resume a crashed synthesis job")
async def resume_job(
    job_id: str,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    record = job_store.load_record(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Job not found")

    # Rehydrate the original request from the stored snapshot.
    request = SynthesisRequest.model_validate(record.request)
    cancel_token = create_cancellation_token(http_request)
    progress_registry.start(job_id, chunks_total=0, step="resuming")

    try:
        result = await engine.synthesize(request, cancel_token=cancel_token, job_id=job_id)
    except Exception as exc:
        progress_registry.finish(job_id, status="error", error=str(exc))
        raise

    try:
        audio = AudioSegment.from_file(str(result.path))
        duration = round(len(audio) / 1000.0, 2)
    except Exception:
        duration = 0.0

    embed_metadata(
        result.path,
        AudioMetadata(
            title=request.title,
            artist=request.artist,
            album=request.album,
            track_number=request.track_number,
        ),
    )

    progress_registry.finish(job_id, status="done")
    job_store.cleanup_job(job_id)
    background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(result.path),
        media_type=f"audio/{request.output_format}",
        filename=f"voxforge_output.{request.output_format}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(result.path.stat().st_size),
            "X-Audio-Chunks": str(result.chunks),
            "X-Audio-Engine": result.engine,
            "X-Text-Length": str(len(request.text)),
            "X-Resumed": "true",
        },
    )


@router.delete("/synthesize/incomplete/{job_id}", summary="Discard a crashed job")
async def discard_job(job_id: str) -> dict[str, str]:
    record = job_store.load_record(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Job not found")
    job_store.cleanup_job(job_id)
    return {"status": "discarded", "job_id": job_id}
