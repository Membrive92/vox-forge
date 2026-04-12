"""SSML-lite markup parser.

Converts inline markup tags to audio processing instructions.
The parser strips tags from text and returns a list of segments
with their effects applied.

Supported tags:
  [pause 1.5s]   → insert N seconds of silence
  [emph]...[/emph] → emphasize text (slightly louder, slightly slower)
  [whisper]...[/whisper] → reduce volume significantly, add breathiness
  [rate 0.8]...[/rate] → change speed for a section
  [loud]...[/loud] → boost volume for a section
  [soft]...[/soft] → reduce volume for a section

Tags are case-insensitive and stripped from the text before TTS.
Effects are applied as post-processing on the synthesized audio.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass(frozen=True)
class SSMLEffect:
    """A post-processing effect to apply to a text segment."""

    type: str  # "pause", "emph", "whisper", "rate", "loud", "soft"
    value: float = 1.0  # Seconds for pause, rate multiplier for rate, etc.


@dataclass
class SSMLSegment:
    """A text segment with optional effects."""

    text: str
    effects: list[SSMLEffect] = field(default_factory=list)


# Pattern to match any SSML-lite tag
_TAG_RE = re.compile(
    r"\[(?:pause\s+[\d.]+s?|emph|/emph|whisper|/whisper|rate\s+[\d.]+|/rate|loud|/loud|soft|/soft)\]",
    re.IGNORECASE,
)

_PAUSE_RE = re.compile(r"\[pause\s+([\d.]+)s?\]", re.IGNORECASE)


def parse_ssml_lite(text: str) -> list[SSMLSegment]:
    """Parse SSML-lite markup and return segments with effects."""
    segments: list[SSMLSegment] = []
    active_effects: list[SSMLEffect] = []

    pos = 0
    for match in _TAG_RE.finditer(text):
        # Text before this tag
        before = text[pos:match.start()].strip()
        if before:
            segments.append(SSMLSegment(text=before, effects=list(active_effects)))

        tag = match.group(0).lower()

        # Process tag
        pause_m = _PAUSE_RE.match(match.group(0))
        if pause_m:
            secs = float(pause_m.group(1))
            segments.append(SSMLSegment(text="", effects=[SSMLEffect("pause", secs)]))
        elif tag == "[emph]":
            active_effects.append(SSMLEffect("emph"))
        elif tag == "[/emph]":
            active_effects = [e for e in active_effects if e.type != "emph"]
        elif tag == "[whisper]":
            active_effects.append(SSMLEffect("whisper"))
        elif tag == "[/whisper]":
            active_effects = [e for e in active_effects if e.type != "whisper"]
        elif tag.startswith("[rate"):
            rate_val = float(re.findall(r"[\d.]+", tag)[0])
            active_effects.append(SSMLEffect("rate", rate_val))
        elif tag == "[/rate]":
            active_effects = [e for e in active_effects if e.type != "rate"]
        elif tag == "[loud]":
            active_effects.append(SSMLEffect("loud"))
        elif tag == "[/loud]":
            active_effects = [e for e in active_effects if e.type != "loud"]
        elif tag == "[soft]":
            active_effects.append(SSMLEffect("soft"))
        elif tag == "[/soft]":
            active_effects = [e for e in active_effects if e.type != "soft"]

        pos = match.end()

    # Remaining text
    remaining = text[pos:].strip()
    if remaining:
        segments.append(SSMLSegment(text=remaining, effects=list(active_effects)))

    return segments


def strip_ssml_tags(text: str) -> str:
    """Remove all SSML-lite tags, returning plain text for the TTS engine."""
    return _TAG_RE.sub("", text).strip()


def has_ssml_tags(text: str) -> bool:
    """Check if text contains any SSML-lite markup."""
    return bool(_TAG_RE.search(text))
