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

import asyncio
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydub import AudioSegment

from ..audio_meta import duration_seconds
from ..cancellation import create_cancellation_token
from ..catalogs import AUDIO_FORMATS
from ..config import settings
from ..dependencies import (
    get_convert_engine,
    get_profile_manager,
    get_transcriber,
    get_tts_engine,
)
from ..exceptions import UnsupportedFormatError
from ..paths import OUTPUT_DIR, TEMP_DIR, VOICES_DIR
from ..schemas import SynthesisRequest
from ..services import export_source as export_source_service
from ..services import job_store
from ..services import mastering
from ..services import project_manager as pm
from ..services import qc as qc_service
from ..services.catalog_reference import get_or_create_catalog_reference
from ..services.convert_engine import ConvertEngine
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.profile_manager import ProfileManager
from ..services.progress import registry as progress_registry
from ..services.transcriber import Transcriber
from ..services.tts_engine import TTSEngine, chunk_texts_for_engine
from ..upload_utils import (
    ALLOWED_AUDIO_EXTS,
    read_upload_safely,
    validate_audio_bytes,
    validate_audio_upload,
)
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chapters", tags=["chapter-synth"])


class ChunkInfo(BaseModel):
    index: int
    text: str
    status: str
    take_id: str | None = None
    duration: float
    # ASR-diff QC (QC-01). ``qc_score`` is None until a QC pass runs
    # (or when no per-chunk audio was available to transcribe).
    qc_score: float | None = None
    qc_flagged: bool = False
    qc_transcript: str | None = None


class ChunkMapResponse(BaseModel):
    generation_id: str | None = None
    chunks: list[ChunkInfo]
    total: int


class ChunkQCInfo(BaseModel):
    index: int
    qc_score: float | None = None
    qc_flagged: bool
    expected_text: str
    transcript: str | None = None


class ChapterQCResponse(BaseModel):
    generation_id: str
    threshold: float
    total: int
    scored: int
    flagged: int
    skipped: int
    chunks: list[ChunkQCInfo]


class UploadedChapterGenerationResponse(BaseModel):
    id: str
    chapter_id: str
    engine: str
    status: str
    duration: float
    file_path: str
    output_format: str


class ChapterExportSourceResponse(BaseModel):
    """Which audio will win the batch export for this chapter (UX-02).

    Mirrors ``export_source.resolve_export_source`` 1:1 so the Workbench
    label and the actual ZIP content cannot diverge.
    """

    chapter_id: str
    kind: export_source_service.ExportSourceKind
    render_id: str | None = None
    generation_id: str | None = None
    created_at: str | None = None
    mastered: bool = False


class MasterChapterResponse(BaseModel):
    """Result of the one-click mastering action (UX-02)."""

    chapter_id: str
    render_id: str
    output_path: str
    duration_s: float
    operations: list[str]


class ApplyVoiceRequest(BaseModel):
    """Re-voice a chapter take with a target timbre (OpenVoice).

    The source take's prosody/intonation is preserved; only the timbre
    changes — to a catalog (system) voice or a profile's voice sample.
    The source defaults to the chapter's active (else latest done) take.
    """

    catalog_voice_id: str | None = None
    profile_id: str | None = None
    generation_id: str | None = None
    # OpenVoice quality knobs (see ConvertEngine.convert).
    tau: float = 0.3
    denoise_source: bool = False


class ApplyVoiceResponse(BaseModel):
    chapter_id: str
    generation_id: str
    source_generation_id: str
    engine: str
    duration: float
    file_path: str
    output_format: str


class TranscribeGenerationRequest(BaseModel):
    """Transcribe a chapter take to fill the chapter text.

    Source defaults to the chapter's active (else latest done) take.
    """

    generation_id: str | None = None
    language: str | None = None


class TranscribeGenerationResponse(BaseModel):
    chapter_id: str
    generation_id: str
    text: str
    word_count: int
    language: str


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

    # Chapter-level overrides take priority over project defaults. Lets
    # a book use different narrators per chapter (POV switch,
    # epistolary sections, etc.) without spawning separate projects.
    voice_id = chapter.get("voice_id") or project["voice_id"]
    profile_id = chapter.get("profile_id") or project["profile_id"]

    request = SynthesisRequest(
        text=text,
        voice_id=voice_id,
        output_format=fmt,
        speed=project["speed"],
        pitch=project["pitch"],
        volume=project["volume"],
        profile_id=profile_id,
    )

    # Resolve routing BEFORE any bookkeeping: a profile with samples
    # routes to XTTS, whose clause-level chunking differs from Edge's
    # paragraph chunking. ``chunks_total``, progress and takes must all
    # mirror the chunk list the engine will actually synthesize
    # (MED-CONC-2). A bad profile_id fails here, before any row exists.
    routing = engine.resolve_routing(request)
    chunks = chunk_texts_for_engine(text, routing.engine)

    # Create a generation record
    gen = await pm.create_generation(
        chapter_id=chapter_id,
        voice_id=voice_id,
        profile_id=profile_id,
        output_format=fmt,
        speed=project["speed"],
        pitch=project["pitch"],
        volume=project["volume"],
        engine=routing.engine,
        chunks_total=len(chunks),
    )
    gen_id = gen["id"]

    job_id = gen_id
    progress_registry.start(job_id, chunks_total=len(chunks), step="synthesizing chapter")

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

    # Header-based probe (mutagen) instead of decoding the whole audio
    # just to measure it; off the event loop either way (MED-PERF-5).
    duration = await asyncio.to_thread(duration_seconds, result.path)

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
    gen = await pm.get_latest_done_generation(chapter_id)
    if gen is None:
        raise HTTPException(400, "No completed generation to regenerate from")

    # Re-split with the chunking the generation's engine actually used —
    # XTTS takes are clause-level, Edge takes are paragraph-level.
    chunks = chunk_texts_for_engine(chapter["text"], gen["engine"])
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
        # New audio invalidates any previous QC verdict for this chunk.
        await pm.update_take(
            existing["id"], file_path=str(chunk_audio), status="done",
            qc_score=None, qc_transcript=None,
        )
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
    # possible for Edge-TTS generations, whose per-chunk MP3s live under the
    # job dir (data/jobs/{gen_id}/) and concatenate with a fixed 400ms pause.
    # XTTS clones can't be rebuilt from their job-dir WAVs: the master was
    # post-processed (per-chunk pauses, speed stretch, volume) after
    # concatenation, so a naive re-splice would silently drop all of that.
    # In that case we leave the take updated and report that the chapter
    # audio was NOT re-spliced so the client can warn / offer a full
    # re-synthesis.
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
    gen_id = gen["id"]
    if gen.get("engine") != "edge-tts":
        # Only Edge masters are a plain concat of their job-dir chunks
        # (see the caller's comment) — never rebuild other engines.
        return False
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

    gen = await pm.get_latest_done_generation(chapter_id)
    if gen is None:
        return {"generation_id": None, "chunks": [], "total": 0}

    chunks = chunk_texts_for_engine(chapter["text"], gen["engine"])
    takes = await pm.list_takes(gen["id"])
    take_map = {t["chunk_index"]: t for t in takes}

    result = []
    for i, text in enumerate(chunks):
        take = take_map.get(i)
        qc_score = take.get("qc_score") if take else None
        transcript = take.get("qc_transcript") if take else None
        result.append({
            "index": i,
            "text": text[:200],
            "status": take["status"] if take else "pending",
            "take_id": take["id"] if take else None,
            "duration": take["duration"] if take else 0,
            "qc_score": qc_score,
            # Flag computed at read time so changing the threshold
            # setting re-evaluates stored scores without re-running ASR.
            "qc_flagged": qc_score is not None and qc_score < settings.intelligibility_threshold,
            "qc_transcript": transcript[:200] if transcript else None,
        })

    return {
        "generation_id": gen["id"],
        "chunks": result,
        "total": len(chunks),
    }


@router.get(
    "/{chapter_id}/export-source",
    summary="Which audio will win the batch export for this chapter",
    response_model=ChapterExportSourceResponse,
)
async def get_export_source(chapter_id: str) -> ChapterExportSourceResponse:
    """Expose the export priority (Studio edit > active take > latest
    synthesis > fresh) so the Workbench can show — and the user can
    override — the choice the export would otherwise make silently."""
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    src = await export_source_service.resolve_export_source(chapter)
    return ChapterExportSourceResponse(
        chapter_id=chapter_id,
        kind=src.kind,
        render_id=src.render_id,
        generation_id=src.generation_id,
        created_at=src.created_at,
        mastered=src.mastered,
    )


@router.post(
    "/{chapter_id}/master",
    summary="One-click mastering of the chapter's export audio",
    response_model=MasterChapterResponse,
)
async def master_chapter(chapter_id: str) -> MasterChapterResponse:
    """Run the headless mastering preset (denoise -> loudness -16 LUFS ->
    compressor) over the audio that currently wins the export, without
    opening the Studio editor. The result persists as a studio render so
    the export picks it up; re-mastering requires discarding it first
    (prevents stacking denoise/compression on every click).
    """
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    src = await export_source_service.resolve_export_source(chapter)
    if src.path is None:
        raise HTTPException(400, "No completed generation to master")
    if src.kind == "studio_edit" and src.mastered:
        raise HTTPException(
            400, "Chapter is already mastered — discard the Studio edit to re-master"
        )

    project = await pm.get_project(chapter["project_id"])
    fmt = project["output_format"] if project else "mp3"
    if fmt not in AUDIO_FORMATS:
        fmt = "mp3"

    render = await mastering.master_to_render(
        src.path,
        project_id=chapter.get("project_id"),
        chapter_id=chapter_id,
        output_format=fmt,
    )
    logger.info(
        "Chapter mastered: chapter=%s source=%s -> %s",
        chapter_id, src.path.name, Path(render["output_path"]).name,
    )
    return MasterChapterResponse(
        chapter_id=chapter_id,
        render_id=render["id"],
        output_path=render["output_path"],
        duration_s=render["duration_s"],
        operations=list(mastering.MASTERING_OP_TYPES),
    )


@router.post(
    "/{chapter_id}/qc",
    summary="Run ASR-diff QC on the chapter's completed generation",
    response_model=ChapterQCResponse,
)
async def qc_chapter(chapter_id: str) -> dict:
    """Transcribe each chunk of the latest done generation and flag the
    ones whose transcript diverges from the chapter text (QC-01).

    Synchronous like chapter synthesis: the response carries the full
    verdict. Transcription holds the shared GPU semaphore per chunk, so
    it serializes with XTTS/OpenVoice inference on CUDA. Scores persist
    on the takes — the chunk map shows them on every subsequent load.
    """
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    gen = await pm.get_latest_done_generation(chapter_id)
    if gen is None:
        raise HTTPException(400, "No completed generation to QC")

    project = await pm.get_project(chapter["project_id"])
    language = project["language"] if project else None

    outcomes = await qc_service.run_chapter_qc(chapter, gen, language=language)

    return {
        "generation_id": gen["id"],
        "threshold": settings.intelligibility_threshold,
        "total": len(outcomes),
        "scored": sum(1 for o in outcomes if o.score is not None),
        "flagged": sum(1 for o in outcomes if o.flagged),
        "skipped": sum(1 for o in outcomes if o.score is None),
        "chunks": [
            {
                "index": o.index,
                "qc_score": o.score,
                "qc_flagged": o.flagged,
                "expected_text": o.expected_text[:200],
                "transcript": o.transcript[:200] if o.transcript else None,
            }
            for o in outcomes
        ],
    }


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
    if ext not in ALLOWED_AUDIO_EXTS:
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

    # Best-effort duration; if neither mutagen nor ffmpeg can read the
    # container, record 0 (``duration_seconds`` handles both fallbacks).
    duration = await asyncio.to_thread(duration_seconds, filepath)

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


async def _resolve_source_take(
    chapter: dict, generation_id: str | None
) -> dict | None:
    """The ORIGINAL take to operate on (re-voice / transcribe).

    An explicit ``generation_id`` wins. Otherwise prefer the newest done
    take that is NOT itself a conversion — re-voicing must always start
    from the recording/upload/synth, never a prior ``converted`` take.
    Without this, repeated "apply voice" chains conversions: each pass
    re-voices the previous output and the OpenVoice artifacts compound
    until the narration is destroyed. Falls back to the active / latest
    done take only if every take is already a conversion.
    """
    if generation_id:
        return await pm.get_generation(generation_id)

    gens = await pm.list_generations(chapter["id"])  # newest first
    done = [g for g in gens if g.get("status") == "done" and g.get("file_path")]
    for g in done:
        if g.get("engine") != "converted":
            return g

    active_id = chapter.get("active_generation_id")
    if active_id:
        for g in done:
            if g["id"] == active_id:
                return g
    return done[0] if done else None


@router.post(
    "/{chapter_id}/apply-voice",
    summary="Re-voice a chapter take with a target timbre (OpenVoice)",
    response_model=ApplyVoiceResponse,
)
async def apply_voice_to_chapter(
    chapter_id: str,
    request: ApplyVoiceRequest,
    convert: ConvertEngine = Depends(get_convert_engine),
    profiles: ProfileManager = Depends(get_profile_manager),
) -> ApplyVoiceResponse:
    """Convert a chapter take's timbre to a target voice, keeping the
    original narration's prosody (OpenVoice audio-to-audio).

    Source = ``generation_id`` if given, else the chapter's active take
    (falling back to the latest done one). Target = a catalog/system voice
    (``catalog_voice_id``, a tone-color reference is synthesized + cached)
    or a profile's voice sample (``profile_id``). The converted audio
    registers as a new ``engine="converted"`` generation and becomes the
    chapter's active take, so export / video / QC pick it up like any other.
    """
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    # Resolve the SOURCE take audio.
    src_gen = await _resolve_source_take(chapter, request.generation_id)
    if src_gen is None or not src_gen.get("file_path"):
        raise HTTPException(400, "No completed take to re-voice")
    source_path = Path(src_gen["file_path"])
    if not source_path.exists():
        raise HTTPException(400, "Take audio file not found on disk")

    # Resolve the TARGET tone-color reference: catalog voice or profile.
    target_path: Path | None = None
    if request.catalog_voice_id:
        target_path = await get_or_create_catalog_reference(request.catalog_voice_id)
    elif request.profile_id:
        profile = profiles.get(request.profile_id)
        if profile is None:
            raise HTTPException(404, f"Profile not found: {request.profile_id}")
        for sample in profile.samples:
            candidate = VOICES_DIR / sample
            if candidate.exists():
                target_path = candidate
                break
    if target_path is None:
        raise HTTPException(
            400, "Provide catalog_voice_id or a profile_id with a voice sample"
        )

    project = await pm.get_project(chapter["project_id"])
    fmt = project["output_format"] if project else "mp3"
    if fmt not in AUDIO_FORMATS:
        fmt = "mp3"

    output_path = await convert.convert(
        source_path=source_path,
        target_sample_path=target_path,
        output_format=fmt,
        tau=max(0.1, min(0.7, request.tau)),
        denoise_source=request.denoise_source,
    )
    duration = await asyncio.to_thread(duration_seconds, output_path)

    gen = await pm.create_generation(
        chapter_id=chapter_id,
        voice_id=request.catalog_voice_id or request.profile_id or "converted",
        profile_id=request.profile_id,
        output_format=fmt,
        engine="converted",
        chunks_total=0,
    )
    gen_id = gen["id"]
    await pm.update_generation(
        gen_id,
        status="done",
        duration=duration,
        file_path=str(output_path.resolve()),
        chunks_done=0,
    )
    await pm.update_chapter(chapter_id, active_generation_id=gen_id)

    logger.info(
        "Chapter re-voiced: chapter=%s source=%s -> %s (target=%s)",
        chapter_id, source_path.name, output_path.name,
        request.catalog_voice_id or request.profile_id,
    )
    return ApplyVoiceResponse(
        chapter_id=chapter_id,
        generation_id=gen_id,
        source_generation_id=src_gen["id"],
        engine="converted",
        duration=duration,
        file_path=str(output_path.resolve()),
        output_format=fmt,
    )


@router.post(
    "/{chapter_id}/transcribe-generation",
    summary="Transcribe a chapter take and fill the chapter text",
    response_model=TranscribeGenerationResponse,
)
async def transcribe_chapter_generation(
    chapter_id: str,
    request: TranscribeGenerationRequest,
    transcriber: Transcriber = Depends(get_transcriber),
) -> TranscribeGenerationResponse:
    """Run faster-whisper over a chapter take and write the transcript to
    ``chapters.text`` — so a recorded/uploaded narration becomes a normal
    chapter with text (for QC, aligned subtitles and re-synthesis).

    Source = ``generation_id`` if given, else the chapter's active take
    (falling back to the latest done one). Overwrites the existing text.
    Holds the shared GPU semaphore during transcription, so it serializes
    with TTS/OpenVoice inference on CUDA.
    """
    chapter = await pm.get_chapter(chapter_id)
    if chapter is None:
        raise HTTPException(404, "Chapter not found")

    src_gen = await _resolve_source_take(chapter, request.generation_id)
    if src_gen is None or not src_gen.get("file_path"):
        raise HTTPException(400, "No completed take to transcribe")
    source = Path(src_gen["file_path"])
    if not source.exists():
        raise HTTPException(400, "Take audio file not found on disk")

    project = await pm.get_project(chapter["project_id"])
    language = request.language or (project["language"] if project else None)

    result = await transcriber.transcribe_async(source, language=language)
    text = " ".join(s.text.strip() for s in result.segments if s.text.strip()).strip()

    await pm.update_chapter(chapter_id, text=text)

    logger.info(
        "Chapter transcribed: chapter=%s take=%s -> %d words (%s)",
        chapter_id, source.name, result.word_count, result.engine,
    )
    return TranscribeGenerationResponse(
        chapter_id=chapter_id,
        generation_id=src_gen["id"],
        text=text,
        word_count=result.word_count,
        language=result.language,
    )
