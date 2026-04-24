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
from ..schemas import VideoImage, VideoOptions

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


def _measure_audio_duration_s(audio_path: Path) -> float:
    """Return the audio duration in seconds. Falls back to 0 on decode
    failure; callers should handle the zero case by substituting a
    sensible minimum (e.g. last image's start_s + buffer)."""
    try:
        return float(len(AudioSegment.from_file(str(audio_path)))) / 1000.0
    except Exception:  # noqa: BLE001
        return 0.0


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


def _compute_image_durations(
    images: list[VideoImage],
    audio_duration_s: float,
) -> list[float]:
    """Each image shows from its ``start_s`` until the next image's
    ``start_s`` (or the end of audio for the last). Returns durations
    in seconds, all >= 0.5 so single-frame glitches are avoided.
    """
    n = len(images)
    durations: list[float] = []
    for i in range(n):
        start = images[i].start_s
        end = images[i + 1].start_s if i + 1 < n else audio_duration_s
        durations.append(max(0.5, end - start))
    return durations


def _build_slideshow_filter(
    *,
    images: list[VideoImage],
    durations: list[float],
    width: int,
    height: int,
    use_ken_burns: bool,
    use_waveform: bool,
    title_text: str | None,
    burn_subs_path: Path | None,
    audio_stream_idx: int,
    xfade_dur: float,
) -> str:
    """Build the filter_complex for a multi-image slideshow.

    Produces one ``[vi]`` stream per image (scaled / Ken Burns'd to the
    output resolution), chains them with ``xfade`` transitions, then
    passes the resulting ``[vbase]`` through the same showwaves /
    drawtext / subtitles stack as the single-cover path.
    """
    parts: list[str] = []
    n = len(images)

    # 1. Per-image: scale or Ken Burns, normalize fps + pixel format so
    # xfade sees compatible streams.
    for i, dur in enumerate(durations):
        if use_ken_burns:
            # zoompan needs a target duration in frames at fps=30; use
            # a clip-specific d value so each image zooms through its
            # whole slot instead of cutting mid-zoom.
            frames = max(30, int(round(dur * 30)))
            parts.append(
                f"[{i}:v]zoompan=z='min(zoom+0.0004,1.2)':"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
                f"d={frames}:s={width}x{height},fps=30,format=yuv420p[v{i}]"
            )
        else:
            parts.append(
                f"[{i}:v]scale={width}:{height},fps=30,format=yuv420p[v{i}]"
            )

    # 2. Chain xfades sequentially. ``offset`` for each xfade is the
    # cumulative duration of already-combined clips minus the xfade
    # overlap — that's when the outgoing clip starts fading out.
    if n == 1:
        parts.append("[v0]null[vbase]")
    else:
        cumulative = durations[0]
        prev = "v0"
        for i in range(1, n):
            offset = max(0.0, cumulative - xfade_dur)
            label = "vbase" if i == n - 1 else f"vx{i}"
            parts.append(
                f"[{prev}][v{i}]xfade=transition=fade:"
                f"duration={xfade_dur:.3f}:offset={offset:.3f}[{label}]"
            )
            prev = label
            # After xfade, the combined stream length is
            # (previous total) + next_duration - xfade_dur.
            cumulative += durations[i] - xfade_dur

    current = "vbase"

    # 3. Waveform overlay from the audio stream (same as single-cover).
    if use_waveform:
        parts.append(
            f"[{audio_stream_idx}:a]showwaves=s={width}x120:"
            f"mode=cline:colors=white|cyan[wv]"
        )
        parts.append(f"[{current}][wv]overlay=0:H-h:format=auto[vw]")
        current = "vw"

    # 4. Title (same first-5-second fade as single-cover).
    if title_text:
        safe = _escape_drawtext(title_text)
        parts.append(
            f"[{current}]drawtext=text='{safe}':"
            f"fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/3:"
            f"enable='between(t,0,5)'[vt]"
        )
        current = "vt"

    # 5. Burned subtitles if present.
    if burn_subs_path is not None:
        sub = str(burn_subs_path).replace("\\", "/")
        parts.append(
            f"[{current}]subtitles={sub}:"
            f"force_style='FontName=Arial,FontSize=28'[vout]"
        )
    else:
        parts.append(f"[{current}]null[vout]")

    return ";".join(parts)


def _build_slideshow_argv(
    *,
    audio_path: Path,
    images: list[VideoImage],
    audio_duration_s: float,
    subtitles_path: Path | None,
    output_path: Path,
    options: VideoOptions,
) -> list[str]:
    """Build ffmpeg argv for a slideshow (multi-image) render."""
    width, height = _parse_resolution(options.resolution)
    soft_subs = subtitles_path is not None and options.subtitles_mode == "soft"
    burn_subs = subtitles_path is not None and options.subtitles_mode == "burn"
    xfade_dur = max(0.0, options.crossfade_s)

    durations = _compute_image_durations(images, audio_duration_s)
    # Each clip extends by xfade_dur (except the last) so the crossfade
    # overlap doesn't truncate its content.
    clip_lengths = [d + (xfade_dur if i < len(durations) - 1 else 0.0)
                    for i, d in enumerate(durations)]

    argv: list[str] = ["ffmpeg", "-y"]
    for img, clip_len in zip(images, clip_lengths):
        argv.extend(["-loop", "1", "-t", f"{clip_len:.3f}", "-i", str(img.path)])
    audio_stream_idx = len(images)
    argv.extend(["-i", str(audio_path)])
    if soft_subs:
        argv.extend(["-i", str(subtitles_path)])

    filter_complex = _build_slideshow_filter(
        images=images,
        durations=durations,
        width=width,
        height=height,
        use_ken_burns=options.ken_burns,
        use_waveform=options.waveform_overlay,
        title_text=options.title_text,
        burn_subs_path=subtitles_path if burn_subs else None,
        audio_stream_idx=audio_stream_idx,
        xfade_dur=xfade_dur,
    )

    argv.extend([
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-map", f"{audio_stream_idx}:a",
    ])
    if soft_subs:
        argv.extend(["-map", str(audio_stream_idx + 1)])

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
        cover_path: Path | None,
        subtitles_path: Path | None,
        options: VideoOptions,
        images: list[VideoImage] | None = None,
    ) -> RenderResult:
        """Produce an MP4 from audio + visuals.

        Two modes:
        - **Single cover** (default, Phase B.2): ``cover_path`` is used
          as a static background with Ken Burns pan/zoom.
        - **Slideshow** (Phase B.3): ``images`` is a non-empty list of
          ``VideoImage``. Each image anchors at its ``start_s`` and
          transitions into the next via ``xfade``. ``cover_path`` is
          ignored if images are provided.
        """
        validate_options(options)
        if not audio_path.exists() or not audio_path.is_file():
            raise InvalidSampleError(f"Audio not found: {audio_path}")
        if subtitles_path is not None and not subtitles_path.exists():
            raise InvalidSampleError(f"Subtitle file not found: {subtitles_path}")

        # Decide mode: slideshow if non-empty images, else single cover.
        if images:
            # All image paths must exist. Caller (router) is responsible
            # for allowlist / path-traversal checks before getting here.
            for img in images:
                p = Path(img.path)
                if not p.exists() or not p.is_file():
                    raise InvalidSampleError(f"Image not found: {p}")
            # start_s must be monotonically non-decreasing so the
            # xfade offsets make sense.
            for i in range(1, len(images)):
                if images[i].start_s < images[i - 1].start_s:
                    raise InvalidSampleError(
                        "Slideshow images must be sorted by start_s"
                    )
            audio_duration_s = _measure_audio_duration_s(audio_path)
            if audio_duration_s <= 0:
                audio_duration_s = max(1.0, images[-1].start_s + 5.0)
        elif cover_path is not None:
            if not cover_path.exists() or not cover_path.is_file():
                raise InvalidSampleError(f"Cover image not found: {cover_path}")
        else:
            raise InvalidSampleError(
                "Either cover_path or images must be provided"
            )

        STUDIO_VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        output_path = STUDIO_VIDEOS_DIR / f"video_{str(uuid.uuid4())[:12]}.mp4"

        if images:
            argv = _build_slideshow_argv(
                audio_path=audio_path,
                images=images,
                audio_duration_s=audio_duration_s,
                subtitles_path=subtitles_path,
                output_path=output_path,
                options=options,
            )
        else:
            assert cover_path is not None  # for type-checker
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
