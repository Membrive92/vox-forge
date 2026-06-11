"""Orquestacion por episodio (SPEC_PIPELINE §6): fases, idempotencia, resumen.

Estrictamente serial (ADR-006): un job de GPU a la vez, fase `images` completa
antes de `videos`. Un FAILED individual no aborta el episodio; EngineStartError
o dos restart() del motor en el mismo run si lo abortan (el entorno esta roto,
seguir es ruido). El orchestrator es dueno del ciclo de vida del motor:
start() al inicio del run, stop() en finally.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal

from . import specs
from .comfy_engine import ComfyEngine
from .config import Config, EngineConfig
from .errors import EngineStartError, JobOOM, ManifestError, PipelineError
from .images import generate_image
from .job_runner import JobRunner
from .specs import Manifest, Scene
from .videos import animate_image

logger = logging.getLogger("pipeline.orchestrator")

Phase = Literal["images", "videos", "all"]
Kind = Literal["image", "video"]

# Dos reinicios del motor en un mismo run -> abortar el episodio (SPEC_PIPELINE §6).
MAX_ENGINE_RESTARTS_PER_RUN = 2


@dataclass(frozen=True)
class SceneOutcome:
    """Fila del resumen: estado final de un job (escena, modalidad)."""

    scene_id: str
    kind: Kind
    status: str  # DONE | SKIPPED | FAILED | FAILED_OOM
    duration_s: float
    path: Path | None
    message: str = ""


@dataclass(frozen=True)
class Summary:
    """Resultado agregado de run_episode; exit code 0 solo si no hay FAILED."""

    episode: str
    outcomes: tuple[SceneOutcome, ...]
    aborted: bool = False
    abort_reason: str = ""

    @property
    def has_failures(self) -> bool:
        return self.aborted or any(outcome.status.startswith("FAILED") for outcome in self.outcomes)

    @property
    def exit_code(self) -> int:
        return 1 if self.has_failures else 0


def run_episode(
    episode: str,
    phase: Phase,
    only: set[str] | None,
    force: bool,
    cfg: Config,
    *,
    engine_factory: Callable[[EngineConfig], ComfyEngine] | None = None,
) -> Summary:
    """Ejecuta las fases pedidas sobre las escenas del manifest del episodio.

    `engine_factory` existe para inyectar un motor falso en tests; en
    produccion siempre es ComfyEngine.
    """
    manifest_path = cfg.paths.assets / episode / "manifest.json"
    manifest = specs.load_manifest(manifest_path)
    if manifest.episode != episode:
        raise ManifestError(
            f"Manifest {manifest_path} declares episode '{manifest.episode}' but '{episode}' was requested"
        )

    scenes = _select_scenes(manifest, only, manifest_path)

    # Plan de jobs en orden estricto: todas las imagenes, despues todos los
    # clips (agrupar por modalidad evita recargar modelos: ADR-006).
    jobs: list[tuple[Kind, Scene]] = []
    if phase in ("images", "all"):
        jobs.extend(("image", scene) for scene in scenes)
    if phase in ("videos", "all"):
        jobs.extend(("video", scene) for scene in scenes)

    factory = engine_factory if engine_factory is not None else ComfyEngine
    engine = factory(cfg.engine)
    runner = JobRunner(engine, cfg.video.oom_max_retries)
    outcomes: list[SceneOutcome] = []

    try:
        engine.start()
    except EngineStartError as exc:
        logger.error("Engine failed to start; aborting episode %s: %s", episode, exc)
        return Summary(episode=episode, outcomes=(), aborted=True, abort_reason=str(exc))

    aborted = False
    abort_reason = ""
    try:
        for index, (kind, scene) in enumerate(jobs):
            try:
                outcome = _run_scene(kind, scene, manifest, engine, cfg, runner, force)
            except EngineStartError as exc:
                # El motor no volvio tras un restart: abortar todo.
                aborted, abort_reason = True, f"engine did not come back after a restart: {exc}"
                outcomes.append(
                    SceneOutcome(scene.id, kind, "FAILED", 0.0, None, abort_reason)
                )
                outcomes.extend(_not_run(jobs[index + 1:], abort_reason))
                break
            outcomes.append(outcome)
            if runner.restart_count >= MAX_ENGINE_RESTARTS_PER_RUN:
                aborted = True
                abort_reason = (
                    f"engine was restarted {runner.restart_count} times in this run; "
                    f"the environment is broken — aborting the episode"
                )
                logger.error("%s", abort_reason)
                outcomes.extend(_not_run(jobs[index + 1:], abort_reason))
                break
    finally:
        engine.stop()

    return Summary(episode=episode, outcomes=tuple(outcomes), aborted=aborted, abort_reason=abort_reason)


def _select_scenes(manifest: Manifest, only: set[str] | None, manifest_path: Path) -> list[Scene]:
    """Filtra las escenas por --only; error claro si se pide una que no existe."""
    if only is None:
        return list(manifest.scenes)
    known = {scene.id for scene in manifest.scenes}
    unknown = sorted(only - known)
    if unknown:
        raise ManifestError(
            f"--only references unknown scene ids: {', '.join(unknown)} "
            f"(manifest {manifest_path} defines: {', '.join(sorted(known))})"
        )
    return [scene for scene in manifest.scenes if scene.id in only]


def _run_scene(
    kind: Kind,
    scene: Scene,
    manifest: Manifest,
    engine: ComfyEngine,
    cfg: Config,
    runner: JobRunner,
    force: bool,
) -> SceneOutcome:
    """Un job; los fallos por escena se reportan, no abortan el episodio."""
    start = time.monotonic()
    try:
        if kind == "image":
            spec = specs.build_image_spec(manifest, scene, cfg)
            result = generate_image(spec, engine, cfg, force=force, runner=runner)
        else:
            spec = specs.build_video_spec(manifest, scene, cfg)
            result = animate_image(spec, engine, cfg, force=force, runner=runner)
    except EngineStartError:
        raise  # entorno roto: lo gestiona run_episode (abortar todo)
    except JobOOM as exc:
        duration = round(time.monotonic() - start, 3)
        logger.error("Scene %s (%s) failed with OOM after retries: %s", scene.id, kind, exc)
        return SceneOutcome(scene.id, kind, "FAILED_OOM", duration, None, str(exc))
    except PipelineError as exc:
        duration = round(time.monotonic() - start, 3)
        logger.error("Scene %s (%s) failed: %s", scene.id, kind, exc)
        return SceneOutcome(scene.id, kind, "FAILED", duration, None, str(exc))
    duration = round(time.monotonic() - start, 3)
    status = "SKIPPED" if result.skipped else "DONE"
    return SceneOutcome(scene.id, kind, status, duration, result.path)


def _not_run(remaining: list[tuple[Kind, Scene]], reason: str) -> list[SceneOutcome]:
    """Marca como FAILED los jobs que no llegaron a ejecutarse por el aborto."""
    return [
        SceneOutcome(scene.id, kind, "FAILED", 0.0, None, f"not run — {reason}")
        for kind, scene in remaining
    ]


def format_summary(summary: Summary) -> str:
    """Tabla por escena (estado, duracion, ruta) + linea de totales."""
    headers = ("scene", "kind", "status", "duration", "path")
    rows = [
        (
            outcome.scene_id,
            outcome.kind,
            outcome.status,
            f"{outcome.duration_s:.1f}s",
            str(outcome.path) if outcome.path is not None else (outcome.message or "-"),
        )
        for outcome in summary.outcomes
    ]
    widths = [
        max(len(header), *(len(row[column]) for row in rows)) if rows else len(header)
        for column, header in enumerate(headers)
    ]
    lines = [
        "  ".join(header.ljust(widths[column]) for column, header in enumerate(headers)),
        "  ".join("-" * widths[column] for column in range(len(headers))),
    ]
    lines.extend("  ".join(row[column].ljust(widths[column]) for column in range(len(headers))) for row in rows)

    done = sum(1 for outcome in summary.outcomes if outcome.status == "DONE")
    skipped = sum(1 for outcome in summary.outcomes if outcome.status == "SKIPPED")
    failed = sum(1 for outcome in summary.outcomes if outcome.status.startswith("FAILED"))
    lines.append("")
    lines.append(f"episode {summary.episode}: {done} done, {skipped} skipped, {failed} failed")
    if summary.aborted:
        lines.append(f"ABORTED: {summary.abort_reason}")
    return "\n".join(lines)
