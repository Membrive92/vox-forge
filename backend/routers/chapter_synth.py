"""Chapter-level synthesis with per-chunk tracking.

This is the core endpoint for the Workbench: synthesize a chapter's text,
store each chunk as a Take in the database, and allow regenerating
individual chunks without re-running the whole chapter.

Also exposes ``POST /{chapter_id}/upload-audio`` for human-recorded
chapters: the user records externally (or via the in-app recorder) and
uploads a finished audio file as a generation of that chapter, so it
flows through Studio edit / export like any TTS output.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydub import AudioSegment

from ..cancellation import create_cancellation_token
from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..exceptions import UnsupportedFormatError
from ..paths import OUTPUT_DIR, TEMP_DIR
from ..services import project_manager as pm
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.progress import registry as progress_registry
from ..services.tts_engine import TTSEngine, split_into_chunks
from ..upload_utils import read_upload_safely, validate_audio_upload
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chapters", tags=["chapter-synth"])


@router.post("/{chapter_id}/synthesize", summary="Synthesize a chapter with per-chunk tracking")
async def synthesize_chapter(
    chapter_id: str,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    project = await pm.get_project(chapter["project_id"])
    if project is None:
        raise HTTPException(404, "Project not found")

    text = chapter["text"]
    if not text or not text.strip():
        raise HTTPException(400, "Chapter has no text")

    fmt = project["output_format"]
    if fmt not in AUDIO_FORMATS:
        raise UnsupportedFormatError(f"Unsupported format: {fmt}")

    cancel_token = create_cancellation_token(http_request)
    chunks = split_into_chunks(text)

    # Chapter-level overrides take priority over project defaults. Lets
    # a book use different narrators per chapter (POV switch,
    # epistolary sections, etc.) without spawning separate projects.
    voice_id = chapter.get("voice_id") or project["voice_id"]
    profile_id = chapter.get("profile_id") or project["profile_id"]

    # Create a generation record
    gen = await pm.create_generation(
        chapter_id=chapter_id,
        voice_id=voice_id,
        profile_id=profile_id,
        output_format=fmt,
        speed=project["speed"],
        pitch=project["pitch"],
        volume=project["volume"],
        engine="edge-tts",
        chunks_total=len(chunks),
    )
    gen_id = gen["id"]

    job_id = gen_id
    progress_registry.start(job_id, chunks_total=len(chunks), step="synthesizing chapter")

    from ..schemas import SynthesisRequest
    request = SynthesisRequest(
        text=text,
        voice_id=voice_id,
        output_format=fmt,
        speed=project["speed"],
        pitch=project["pitch"],
        volume=project["volume"],
        profile_id=profile_id,
    )

    try:
        result = await engine.synthesize(request, cancel_token=cancel_token, job_id=job_id)
    except Exception as exc:
        progress_registry.finish(job_id, status="error", error=str(exc))
        await pm.update_generation(gen_id, status="error", error=str(exc))
        raise

    # Record individual chunk takes from the synthesis
    for i, chunk_text in enumerate(chunks):
        await pm.create_take(
            generation_id=gen_id,
            chunk_index=i,
            chunk_text=chunk_text,
            status="done",
        )

    try:
        audio = AudioSegment.from_file(str(result.path))
        duration = round(len(audio) / 1000.0, 2)
    except Exception:
        duration = 0.0

    await pm.update_generation(
        gen_id,
        status="done",
        duration=duration,
        file_path=str(result.path),
        chunks_done=len(chunks),
        engine=result.engine,
    )
    # Newest successful synth becomes the active take by default. User
    # can still pick an older version from the multi-take selector.
    await pm.update_chapter(chapter_id, active_generation_id=gen_id)

    progress_registry.finish(job_id, status="done")
    background_tasks.add_task(cleanup_old_files)

    return FileResponse(
        path=str(result.path),
        media_type=f"audio/{fmt}",
        filename=f"chapter_{chapter['sort_order']:02d}.{fmt}",
        headers={
            "X-Audio-Duration": str(duration),
            "X-Audio-Size": str(result.path.stat().st_size),
            "X-Audio-Chunks": str(len(chunks)),
            "X-Audio-Engine": result.engine,
            "X-Generation-ID": gen_id,
        },
    )


@router.post(
    "/{chapter_id}/regenerate-chunk/{chunk_index}",
    summary="Regenerate a single chunk of a chapter",
)
async def regenerate_chunk(
    chapter_id: str,
    chunk_index: int,
    http_request: Request,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Regenerate chunk N without re-synthesizing the whole chapter.

    Finds the latest generation for this chapter, re-splits the text,
    synthesizes only the requested chunk, replaces the take, and
    re-exports the full audio by splicing in the new chunk.
    """
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    project = await pm.get_project(chapter["project_id"])
    if project is None:
        raise HTTPException(404, "Project not found")

    # Find the latest done generation for this chapter
    gens = await pm.list_generations(chapter_id)
    gen = next((g for g in gens if g["status"] == "done"), None)
    if gen is None:
        raise HTTPException(400, "No completed generation to regenerate from")

    chunks = split_into_chunks(chapter["text"])
    if chunk_index < 0 or chunk_index >= len(chunks):
        raise HTTPException(400, f"chunk_index {chunk_index} out of range (0-{len(chunks) - 1})")

    chunk_text = chunks[chunk_index]
    fmt = gen["output_format"]

    # Synthesize just this chunk
    import edge_tts

    from ..services.tts_engine import _pitch_str, _rate_str, _volume_str

    file_id = str(uuid.uuid4())[:8]
    chunk_path = TEMP_DIR / f"regen_{file_id}.mp3"

    communicate = edge_tts.Communicate(
        text=chunk_text,
        voice=gen["voice_id"],
        rate=_rate_str(gen["speed"]),
        pitch=_pitch_str(gen["pitch"]),
        volume=_volume_str(gen["volume"]),
    )
    await communicate.save(str(chunk_path))

    # Update or create the take
    takes = await pm.list_takes(gen["id"])
    existing = next((t for t in takes if t["chunk_index"] == chunk_index), None)
    if existing:
        await pm.update_take(existing["id"], file_path=str(chunk_path), status="done")
    else:
        await pm.create_take(
            generation_id=gen["id"],
            chunk_index=chunk_index,
            chunk_text=chunk_text,
            file_path=str(chunk_path),
            status="done",
        )

    # Return just the regenerated chunk audio
    return FileResponse(
        path=str(chunk_path),
        media_type="audio/mpeg",
        filename=f"chunk_{chunk_index:04d}.mp3",
        headers={
            "X-Chunk-Index": str(chunk_index),
            "X-Generation-ID": gen["id"],
        },
    )


@router.get("/{chapter_id}/chunks", summary="Get chunk map for latest generation")
async def get_chunk_map(chapter_id: str) -> dict:
    """Return the chunk list for the latest generation of a chapter."""
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    gens = await pm.list_generations(chapter_id)
    gen = next((g for g in gens if g["status"] == "done"), None)
    if gen is None:
        return {"generation_id": None, "chunks": [], "total": 0}

    chunks = split_into_chunks(chapter["text"])
    takes = await pm.list_takes(gen["id"])
    take_map = {t["chunk_index"]: t for t in takes}

    result = []
    for i, text in enumerate(chunks):
        take = take_map.get(i)
        result.append({
            "index": i,
            "text": text[:200],
            "status": take["status"] if take else "pending",
            "take_id": take["id"] if take else None,
            "duration": take["duration"] if take else 0,
        })

    return {
        "generation_id": gen["id"],
        "chunks": result,
        "total": len(chunks),
    }


_ALLOWED_UPLOAD_EXTS = (".wav", ".mp3", ".ogg", ".flac", ".webm", ".m4a")


@router.post(
    "/{chapter_id}/upload-audio",
    summary="Upload a pre-recorded audio file as a generation of this chapter",
)
async def upload_chapter_audio(
    chapter_id: str,
    audio: UploadFile = File(...),
) -> dict:
    """Save the uploaded audio under ``data/output/`` and register a
    ``generations`` row with ``engine="upload"`` and ``status="done"``.

    Makes the chapter behave identically to a TTS-synthesized one
    downstream: Studio can load it, Workbench can render a video from
    it, export can bundle it. Browser recordings (webm/opus) and other
    containers are accepted — ``AudioSegment.from_file`` handles them
    via ffmpeg. The file is stored as-is, without transcoding, to
    preserve quality.
    """
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    validate_audio_upload(audio)

    ext = Path(audio.filename or "").suffix.lower()
    if ext not in _ALLOWED_UPLOAD_EXTS:
        # Browser recorders may leave the filename without extension;
        # derive from content_type when possible.
        ctype = (audio.content_type or "").lower()
        if "webm" in ctype:
            ext = ".webm"
        elif "mp4" in ctype or "m4a" in ctype:
            ext = ".m4a"
        elif "ogg" in ctype:
            ext = ".ogg"
        elif "mpeg" in ctype or "mp3" in ctype:
            ext = ".mp3"
        else:
            ext = ".wav"

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"upload_{chapter_id}_{str(uuid.uuid4())[:8]}{ext}"
    filepath = OUTPUT_DIR / filename

    content = await read_upload_safely(audio)
    filepath.write_bytes(content)

    # Best-effort duration; if ffmpeg can't decode, record 0.
    try:
        seg = AudioSegment.from_file(str(filepath))
        duration = round(len(seg) / 1000.0, 2)
    except Exception:  # noqa: BLE001
        duration = 0.0

    project = await pm.get_project(chapter["project_id"])
    voice_id = chapter.get("voice_id") or (project["voice_id"] if project else "")
    profile_id = chapter.get("profile_id") or (project["profile_id"] if project else None)

    gen = await pm.create_generation(
        chapter_id=chapter_id,
        voice_id=voice_id or "upload",
        profile_id=profile_id,
        output_format=ext.lstrip("."),
        speed=(project["speed"] if project else 100),
        pitch=(project["pitch"] if project else 0),
        volume=(project["volume"] if project else 80),
        engine="upload",
        chunks_total=0,
    )
    gen_id = gen["id"]
    await pm.update_generation(
        gen_id,
        status="done",
        duration=duration,
        file_path=str(filepath.resolve()),
        chunks_done=0,
    )
    # New upload becomes the active version by default — matches the
    # user's mental model of "I just made this, it's the one I want".
    await pm.update_chapter(chapter_id, active_generation_id=gen_id)

    logger.info(
        "Chapter audio uploaded: chapter=%s file=%s (%.2fs)",
        chapter_id, filename, duration,
    )
    return {
        "id": gen_id,
        "chapter_id": chapter_id,
        "engine": "upload",
        "status": "done",
        "duration": duration,
        "file_path": str(filepath.resolve()),
        "output_format": ext.lstrip("."),
    }
