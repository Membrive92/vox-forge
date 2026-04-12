"""Parse character markup from text.

Text can contain `[CharacterName]` tags at the start of lines:

    [Narrator] It was a dark and stormy night.
    [Kael] "I told you this would happen."
    [Narrator] Kael stepped forward, his voice trembling.

Lines without a tag inherit the last active character (default: Narrator).
The parser splits text into segments grouped by character, each with
the character name and the text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_TAG_RE = re.compile(r"^\[([^\]]+)\]\s*(.*)$")


@dataclass(frozen=True)
class CharacterSegment:
    character: str
    text: str


def parse_character_markup(text: str) -> list[CharacterSegment]:
    """Parse text with [Character] tags into segments.

    Adjacent lines by the same character are merged into a single segment.
    """
    lines = text.split("\n")
    segments: list[CharacterSegment] = []
    current_char = "Narrator"
    current_lines: list[str] = []

    for line in lines:
        match = _TAG_RE.match(line.strip())
        if match:
            char_name = match.group(1).strip()
            content = match.group(2).strip()
            if char_name != current_char:
                # Flush
                if current_lines:
                    segments.append(CharacterSegment(
                        character=current_char,
                        text="\n".join(current_lines).strip(),
                    ))
                    current_lines = []
                current_char = char_name
            if content:
                current_lines.append(content)
        else:
            stripped = line.strip()
            if stripped:
                current_lines.append(stripped)

    # Flush last segment
    if current_lines:
        segments.append(CharacterSegment(
            character=current_char,
            text="\n".join(current_lines).strip(),
        ))

    return segments


def extract_characters(text: str) -> list[str]:
    """Return distinct character names found in the text, in order of appearance."""
    seen: set[str] = set()
    result: list[str] = []
    for line in text.split("\n"):
        match = _TAG_RE.match(line.strip())
        if match:
            name = match.group(1).strip()
            if name not in seen:
                seen.add(name)
                result.append(name)
    return result
