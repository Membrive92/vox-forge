"""Politica de reintento OOM compartida por images.py y videos.py (SPEC_COMFY_ENGINE §6).

Escalada fija:

    intento 1 --JobOOM--> engine.free_vram() --> intento 2 --JobOOM-->
    engine.restart() --> intento 3 --JobOOM/error--> FAILED definitivo

`JobFailed` (no-OOM) nunca se reintenta: un grafo determinista que falla sin
OOM volvera a fallar. `JobTimeout` -> interrupt() + fail (un timeout indica
cuelgue, no lentitud). El runner mantiene el contador de reinicios del run
para que el orchestrator pueda abortar el episodio tras dos restarts
(SPEC_PIPELINE §6): el entorno esta roto, seguir es ruido.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .comfy_engine import ComfyEngine
from .errors import JobOOM, JobTimeout

logger = logging.getLogger("pipeline.jobs")


@dataclass(frozen=True)
class JobResult:
    """Resultado de un submit/wait completado."""

    prompt_id: str
    history: dict[str, Any]
    timings: dict[str, float]  # {"queue_s": float, "exec_s": float}


def pick_main_output(outputs: list[Path], preferred_suffix: str) -> Path:
    """Output principal del job: el primero con la extension esperada, o el primero.

    En nuestros grafos hay exactamente un nodo de guardado (titulo SAVE), asi
    que normalmente la lista tiene un unico elemento.
    """
    for path in outputs:
        if path.suffix.lower() == preferred_suffix:
            return path
    return outputs[0]


class JobRunner:
    """Ejecuta submit/wait con la escalada OOM; cuenta los restarts del run.

    Un runner por run del orchestrator: `restart_count` es el contador que la
    politica incrementa y el orchestrator observa para abortar el episodio.
    """

    def __init__(self, engine: ComfyEngine, oom_max_retries: int = 2) -> None:
        # La escalada documentada tiene exactamente dos peldanos
        # (free_vram -> restart); el valor de config se acota a ese rango.
        self.engine = engine
        self.oom_max_retries = max(0, min(oom_max_retries, 2))
        self.restart_count = 0

    def run(self, workflow: dict[str, Any], timeout_s: float) -> JobResult:
        """Un job completo con la politica de reintento OOM de SPEC_COMFY_ENGINE §6."""
        recoveries = (self._recover_free_vram, self._recover_restart)[: self.oom_max_retries]
        attempt = 0
        while True:
            try:
                return self._attempt(workflow, timeout_s)
            except JobOOM:
                if attempt >= len(recoveries):
                    logger.error("Job still OOM after %d attempt(s); giving up", attempt + 1)
                    raise
                recoveries[attempt]()
                attempt += 1

    def _attempt(self, workflow: dict[str, Any], timeout_s: float) -> JobResult:
        prompt_id = self.engine.submit(workflow)
        try:
            entry = self.engine.wait(prompt_id, timeout_s)
        except JobTimeout:
            logger.error("Job %s timed out after %.0fs; interrupting", prompt_id, timeout_s)
            try:
                self.engine.interrupt()
            except Exception as exc:
                logger.warning("Interrupt after timeout failed: %s", exc)
            raise
        timings = entry.get("timings", {"queue_s": 0.0, "exec_s": 0.0})
        return JobResult(prompt_id=prompt_id, history=entry, timings=timings)

    def _recover_free_vram(self) -> None:
        logger.warning("Job hit GPU OOM; freeing VRAM and retrying")
        self.engine.free_vram()

    def _recover_restart(self) -> None:
        logger.warning("Job hit GPU OOM again; restarting the engine and retrying")
        self.engine.restart()
        self.restart_count += 1
