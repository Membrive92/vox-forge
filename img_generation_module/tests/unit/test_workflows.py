"""Tests de pipeline.workflows: parametrizacion pura sobre fixtures minimos.

Los fixtures replican la estructura real del formato API:
{id: {class_type, inputs, _meta: {title}}}. El de video tiene SEED en DOS
nodos (uno con `seed`, otro con `noise_seed`), como el grafo real.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from pipeline import workflows
from pipeline.errors import NodeMissingError, WorkflowParamError


@pytest.fixture()
def image_wf(image_wf_path: Path) -> dict:
    return workflows.load(image_wf_path)


@pytest.fixture()
def video_wf(video_wf_path: Path) -> dict:
    return workflows.load(video_wf_path)


# ------------------------------------------------------------------- load


def test_load_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(WorkflowParamError, match="not found"):
        workflows.load(tmp_path / "nope.api.json")


def test_load_non_object_json_raises(tmp_path: Path) -> None:
    path = tmp_path / "bad.api.json"
    path.write_text("[1, 2, 3]", encoding="utf-8")
    with pytest.raises(WorkflowParamError, match="not a JSON object"):
        workflows.load(path)


# ---------------------------------------------------------- find_by_title


def test_find_by_title_unique(image_wf: dict) -> None:
    assert workflows.find_by_title(image_wf, "PROMPT_POSITIVE") == "4"
    assert workflows.find_by_title(image_wf, "SAVE") == "9"


def test_find_by_title_missing(image_wf: dict) -> None:
    with pytest.raises(WorkflowParamError, match="NO_SUCH_TITLE"):
        workflows.find_by_title(image_wf, "NO_SUCH_TITLE")


def test_find_by_title_duplicated(video_wf: dict) -> None:
    # SEED esta en dos nodos en el grafo de video: find_by_title exige unicidad.
    with pytest.raises(WorkflowParamError, match="2 nodes"):
        workflows.find_by_title(video_wf, "SEED")


# ---------------------------------------------------------------- set_seed


def test_set_seed_single_node_seed_key(image_wf: dict) -> None:
    workflows.set_seed(image_wf, "SEED", 12345)
    assert image_wf["7"]["inputs"]["seed"] == 12345


def test_set_seed_multi_node_writes_both_keys(video_wf: dict) -> None:
    # Excepcion documentada a la unicidad: SEED x2, claves distintas por sampler.
    workflows.set_seed(video_wf, "SEED", 990103)
    assert video_wf["20"]["inputs"]["noise_seed"] == 990103
    assert video_wf["21"]["inputs"]["seed"] == 990103


def test_set_seed_missing_title(image_wf: dict) -> None:
    with pytest.raises(WorkflowParamError, match="SEED_X"):
        workflows.set_seed(image_wf, "SEED_X", 1)


def test_set_seed_node_without_seed_keys(image_wf: dict) -> None:
    # Nodo con titulo SEED pero sin `seed` ni `noise_seed` en inputs.
    del image_wf["7"]["inputs"]["seed"]
    with pytest.raises(WorkflowParamError, match="neither 'seed' nor 'noise_seed'"):
        workflows.set_seed(image_wf, "SEED", 1)


# ------------------------------------------------------------ otros setters


def test_set_text(image_wf: dict) -> None:
    workflows.set_text(image_wf, "PROMPT_POSITIVE", "a tower in the mist")
    assert image_wf["4"]["inputs"]["text"] == "a tower in the mist"


def test_set_image(video_wf: dict) -> None:
    workflows.set_image(video_wf, "INPUT_IMAGE", "e01_s03__deadbeef.png")
    assert video_wf["18"]["inputs"]["image"] == "e01_s03__deadbeef.png"


def test_set_size(video_wf: dict) -> None:
    workflows.set_size(video_wf, "SIZE", 832, 480)
    assert video_wf["19"]["inputs"]["width"] == 832
    assert video_wf["19"]["inputs"]["height"] == 480


def test_set_length(video_wf: dict) -> None:
    workflows.set_length(video_wf, "LENGTH", 33)
    assert video_wf["22"]["inputs"]["length"] == 33


# ------------------------------------------------------------- params_hash


def test_params_hash_stable_under_key_order() -> None:
    sha = "a" * 64
    h1 = workflows.params_hash({"prompt": "x", "seed": 7, "width": 832}, sha)
    h2 = workflows.params_hash({"width": 832, "seed": 7, "prompt": "x"}, sha)
    assert h1 == h2
    assert h1.startswith("sha256:")


def test_params_hash_sensitive_to_workflow_sha() -> None:
    spec = {"prompt": "x", "seed": 7}
    assert workflows.params_hash(spec, "a" * 64) != workflows.params_hash(spec, "b" * 64)


def test_params_hash_sensitive_to_params() -> None:
    sha = "a" * 64
    assert workflows.params_hash({"seed": 7}, sha) != workflows.params_hash({"seed": 8}, sha)


def test_params_hash_canonical_json_no_spaces() -> None:
    # El hash debe corresponder a json con claves ordenadas y sin espacios.
    sha = "c" * 64
    canonical = json.dumps({"a": 1, "b": "x"}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    expected = "sha256:" + hashlib.sha256((canonical + sha).encode("utf-8")).hexdigest()
    assert workflows.params_hash({"b": "x", "a": 1}, sha) == expected


# ------------------------------------------------------------ workflow_sha


def test_workflow_sha_matches_file_bytes(image_wf_path: Path) -> None:
    expected = hashlib.sha256(image_wf_path.read_bytes()).hexdigest()
    assert workflows.workflow_sha(image_wf_path) == expected


def test_workflow_sha_changes_with_content(tmp_path: Path) -> None:
    p1 = tmp_path / "a.json"
    p2 = tmp_path / "b.json"
    p1.write_text("{}", encoding="utf-8")
    p2.write_text("{ }", encoding="utf-8")
    assert workflows.workflow_sha(p1) != workflows.workflow_sha(p2)


# --------------------------------------------------------- assert_workflow


def _object_info_for(wf: dict) -> dict:
    return {node["class_type"]: {} for node in wf.values()}


def test_assert_workflow_ok(video_wf: dict) -> None:
    titles = {"PROMPT_POSITIVE", "PROMPT_NEGATIVE", "SEED", "SIZE", "LENGTH", "INPUT_IMAGE", "SAVE"}
    workflows.assert_workflow(video_wf, titles, _object_info_for(video_wf))


def test_assert_workflow_missing_title(image_wf: dict) -> None:
    with pytest.raises(WorkflowParamError, match="LENGTH"):
        workflows.assert_workflow(image_wf, {"LENGTH"}, _object_info_for(image_wf))


def test_assert_workflow_missing_node_class(video_wf: dict) -> None:
    info = _object_info_for(video_wf)
    del info["UnetLoaderGGUF"]
    with pytest.raises(NodeMissingError, match="UnetLoaderGGUF"):
        workflows.assert_workflow(video_wf, {"SEED"}, info)


# ----------------------------------------------------------- collect_models


def test_collect_models_video(video_wf: dict) -> None:
    models = workflows.collect_models(video_wf)
    assert models["diffusion"] == [
        "Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf",
        "Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf",
    ]
    assert models["loras"] == [
        "wan22_i2v_lightning4_high.safetensors",
        "wan22_i2v_lightning4_low.safetensors",
    ]
    assert models["text_encoder"] == "umt5_xxl_fp8_e4m3fn_scaled.safetensors"
    assert models["vae"] == "wan_2.1_vae.safetensors"


def test_collect_models_image(image_wf: dict) -> None:
    models = workflows.collect_models(image_wf)
    assert models["diffusion"] == ["z_image_turbo_bf16.safetensors"]
    assert models["loras"] == []
    assert models["text_encoder"] == "qwen_3_4b.safetensors"
    assert models["vae"] == "ae.safetensors"


def test_collect_models_reads_parametrized_values(video_wf: dict) -> None:
    # El sidecar lee del grafo real: si la GUI cambia un fichero, se refleja.
    video_wf["10"]["inputs"]["unet_name"] = "Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf"
    models = workflows.collect_models(video_wf)
    assert "Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf" in models["diffusion"]
