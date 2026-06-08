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
from pydantic import BaseModel
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
from ..upload_utils import read_upload_safely, validate_audio_bytes, validate_audio_upload
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chapters", tags=["chapter-synth"])


class ChunkInfo(BaseModel):
    index: int
    text: str
    status: str
    take_id: str | None = None
    duration: float


class ChunkMapResponse(BaseModel):
    generation_id: str | None = None
    chunks: list[ChunkInfo]
    total: int


class UploadedChapterGenerationResponse(BaseModel):
    id: str
    chapter_id: str
    engine: str
    status: str
    duration: float
    file_path: str
    output_format: str


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
    finally:
        cancel_token.finish()

    # Record individual chunk takes from the synthesis (one transaction).
    await pm.create_takes(
        gen_id,
        [{"chunk_index": i, "chunk_text": chunk_text, "status": "done"}
         for i, chunk_text in enumerate(chunks)],
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

    # Route through the standard TTSEngine.synthesize() so we get the
    # same routing the original chapter synthesis used:
    #   - profile with sample      -> XTTS v2 clone (with castilian_anchor)
    #   - profile without sample   -> Edge-TTS with profile's voice
    #   - no profile               -> Edge-TTS with raw voice_id
    #
    # The previous implementation always called edge_tts.Communicate
    # directly, which broke regen for any chapter generated with a
    # cloned voice (the user's narrator).
    from ..schemas import SynthesisRequest
    request = SynthesisRequest(
        text=chunk_text,
        voice_id=gen["voice_id"],
        output_format="mp3",
        speed=gen["speed"],
        pitch=gen["pitch"],
        volume=gen["volume"],
        profile_id=gen.get("profile_id"),
    )

    result = await engine.synthesize(request)
    chunk_audio = result.path
    gen_id = gen["id"]

    # Update or create the take with the regenerated chunk audio.
    takes = await pm.list_takes(gen_id)
    existing = next((t for t in takes if t["chunk_index"] == chunk_index), None)
    if existing:
        await pm.update_take(existing["id"], file_path=str(chunk_audio), status="done")
    else:
        await pm.create_take(
            generation_id=gen_id,
            chunk_index=chunk_index,
            chunk_text=chunk_text,
            file_path=str(chunk_audio),
            status="done",
        )

    # Re-splice the whole-chapter audio so the player/export/Studio reflect
    # the regenerated chunk — otherwise this endpoint reports success while
    # ``generation.file_path`` still points at the old audio. This is only
    # possible when every chunk of the original synthesis is on disk: the
    # Edge-TTS path keeps them under the job dir (data/jobs/{gen_id}/), so
    # we overwrite this chunk there and concatenate all chunks in order
    # with the same 400ms pauses the engine uses. When the chunks aren't
    # available (e.g. an XTTS clone, which doesn't persist per-chunk files
    # yet), we leave the take updated and report that the chapter audio was
    # NOT re-spliced so the client can warn / offer a full re-synthesis.
    respliced = await _resplice_chapter(gen, chunks, chunk_index, chunk_audio)

    return FileResponse(
        path=str(chunk_audio),
        media_type="audio/mpeg",
        filename=f"chunk_{chunk_index:04d}.mp3",
        headers={
            "X-Chunk-Index": str(chunk_index),
            "X-Generation-ID": gen_id,
            "X-Audio-Engine": result.engine,
            "X-Chapter-Respliced": "true" if respliced else "false",
        },
    )


async def _resplice_chapter(
    gen: dict, chunks: list[str], regen_index: int, new_chunk_audio: Path
) -> bool:
    """Rebuild ``generation.file_path`` from per-chunk audio in the job dir.

    Returns True if the full-chapter audio was rebuilt and persisted, False
    if the per-chunk files weren't all available (so only the take changed).
    """
    from ..services import job_store

    gen_id = gen["id"]
    target_path = gen.get("file_path")
    if not target_path:
        return False
    try:
        # Overwrite this chunk in the job dir with the freshly regenerated audio.
        job_chunk = job_store.chunk_path(gen_id, regen_index, "mp3")
        job_chunk.parent.mkdir(parents=True, exist_ok=True)
        AudioSegment.from_file(str(new_chunk_audio)).export(str(job_chunk), format="mp3")

        chunk_files = [job_store.chunk_path(gen_id, i, "mp3") for i in range(len(chunks))]
        if not chunk_files or not all(cf.exists() for cf in chunk_files):
            return False  # per-chunk audio not persisted (e.g. XTTS clone)

        pause = AudioSegment.silent(duration=400)
        combined: AudioSegment | None = None
        for cf in chunk_files:
            seg = AudioSegment.from_file(str(cf))
            combined = seg if combined is None else combined + pause + seg
        if combined is None:
            return False

        out_path = Path(target_path)
        out_fmt = out_path.suffix.lstrip(".") or "mp3"
        combined.export(str(out_path), format=out_fmt)
        duration = round(len(combined) / 1000.0, 2)
        await pm.update_generation(gen_id, file_path=str(out_path), duration=duration)
        return True
    except Exception as exc:  # noqa: BLE001 — never fail the regen over a re-splice
        logger.warning("regenerate-chunk: could not re-splice chapter %s: %s", gen_id, exc)
        return False


@router.get("/{chapter_id}/chunks", summary="Get chunk map for latest generation", response_model=ChunkMapResponse)
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
    response_model=UploadedChapterGenerationResponse,
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
    validate_audio_bytes(content)
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
