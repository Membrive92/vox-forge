"""Generacion de stills T2I: generate_image(spec, engine, cfg) (SPEC_PIPELINE §2).

Esqueleto comun de las funciones de generacion: idempotencia -> parametrizar
workflow -> submit/wait con politica OOM -> MOVER el output a assets/ ->
escribir sidecar. Mover, no copiar: vendor/ComfyUI/output/ no es un almacen,
es un buzon.
"""

from __future__ import annotations

import logging
import shutil

from . import specs, workflows
from .comfy_engine import ComfyEngine
from .config import Config
from .errors import JobFailed
from .job_runner import JobRunner, pick_main_output
from .specs import AssetResult, ImageSpec

logger = logging.getLogger("pipeline.images")

_NO_TIMINGS: dict[str, float] = {"queue_s": 0.0, "exec_s": 0.0}


def generate_image(
    spec: ImageSpec,
    engine: ComfyEngine,
    cfg: Config,
    *,
    force: bool = False,
    runner: JobRunner | None = None,
) -> AssetResult:
    """Genera el still de una escena; idempotente por params_hash (§5).

    `runner` permite al orchestrator compartir la politica de reintento (y su
    contador de restarts) entre todos los jobs del run; en uso directo se crea
    uno efimero con la escalada por defecto.
    """
    wf_path = cfg.image.workflow
    wf_sha = workflows.workflow_sha(wf_path)
    phash = specs.image_params_hash(spec, wf_sha)

    episode = specs.episode_of(spec.asset_id)
    binary = specs.image_asset_path(cfg.paths.assets, episode, spec.asset_id)
    sidecar_path = binary.with_suffix(".json")

    if specs.should_skip(binary, sidecar_path, phash, force):
        logger.info("Skip %s: binary + sidecar exist and params_hash matches", spec.asset_id)
        return AssetResult(path=binary, sidecar=sidecar_path, timings=dict(_NO_TIMINGS), skipped=True)

    # Parametrizacion por titulo (ADR-005): solo los campos permitidos.
    wf = workflows.load(wf_path)
    workflows.set_text(wf, "PROMPT_POSITIVE", spec.prompt)
    if spec.negative:
        # negative vacio = respetar el del workflow (SPEC_PIPELINE §1).
        workflows.set_text(wf, "PROMPT_NEGATIVE", spec.negative)
    workflows.set_seed(wf, "SEED", spec.seed)
    workflows.set_size(wf, "SIZE", spec.width, spec.height)
    workflows.assert_workflow(wf, workflows.IMAGE_REQUIRED_TITLES, engine.object_info())

    job_runner = runner if runner is not None else JobRunner(engine)
    logger.info("Generating image %s (seed=%d, %dx%d)", spec.asset_id, spec.seed, spec.width, spec.height)
    result = job_runner.run(wf, float(cfg.image.timeout_s))

    outputs = engine.collect_outputs(result.prompt_id)
    if not outputs:
        raise JobFailed(f"Image job {result.prompt_id} for {spec.asset_id} produced no outputs")
    source = pick_main_output(outputs, ".png")

    binary.parent.mkdir(parents=True, exist_ok=True)
    binary.unlink(missing_ok=True)
    shutil.move(str(source), str(binary))

    sidecar = specs.build_sidecar(
        asset_id=spec.asset_id,
        kind="image",
        params_hash_value=phash,
        workflow_file=specs.rel_to_root(wf_path, cfg.root),
        workflow_sha256=wf_sha,
        params=specs.image_params(spec),
        models=workflows.collect_models(wf),
        comfyui_pin=cfg.engine.comfyui_pin,
        gpu=cfg.engine.gpu,
        timings=result.timings,
    )
    specs.write_sidecar(sidecar_path, sidecar)
    logger.info("Image %s done in %.1fs -> %s", spec.asset_id, result.timings.get("exec_s", 0.0), binary)
    return AssetResult(path=binary, sidecar=sidecar_path, timings=result.timings, skipped=False)
