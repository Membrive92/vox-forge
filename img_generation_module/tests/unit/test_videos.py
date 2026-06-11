"""Tests de animate_image: upload del still, limpieza de input/ y sidecar con source_image."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline.errors import JobFailed, WorkflowParamError
from pipeline.specs import VideoSpec, read_sidecar
from pipeline.videos import animate_image

from tests.conftest import FakeEngine


@pytest.fixture()
def still(pipeline_cfg) -> Path:
    path = pipeline_cfg.paths.assets / "e01" / "images" / "e01_s01.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"fake still bytes")
    return path


def _spec(still: Path, **overrides) -> VideoSpec:
    params = {
        "asset_id": "e01_s01",
        "source_image": still,
        "prompt": "fog rolling slowly, static camera",
        "seed": 7,
        "width": 832,
        "height": 480,
        "frames": 81,
    }
    params.update(overrides)
    return VideoSpec(**params)


def _input_dir(pipeline_cfg) -> Path:
    return pipeline_cfg.engine.workspace / "input"


def test_happy_path_moves_mp4_and_writes_sidecar(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    result = animate_image(_spec(still), fake_engine, pipeline_cfg)

    assert result.skipped is False
    assert result.path == pipeline_cfg.paths.assets / "e01" / "clips" / "e01_s01.mp4"
    assert result.path.is_file()
    assert list((pipeline_cfg.engine.workspace / "output").iterdir()) == []  # MOVE

    sidecar = read_sidecar(result.sidecar)
    assert sidecar["kind"] == "video"
    assert sidecar["source_image"] == "assets/e01/images/e01_s01.png"
    assert sidecar["params"]["frames"] == 81
    assert sidecar["workflow"]["file"] == "workflows/video_minimal.api.json"
    assert sidecar["models"]["diffusion"] == [
        "Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf",
        "Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf",
    ]


def test_workflow_gets_input_image_seed_and_length(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    animate_image(_spec(still, seed=990103, frames=33), fake_engine, pipeline_cfg)
    _, workflow = fake_engine.submitted[0]
    assert len(fake_engine.uploads) == 1
    uploaded = fake_engine.uploads[0]
    assert workflow["18"]["inputs"]["image"] == uploaded
    # SEED se escribe en AMBOS samplers (noise_seed y seed).
    assert workflow["20"]["inputs"]["noise_seed"] == 990103
    assert workflow["21"]["inputs"]["seed"] == 990103
    assert workflow["22"]["inputs"]["length"] == 33
    assert workflow["16"]["inputs"]["text"] == "fog rolling slowly, static camera"


def test_input_is_cleaned_on_success(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    animate_image(_spec(still), fake_engine, pipeline_cfg)
    assert list(_input_dir(pipeline_cfg).iterdir()) == []


def test_input_is_cleaned_on_failure(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    fake_engine.wait_script = [JobFailed("boom")]
    with pytest.raises(JobFailed, match="boom"):
        animate_image(_spec(still), fake_engine, pipeline_cfg)
    assert len(fake_engine.uploads) == 1  # se llego a subir
    assert list(_input_dir(pipeline_cfg).iterdir()) == []  # y se limpio igualmente


def test_input_is_cleaned_when_set_image_fails(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    """Titulo INPUT_IMAGE duplicado: assert_workflow (solo presencia) lo acepta,
    set_image (unicidad) lanza DESPUES del upload; el still subido se limpia igual."""
    wf_path = pipeline_cfg.video.workflow
    wf = json.loads(wf_path.read_text(encoding="utf-8"))
    wf["99"] = {"class_type": "LoadImage", "inputs": {"image": "dup.png"}, "_meta": {"title": "INPUT_IMAGE"}}
    wf_path.write_text(json.dumps(wf), encoding="utf-8")

    with pytest.raises(WorkflowParamError, match="INPUT_IMAGE"):
        animate_image(_spec(still), fake_engine, pipeline_cfg)

    assert len(fake_engine.uploads) == 1  # el still llego a subirse
    assert list(_input_dir(pipeline_cfg).iterdir()) == []  # y se limpio igualmente
    assert fake_engine.submitted == []  # el job nunca llego a encolarse


def test_missing_still_fails_before_touching_engine(pipeline_cfg, fake_engine: FakeEngine) -> None:
    ghost = pipeline_cfg.paths.assets / "e01" / "images" / "e01_s09.png"
    spec = _spec(ghost, asset_id="e01_s09")
    with pytest.raises(JobFailed, match="ejecuta primero --phase images"):
        animate_image(spec, fake_engine, pipeline_cfg)
    assert fake_engine.submitted == []
    assert fake_engine.uploads == []


def test_rerun_skips_without_upload(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    animate_image(_spec(still), fake_engine, pipeline_cfg)
    result = animate_image(_spec(still), fake_engine, pipeline_cfg)
    assert result.skipped is True
    assert len(fake_engine.uploads) == 1  # la idempotencia decide ANTES de subir nada


def test_changed_still_bytes_regenerate_clip(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    animate_image(_spec(still), fake_engine, pipeline_cfg)
    still.write_bytes(b"retouched still bytes")  # mismo path, contenido distinto
    result = animate_image(_spec(still), fake_engine, pipeline_cfg)
    assert result.skipped is False  # el hash incluye el sha256 del still
    assert len(fake_engine.submitted) == 2


def test_force_regenerates_clip(pipeline_cfg, fake_engine: FakeEngine, still: Path) -> None:
    animate_image(_spec(still), fake_engine, pipeline_cfg)
    result = animate_image(_spec(still), fake_engine, pipeline_cfg, force=True)
    assert result.skipped is False
    assert len(fake_engine.submitted) == 2
