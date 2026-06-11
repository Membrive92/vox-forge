"""Excepciones tipadas del pipeline (SPEC_COMFY_ENGINE §6)."""

from __future__ import annotations

from typing import Any


class PipelineError(Exception):
    """Base comun de todas las excepciones del pipeline."""


class EngineStartError(PipelineError):
    """El subproceso ComfyUI no arranco o el puerto esta ocupado por un proceso ajeno."""


class NodeMissingError(PipelineError):
    """Un nodo requerido no aparece en /object_info (provision incompleta o pin roto)."""


class WorkflowParamError(PipelineError):
    """Error parametrizando el grafo: titulo ausente/duplicado o campo inexistente."""


class JobTimeout(PipelineError):
    """El job supero el timeout: indica cuelgue, no lentitud (los margenes son amplios)."""


class JobOOM(PipelineError):
    """Fallo de ejecucion clasificado como out-of-memory de GPU (reintetable segun politica)."""


class JobFailed(PipelineError):
    """Fallo de ejecucion no-OOM: un grafo determinista que falla volvera a fallar."""


class SpecError(PipelineError):
    """Spec de generacion invalida: dimensiones, frames, prompt vacio o asset_id mal formado."""


class ManifestError(PipelineError):
    """Manifest de episodio ausente o invalido; el mensaje cita la escena ofensiva."""


class SidecarError(PipelineError):
    """Sidecar con esquema invalido (SPEC_PIPELINE seccion 3)."""


def classify_execution_error(payload: dict[str, Any]) -> JobOOM | JobFailed:
    """Clasifica el `data` de un mensaje `execution_error` de ComfyUI.

    Si `exception_message` o `exception_type` contiene "OutOfMemory" o
    "allocation on device" (sin distinguir mayusculas) -> JobOOM; resto -> JobFailed.
    El payload completo se conserva en el mensaje de la excepcion para el log.
    """
    message = str(payload.get("exception_message", ""))
    exc_type = str(payload.get("exception_type", ""))
    haystack = f"{exc_type} {message}".lower()
    if "outofmemory" in haystack or "allocation on device" in haystack:
        return JobOOM(f"GPU out of memory during execution: {payload}")
    return JobFailed(f"Execution failed: {payload}")
