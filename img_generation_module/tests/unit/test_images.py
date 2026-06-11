"""Tests de generate_image contra el FakeEngine y el fixture de workflow minimo."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.errors import NodeMissingError
from pipeline.images import generate_image
from pipeline.specs import ImageSpec, read_sidecar

from tests.conftest import FakeEngine


def _spec(**overrides) -> ImageSpec:
    params = {
        "asset_id": "e01_s01",
        "prompt": "wide shot of the tower, dense fog",
        "seed": 7,
        "width": 1248,
        "height": 720,
    }
    params.update(overrides)
    return ImageSpec(**params)


def test_happy_path_moves_png_and_writes_valid_sidecar(pipeline_cfg, fake_engine: FakeEngine) -> None:
    result = generate_image(_spec(), fake_engine, pipeline_cfg)

    assert result.skipped is False
    assert result.path == pipeline_cfg.paths.assets / "e01" / "images" / "e01_s01.png"
    assert result.path.is_file()
    assert result.timings == {"queue_s": 0.1, "exec_s": 1.5}

    # MOVE, no copia: output/ del workspace queda vacio (es un buzon).
    output_dir = pipeline_cfg.engine.workspace / "output"
    assert list(output_dir.iterdir()) == []

    # Sidecar valido contra el esquema (read_sidecar valida).
    sidecar = read_sidecar(result.sidecar)
    assert sidecar["asset_id"] == "e01_s01"
    assert sidecar["kind"] == "image"
    assert sidecar["params"]["seed"] == 7
    assert sidecar["params"]["prompt"] == "wide shot of the tower, dense fog"
    assert sidecar["workflow"]["file"] == "workflows/image_minimal.api.json"
    assert sidecar["engine"] == {"comfyui_pin": "testpin", "gpu": "Test GPU 12GB"}
    # models extraidos del grafo parametrizado, no de constantes.
    assert sidecar["models"]["diffusion"] == ["z_image_turbo_bf16.safetensors"]
    assert sidecar["models"]["text_encoder"] == "qwen_3_4b.safetensors"


def test_workflow_is_parametrized_by_titles(pipeline_cfg, fake_engine: FakeEngine) -> None:
    generate_image(_spec(seed=990103, width=512, height=512), fake_engine, pipeline_cfg)
    _, workflow = fake_engine.submitted[0]
    assert workflow["4"]["inputs"]["text"] == "wide shot of the tower, dense fog"
    assert workflow["7"]["inputs"]["seed"] == 990103
    assert workflow["6"]["inputs"]["width"] == 512
    assert workflow["6"]["inputs"]["height"] == 512


def test_empty_negative_respects_workflow_default(pipeline_cfg, fake_engine: FakeEngine) -> None:
    generate_image(_spec(negative=""), fake_engine, pipeline_cfg)
    _, workflow = fake_engine.submitted[0]
    assert workflow["5"]["inputs"]["text"] == "placeholder negative"  # intacto


def test_non_empty_negative_overrides_workflow(pipeline_cfg, fake_engine: FakeEngine) -> None:
    generate_image(_spec(negative="blurry, low quality"), fake_engine, pipeline_cfg)
    _, workflow = fake_engine.submitted[0]
    assert workflow["5"]["inputs"]["text"] == "blurry, low quality"


def test_rerun_skips_without_touching_engine(pipeline_cfg, fake_engine: FakeEngine) -> None:
    generate_image(_spec(), fake_engine, pipeline_cfg)
    result = generate_image(_spec(), fake_engine, pipeline_cfg)
    assert result.skipped is True
    assert len(fake_engine.submitted) == 1  # sin segundo submit


def test_force_regenerates(pipeline_cfg, fake_engine: FakeEngine) -> None:
    generate_image(_spec(), fake_engine, pipeline_cfg)
    result = generate_image(_spec(), fake_engine, pipeline_cfg, force=True)
    assert result.skipped is False
    assert len(fake_engine.submitted) == 2


def test_changed_seed_regenerates(pipeline_cfg, fake_engine: FakeEngine) -> None:
    generate_image(_spec(seed=7), fake_engine, pipeline_cfg)
    result = generate_image(_spec(seed=8), fake_engine, pipeline_cfg)
    assert result.skipped is False
    assert len(fake_engine.submitted) == 2


def test_assert_workflow_fails_fast_on_missing_node_class(pipeline_cfg, fake_engine: FakeEngine) -> None:
    # objeto_info sin un class_type del grafo -> NodeMissingError antes de submit.
    del fake_engine.object_info()["KSampler"]
    with pytest.raises(NodeMissingError, match="KSampler"):
        generate_image(_spec(), fake_engine, pipeline_cfg)
    assert fake_engine.submitted == []
