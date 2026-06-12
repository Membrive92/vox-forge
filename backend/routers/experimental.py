"""Experimental endpoints for testing cross-lingual voice cloning.

These endpoints bypass the quality system (candidates, retries, text
normalization) for fast iteration. Not for production narration.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pydub import AudioSegment

from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..exceptions import InvalidParameterError, UnsupportedFormatError
from ..paths import OUTPUT_DIR, TEMP_DIR
from ..services.castilian_warmup import (
    build_anchored_speaker_wav,
    get_reference_voice,
    time_stretch_wav,
    trim_warmup_audio,
    wrap_text_with_warmup,
)
from ..services.tts_engine import TTSEngine
from ..upload_utils import read_upload_safely, validate_audio_upload
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/experimental", tags=["experimental"])


class CandidateTake(BaseModel):
    id: str
    path: str
    duration_s: float


class CandidatesResponse(BaseModel):
    candidates: list[CandidateTake]
    count: int
    language: str
    castilian_warmup: bool
    castilian_reference: bool


class ReferenceVoiceStatusResponse(BaseModel):
    """Availability of the operator-configured Castilian reference voice."""

    configured: bool
    filename: str | None = None
    duration_s: float | None = None

_ALLOWED_LANGUAGES = {"es", "en", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "ja", "hu", "ko"}
_MAX_CANDIDATES = 3


@dataclass(frozen=True)
class _Take:
    """One generated take, ready to be served."""
    output_path: Path
    duration_s: float


async def _persist_sample(voice_sample: UploadFile) -> Path:
    """Save the user-uploaded reference voice to a temp file."""
    sample_ext = Path(voice_sample.filename or "").suffix or ".wav"
    sample_filename = f"{str(uuid.uuid4())[:8]}_xling{sample_ext}"
    sample_path = TEMP_DIR / sample_filename
    sample_content = await read_upload_safely(voice_sample)
    sample_path.write_bytes(sample_content)
    return sample_path


@dataclass(frozen=True)
class _SpeakerPlan:
    speaker_wav: Path
    use_text_warmup: bool


def _resolve_speaker_plan(
    user_sample: Path,
    use_reference: bool,
    castilian_warmup: bool,
) -> _SpeakerPlan:
    """Build the speaker_wav XTTS will see and decide which warm-up flavor.

    Three real cases:

    - **D1 (use_reference=True)** → speaker_wav = pure reference. Timbre
      is sacrificed for a guaranteed Castilian accent. No text warm-up.
    - **E (warmup=True + reference exists)** → speaker_wav = reference +
      user_sample concatenated. The first ~8s of audio is Castilian, so
      XTTS's speaker embedding picks up that accent. Timbre stays close
      to the user's voice. NO text warm-up — audio is doing the work.
    - **B (warmup=True + no reference)** → speaker_wav = user_sample as-is.
      We fall back to wrapping the *text* with a Castilian phrase. Less
      effective but better than nothing.
    - **off** → speaker_wav = user_sample untouched. No warm-up.
    """
    if use_reference:
        ref = get_reference_voice()
        if ref is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No Castilian reference voice configured. "
                    "Drop a .wav into data/voices/reference/ to enable this option."
                ),
            )
        return _SpeakerPlan(speaker_wav=ref, use_text_warmup=False)

    if castilian_warmup:
        ref = get_reference_voice()
        if ref is not None:
            # E: prepend the reference to the user_sample.
            anchored = TEMP_DIR / f"{uuid.uuid4().hex[:8]}_anchored.wav"
            build_anchored_speaker_wav(user_sample, ref, anchored)
            return _SpeakerPlan(speaker_wav=anchored, use_text_warmup=False)
        # B fallback: text-only warm-up.
        return _SpeakerPlan(speaker_wav=user_sample, use_text_warmup=True)

    return _SpeakerPlan(speaker_wav=user_sample, use_text_warmup=False)


async def _generate_take(
    *,
    engine: TTSEngine,
    text: str,
    speaker_wav: Path,
    language: str,
    output_format: str,
    speed_pct: int,
    castilian_warmup: bool,
    use_text_warmup: bool,
) -> _Take:
    """Run one synthesis pass and return the rendered output file.

    Two warm-up modes share the ``castilian_warmup`` flag:
      - **Text warm-up** (``use_text_warmup=True``): prepend a Castilian
        phrase to the text, synthesize, then trim that portion from the
        wav. Used when no reference voice is configured.
      - **Audio anchor** (``use_text_warmup=False``): the caller has
        already concatenated a Castilian reference into the speaker_wav.
        We pass the user's text untouched and skip the trim. This is
        the path that actually fixes the accent in practice.

    The caller is responsible for cleaning up the returned file when no
    longer needed (e.g. via background task cleanup).
    """
    file_id = str(uuid.uuid4())[:12]
    output_wav = TEMP_DIR / f"{file_id}_xling.wav"
    output_path = OUTPUT_DIR / f"{file_id}.{output_format}"

    synth_text = (
        wrap_text_with_warmup(text)
        if (castilian_warmup and use_text_warmup)
        else text
    )

    clone = engine._get_clone_engine()
    # Always synthesize at natural cadence and stretch in post. XTTS's
    # native ``speed`` kwarg gets ignored when speaker_wav is long (e.g.
    # with audio anchor), so the slider felt dead. The Rubber Band
    # post-stretch (pedalboard.time_stretch) is independent of the model
    # and preserves pitch and formants.
    await clone.raw_synthesize(
        text=synth_text,
        speaker_wav=str(speaker_wav),
        language=language,
        output_path=output_wav,
    )

    if castilian_warmup and use_text_warmup:
        trim_warmup_audio(output_wav)

    # Apply user-requested speed via Rubber Band post-stretch.
    # speed_pct=100 → rate=1.0 → no-op. <100 = slower, >100 = faster.
    rate = speed_pct / 100.0
    if abs(rate - 1.0) >= 0.01:
        # rate>1 makes audio shorter (faster) — same direction as
        # speed_pct. The helper clamps to the safe ±25% range.
        time_stretch_wav(output_wav, rate)

    # Format conversion
    if output_format == "wav":
        output_wav.rename(output_path)
    else:
        fmt = AUDIO_FORMATS[output_format]
        audio = AudioSegment.from_wav(str(output_wav))
        audio.export(
            str(output_path),
            format=fmt["format"],
            codec=fmt["codec"],
            parameters=fmt["parameters"],
        )
        output_wav.unlink(missing_ok=True)

    try:
        result_audio = AudioSegment.from_file(str(output_path))
        duration = round(len(result_audio) / 1000.0, 2)
    except Exception:
        duration = 0.0

    return _Take(output_path=output_path, duration_s=duration)


def _validate_common(language: str, output_format: str) -> None:
    if output_format not in AUDIO_FORMATS:
        raise UnsupportedFormatError(
            f"Unsupported format: {output_format}. Valid: {sorted(AUDIO_FORMATS)}"
        )
    if language not in _ALLOWED_LANGUAGES:
        raise InvalidParameterError(
            f"Unsupported language: {language}. Valid: {sorted(_ALLOWED_LANGUAGES)}"
        )


@router.post("/cross-lingual", summary="Cross-lingual voice cloning (experimental)")
async def cross_lingual_synthesis(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    voice_sample: UploadFile = File(...),
    language: str = Form(default="es"),
    output_format: str = Form(default="mp3"),
    speed: int = Form(default=100),
    castilian_warmup: bool = Form(default=False),
    use_castilian_reference: bool = Form(default=False),
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    """Synthesize text in one language using a voice sample from another.

    Optional flags:
      - ``castilian_warmup`` (B): prepend a Castilian-only phrase + silence
        before synthesis, then trim it from the result. Helps anchor the
        accent toward Castilian when ``language="es"``.
      - ``use_castilian_reference`` (D1): replace the user's voice_sample
        with the operator-configured reference voice in
        ``data/voices/reference/``. Sacrifices timbre for guaranteed
        Castilian accent. Returns 400 if no reference is configured.
    """
    _validate_common(language, output_format)
    validate_audio_upload(voice_sample)

    user_sample = await _persist_sample(voice_sample)
    anchored_path: Path | None = None

    try:
        plan = _resolve_speaker_plan(
            user_sample, use_castilian_reference, castilian_warmup,
        )
        if plan.speaker_wav != user_sample and plan.speaker_wav.parent == TEMP_DIR:
            anchored_path = plan.speaker_wav  # cleanup later
        take = await _generate_take(
            engine=engine,
            text=text,
            speaker_wav=plan.speaker_wav,
            language=language,
            output_format=output_format,
            speed_pct=speed,
            castilian_warmup=castilian_warmup,
            use_text_warmup=plan.use_text_warmup,
        )
        background_tasks.add_task(cleanup_old_files)
        return FileResponse(
            path=str(take.output_path),
            media_type=f"audio/{output_format}",
            filename=f"voxforge_xling.{output_format}",
            headers={
                "X-Audio-Duration": str(take.duration_s),
                "X-Audio-Engine": "xtts-v2-crosslingual",
                "X-Target-Language": language,
                "X-Castilian-Warmup": "1" if castilian_warmup else "0",
                "X-Castilian-Reference": "1" if use_castilian_reference else "0",
                "X-Castilian-Anchor": "1" if (castilian_warmup and not plan.use_text_warmup and not use_castilian_reference) else "0",
            },
        )
    finally:
        user_sample.unlink(missing_ok=True)
        if anchored_path is not None:
            anchored_path.unlink(missing_ok=True)


@router.post("/cross-lingual/candidates", summary="Cross-lingual with N takes", response_model=CandidatesResponse)
async def cross_lingual_candidates(
    background_tasks: BackgroundTasks,
    text: str = Form(...),
    voice_sample: UploadFile = File(...),
    language: str = Form(default="es"),
    output_format: str = Form(default="mp3"),
    speed: int = Form(default=100),
    castilian_warmup: bool = Form(default=False),
    use_castilian_reference: bool = Form(default=False),
    candidates: int = Form(default=3),
    engine: TTSEngine = Depends(get_tts_engine),
) -> dict:
    """Generate N independent takes (C). Each take is saved under
    OUTPUT_DIR and a JSON manifest is returned. The frontend serves
    each take via the existing /studio/audio endpoint.

    XTTS v2 is non-deterministic — each take comes out slightly
    different. With cross-lingual, this means you can pick the take
    with the best accent or fewest artefacts.
    """
    if candidates < 1 or candidates > _MAX_CANDIDATES:
        raise HTTPException(
            status_code=400,
            detail=f"candidates must be between 1 and {_MAX_CANDIDATES}",
        )

    _validate_common(language, output_format)
    validate_audio_upload(voice_sample)

    user_sample = await _persist_sample(voice_sample)
    anchored_path: Path | None = None

    try:
        plan = _resolve_speaker_plan(
            user_sample, use_castilian_reference, castilian_warmup,
        )
        if plan.speaker_wav != user_sample and plan.speaker_wav.parent == TEMP_DIR:
            anchored_path = plan.speaker_wav  # temp anchored wav — clean up later
        takes: list[_Take] = []
        for _ in range(candidates):
            take = await _generate_take(
                engine=engine,
                text=text,
                speaker_wav=plan.speaker_wav,
                language=language,
                output_format=output_format,
                speed_pct=speed,
                castilian_warmup=castilian_warmup,
                use_text_warmup=plan.use_text_warmup,
            )
            takes.append(take)

        background_tasks.add_task(cleanup_old_files)
        return {
            "candidates": [
                {
                    "id": t.output_path.stem,
                    "path": str(t.output_path),
                    "duration_s": t.duration_s,
                }
                for t in takes
            ],
            "count": len(takes),
            "language": language,
            "castilian_warmup": castilian_warmup,
            "castilian_reference": use_castilian_reference,
        }
    finally:
        user_sample.unlink(missing_ok=True)
        if anchored_path is not None:
            anchored_path.unlink(missing_ok=True)


@router.get("/reference-voice/audio", summary="Serve the configured reference voice file")
async def reference_voice_audio() -> FileResponse:
    """Stream the operator-configured Castilian reference voice as audio.

    Used by the frontend's "Save as profile" action — it fetches the
    bytes here, wraps them in a File, and posts to /api/profiles to
    register a normal profile with this audio as its sample.
    """
    ref = get_reference_voice()
    if ref is None:
        raise HTTPException(status_code=404, detail="No reference voice configured")
    media_type = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
    }.get(ref.suffix.lower(), "application/octet-stream")
    return FileResponse(path=str(ref), media_type=media_type, filename=ref.name)


@router.get(
    "/reference-voice",
    summary="Check if a Castilian reference voice is configured",
    response_model=ReferenceVoiceStatusResponse,
)
async def reference_voice_status() -> ReferenceVoiceStatusResponse:
    """Tell the frontend whether the D1 toggle should be available."""
    ref = get_reference_voice()
    if ref is None:
        return ReferenceVoiceStatusResponse(configured=False)
    try:
        seg = AudioSegment.from_file(str(ref))
        duration = round(len(seg) / 1000.0, 2)
    except Exception:
        duration = 0.0
    return ReferenceVoiceStatusResponse(
        configured=True,
        filename=ref.name,
        duration_s=duration,
    )
