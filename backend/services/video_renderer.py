"""Render an audio file + cover image (+ optional subtitles) to MP4.

Thin wrapper over ffmpeg via ``asyncio.create_subprocess_exec``. The
argv builder is a pure function (``_build_ffmpeg_argv``) so it can be
tested without running ffmpeg. Tests also monkeypatch
``VideoRenderer._run_command`` to skip real encoding.
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from pydub import AudioSegment

from ..exceptions import InvalidSampleError, SynthesisError
from ..paths import STUDIO_VIDEOS_DIR
from ..schemas import VideoOptions

logger = logging.getLogger(__name__)

VALID_RESOLUTIONS: frozenset[str] = frozenset({"1920x1080", "1280x720"})
VALID_SUB_MODES: frozenset[str] = frozenset({"none", "burn", "soft"})


def validate_options(options: VideoOptions) -> None:
    """Raise ``InvalidSampleError`` on malformed option values."""
    if options.resolution not in VALID_RESOLUTIONS:
        raise InvalidSampleError(
            f"Invalid resolution {options.resolution}. "
            f"Valid: {sorted(VALID_RESOLUTIONS)}"
        )
    if options.subtitles_mode not in VALID_SUB_MODES:
        raise InvalidSampleError(
            f"Invalid subtitles_mode {options.subtitles_mode}. "
            f"Valid: {sorted(VALID_SUB_MODES)}"
        )


@dataclass(frozen=True)
class RenderResult:
    output_path: Path
    duration_s: float
    size_bytes: int
    argv: list[str] = field(default_factory=list)


def _parse_resolution(res: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d+)x(\d+)", res)
    if not match:
        raise ValueError(f"Invalid resolution format: {res}")
    return int(match.group(1)), int(match.group(2))


def _escape_drawtext(text: str) -> str:
    """Escape characters ffmpeg's drawtext filter treats as syntax."""
    # Order matters: escape backslash first, then colon/comma/quote/brackets.
    out = text.replace("\\", r"\\")
    for ch in (":", ",", "'", "[", "]", "%"):
        out = out.replace(ch, "\\" + ch)
    return out


def _build_filter_complex(
    *,
    width: int,
    height: int,
    use_ken_burns: bool,
    use_waveform: bool,
    title_text: str | None,
    burn_subs_path: Path | None,
) -> str:
    parts: list[str] = []

    # 1. Cover -> base video. Ken Burns or plain scale.
    if use_ken_burns:
        parts.append(
            f"[0:v]zoompan=z='min(zoom+0.0002,1.15)':"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d=1:s={width}x{height},fps=30[v]"
        )
    else:
        parts.append(f"[0:v]scale={width}:{height},fps=30[v]")

    current = "v"

    # 2. Optional waveform overlay at the bottom.
    if use_waveform:
        parts.append(
            f"[1:a]showwaves=s={width}x120:mode=cline:colors=white|cyan[wv]"
        )
        parts.append(f"[{current}][wv]overlay=0:H-h:format=auto[vw]")
        current = "vw"

    # 3. Optional title text, fades out after 5s.
    if title_text:
        safe = _escape_drawtext(title_text)
        parts.append(
            f"[{current}]drawtext=text='{safe}':"
            f"fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/3:"
            f"enable='between(t,0,5)'[vt]"
        )
        current = "vt"

    # 4. Burn subtitles (only when path provided AND mode=burn).
    if burn_subs_path is not None:
        # Forward slashes even on Windows — ffmpeg's 'subtitles' filter
        # does its own parsing and chokes on backslashes.
        sub = str(burn_subs_path).replace("\\", "/")
        parts.append(
            f"[{current}]subtitles={sub}:"
            f"force_style='FontName=Arial,FontSize=28'[vout]"
        )
    else:
        parts.append(f"[{current}]null[vout]")

    return ";".join(parts)


def _build_ffmpeg_argv(
    *,
    audio_path: Path,
    cover_path: Path,
    subtitles_path: Path | None,
    output_path: Path,
    options: VideoOptions,
) -> list[str]:
    width, height = _parse_resolution(options.resolution)
    soft_subs = subtitles_path is not None and options.subtitles_mode == "soft"
    burn_subs = subtitles_path is not None and options.subtitles_mode == "burn"

    filter_complex = _build_filter_complex(
        width=width,
        height=height,
        use_ken_burns=options.ken_burns,
        use_waveform=options.waveform_overlay,
        title_text=options.title_text,
        burn_subs_path=subtitles_path if burn_subs else None,
    )

    argv: list[str] = [
        "ffmpeg", "-y",
        "-loop", "1",
        "-i", str(cover_path),
        "-i", str(audio_path),
    ]
    if soft_subs:
        argv.extend(["-i", str(subtitles_path)])

    argv.extend([
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", "1:a",
    ])
    if soft_subs:
        argv.extend(["-map", "2"])

    argv.extend([
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
    ])
    if soft_subs:
        argv.extend(["-c:s", "mov_text"])

    argv.extend([
        "-shortest",
        "-movflags", "+faststart",
        str(output_path),
    ])
    return argv


class VideoRenderer:
    """Stateless renderer; one instance is reused across requests."""

    async def render(
        self,
        *,
        audio_path: Path,
        cover_path: Path,
        subtitles_path: Path | None,
        options: VideoOptions,
    ) -> RenderResult:
        validate_options(options)
        if not audio_path.exists() or not audio_path.is_file():
            raise InvalidSampleError(f"Audio not found: {audio_path}")
        if not cover_path.exists() or not cover_path.is_file():
            raise InvalidSampleError(f"Cover image not found: {cover_path}")
        if subtitles_path is not None and not subtitles_path.exists():
            raise InvalidSampleError(f"Subtitle file not found: {subtitles_path}")

        STUDIO_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = STUDIO_VIDEOS_DIR / f"video_{str(uuid.uuid4())[:12]}.mp4"

        argv = _build_ffmpeg_argv(
            audio_path=audio_path,
            cover_path=cover_path,
            subtitles_path=subtitles_path,
            output_path=output_path,
            options=options,
        )

        await self._run_command(argv, output_path)

        if not output_path.exists():
            raise SynthesisError("Renderer completed but no output file was produced")

        try:
            duration_s = float(len(AudioSegment.from_file(str(audio_path)))) / 1000.0
        except Exception:  # noqa: BLE001
            duration_s = 0.0

        return RenderResult(
            output_path=output_path,
            duration_s=duration_s,
            size_bytes=output_path.stat().st_size,
            argv=argv,
        )

    async def _run_command(self, argv: list[str], output_path: Path) -> None:
        """Execute ffmpeg. Tests monkeypatch this to skip real encoding."""
        if not shutil.which(argv[0]):
            raise SynthesisError(
                "ffmpeg not found on PATH. Install it or add it to PATH.",
            )

        logger.info("Rendering video: %s", output_path.name)
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            tail = stderr.decode(errors="replace")[-2000:]
            raise SynthesisError(
                f"ffmpeg exited {proc.returncode}: {tail.strip()}",
            )
