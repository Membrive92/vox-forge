"""Parametrizacion de workflows JSON (formato API) por titulo de nodo.

Funciones puras sobre dict (SPEC_COMFY_ENGINE §7, ADR-005): sin red, sin GPU.
Estructura del JSON API: {node_id: {"class_type": str, "inputs": {...},
"_meta": {"title": str}}}. El codigo localiza nodos por `_meta.title` (los IDs
numericos cambian entre re-exportaciones de la GUI) y solo escribe los campos
permitidos por la convencion de titulos reservados.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .errors import NodeMissingError, WorkflowParamError

# Titulos reservados por grafo (SPEC_COMFY_ENGINE seccion 7): unica fuente de
# verdad para cli.py, images.py y videos.py.
IMAGE_REQUIRED_TITLES: frozenset[str] = frozenset({"PROMPT_POSITIVE", "PROMPT_NEGATIVE", "SEED", "SIZE", "SAVE"})
VIDEO_REQUIRED_TITLES: frozenset[str] = IMAGE_REQUIRED_TITLES | {"LENGTH", "INPUT_IMAGE"}

# Claves de loaders cuyos valores van al bloque "models" del sidecar.
# Se leen del grafo parametrizado, nunca de constantes (SPEC_PIPELINE §3).
_LOADER_FIELDS: dict[str, tuple[str, ...]] = {
    # class_type (o sufijo) -> claves de inputs que nombran ficheros de modelo
    "diffusion": ("unet_name", "model_name"),
    "loras": ("lora_name",),
    "text_encoder": ("clip_name", "clip_name1", "clip_name2", "text_encoder_name"),
    "vae": ("vae_name",),
}

_DIFFUSION_LOADERS = ("UnetLoaderGGUF", "UNETLoader", "CheckpointLoaderSimple", "DiffusionModelLoader")
_LORA_LOADERS = ("LoraLoader", "LoraLoaderModelOnly")
_CLIP_LOADERS = ("CLIPLoaderGGUF", "CLIPLoader", "DualCLIPLoader", "TripleCLIPLoader")
_VAE_LOADERS = ("VAELoader",)


def load(path: Path) -> dict[str, Any]:
    """Carga un workflow JSON en formato API."""
    if not path.is_file():
        raise WorkflowParamError(f"Workflow file not found: {path}")
    with path.open("rb") as fh:
        wf = json.load(fh)
    if not isinstance(wf, dict):
        raise WorkflowParamError(f"Workflow {path} is not a JSON object (API format expected)")
    return wf


def workflow_sha(path: Path) -> str:
    """SHA-256 hex del fichero de workflow tal cual esta en disco."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _nodes_by_title(wf: dict[str, Any], title: str) -> list[str]:
    """IDs de todos los nodos cuyo `_meta.title` coincide exactamente."""
    return [
        node_id
        for node_id, node in wf.items()
        if isinstance(node, dict) and node.get("_meta", {}).get("title") == title
    ]


def find_by_title(wf: dict[str, Any], title: str) -> str:
    """ID del unico nodo con ese titulo; error si hay 0 o mas de 1."""
    matches = _nodes_by_title(wf, title)
    if not matches:
        raise WorkflowParamError(f"No node with title '{title}' found in workflow")
    if len(matches) > 1:
        raise WorkflowParamError(
            f"Title '{title}' matches {len(matches)} nodes ({', '.join(sorted(matches))}); titles must be unique"
        )
    return matches[0]


def set_text(wf: dict[str, Any], title: str, text: str) -> None:
    """Escribe inputs["text"] del nodo con ese titulo."""
    node_id = find_by_title(wf, title)
    wf[node_id]["inputs"]["text"] = text


def set_seed(wf: dict[str, Any], title: str, seed: int) -> None:
    """Escribe la seed en todos los nodos con ese titulo.

    Segun el sampler, el campo se llama `seed` (KSampler) o `noise_seed`
    (KSamplerAdvanced y variantes): se escribe en la clave que YA exista en
    `inputs`. El grafo de video tiene dos samplers (uno por experto) con el
    mismo titulo SEED: excepcion documentada a la regla de unicidad, por eso
    aqui se aceptan multiples nodos y se escribe en todos.
    """
    matches = _nodes_by_title(wf, title)
    if not matches:
        raise WorkflowParamError(f"No node with title '{title}' found in workflow")
    for node_id in matches:
        inputs = wf[node_id]["inputs"]
        if "seed" in inputs:
            inputs["seed"] = seed
        elif "noise_seed" in inputs:
            inputs["noise_seed"] = seed
        else:
            raise WorkflowParamError(
                f"Node {node_id} (title '{title}') has neither 'seed' nor 'noise_seed' in inputs"
            )


def set_image(wf: dict[str, Any], title: str, filename: str) -> None:
    """Escribe inputs["image"] (filename dentro de input/ del workspace)."""
    node_id = find_by_title(wf, title)
    wf[node_id]["inputs"]["image"] = filename


def set_size(wf: dict[str, Any], title: str, width: int, height: int) -> None:
    """Escribe inputs["width"] e inputs["height"]."""
    node_id = find_by_title(wf, title)
    inputs = wf[node_id]["inputs"]
    inputs["width"] = width
    inputs["height"] = height


def set_length(wf: dict[str, Any], title: str, frames: int) -> None:
    """Escribe inputs["length"] (numero de frames del clip)."""
    node_id = find_by_title(wf, title)
    wf[node_id]["inputs"]["length"] = frames


def params_hash(canonical_spec: dict[str, Any], workflow_sha256: str) -> str:
    """Hash de idempotencia: sha256(canonical_json(spec) + sha del workflow).

    Canonical = claves ordenadas, sin espacios. Si cambia el workflow cambia
    el hash: correcto, porque el resultado cambiaria (SPEC_PIPELINE §3).
    Devuelve "sha256:<hex>".
    """
    canonical = json.dumps(canonical_spec, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.sha256((canonical + workflow_sha256).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def assert_workflow(
    wf: dict[str, Any], required_titles: set[str] | frozenset[str], object_info: dict[str, Any]
) -> None:
    """Validacion fail-fast del grafo (SPEC_COMFY_ENGINE §7).

    Comprueba que todos los titulos requeridos estan presentes y que todos los
    `class_type` del grafo existen en /object_info. Asi un bump de ComfyUI que
    rompa un nodo se detecta en `pipeline validate`, no a mitad de un episodio.
    """
    for title in sorted(required_titles):
        if not _nodes_by_title(wf, title):
            raise WorkflowParamError(f"Required title '{title}' not found in workflow")
    missing: list[str] = []
    for node_id, node in wf.items():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        if class_type and class_type not in object_info:
            missing.append(f"{class_type} (node {node_id})")
    if missing:
        raise NodeMissingError(
            "Node classes missing from object_info (broken provision or ComfyUI pin bump): "
            + ", ".join(sorted(missing))
        )


def collect_models(wf: dict[str, Any]) -> dict[str, Any]:
    """Extrae los ficheros de modelo de los nodos loader del grafo parametrizado.

    Para el bloque "models" del sidecar (SPEC_PIPELINE §3): se lee del dict
    real, nunca de constantes, para que el sidecar no mienta si alguien cambia
    un fichero en la GUI. Devuelve listas para diffusion/loras y, cuando hay un
    unico valor, string plano para text_encoder/vae (como en el esquema).
    """
    diffusion: list[str] = []
    loras: list[str] = []
    text_encoders: list[str] = []
    vaes: list[str] = []

    for node in wf.values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", ""))
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue

        if class_type in _DIFFUSION_LOADERS or class_type.startswith("UnetLoaderGGUF"):
            for key in _LOADER_FIELDS["diffusion"] + ("ckpt_name",):
                value = inputs.get(key)
                if isinstance(value, str):
                    diffusion.append(value)
        elif class_type in _LORA_LOADERS or "LoraLoader" in class_type:
            for key in _LOADER_FIELDS["loras"]:
                value = inputs.get(key)
                if isinstance(value, str):
                    loras.append(value)
        elif class_type in _CLIP_LOADERS or "CLIPLoader" in class_type:
            for key in _LOADER_FIELDS["text_encoder"]:
                value = inputs.get(key)
                if isinstance(value, str):
                    text_encoders.append(value)
        elif class_type in _VAE_LOADERS:
            for key in _LOADER_FIELDS["vae"]:
                value = inputs.get(key)
                if isinstance(value, str):
                    vaes.append(value)

    result: dict[str, Any] = {
        "diffusion": sorted(diffusion),
        "loras": sorted(loras),
    }
    result["text_encoder"] = text_encoders[0] if len(text_encoders) == 1 else sorted(text_encoders)
    result["vae"] = vaes[0] if len(vaes) == 1 else sorted(vaes)
    return result
