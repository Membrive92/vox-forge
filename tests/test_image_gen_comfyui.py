"""Tests for the ComfyUI image provider (PROD-02).

All transport is mocked with ``httpx.MockTransport`` — no network, no
ComfyUI, no GPU. Covers: parametrization by reserved ``_meta.title``
(the img_generation_module convention), the happy path (unload → submit
→ history poll → /view download), the actionable error when the
workflow export (PROD-05, human step) is missing, and the health-check
paths of ``GET /api/studio/image-provider/status``.

``backend`` is imported inside tests so collection cannot import the
real torch/pydub before the conftest stubs are installed.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest

_PNG = b"\x89PNG\r\n\x1a\nfake-image-bytes"


def _workflow() -> dict[str, Any]:
    """Minimal API-format graph with the reserved titles (ADR-005)."""
    return {
        "3": {
            "class_type": "KSampler",
            "inputs": {"noise_seed": 1, "steps": 8},
            "_meta": {"title": "SEED"},
        },
        "5": {
            "class_type": "EmptySD3LatentImage",
            "inputs": {"width": 0, "height": 0},
            "_meta": {"title": "SIZE"},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": ""},
            "_meta": {"title": "PROMPT_POSITIVE"},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": "blurry, watermark"},
            "_meta": {"title": "PROMPT_NEGATIVE"},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "ComfyUI"},
            "_meta": {"title": "SAVE"},
        },
    }


def _write_workflow(tmp_path: Path, wf: dict[str, Any] | None = None) -> Path:
    path = tmp_path / "zimage_t2i_fp8.api.json"
    path.write_text(json.dumps(wf if wf is not None else _workflow()), encoding="utf-8")
    return path


def _comfy_transport(
    record: dict[str, Any],
    *,
    completed: bool = True,
    reject_graph: bool = False,
    execution_error: bool = False,
) -> httpx.MockTransport:
    """Fake ComfyUI: /prompt, /history/{id}, /view, /system_stats."""

    def handler(request: httpx.Request) -> httpx.Response:
        record.setdefault("calls", []).append(f"{request.method} {request.url.path}")
        if request.url.path == "/prompt":
            if reject_graph:
                return httpx.Response(400, json={"error": "invalid graph"})
            record["graph"] = json.loads(request.content)["prompt"]
            return httpx.Response(200, json={"prompt_id": "p1"})
        if request.url.path == "/history/p1":
            if execution_error:
                entry = {
                    "status": {
                        "status_str": "error",
                        "completed": False,
                        "messages": [
                            ["execution_error", {"exception_message": "CUDA out of memory"}],
                        ],
                    },
                    "outputs": {},
                }
                return httpx.Response(200, json={"p1": entry})
            if not completed:
                return httpx.Response(200, json={})
            entry = {
                "status": {"status_str": "success", "completed": True, "messages": []},
                "outputs": {
                    "9": {
                        "images": [
                            {
                                "filename": "scene_00001_.png",
                                "subfolder": "voxforge",
                                "type": "output",
                            },
                        ],
                    },
                },
            }
            return httpx.Response(200, json={"p1": entry})
        if request.url.path == "/view":
            record["view_params"] = dict(request.url.params)
            return httpx.Response(200, content=_PNG)
        if request.url.path == "/system_stats":
            return httpx.Response(200, json={"system": {}})
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def _down_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    return httpx.MockTransport(handler)


def _provider(
    workflow_path: Path,
    transport: httpx.AsyncBaseTransport,
    *,
    unload=None,
    timeout_s: float = 5.0,
):
    from backend.services.image_gen import ComfyUIProvider

    return ComfyUIProvider(
        url="http://127.0.0.1:8188",
        workflow_path=workflow_path,
        timeout_s=timeout_s,
        unload_engines=unload,
        transport=transport,
        poll_interval_s=0.01,
    )


# ── Parametrization by _meta.title + happy path ─────────────────────


async def test_happy_path_parametrizes_by_title_and_returns_png(tmp_path):
    record: dict[str, Any] = {"calls": []}

    async def unload() -> None:
        record["calls"].append("unload")

    provider = _provider(_write_workflow(tmp_path), _comfy_transport(record), unload=unload)
    png = await provider.generate_async(prompt="a quiet harbor at dawn", aspect="16:9", seed=42)

    assert png == _PNG
    graph = record["graph"]
    assert graph["6"]["inputs"]["text"] == "a quiet harbor at dawn"
    # Honors the seed field the sampler actually exposes (noise_seed here).
    assert graph["3"]["inputs"]["noise_seed"] == 42
    assert (graph["5"]["inputs"]["width"], graph["5"]["inputs"]["height"]) == (1248, 720)
    assert graph["9"]["inputs"]["filename_prefix"].startswith("voxforge")
    # Negative prompt untouched: the exported workflow's default survives.
    assert graph["7"]["inputs"]["text"] == "blurry, watermark"
    # PROD-01: the GPU unload ran BEFORE anything was submitted.
    assert record["calls"][0] == "unload"
    assert record["calls"][1] == "POST /prompt"
    # Download went through /view with the history-provided coordinates.
    assert record["view_params"] == {
        "filename": "scene_00001_.png", "subfolder": "voxforge", "type": "output",
    }


@pytest.mark.parametrize(
    ("aspect", "size"),
    [("16:9", (1248, 720)), ("9:16", (720, 1248)), ("1:1", (1024, 1024)), ("4:3", (1024, 768))],
)
async def test_size_buckets_are_multiples_of_16(tmp_path, aspect, size):
    record: dict[str, Any] = {}
    provider = _provider(_write_workflow(tmp_path), _comfy_transport(record))

    await provider.generate_async(prompt="x", aspect=aspect, seed=1)

    inputs = record["graph"]["5"]["inputs"]
    assert (inputs["width"], inputs["height"]) == size
    assert inputs["width"] % 16 == 0 and inputs["height"] % 16 == 0


async def test_seed_written_to_plain_seed_field_when_present(tmp_path):
    wf = _workflow()
    wf["3"]["inputs"] = {"seed": 0, "steps": 8}
    record: dict[str, Any] = {}
    provider = _provider(_write_workflow(tmp_path, wf), _comfy_transport(record))

    await provider.generate_async(prompt="x", aspect="1:1", seed=7)

    assert record["graph"]["3"]["inputs"]["seed"] == 7


# ── Actionable failures ─────────────────────────────────────────────


async def test_missing_workflow_file_lists_the_human_step(tmp_path):
    from backend.exceptions import ImageWorkflowError

    provider = _provider(tmp_path / "missing.api.json", _comfy_transport({}))

    with pytest.raises(ImageWorkflowError) as exc_info:
        await provider.generate_async(prompt="x", aspect="16:9", seed=1)

    msg = str(exc_info.value)
    assert "missing.api.json" in msg
    # The fix is a HUMAN step (PROD-05): the message must spell it out.
    assert "python -m pipeline engine up" in msg
    assert "Save (API Format)" in msg
    assert "SETUP_PROVISIONING" in msg


async def test_workflow_missing_reserved_title_is_actionable(tmp_path):
    from backend.exceptions import ImageWorkflowError

    wf = _workflow()
    del wf["6"]  # drop PROMPT_POSITIVE
    provider = _provider(_write_workflow(tmp_path, wf), _comfy_transport({}))

    with pytest.raises(ImageWorkflowError, match="PROMPT_POSITIVE"):
        await provider.generate_async(prompt="x", aspect="16:9", seed=1)


async def test_server_down_raises_unavailable_with_instructions(tmp_path):
    from backend.exceptions import ImageProviderUnavailableError

    provider = _provider(_write_workflow(tmp_path), _down_transport())

    with pytest.raises(ImageProviderUnavailableError) as exc_info:
        await provider.generate_async(prompt="x", aspect="16:9", seed=1)

    msg = str(exc_info.value)
    assert "127.0.0.1:8188" in msg
    assert "engine up" in msg
    assert "VOXFORGE_IMAGE_PROVIDER=placeholder" in msg


async def test_rejected_graph_400_is_a_workflow_error(tmp_path):
    from backend.exceptions import ImageWorkflowError

    provider = _provider(
        _write_workflow(tmp_path), _comfy_transport({}, reject_graph=True),
    )

    with pytest.raises(ImageWorkflowError, match="invalid graph"):
        await provider.generate_async(prompt="x", aspect="16:9", seed=1)


async def test_timeout_when_history_never_completes(tmp_path):
    from backend.exceptions import ImageGenerationError

    provider = _provider(
        _write_workflow(tmp_path),
        _comfy_transport({}, completed=False),
        timeout_s=0.05,
    )

    with pytest.raises(ImageGenerationError, match="did not finish"):
        await provider.generate_async(prompt="x", aspect="16:9", seed=1)


async def test_history_execution_error_surfaces_the_reason(tmp_path):
    from backend.exceptions import ImageGenerationError

    provider = _provider(
        _write_workflow(tmp_path), _comfy_transport({}, execution_error=True),
    )

    with pytest.raises(ImageGenerationError, match="CUDA out of memory"):
        await provider.generate_async(prompt="x", aspect="16:9", seed=1)


# ── Health check ────────────────────────────────────────────────────


async def test_status_available_when_server_and_workflow_ok(tmp_path):
    provider = _provider(_write_workflow(tmp_path), _comfy_transport({}))

    status = await provider.status_async()

    assert status.available is True
    assert status.name == "comfyui"
    assert status.server_url == "http://127.0.0.1:8188"
    assert status.error is None


async def test_status_unavailable_when_server_down(tmp_path):
    provider = _provider(_write_workflow(tmp_path), _down_transport())

    status = await provider.status_async()

    assert status.available is False
    assert status.error is not None and "engine up" in status.error


async def test_status_reports_missing_workflow_before_touching_network(tmp_path):
    record: dict[str, Any] = {"calls": []}
    provider = _provider(tmp_path / "missing.api.json", _comfy_transport(record))

    status = await provider.status_async()

    assert status.available is False
    assert status.error is not None and "SETUP_PROVISIONING" in status.error
    assert record["calls"] == []  # workflow precondition checked first


def test_status_endpoint_placeholder_always_available(client):
    resp = client.get("/api/studio/image-provider/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "placeholder"
    assert body["available"] is True
    assert body["error"] is None


def test_status_endpoint_reports_comfyui_offline(client, tmp_path, monkeypatch):
    from backend.services import image_gen

    provider = _provider(_write_workflow(tmp_path), _down_transport())
    monkeypatch.setattr(image_gen, "_DEFAULT_PROVIDER", provider)

    resp = client.get("/api/studio/image-provider/status")

    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "comfyui"
    assert body["available"] is False
    assert "engine up" in body["error"]


# ── Factory + endpoint integration ──────────────────────────────────


def test_build_provider_branches_on_settings(monkeypatch):
    from backend.config import settings
    from backend.services import image_gen

    monkeypatch.setattr(settings, "image_provider", "comfyui")
    image_gen.reset_provider_cache()
    try:
        provider = image_gen.get_provider()
        assert isinstance(provider, image_gen.ComfyUIProvider)
        # Relative default resolves against base_dir (the module's export).
        expected = settings.base_dir / "img_generation_module/workflows/zimage_t2i_fp8.api.json"
        assert provider._workflow_path == expected  # noqa: SLF001
    finally:
        image_gen.reset_provider_cache()


def test_generate_image_endpoint_with_comfyui_provider(client, tmp_path, monkeypatch):
    from backend.services import image_gen

    record: dict[str, Any] = {}
    provider = _provider(_write_workflow(tmp_path), _comfy_transport(record))
    monkeypatch.setattr(image_gen, "_DEFAULT_PROVIDER", provider)

    resp = client.post(
        "/api/studio/generate-image",
        json={"prompt": "a stone tower above the mist", "aspect_ratio": "16:9", "seed": 7},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["provider"] == "comfyui"
    assert body["seed"] == 7
    # The PNG was saved under the Studio covers root (allowed root).
    saved = Path(body["path"])
    assert saved.read_bytes() == _PNG
    assert record["graph"]["6"]["inputs"]["text"] == "a stone tower above the mist"


def test_generate_image_endpoint_maps_unavailable_to_503(client, tmp_path, monkeypatch):
    from backend.services import image_gen

    provider = _provider(_write_workflow(tmp_path), _down_transport())
    monkeypatch.setattr(image_gen, "_DEFAULT_PROVIDER", provider)

    resp = client.post(
        "/api/studio/generate-image",
        json={"prompt": "x", "aspect_ratio": "16:9"},
    )

    assert resp.status_code == 503
    body = resp.json()
    assert body["code"] == "image_provider_unavailable"
    # The per-instance actionable message reaches the UI (the dialog's
    # toast shows ``detail``), not a flattened generic string.
    assert "engine up" in body["detail"]
