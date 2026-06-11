"""Tests de sidecar (SPEC_PIPELINE §3) e idempotencia (§5)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline import specs
from pipeline.errors import SidecarError
from pipeline.specs import (
    ImageSpec,
    VideoSpec,
    build_sidecar,
    read_sidecar,
    should_skip,
    validate_sidecar,
    write_sidecar,
)


def _image_sidecar(**overrides) -> dict:
    params = {
        "asset_id": "e01_s01",
        "kind": "image",
        "params_hash_value": "sha256:" + "a" * 64,
        "workflow_file": "workflows/zimage_t2i_fp8.api.json",
        "workflow_sha256": "b" * 64,
        "params": {"prompt": "x", "negative": "", "seed": 7, "width": 1248, "height": 720},
        "models": {"diffusion": ["z.safetensors"], "loras": [], "text_encoder": "q.safetensors", "vae": "ae"},
        "comfyui_pin": "abc123",
        "gpu": "RTX 4070 Super 12GB",
        "timings": {"queue_s": 0.4, "exec_s": 9.1},
    }
    params.update(overrides)
    return build_sidecar(**params)


def _video_sidecar(**overrides) -> dict:
    params = {
        "asset_id": "e01_s01",
        "kind": "video",
        "params_hash_value": "sha256:" + "a" * 64,
        "workflow_file": "workflows/wan22_i2v_q5.api.json",
        "workflow_sha256": "b" * 64,
        "params": {"prompt": "x", "negative": "", "seed": 7, "width": 832, "height": 480, "frames": 81},
        "models": {"diffusion": [], "loras": [], "text_encoder": "umt5", "vae": "wan"},
        "comfyui_pin": "abc123",
        "gpu": "RTX 4070 Super 12GB",
        "timings": {"queue_s": 0.4, "exec_s": 217.8},
        "source_image": "assets/e01/images/e01_s01.png",
    }
    params.update(overrides)
    return build_sidecar(**params)


# ------------------------------------------------------------ build + validate


def test_build_image_sidecar_schema(tmp_path: Path) -> None:
    data = _image_sidecar()
    assert data["schema"] == 1
    assert data["kind"] == "image"
    assert "source_image" not in data
    assert data["engine"] == {"comfyui_pin": "abc123", "gpu": "RTX 4070 Super 12GB"}
    validate_sidecar(data)  # no lanza


def test_build_video_sidecar_includes_source_image() -> None:
    data = _video_sidecar()
    assert data["kind"] == "video"
    assert data["source_image"] == "assets/e01/images/e01_s01.png"
    assert data["params"]["frames"] == 81


def test_build_sidecar_sets_created_at_timestamp() -> None:
    data = _image_sidecar()
    assert "T" in data["created_at"]  # ISO 8601


def test_validate_rejects_wrong_schema() -> None:
    data = _image_sidecar()
    data["schema"] = 99
    with pytest.raises(SidecarError, match="schema"):
        validate_sidecar(data)


def test_validate_rejects_bad_kind() -> None:
    data = _image_sidecar()
    data["kind"] = "audio"
    with pytest.raises(SidecarError, match="kind"):
        validate_sidecar(data)


def test_validate_rejects_params_hash_without_prefix() -> None:
    data = _image_sidecar()
    data["params_hash"] = "a" * 64
    with pytest.raises(SidecarError, match="params_hash"):
        validate_sidecar(data)


def test_video_sidecar_requires_source_image() -> None:
    data = _video_sidecar()
    del data["source_image"]
    with pytest.raises(SidecarError, match="source_image"):
        validate_sidecar(data)


def test_image_sidecar_must_not_carry_source_image() -> None:
    data = _image_sidecar()
    data["source_image"] = "assets/e01/images/e01_s01.png"
    with pytest.raises(SidecarError, match="source_image"):
        validate_sidecar(data)


def test_build_sidecar_rejects_invalid_combination() -> None:
    # build_sidecar valida lo que construye: kind imagen + source_image -> error.
    with pytest.raises(SidecarError):
        _image_sidecar(source_image="assets/e01/images/e01_s01.png")


def test_video_params_require_frames() -> None:
    with pytest.raises(SidecarError, match="frames"):
        _video_sidecar(params={"prompt": "x", "negative": "", "seed": 7, "width": 832, "height": 480})


# -------------------------------------------------------------- write + read


def test_sidecar_roundtrip(tmp_path: Path) -> None:
    path = tmp_path / "e01_s01.json"
    data = _video_sidecar()
    write_sidecar(path, data)
    assert read_sidecar(path) == data


def test_read_sidecar_missing_raises(tmp_path: Path) -> None:
    with pytest.raises(SidecarError, match="not found"):
        read_sidecar(tmp_path / "nope.json")


def test_read_sidecar_corrupt_json_raises(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text("{broken", encoding="utf-8")
    with pytest.raises(SidecarError, match="Invalid JSON"):
        read_sidecar(path)


# ------------------------------------------------------- params hash con still


def test_video_params_hash_includes_source_image_sha() -> None:
    spec = VideoSpec(
        asset_id="e01_s01", source_image=Path("x.png"), prompt="fog", seed=7
    )
    wf_sha = "c" * 64
    h1 = specs.video_params_hash(spec, wf_sha, "1" * 64)
    h2 = specs.video_params_hash(spec, wf_sha, "2" * 64)
    assert h1 != h2  # cambia el still -> cambia el hash -> se regenera el clip


def test_image_params_hash_stable_for_same_spec() -> None:
    spec_a = ImageSpec(asset_id="e01_s01", prompt="tower", seed=7)
    spec_b = ImageSpec(asset_id="e01_s01", prompt="tower", seed=7)
    wf_sha = "c" * 64
    assert specs.image_params_hash(spec_a, wf_sha) == specs.image_params_hash(spec_b, wf_sha)


# ------------------------------------------------------------- idempotencia §5


HASH = "sha256:" + "a" * 64


def _make_pair(tmp_path: Path, params_hash: str = HASH) -> tuple[Path, Path]:
    binary = tmp_path / "e01_s01.png"
    binary.write_bytes(b"png")
    sidecar = tmp_path / "e01_s01.json"
    write_sidecar(sidecar, _image_sidecar(params_hash_value=params_hash))
    return binary, sidecar


def test_should_skip_when_hash_matches(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    assert should_skip(binary, sidecar, HASH, force=False) is True


def test_force_bypasses_skip(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    assert should_skip(binary, sidecar, HASH, force=True) is False


def test_hash_mismatch_regenerates(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    assert should_skip(binary, sidecar, "sha256:" + "f" * 64, force=False) is False


def test_orphan_sidecar_regenerates(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    binary.unlink()  # sidecar huerfano: sin binario no hay skip
    assert should_skip(binary, sidecar, HASH, force=False) is False


def test_binary_without_sidecar_regenerates(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    sidecar.unlink()  # sin metadatos no hay reproducibilidad
    assert should_skip(binary, sidecar, HASH, force=False) is False


def test_corrupt_sidecar_regenerates(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    sidecar.write_text("{broken", encoding="utf-8")
    assert should_skip(binary, sidecar, HASH, force=False) is False


def test_invalid_schema_sidecar_regenerates(tmp_path: Path) -> None:
    binary, sidecar = _make_pair(tmp_path)
    data = json.loads(sidecar.read_text(encoding="utf-8"))
    data["schema"] = 99
    sidecar.write_text(json.dumps(data), encoding="utf-8")
    assert should_skip(binary, sidecar, HASH, force=False) is False
