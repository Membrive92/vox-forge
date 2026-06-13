"""Image generation for the Studio slideshow.

Pluggable ``ImageProvider`` abstraction with two implementations:

- ``PlaceholderProvider`` (default) — renders a text-on-gradient PNG
  with PIL: no network, no GPU, always works.
- ``ComfyUIProvider`` (PROD-02) — talks plain HTTP to the SAME local
  ComfyUI instance/workspace that ``img_generation_module`` provisions
  (Z-Image-Turbo, Apache 2.0 stack). The backend never runs diffusion
  itself.

Adding another provider = subclass ``ImageProvider``, implement
``generate_async``, branch in ``_build_provider``.

Generated PNGs are saved under ``STUDIO_COVERS_DIR`` so the existing
slideshow pipeline (``VideoImage.path`` + the allowed-roots guard)
picks them up with zero extra work.
"""
from __future__ import annotations

import abc
import asyncio
import hashlib
import json
import logging
import random
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from PIL import Image, ImageDraw, ImageFont

from ..config import settings
from ..dependencies import get_convert_engine, get_tts_engine
from ..exceptions import (
    ImageGenerationError,
    ImageProviderUnavailableError,
    ImageWorkflowError,
)
from ..paths import STUDIO_COVERS_DIR, STUDIO_MEDIA_DIR, STUDIO_MEDIA_THUMBS_DIR
from .engine_unload import unload_gpu_engines

logger = logging.getLogger(__name__)

VALID_ASPECT_RATIOS: frozenset[str] = frozenset({"16:9", "9:16", "1:1", "4:3"})


@dataclass(frozen=True)
class ProviderStatus:
    """Health-check result for the configured provider (plan F2)."""

    name: str
    available: bool
    server_url: str | None = None
    error: str | None = None


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

    async def status_async(self) -> ProviderStatus:
        """Health check — providers without external dependencies are
        always available; networked providers override this."""
        return ProviderStatus(name=self.name, available=True)


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


# ── ComfyUI provider (PROD-02) ──────────────────────────────────────

# Reserved node titles, mirroring the img_generation_module convention
# (pipeline/workflows.py, ADR-005): nodes are located by ``_meta.title``
# because numeric node IDs change between GUI re-exports. Conventions
# are mirrored, never imported — that module owns its own specs.
COMFYUI_REQUIRED_TITLES: frozenset[str] = frozenset({"PROMPT_POSITIVE", "SEED", "SIZE", "SAVE"})

# Z-Image-Turbo size buckets per aspect ratio. Width/height must be
# multiples of 16; 1248x720 is the canonical 16:9 still of the
# img_generation_module (SETUP_PROVISIONING §5). The slideshow scales
# to the final resolution at render time via ffmpeg.
COMFYUI_SIZE_BUCKETS: dict[str, tuple[int, int]] = {
    "16:9": (1248, 720),
    "9:16": (720, 1248),
    "1:1": (1024, 1024),
    "4:3": (1024, 768),
}

# Outputs land in the shared ComfyUI workspace output/ dir under this
# prefix so VoxForge files are recognizable next to the module's own.
_COMFYUI_FILENAME_PREFIX = "voxforge/scene"

# The default workflow export is a HUMAN step (PROD-05): every error a
# missing/broken template can produce points the author at it.
_WORKFLOW_EXPORT_HINT = (
    "Export it from the ComfyUI GUI first (PROD-05, human step): inside "
    "img_generation_module run `python -m pipeline engine up`, load the "
    "Z-Image-Turbo template, rename the reserved node titles "
    "(PROMPT_POSITIVE/PROMPT_NEGATIVE/SEED/SIZE/SAVE) and use "
    "'Save (API Format)' — see img_generation_module/docs/SETUP_PROVISIONING.md §5."
)


def _nodes_by_title(wf: dict[str, Any], title: str) -> list[str]:
    """IDs of all nodes whose ``_meta.title`` matches exactly."""
    return [
        node_id
        for node_id, node in wf.items()
        if isinstance(node, dict) and node.get("_meta", {}).get("title") == title
    ]


def _single_node_by_title(wf: dict[str, Any], title: str) -> str:
    """ID of the unique node with that title; error if 0 or more than 1."""
    matches = _nodes_by_title(wf, title)
    if not matches:
        raise ImageWorkflowError(
            f"No node titled '{title}' in the ComfyUI workflow. {_WORKFLOW_EXPORT_HINT}"
        )
    if len(matches) > 1:
        raise ImageWorkflowError(
            f"Title '{title}' matches {len(matches)} nodes in the ComfyUI workflow; "
            f"reserved titles must be unique. {_WORKFLOW_EXPORT_HINT}"
        )
    return matches[0]


def _entry_completed(prompt_id: str, entry: dict[str, Any]) -> bool:
    """Interpret a ``/history`` entry; True when the job completed.

    The history is the source of truth for failures too (mirrors the
    img_generation_module engine): a recorded ``execution_error`` or an
    error status raises instead of waiting out the timeout.
    """
    status = entry.get("status", {}) or {}
    for message in status.get("messages", []) or []:
        if (
            isinstance(message, (list, tuple))
            and len(message) >= 2
            and message[0] == "execution_error"
        ):
            payload = message[1] if isinstance(message[1], dict) else {}
            detail = payload.get("exception_message") or json.dumps(payload)[:300]
            raise ImageGenerationError(
                f"ComfyUI execution error for prompt {prompt_id}: {detail}"
            )
    if status.get("status_str") == "error":
        raise ImageGenerationError(
            f"ComfyUI prompt {prompt_id} ended in error state: {status}"
        )
    return bool(entry.get("outputs")) or status.get("completed") is True


def _first_output_image(prompt_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    """The first persisted output image of a completed history entry."""
    outputs = entry.get("outputs") or {}
    for node_output in outputs.values():
        if not isinstance(node_output, dict):
            continue
        for item in node_output.get("images", []):
            if (
                isinstance(item, dict)
                and item.get("filename")
                # Previews carry type "temp" and don't live in output/.
                and item.get("type", "output") == "output"
            ):
                return item
    raise ImageGenerationError(
        f"ComfyUI prompt {prompt_id} completed without output images"
    )


class ComfyUIProvider(ImageProvider):
    """Real image generation through a local ComfyUI instance.

    Plain HTTP against the SAME ComfyUI instance/workspace that
    ``img_generation_module`` provisions (default ``127.0.0.1:8188``):
    parametrize the exported workflow by reserved ``_meta.title``,
    submit it (``POST /prompt``), poll ``GET /history/{prompt_id}``
    until completion, download the PNG via ``GET /view``.

    Before submitting, it applies the PROD-01 inter-process VRAM policy
    via the injected ``unload_engines`` callable (a direct in-process
    service call — never HTTP-to-self) so the diffusion model fits next
    to this backend on the shared 12 GB card.

    ``transport`` is a test seam: pass ``httpx.MockTransport`` to run
    the full flow without a network.
    """

    name = "comfyui"

    def __init__(
        self,
        url: str,
        workflow_path: Path,
        timeout_s: float,
        unload_engines: Callable[[], Awaitable[None]] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        poll_interval_s: float = 0.5,
    ) -> None:
        self._url = url.rstrip("/")
        self._workflow_path = workflow_path
        self._timeout_s = timeout_s
        self._unload_engines = unload_engines
        self._transport = transport
        self._poll_interval_s = poll_interval_s
        self._client_id = uuid.uuid4().hex

    async def generate_async(
        self,
        prompt: str,
        aspect: str,
        seed: int | None,
    ) -> bytes:
        # Loaded per request (a few KB): a re-exported workflow is picked
        # up without a backend restart, and a missing one fails at
        # request time with the actionable message instead of at boot.
        wf = self._load_workflow()
        if seed is None:
            seed = random.randint(0, 2**31 - 1)
        self._parametrize(wf, prompt, aspect, seed)

        if self._unload_engines is not None:
            # PROD-01: free this backend's VRAM before the diffusion load.
            await self._unload_engines()

        deadline = time.monotonic() + self._timeout_s
        async with self._client() as client:
            prompt_id = await self._submit(client, wf)
            entry = await self._poll_history(client, prompt_id, deadline)
            image_ref = _first_output_image(prompt_id, entry)
            return await self._download(client, image_ref)

    async def status_async(self) -> ProviderStatus:
        # Workflow first: it is the cheap, network-free precondition and
        # the one with a human step (PROD-05) behind it.
        try:
            self._load_workflow()
        except ImageWorkflowError as exc:
            return ProviderStatus(
                name=self.name, available=False, server_url=self._url, error=exc.message,
            )
        try:
            async with self._client() as client:
                response = await client.get("/system_stats", timeout=2.0)
                response.raise_for_status()
        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            return ProviderStatus(
                name=self.name,
                available=False,
                server_url=self._url,
                error=self._unreachable_message(exc),
            )
        return ProviderStatus(name=self.name, available=True, server_url=self._url)

    # ------------------------------------------------------------ internals

    def _load_workflow(self) -> dict[str, Any]:
        """Load + validate the API-format workflow JSON, fail actionably."""
        if not self._workflow_path.is_file():
            raise ImageWorkflowError(
                f"ComfyUI workflow not found: {self._workflow_path}. {_WORKFLOW_EXPORT_HINT}"
            )
        try:
            wf = json.loads(self._workflow_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ImageWorkflowError(
                f"ComfyUI workflow {self._workflow_path} is not valid JSON "
                f"({exc}). {_WORKFLOW_EXPORT_HINT}"
            ) from exc
        if not isinstance(wf, dict):
            raise ImageWorkflowError(
                f"ComfyUI workflow {self._workflow_path} is not a JSON object "
                f"(API format expected). {_WORKFLOW_EXPORT_HINT}"
            )
        missing = [t for t in sorted(COMFYUI_REQUIRED_TITLES) if not _nodes_by_title(wf, t)]
        if missing:
            raise ImageWorkflowError(
                f"ComfyUI workflow {self._workflow_path} is missing reserved node "
                f"titles: {', '.join(missing)}. {_WORKFLOW_EXPORT_HINT}"
            )
        return wf

    def _parametrize(self, wf: dict[str, Any], prompt: str, aspect: str, seed: int) -> None:
        """Write the allowed fields into the titled nodes (in place).

        Only PROMPT_POSITIVE/SEED/SIZE/SAVE are touched; everything else
        (negative prompt, sampler, steps, model files) stays as exported.
        """
        width, height = COMFYUI_SIZE_BUCKETS[aspect]
        wf[_single_node_by_title(wf, "PROMPT_POSITIVE")]["inputs"]["text"] = prompt
        # SEED may legitimately match several samplers (the module's video
        # graph does); write all, honoring the field each sampler exposes.
        for node_id in _nodes_by_title(wf, "SEED"):
            inputs = wf[node_id]["inputs"]
            if "seed" in inputs:
                inputs["seed"] = seed
            elif "noise_seed" in inputs:
                inputs["noise_seed"] = seed
            else:
                raise ImageWorkflowError(
                    f"Workflow node {node_id} (title 'SEED') has neither 'seed' "
                    f"nor 'noise_seed' in inputs. {_WORKFLOW_EXPORT_HINT}"
                )
        size_inputs = wf[_single_node_by_title(wf, "SIZE")]["inputs"]
        size_inputs["width"] = width
        size_inputs["height"] = height
        wf[_single_node_by_title(wf, "SAVE")]["inputs"]["filename_prefix"] = (
            _COMFYUI_FILENAME_PREFIX
        )

    def _client(self) -> httpx.AsyncClient:
        kwargs: dict[str, Any] = {"base_url": self._url, "timeout": httpx.Timeout(30.0)}
        if self._transport is not None:
            kwargs["transport"] = self._transport
        return httpx.AsyncClient(**kwargs)

    def _unreachable_message(self, exc: Exception) -> str:
        return (
            f"Cannot reach ComfyUI at {self._url} ({exc.__class__.__name__}). "
            "Start the img_generation_module instance (`python -m pipeline "
            "engine up` inside img_generation_module) or set "
            "VOXFORGE_IMAGE_PROVIDER=placeholder."
        )

    async def _submit(self, client: httpx.AsyncClient, wf: dict[str, Any]) -> str:
        """POST /prompt → prompt_id."""
        payload = {"prompt": wf, "client_id": self._client_id}
        try:
            response = await client.post("/prompt", json=payload)
        except httpx.RequestError as exc:
            raise ImageProviderUnavailableError(self._unreachable_message(exc)) from exc
        if response.status_code == 400:
            # Invalid graph (unknown node, mistyped input): provisioning or
            # programming error — do not retry (mirrors the module engine).
            raise ImageWorkflowError(
                f"ComfyUI rejected the workflow (HTTP 400, invalid graph): "
                f"{response.text[:500]}. {_WORKFLOW_EXPORT_HINT}"
            )
        if response.status_code >= 300:
            raise ImageGenerationError(
                f"ComfyUI POST /prompt failed with HTTP {response.status_code}: "
                f"{response.text[:300]}"
            )
        prompt_id = response.json().get("prompt_id")
        if not isinstance(prompt_id, str):
            raise ImageGenerationError(
                f"ComfyUI POST /prompt returned no prompt_id: {response.text[:300]}"
            )
        logger.info("ComfyUI prompt submitted: %s", prompt_id)
        return prompt_id

    async def _poll_history(
        self, client: httpx.AsyncClient, prompt_id: str, deadline: float
    ) -> dict[str, Any]:
        """Poll GET /history/{prompt_id} until completion or deadline."""
        while time.monotonic() < deadline:
            try:
                response = await client.get(f"/history/{prompt_id}")
            except httpx.RequestError as exc:
                raise ImageProviderUnavailableError(self._unreachable_message(exc)) from exc
            if response.status_code < 300:
                entry = response.json().get(prompt_id)
                if isinstance(entry, dict) and _entry_completed(prompt_id, entry):
                    return entry
            await asyncio.sleep(self._poll_interval_s)
        raise ImageGenerationError(
            f"ComfyUI did not finish prompt {prompt_id} within {self._timeout_s:.0f}s. "
            "Raise VOXFORGE_COMFYUI_TIMEOUT_S if the model was still loading."
        )

    async def _download(
        self, client: httpx.AsyncClient, image_ref: dict[str, Any]
    ) -> bytes:
        """GET /view → raw image bytes."""
        params = {
            "filename": image_ref["filename"],
            "subfolder": image_ref.get("subfolder", "") or "",
            "type": "output",
        }
        try:
            response = await client.get("/view", params=params)
        except httpx.RequestError as exc:
            raise ImageProviderUnavailableError(self._unreachable_message(exc)) from exc
        if response.status_code >= 300 or not response.content:
            raise ImageGenerationError(
                f"ComfyUI /view download failed for {image_ref['filename']} "
                f"(HTTP {response.status_code})"
            )
        return response.content


async def _unload_runtime_engines() -> None:
    """PROD-01 policy as an in-process call: release this backend's GPU
    models before a diffusion job (never HTTP-to-self)."""
    unloaded, _ = await unload_gpu_engines(get_tts_engine(), get_convert_engine())
    if unloaded:
        logger.info("Unloaded GPU engines before image generation: %s", unloaded)


def _build_provider() -> ImageProvider:
    """Factory — branches on ``settings.image_provider``."""
    if settings.image_provider == "comfyui":
        workflow_path = settings.comfyui_workflow_path
        if not workflow_path.is_absolute():
            workflow_path = settings.base_dir / workflow_path
        return ComfyUIProvider(
            url=settings.comfyui_url,
            workflow_path=workflow_path,
            timeout_s=settings.comfyui_timeout_s,
            unload_engines=_unload_runtime_engines,
        )
    return PlaceholderProvider()


_DEFAULT_PROVIDER: ImageProvider | None = None


def get_provider() -> ImageProvider:
    global _DEFAULT_PROVIDER
    if _DEFAULT_PROVIDER is None:
        _DEFAULT_PROVIDER = _build_provider()
    return _DEFAULT_PROVIDER


def reset_provider_cache() -> None:
    """Forget the cached provider so a settings change takes effect
    (used by tests that flip ``settings.image_provider``)."""
    global _DEFAULT_PROVIDER
    _DEFAULT_PROVIDER = None


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


# ── Library-aware generation (T2I-1) ────────────────────────────────


# Default thumbnail edge in pixels (PIL ``Image.thumbnail`` preserves aspect).
THUMBNAIL_MAX_PX = 256


@dataclass(frozen=True)
class LibraryImage:
    """A generation written into the media library.

    ``filename`` / ``thumb_filename`` are relative to ``STUDIO_MEDIA_DIR``
    (the row stores them as-is); ``sidecar`` carries the reproducibility
    record (SPEC_PIPELINE §3 shape) already merged into ``meta``.
    """

    filename: str
    thumb_filename: str
    width: int
    height: int
    seed: int
    aspect_ratio: str
    size_kb: float
    provider: str
    meta: dict[str, Any]


def _png_dimensions(png_bytes: bytes) -> tuple[int, int]:
    """(width, height) of an in-memory PNG via PIL."""
    import io

    with Image.open(io.BytesIO(png_bytes)) as img:
        return img.width, img.height


def _write_thumbnail(png_bytes: bytes, dest: Path) -> None:
    """Write a ``THUMBNAIL_MAX_PX`` PNG thumbnail (aspect preserved).

    Blocking PIL work — call via ``asyncio.to_thread``.
    """
    import io

    with Image.open(io.BytesIO(png_bytes)) as img:
        img = img.convert("RGB")
        img.thumbnail((THUMBNAIL_MAX_PX, THUMBNAIL_MAX_PX))
        img.save(dest, format="PNG", optimize=True)


def _build_sidecar(
    *,
    provider: str,
    prompt: str,
    seed: int,
    width: int,
    height: int,
    created_at: str,
    elapsed_s: float,
) -> dict[str, Any]:
    """Reproducibility sidecar in the img_generation_module shape
    (SPEC_PIPELINE §3): ``params`` + ``models`` + ``workflow`` + ``timings``
    + ``created_at``. The placeholder provider has no real models/workflow,
    so those stay empty — an imported module asset and an in-app one read
    the same way."""
    return {
        "schema": 1,
        "kind": "image",
        "created_at": created_at,
        "provider": provider,
        "params": {"prompt": prompt, "negative": "", "seed": seed,
                   "width": width, "height": height},
        "models": {},
        "workflow": {},
        "timings": {"exec_s": round(elapsed_s, 3)},
    }


async def generate_into_library(
    prompt: str,
    aspect: str = "16:9",
    seed: int | None = None,
    provider: ImageProvider | None = None,
) -> LibraryImage:
    """Generate an image and persist it into the media library.

    Writes the PNG + a sidecar JSON (SPEC_PIPELINE §3 shape) + a 256px
    thumbnail under ``STUDIO_MEDIA_DIR``. Returns the metadata the router
    needs to insert a ``media_assets`` row. Does NOT touch the existing
    ``generate_image()`` path that ``VideoRenderPanel`` still uses.
    """
    if not prompt or not prompt.strip():
        raise ValueError("Prompt must be non-empty")
    if aspect not in VALID_ASPECT_RATIOS:
        raise ValueError(
            f"Invalid aspect ratio: {aspect}. Valid: {sorted(VALID_ASPECT_RATIOS)}"
        )

    p = provider or get_provider()
    if seed is None:
        seed = random.randint(0, 2**31 - 1)

    started = time.monotonic()
    png_bytes = await p.generate_async(prompt=prompt, aspect=aspect, seed=seed)
    elapsed_s = time.monotonic() - started
    created_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime()) or ""

    width, height = await asyncio.to_thread(_png_dimensions, png_bytes)

    STUDIO_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    STUDIO_MEDIA_THUMBS_DIR.mkdir(parents=True, exist_ok=True)
    stem = f"gen_{str(uuid.uuid4())[:12]}"
    filename = f"{stem}.png"
    thumb_filename = f"{stem}.png"  # relative to the thumbs subdir

    (STUDIO_MEDIA_DIR / filename).write_bytes(png_bytes)
    await asyncio.to_thread(
        _write_thumbnail, png_bytes, STUDIO_MEDIA_THUMBS_DIR / thumb_filename
    )

    sidecar = _build_sidecar(
        provider=p.name, prompt=prompt, seed=seed,
        width=width, height=height, created_at=created_at, elapsed_s=elapsed_s,
    )
    # Sidecar JSON next to the PNG so a module-imported asset and an
    # in-app one are read the same way (plan §3).
    (STUDIO_MEDIA_DIR / f"{stem}.json").write_text(
        json.dumps(sidecar, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    size_kb = round(len(png_bytes) / 1024, 1)
    logger.info(
        "Library image generated: provider=%s prompt=%r aspect=%s seed=%s "
        "(%dx%d, %.1f KB) -> %s",
        p.name, prompt[:60], aspect, seed, width, height, size_kb, filename,
    )
    return LibraryImage(
        filename=filename,
        thumb_filename=thumb_filename,
        width=width,
        height=height,
        seed=seed,
        aspect_ratio=aspect,
        size_kb=size_kb,
        provider=p.name,
        meta=sidecar,
    )
