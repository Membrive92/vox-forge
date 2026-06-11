"""Tests de los specs de generacion (SPEC_PIPELINE §1): validaciones de invariantes."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.errors import SpecError
from pipeline.specs import AssetResult, ImageSpec, VideoSpec, episode_of


def _image(**overrides) -> ImageSpec:
    params = {"asset_id": "e01_s03", "prompt": "a tower in the mist", "seed": 7}
    params.update(overrides)
    return ImageSpec(**params)


def _video(**overrides) -> VideoSpec:
    params = {
        "asset_id": "e01_s03",
        "source_image": Path("assets/e01/images/e01_s03.png"),
        "prompt": "slow fog drifting",
        "seed": 7,
    }
    params.update(overrides)
    return VideoSpec(**params)


# ------------------------------------------------------------------ ImageSpec


def test_image_spec_valid_defaults() -> None:
    spec = _image()
    assert (spec.width, spec.height) == (1248, 720)
    assert spec.negative == ""


def test_image_spec_accepts_variant_suffix() -> None:
    assert _image(asset_id="e01_s03_alt2").asset_id == "e01_s03_alt2"


@pytest.mark.parametrize(
    "asset_id",
    ["e1_s03", "e01_s3", "e01s03", "s03_e01", "e01_s03_ALT", "e01_s03_", "x01_s03", "e01_s03 "],
)
def test_image_spec_rejects_bad_asset_id(asset_id: str) -> None:
    with pytest.raises(SpecError, match="asset_id"):
        _image(asset_id=asset_id)


@pytest.mark.parametrize("prompt", ["", "   ", "\n\t"])
def test_image_spec_rejects_empty_prompt(prompt: str) -> None:
    with pytest.raises(SpecError, match="prompt"):
        _image(prompt=prompt)


def test_image_spec_rejects_width_not_multiple_of_16() -> None:
    with pytest.raises(SpecError, match="width"):
        _image(width=1250)


def test_image_spec_rejects_height_not_multiple_of_16() -> None:
    with pytest.raises(SpecError, match="height"):
        _image(height=721)


def test_image_spec_is_frozen() -> None:
    spec = _image()
    with pytest.raises(AttributeError):
        spec.seed = 99  # type: ignore[misc]


# ------------------------------------------------------------------ VideoSpec


def test_video_spec_valid_defaults() -> None:
    spec = _video()
    assert (spec.width, spec.height, spec.frames) == (832, 480, 81)


@pytest.mark.parametrize("frames", [17, 81, 121])
def test_video_spec_accepts_frames_in_range(frames: int) -> None:
    assert _video(frames=frames).frames == frames


@pytest.mark.parametrize("frames", [16, 0, 122, -1])
def test_video_spec_rejects_frames_out_of_range(frames: int) -> None:
    with pytest.raises(SpecError, match="frames"):
        _video(frames=frames)


def test_video_spec_rejects_bad_size() -> None:
    with pytest.raises(SpecError, match="width"):
        _video(width=831)


# ----------------------------------------------------------------- AssetResult


def test_asset_result_defaults_not_skipped(tmp_path: Path) -> None:
    result = AssetResult(
        path=tmp_path / "a.png", sidecar=tmp_path / "a.json", timings={"queue_s": 0.1, "exec_s": 2.0}
    )
    assert result.skipped is False


# ------------------------------------------------------------------ episode_of


def test_episode_of_extracts_episode() -> None:
    assert episode_of("e01_s03") == "e01"
    assert episode_of("e102_s07_alt") == "e102"


def test_episode_of_rejects_invalid_asset_id() -> None:
    with pytest.raises(SpecError):
        episode_of("not-an-asset")
