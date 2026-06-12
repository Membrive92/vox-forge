"""Scene detection over SRT transcripts (PROD-03 / production plan B2).

Pure functions: parse an SRT document into timed entries and group
consecutive entries into ~N-second "scenes". Each scene is one slot for
a slideshow image — the glue between ``/api/studio/transcribe`` and the
``images`` list of ``/api/studio/render-video``. No persistence: the
client keeps the array (montage UI arrives with UX-03/M5).
"""
from __future__ import annotations

import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from .transcriber import SrtSegment

# A silence this long between consecutive entries reads as a paragraph
# break: the current scene closes even before reaching the target
# duration (plan B2: "paragraph break según pausa larga").
PARAGRAPH_PAUSE_S = 1.5

# Scene summaries keep only the first words — enough to label an image
# slot without shipping the whole transcript back to the client.
_SUMMARY_WORDS = 12

# "HH:MM:SS,mmm --> HH:MM:SS,mmm" (comma per spec; dot tolerated).
_TIMESTAMP_RE = re.compile(
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*"
    r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})"
)


@dataclass(frozen=True)
class Scene:
    """A detected scene: time range plus the first words spoken in it."""

    start_s: float
    end_s: float
    text_summary: str


def parse_srt(content: str) -> list[SrtSegment]:
    """Parse SRT text into segments; malformed blocks are skipped.

    Tolerant by design: the SRT may have been hand-edited after
    transcription, so a broken block must not sink the whole request.
    """
    segments: list[SrtSegment] = []
    for block in re.split(r"\n\s*\n", content.replace("\r\n", "\n")):
        lines = [line.strip() for line in block.strip().split("\n") if line.strip()]
        match: re.Match[str] | None = None
        ts_line = -1
        for i, line in enumerate(lines):
            match = _TIMESTAMP_RE.search(line)
            if match:
                ts_line = i
                break
        if match is None:
            continue
        text = " ".join(lines[ts_line + 1:]).strip()
        segments.append(
            SrtSegment(
                index=len(segments) + 1,
                start=_to_seconds(match.group(1), match.group(2), match.group(3), match.group(4)),
                end=_to_seconds(match.group(5), match.group(6), match.group(7), match.group(8)),
                text=text,
            )
        )
    return segments


def group_into_scenes(
    entries: Iterable[SrtSegment],
    target_scene_seconds: float = 25.0,
    *,
    paragraph_pause_s: float = PARAGRAPH_PAUSE_S,
) -> list[Scene]:
    """Group consecutive entries into scenes of ~``target_scene_seconds``.

    Rules (plan B2):
    - accumulate entries until the scene span reaches the target;
    - a pause >= ``paragraph_pause_s`` between entries closes the scene
      early (paragraph break);
    - an entry that alone meets the target becomes its own scene rather
      than inflating the previous one.
    """
    scenes: list[Scene] = []
    group: list[SrtSegment] = []

    def close() -> None:
        scenes.append(
            Scene(
                start_s=group[0].start,
                end_s=group[-1].end,
                text_summary=_summarize(group),
            )
        )
        group.clear()

    for entry in entries:
        entry_is_long = (entry.end - entry.start) >= target_scene_seconds
        if group and (entry_is_long or entry.start - group[-1].end >= paragraph_pause_s):
            close()
        group.append(entry)
        if entry.end - group[0].start >= target_scene_seconds:
            close()
    if group:
        close()
    return scenes


def _to_seconds(hours: str, minutes: str, secs: str, ms: str) -> float:
    return int(hours) * 3600 + int(minutes) * 60 + int(secs) + int(ms) / 1000


def _summarize(group: Sequence[SrtSegment]) -> str:
    words = " ".join(seg.text for seg in group).split()
    if len(words) <= _SUMMARY_WORDS:
        return " ".join(words)
    return " ".join(words[:_SUMMARY_WORDS]) + "…"
