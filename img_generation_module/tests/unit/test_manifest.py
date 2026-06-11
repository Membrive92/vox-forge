"""Tests del manifest de episodio (SPEC_PIPELINE §4): validacion y resolucion."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pipeline import specs
from pipeline.config import MODULE_ROOT
from pipeline.errors import ManifestError
from pipeline.specs import deterministic_seed, load_manifest, scene_seed

VALID_MANIFEST: dict = {
    "schema": 1,
    "episode": "e01",
    "defaults": {
        "image_suffix": ", dense fog, cinematic",
        "motion_suffix": ", static camera",
    },
    "scenes": [
        {"id": "s01", "image_prompt": "wide shot of the tower", "motion_prompt": "fog rolling slowly"},
        {"id": "s02", "image_prompt": "rusted iron door", "motion_prompt": "camera push-in", "seed": 4471},
    ],
}


def _write_manifest(tmp_path: Path, data: dict) -> Path:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


# ----------------------------------------------------------------------- load


def test_load_valid_manifest(tmp_path: Path) -> None:
    manifest = load_manifest(_write_manifest(tmp_path, VALID_MANIFEST))
    assert manifest.episode == "e01"
    assert len(manifest.scenes) == 2
    assert manifest.scenes[0].id == "s01"
    assert manifest.scenes[0].seed is None
    assert manifest.scenes[1].seed == 4471


def test_load_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(ManifestError, match="not found"):
        load_manifest(tmp_path / "manifest.json")


def test_load_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    path.write_text("{broken", encoding="utf-8")
    with pytest.raises(ManifestError, match="Invalid JSON"):
        load_manifest(path)


def test_load_wrong_schema(tmp_path: Path) -> None:
    data = dict(VALID_MANIFEST, schema=2)
    with pytest.raises(ManifestError, match="schema"):
        load_manifest(_write_manifest(tmp_path, data))


def test_load_bad_episode_pattern(tmp_path: Path) -> None:
    data = dict(VALID_MANIFEST, episode="episode-1")
    with pytest.raises(ManifestError, match="episode"):
        load_manifest(_write_manifest(tmp_path, data))


def test_duplicate_scene_id_cites_scene(tmp_path: Path) -> None:
    data = dict(VALID_MANIFEST)
    data["scenes"] = [
        {"id": "s01", "image_prompt": "a", "motion_prompt": "b"},
        {"id": "s01", "image_prompt": "c", "motion_prompt": "d"},
    ]
    with pytest.raises(ManifestError, match="'s01'.*duplicate"):
        load_manifest(_write_manifest(tmp_path, data))


def test_bad_scene_id_pattern_cites_scene(tmp_path: Path) -> None:
    data = dict(VALID_MANIFEST)
    data["scenes"] = [{"id": "scene-1", "image_prompt": "a", "motion_prompt": "b"}]
    with pytest.raises(ManifestError, match="'scene-1'"):
        load_manifest(_write_manifest(tmp_path, data))


def test_empty_scenes_rejected(tmp_path: Path) -> None:
    data = dict(VALID_MANIFEST)
    data["scenes"] = []
    with pytest.raises(ManifestError, match="scenes"):
        load_manifest(_write_manifest(tmp_path, data))


def test_non_integer_seed_cites_scene(tmp_path: Path) -> None:
    data = dict(VALID_MANIFEST)
    data["scenes"] = [{"id": "s01", "image_prompt": "a", "motion_prompt": "b", "seed": "4471"}]
    with pytest.raises(ManifestError, match="'s01'.*seed"):
        load_manifest(_write_manifest(tmp_path, data))


# ----------------------------------------------------------- prompt resolution


def test_prompt_resolution_appends_suffix(tmp_path: Path) -> None:
    manifest = load_manifest(_write_manifest(tmp_path, VALID_MANIFEST))
    scene = manifest.scenes[0]
    assert scene.image_prompt + manifest.defaults.image_suffix == (
        "wide shot of the tower, dense fog, cinematic"
    )
    assert scene.motion_prompt + manifest.defaults.motion_suffix == ("fog rolling slowly, static camera")


def test_missing_defaults_means_empty_suffixes(tmp_path: Path) -> None:
    data = {key: value for key, value in VALID_MANIFEST.items() if key != "defaults"}
    manifest = load_manifest(_write_manifest(tmp_path, data))
    assert manifest.defaults.image_suffix == ""
    assert manifest.defaults.motion_suffix == ""


# ------------------------------------------------------------------------ seed


def test_deterministic_seed_stable_known_values() -> None:
    # Valores fijados: si cambian, cambia la reproducibilidad de todos los episodios.
    assert deterministic_seed("e01", "s01") == 2010026503
    assert deterministic_seed("e01", "s02") == 2750125582
    assert deterministic_seed("e01", "s03") == 3729864729


def test_deterministic_seed_differs_per_scene_and_episode() -> None:
    assert deterministic_seed("e01", "s01") != deterministic_seed("e01", "s02")
    assert deterministic_seed("e01", "s01") != deterministic_seed("e02", "s01")


def test_scene_seed_uses_deterministic_when_not_fixed(tmp_path: Path) -> None:
    manifest = load_manifest(_write_manifest(tmp_path, VALID_MANIFEST))
    assert scene_seed("e01", manifest.scenes[0]) == deterministic_seed("e01", "s01")


def test_scene_seed_fixed_override(tmp_path: Path) -> None:
    manifest = load_manifest(_write_manifest(tmp_path, VALID_MANIFEST))
    assert scene_seed("e01", manifest.scenes[1]) == 4471


def test_same_seed_for_image_and_video_of_a_scene(tmp_path: Path, pipeline_cfg) -> None:
    manifest = load_manifest(_write_manifest(tmp_path, VALID_MANIFEST))
    scene = manifest.scenes[0]
    image_spec = specs.build_image_spec(manifest, scene, pipeline_cfg)
    video_spec = specs.build_video_spec(manifest, scene, pipeline_cfg)
    assert image_spec.seed == video_spec.seed == deterministic_seed("e01", "s01")
    assert image_spec.asset_id == video_spec.asset_id == "e01_s01"


# ------------------------------------------------------------------ spec build


def test_build_image_spec_rejects_empty_prompt(tmp_path: Path, pipeline_cfg) -> None:
    from pipeline.errors import SpecError

    data = dict(VALID_MANIFEST)
    data["scenes"] = [{"id": "s01", "image_prompt": "  ", "motion_prompt": "b"}]
    manifest = load_manifest(_write_manifest(tmp_path, data))
    with pytest.raises(SpecError, match="'s01'.*image_prompt"):
        specs.build_image_spec(manifest, manifest.scenes[0], pipeline_cfg)


def test_build_video_spec_points_to_episode_still(tmp_path: Path, pipeline_cfg) -> None:
    manifest = load_manifest(_write_manifest(tmp_path, VALID_MANIFEST))
    spec = specs.build_video_spec(manifest, manifest.scenes[0], pipeline_cfg)
    assert spec.source_image == pipeline_cfg.paths.assets / "e01" / "images" / "e01_s01.png"
    assert (spec.width, spec.height, spec.frames) == (832, 480, 81)


# ------------------------------------------------------------- demo manifest


def test_demo_manifest_is_valid() -> None:
    # El artefacto versionado assets/e01/manifest.json debe cargar tal cual.
    manifest = load_manifest(MODULE_ROOT / "assets" / "e01" / "manifest.json")
    assert manifest.episode == "e01"
    assert len(manifest.scenes) == 3
    fixed = [scene for scene in manifest.scenes if scene.seed is not None]
    assert len(fixed) == 1  # exactamente una escena ejercita la seed fijada
    assert fixed[0].seed == 4471
