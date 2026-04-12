"""Character-cast synthesis: different profiles for different characters."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pydub import AudioSegment

from ..cancellation import create_cancellation_token
from ..catalogs import AUDIO_FORMATS
from ..dependencies import get_tts_engine
from ..paths import OUTPUT_DIR, TEMP_DIR
from ..schemas import SynthesisRequest
from ..services.character_parser import CharacterSegment, extract_characters, parse_character_markup
from ..services.metadata import AudioMetadata, embed_metadata
from ..services.tts_engine import TTSEngine
from ..utils import cleanup_old_files

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/character-synth", tags=["character-synth"])


class CharacterMapping(BaseModel):
    character: str
    profile_id: Optional[str] = None
    voice_id: str = Field(default="")


class CastSynthesisRequest(BaseModel):
    text: str = Field(..., min_length=1)
    cast: list[CharacterMapping]
    output_format: str = Field(default="mp3")
    speed: int = Field(default=100, ge=50, le=200)
    pitch: int = Field(default=0, ge=-10, le=10)
    volume: int = Field(default=80, ge=0, le=100)
    title: Optional[str] = None
    artist: Optional[str] = None


@router.post("/extract-characters", summary="List character names found in text")
async def extract_chars(body: dict) -> dict:
    text = body.get("text", "")
    return {"characters": extract_characters(text)}


@router.post("/synthesize", summary="Synthesize text with character-cast voices")
async def cast_synthesize(
    body: CastSynthesisRequest,
    http_request: Request,
    background_tasks: BackgroundTasks,
    engine: TTSEngine = Depends(get_tts_engine),
) -> FileResponse:
    fmt = body.output_format
    if fmt not in AUDIO_FORMATS:
        raise HTTPException(400, f"Unsupported format: {fmt}")

    segments = parse_character_markup(body.text)
    if not segments:
        raise HTTPException(400, "No text to synthesize")

    cast_map = {m.character: m for m in body.cast}

    # Validate: every detected character should have a cast mapping
    unmapped = [seg.character for seg in segments if seg.character not in cast_map]
    if unmapped:
        unique_unmapped = sorted(set(unmapped))
        logger.warning(
            "Characters without cast mapping (will use default voice): %s",
            unique_unmapped,
        )

    cancel_token = create_cancellation_token(http_request)

    file_id = str(uuid.uuid4())[:8]
    output_path = OUTPUT_DIR / f"cast_{file_id}.{fmt}"
    temp_files: list[Path] = []

    # Default voice for unmapped characters
    default_voice = "es-ES-AlvaroNeural"

    try:
        for i, seg in enumerate(segments):
            mapping = cast_map.get(seg.character)
            voice_id = mapping.voice_id if mapping else default_voice
            profile_id = mapping.profile_id if mapping else None

            request = SynthesisRequest(
                text=seg.text,
                voice_id=voice_id or default_voice,
                output_format="mp3",
                speed=body.speed,
                pitch=body.pitch,
                volume=body.volume,
                profile_id=profile_id,
            )

            result = await engine.synthesize(request, cancel_token=cancel_token)
            temp_files.append(result.path)
            logger.info(
                "Cast segment %d/%d [%s] done: %d bytes",
                i + 1, len(segments), seg.character, result.path.stat().st_size,
            )

        # Concatenate all segments with a 600ms pause between character switches
        combined = AudioSegment.empty()
        pause = AudioSegment.silent(duration=600)
        prev_char = ""
        for j, tf in enumerate(temp_files):
            seg_audio = AudioSegment.from_file(str(tf))
            cur_char = segments[j].character if j < len(segments) else ""
            if j > 0 and cur_char != prev_char:
                combined += pause
            elif j > 0:
                combined += AudioSegment.silent(duration=300)
            combined += seg_audio
            prev_char = cur_char

        fmt_cfg = AUDIO_FORMATS[fmt]
        combined.export(
            str(output_path),
            format=fmt_cfg["format"],
            codec=fmt_cfg["codec"],
            parameters=fmt_cfg["parameters"],
        )

        duration = round(len(combined) / 1000.0, 2)

        embed_metadata(
            output_path,
            AudioMetadata(title=body.title, artist=body.artist),
        )

        background_tasks.add_task(cleanup_old_files)

        return FileResponse(
            path=str(output_path),
            media_type=f"audio/{fmt}",
            filename=f"cast_{file_id}.{fmt}",
            headers={
                "X-Audio-Duration": str(duration),
                "X-Audio-Size": str(output_path.stat().st_size),
                "X-Audio-Segments": str(len(segments)),
                "X-Unmapped-Characters": ",".join(sorted(set(unmapped))) if unmapped else "",
            },
        )
    finally:
        for tf in temp_files:
            tf.unlink(missing_ok=True)
