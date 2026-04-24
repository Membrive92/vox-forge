"""Image generation for the Studio slideshow.

Pluggable ``ImageProvider`` abstraction + a ``PlaceholderProvider``
that renders a text-on-gradient PNG with PIL (no network, no API key,
always works). Adding a real provider (Replicate, OpenAI DALL·E, local
Stable Diffusion, Stable Horde, etc.) = subclass ``ImageProvider``,
implement ``generate_async``, wire it in ``_build_provider``.

Generated PNGs are saved under ``STUDIO_COVERS_DIR`` so the existing
slideshow pipeline (``VideoImage.path`` + the allowed-roots guard)
picks them up with zero extra work.
"""
from __future__ import annotations

import abc
import asyncio
import hashlib
import logging
import random
import uuid
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from ..paths import STUDIO_COVERS_DIR

logger = logging.getLogger(__name__)

VALID_ASPECT_RATIOS: frozenset[str] = frozenset({"16:9", "9:16", "1:1", "4:3"})


def _parse_aspect(aspect: str) -> tuple[int, int]:
    """Return (width, height) for an aspect ratio at roughly 1080p."""
    if aspect not in VALID_ASPECT_RATIOS:
        raise ValueError(
            f"Invalid aspect ratio: {aspect}. Valid: {sorted(VALID_ASPECT_RATIOS)}"
        )
    presets = {
        "16:9": (1920, 1080),
        "9:16": (1080, 1920),
        "1:1": (1080, 1080),
        "4:3": (1440, 1080),
    }
    return presets[aspect]


class ImageProvider(abc.ABC):
    """Abstract provider. Async-first so slow backends (remote APIs,
    local SD) don't block the event loop."""

    name: str = "abstract"

    @abc.abstractmethod
    async def generate_async(
        self,
        prompt: str,
        aspect: str,
        seed: int | None,
    ) -> bytes:
        """Return raw PNG bytes for ``prompt`` at the given aspect ratio."""


class PlaceholderProvider(ImageProvider):
    """Deterministic offline provider. The prompt's hash drives the
    gradient colours so the same prompt always produces the same image
    (useful for tests and quick prototyping of scene assignments
    without paying for API calls)."""

    name = "placeholder"

    async def generate_async(
        self,
        prompt: str,
        aspect: str,
        seed: int | None,
    ) -> bytes:
        # Move the blocking PIL work off the event loop so big renders
        # don't stall other requests.
        return await asyncio.to_thread(self._render, prompt, aspect, seed)

    @staticmethod
    def _render(prompt: str, aspect: str, seed: int | None) -> bytes:
        width, height = _parse_aspect(aspect)
        # Derive a colour pair from the prompt + optional seed so the
        # output is deterministic yet varied across scenes.
        salt = f"{prompt}|{seed}".encode("utf-8", errors="replace")
        digest = hashlib.sha256(salt).digest()
        c1 = (digest[0], digest[1], digest[2])
        c2 = (digest[3], digest[4], digest[5])

        img = Image.new("RGB", (width, height), c1)
        # Vertical gradient from c1 (top) to c2 (bottom)
        top = c1
        bottom = c2
        draw = ImageDraw.Draw(img)
        for y in range(height):
            ratio = y / max(height - 1, 1)
            r = int(top[0] * (1 - ratio) + bottom[0] * ratio)
            g = int(top[1] * (1 - ratio) + bottom[1] * ratio)
            b = int(top[2] * (1 - ratio) + bottom[2] * ratio)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

        # Text overlay — prompt preview in the centre. Wrap naively.
        try:
            font = ImageFont.truetype("arial.ttf", size=max(28, width // 48))
        except OSError:
            font = ImageFont.load_default()

        preview = prompt.strip()[:140] + ("…" if len(prompt) > 140 else "")
        lines = _wrap_text(preview, max_chars=max(24, width // 40))
        line_height = (font.size if hasattr(font, "size") else 20) + 8
        total_height = line_height * len(lines)
        y = (height - total_height) // 2
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=font)
            tw = bbox[2] - bbox[0]
            x = (width - tw) // 2
            # Shadow for legibility against any background colour
            draw.text((x + 2, y + 2), line, font=font, fill=(0, 0, 0))
            draw.text((x, y), line, font=font, fill=(255, 255, 255))
            y += line_height

        import io

        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        return buf.getvalue()


def _wrap_text(text: str, max_chars: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        candidate = f"{current} {w}".strip()
        if len(candidate) > max_chars and current:
            lines.append(current)
            current = w
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines or [text]


def _build_provider() -> ImageProvider:
    """Factory. Today only ``PlaceholderProvider`` is wired; extension
    point for real providers lives here (read from settings, branch on
    ``image_provider`` name)."""
    return PlaceholderProvider()


_DEFAULT_PROVIDER: ImageProvider | None = None


def get_provider() -> ImageProvider:
    global _DEFAULT_PROVIDER
    if _DEFAULT_PROVIDER is None:
        _DEFAULT_PROVIDER = _build_provider()
    return _DEFAULT_PROVIDER


async def generate_image(
    prompt: str,
    aspect: str = "16:9",
    seed: int | None = None,
    provider: ImageProvider | None = None,
) -> Path:
    """High-level entry point — delegates to the configured provider,
    saves the PNG under ``STUDIO_COVERS_DIR``, and returns its path."""
    if not prompt or not prompt.strip():
        raise ValueError("Prompt must be non-empty")
    if aspect not in VALID_ASPECT_RATIOS:
        raise ValueError(
            f"Invalid aspect ratio: {aspect}. Valid: {sorted(VALID_ASPECT_RATIOS)}"
        )

    p = provider or get_provider()
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    png_bytes = await p.generate_async(prompt=prompt, aspect=aspect, seed=seed)

    STUDIO_COVERS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"gen_{str(uuid.uuid4())[:12]}.png"
    filepath = STUDIO_COVERS_DIR / filename
    filepath.write_bytes(png_bytes)
    logger.info(
        "Image generated: provider=%s prompt=%r aspect=%s seed=%s -> %s",
        p.name, prompt[:60], aspect, seed, filename,
    )
    return filepath
