"""Smoke tests de integracion (SPEC_PIPELINE §10): requieren GPU + ComfyUI provisionado.

Excluidos del run normal (pytest.ini: -m "not gpu"). Ejecucion manual:

    python -m pytest -m gpu

Usan el episodio sintetico e99 para no pisar los assets reales. Los binarios
generados quedan en assets/e99/ (gitignored) como evidencia inspeccionable.
"""

from __future__ import annotations

import pytest

from pipeline.comfy_engine import ComfyEngine
from pipeline.config import Config, load_config
from pipeline.images import generate_image
from pipeline.specs import ImageSpec, VideoSpec, read_sidecar
from pipeline.videos import animate_image

pytestmark = pytest.mark.gpu


@pytest.fixture(scope="module")
def cfg() -> Config:
    return load_config()


@pytest.fixture(scope="module")
def engine(cfg: Config):
    eng = ComfyEngine(cfg.engine)
    eng.start()
    yield eng
    eng.stop()


def test_smoke_image_512_fixed_seed_and_rerun_skips(cfg: Config, engine: ComfyEngine) -> None:
    spec = ImageSpec(
        asset_id="e99_s01",
        prompt="abandoned stone tower in dense fog, cold blue hour, cinematic",
        seed=123,
        width=512,
        height=512,
    )

    result = generate_image(spec, engine, cfg, force=True)
    assert result.skipped is False
    assert result.path.is_file() and result.path.suffix == ".png"
    assert result.path.stat().st_size > 0

    sidecar = read_sidecar(result.sidecar)  # valida el esquema al leer
    assert sidecar["kind"] == "image"
    assert sidecar["params"]["seed"] == 123
    assert sidecar["models"]["diffusion"]  # extraido del workflow real
    assert sidecar["timings"]["exec_s"] > 0

    rerun = generate_image(spec, engine, cfg)
    assert rerun.skipped is True  # re-run inmediato: idempotencia por params_hash


def test_smoke_video_33_frames_with_source_image(cfg: Config, engine: ComfyEngine) -> None:
    # Still nativo del clip (misma AR que 832x480) generado aqui mismo.
    still = generate_image(
        ImageSpec(
            asset_id="e99_s02",
            prompt="rusted iron door at the tower base, dense fog, cinematic",
            seed=123,
            width=832,
            height=480,
        ),
        engine,
        cfg,
    )

    spec = VideoSpec(
        asset_id="e99_s02",
        source_image=still.path,
        prompt="slow fog drifting around the tower, static camera, subtle wind",
        seed=123,
        width=832,
        height=480,
        frames=33,  # corto para el smoke (SETUP_PROVISIONING seccion 6)
    )
    result = animate_image(spec, engine, cfg, force=True)
    assert result.skipped is False
    assert result.path.is_file() and result.path.suffix == ".mp4"
    assert result.path.stat().st_size > 0

    sidecar = read_sidecar(result.sidecar)
    assert sidecar["kind"] == "video"
    assert sidecar["source_image"].endswith("e99_s02.png")
    assert sidecar["params"]["frames"] == 33

    # input/ del workspace queda limpio tras el job.
    leftovers = [p for p in (cfg.engine.workspace / "input").glob("e99_s02__*") if p.is_file()]
    assert leftovers == []
