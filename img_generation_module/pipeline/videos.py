"""Animacion I2V de stills: animate_image(spec, engine, cfg) (SPEC_PIPELINE §2).

Mismo esqueleto que images.py mas: verificacion del still fuente ANTES de
tocar el motor, upload del still a <workspace>/input/, hash de idempotencia
que incluye el sha256 del still, sidecar con `source_image`, y limpieza del
fichero subido SIEMPRE (exito y fallo).
"""

from __future__ import annotations

import logging
import shutil

from . import specs, workflows
from .comfy_engine import ComfyEngine
from .config import Config
from .errors import JobFailed
from .job_runner import JobRunner, pick_main_output
from .specs import AssetResult, VideoSpec

logger = logging.getLogger("pipeline.videos")

_NO_TIMINGS: dict[str, float] = {"queue_s": 0.0, "exec_s": 0.0}


def animate_image(
    spec: VideoSpec,
    engine: ComfyEngine,
    cfg: Config,
    *,
    force: bool = False,
    runner: JobRunner | None = None,
) -> AssetResult:
    """Anima el still de una escena a un clip MP4; idempotente por params_hash (§5)."""
    # Fail-fast accionable antes de tocar el motor: sin still no hay clip.
    if not spec.source_image.is_file():
        raise JobFailed(
            f"Source still not found for {spec.asset_id}: {spec.source_image}. "
            f"Generate the stills first — ejecuta primero --phase images."
        )

    wf_path = cfg.video.workflow
    wf_sha = workflows.workflow_sha(wf_path)
    source_sha = specs.source_image_sha256(spec.source_image)
    phash = specs.video_params_hash(spec, wf_sha, source_sha)

    episode = specs.episode_of(spec.asset_id)
    binary = specs.clip_asset_path(cfg.paths.assets, episode, spec.asset_id)
    sidecar_path = binary.with_suffix(".json")

    if specs.should_skip(binary, sidecar_path, phash, force):
        logger.info("Skip %s: binary + sidecar exist and params_hash matches", spec.asset_id)
        return AssetResult(path=binary, sidecar=sidecar_path, timings=dict(_NO_TIMINGS), skipped=True)

    wf = workflows.load(wf_path)
    workflows.set_text(wf, "PROMPT_POSITIVE", spec.prompt)
    if spec.negative:
        workflows.set_text(wf, "PROMPT_NEGATIVE", spec.negative)
    workflows.set_seed(wf, "SEED", spec.seed)  # dos samplers en el grafo: escribe en ambos
    workflows.set_size(wf, "SIZE", spec.width, spec.height)
    workflows.set_length(wf, "LENGTH", spec.frames)
    workflows.assert_workflow(wf, workflows.VIDEO_REQUIRED_TITLES, engine.object_info())

    input_filename = engine.upload_input(spec.source_image)
    try:
        # Dentro del try: si set_image falla (p. ej. titulo INPUT_IMAGE
        # duplicado), el finally borra igualmente el still ya subido.
        workflows.set_image(wf, "INPUT_IMAGE", input_filename)
        job_runner = runner if runner is not None else JobRunner(engine, cfg.video.oom_max_retries)
        logger.info(
            "Animating %s (seed=%d, %dx%d, %d frames)",
            spec.asset_id, spec.seed, spec.width, spec.height, spec.frames,
        )
        result = job_runner.run(wf, float(cfg.video.timeout_s))

        outputs = engine.collect_outputs(result.prompt_id)
        if not outputs:
            raise JobFailed(f"Video job {result.prompt_id} for {spec.asset_id} produced no outputs")
        source = pick_main_output(outputs, ".mp4")

        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.unlink(missing_ok=True)
        shutil.move(str(source), str(binary))

        sidecar = specs.build_sidecar(
            asset_id=spec.asset_id,
            kind="video",
            params_hash_value=phash,
            workflow_file=specs.rel_to_root(wf_path, cfg.root),
            workflow_sha256=wf_sha,
            params=specs.video_params(spec),
            models=workflows.collect_models(wf),
            comfyui_pin=cfg.engine.comfyui_pin,
            gpu=cfg.engine.gpu,
            timings=result.timings,
            source_image=specs.rel_to_root(spec.source_image, cfg.root),
        )
        specs.write_sidecar(sidecar_path, sidecar)
        logger.info("Clip %s done in %.1fs -> %s", spec.asset_id, result.timings.get("exec_s", 0.0), binary)
        return AssetResult(path=binary, sidecar=sidecar_path, timings=result.timings, skipped=False)
    finally:
        # Limpieza SIEMPRE (exito y fallo): input/ no acumula stills temporales.
        uploaded = cfg.engine.workspace / "input" / input_filename
        uploaded.unlink(missing_ok=True)
