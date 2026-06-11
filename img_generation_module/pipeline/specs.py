"""Contratos de datos del pipeline (SPEC_PIPELINE §1, §3, §4, §5).

Tres piezas, todas puras (sin red, sin GPU):

- Specs de generacion: ImageSpec / VideoSpec / AssetResult (dataclasses
  congeladas con validacion en __post_init__ via funcion auxiliar).
- Manifest del episodio: carga + validacion, resolucion de prompts (prompt de
  escena + suffix de defaults) y de seed determinista.
- Sidecar: construccion, lectura y validacion del esquema v1, mas la decision
  de idempotencia (should_skip).
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from . import workflows
from .config import Config
from .errors import ManifestError, SidecarError, SpecError

# Patrones de identificadores (SPEC_PIPELINE §1 y §4).
ASSET_ID_RE: re.Pattern[str] = re.compile(r"^e\d{2,}_s\d{2,}(_[a-z0-9]+)?$")
SCENE_ID_RE: re.Pattern[str] = re.compile(r"^s\d{2,}(_[a-z0-9]+)?$")
EPISODE_RE: re.Pattern[str] = re.compile(r"^e\d{2,}$")

FRAMES_MIN = 17
FRAMES_MAX = 121

SIDECAR_SCHEMA = 1
MANIFEST_SCHEMA = 1


# ------------------------------------------------------------------ specs §1


def _validate_spec(asset_id: str, prompt: str, width: int, height: int, frames: int | None = None) -> None:
    """Validacion compartida de ImageSpec/VideoSpec (dataclasses congeladas)."""
    if not ASSET_ID_RE.match(asset_id):
        raise SpecError(
            f"Invalid asset_id {asset_id!r}: expected pattern e<NN>_s<NN>[_suffix], e.g. 'e01_s03' or 'e01_s03_alt'"
        )
    if not prompt or not prompt.strip():
        raise SpecError(f"Spec {asset_id}: prompt must not be empty")
    if width % 16 != 0:
        raise SpecError(f"Spec {asset_id}: width {width} must be a multiple of 16")
    if height % 16 != 0:
        raise SpecError(f"Spec {asset_id}: height {height} must be a multiple of 16")
    if frames is not None and not (FRAMES_MIN <= frames <= FRAMES_MAX):
        raise SpecError(f"Spec {asset_id}: frames {frames} out of range [{FRAMES_MIN}, {FRAMES_MAX}]")


@dataclass(frozen=True)
class ImageSpec:
    """Parametros de un still T2I. steps/cfg NO van aqui: son fuente de verdad del workflow (ADR-005)."""

    asset_id: str
    prompt: str
    negative: str = ""
    seed: int = 0
    width: int = 1248
    height: int = 720

    def __post_init__(self) -> None:
        _validate_spec(self.asset_id, self.prompt, self.width, self.height)


@dataclass(frozen=True)
class VideoSpec:
    """Parametros de un clip I2V a partir de un still ya generado."""

    asset_id: str
    source_image: Path
    prompt: str
    negative: str = ""
    seed: int = 0
    width: int = 832
    height: int = 480
    frames: int = 81

    def __post_init__(self) -> None:
        _validate_spec(self.asset_id, self.prompt, self.width, self.height, self.frames)


@dataclass(frozen=True)
class AssetResult:
    """Resultado de generar (o saltar) un asset."""

    path: Path
    sidecar: Path
    timings: dict[str, float]
    skipped: bool = False


# ------------------------------------------------------------- manifest §4


@dataclass(frozen=True)
class ManifestDefaults:
    """Sufijos que centralizan la coherencia visual de la serie."""

    image_suffix: str = ""
    motion_suffix: str = ""


@dataclass(frozen=True)
class Scene:
    """Escena del manifest tal cual se declara (prompts sin resolver)."""

    id: str
    image_prompt: str = ""
    motion_prompt: str = ""
    seed: int | None = None


@dataclass(frozen=True)
class Manifest:
    episode: str
    defaults: ManifestDefaults = field(default_factory=ManifestDefaults)
    scenes: tuple[Scene, ...] = ()


def _manifest_str(raw: dict[str, Any], key: str, where: str, default: str = "") -> str:
    value = raw.get(key, default)
    if not isinstance(value, str):
        raise ManifestError(f"{where}: '{key}' must be a string, got {type(value).__name__}")
    return value


def load_manifest(path: Path) -> Manifest:
    """Carga y valida assets/<ep>/manifest.json (SPEC_PIPELINE §4).

    Validacion estructural: schema, episodio, ids unicos y con patron valido,
    tipos correctos. Los mensajes de error citan la escena ofensiva. Los
    prompts vacios NO se rechazan aqui: se rechazan por escena al construir el
    spec, para que un fallo individual no tire el episodio entero.
    """
    if not path.is_file():
        raise ManifestError(f"Manifest not found: {path}. Create assets/<episode>/manifest.json first.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ManifestError(f"Invalid JSON in manifest {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ManifestError(f"Manifest {path} must be a JSON object")
    if data.get("schema") != MANIFEST_SCHEMA:
        raise ManifestError(f"Unsupported manifest schema {data.get('schema')!r} in {path} (expected {MANIFEST_SCHEMA})")

    episode = data.get("episode")
    if not isinstance(episode, str) or not EPISODE_RE.match(episode):
        raise ManifestError(f"Invalid episode {episode!r} in {path}: expected pattern e<NN>, e.g. 'e01'")

    defaults_raw = data.get("defaults", {})
    if not isinstance(defaults_raw, dict):
        raise ManifestError(f"Manifest {path}: 'defaults' must be an object")
    defaults = ManifestDefaults(
        image_suffix=_manifest_str(defaults_raw, "image_suffix", f"manifest {path} defaults"),
        motion_suffix=_manifest_str(defaults_raw, "motion_suffix", f"manifest {path} defaults"),
    )

    scenes_raw = data.get("scenes")
    if not isinstance(scenes_raw, list) or not scenes_raw:
        raise ManifestError(f"Manifest {path} must define a non-empty 'scenes' list")

    scenes: list[Scene] = []
    seen: set[str] = set()
    for index, raw in enumerate(scenes_raw, start=1):
        if not isinstance(raw, dict):
            raise ManifestError(f"scene #{index} in {path}: must be a JSON object")
        scene_id = raw.get("id")
        if not isinstance(scene_id, str) or not SCENE_ID_RE.match(scene_id):
            raise ManifestError(
                f"scene #{index} (id={scene_id!r}) in {path}: invalid id, expected pattern s<NN>, "
                f"e.g. 's03' or 's03_alt'"
            )
        if scene_id in seen:
            raise ManifestError(f"scene '{scene_id}' in {path}: duplicate id (scene ids must be unique)")
        seen.add(scene_id)
        seed = raw.get("seed")
        if seed is not None and (isinstance(seed, bool) or not isinstance(seed, int)):
            raise ManifestError(f"scene '{scene_id}' in {path}: seed must be an integer")
        scenes.append(
            Scene(
                id=scene_id,
                image_prompt=_manifest_str(raw, "image_prompt", f"scene '{scene_id}' in {path}"),
                motion_prompt=_manifest_str(raw, "motion_prompt", f"scene '{scene_id}' in {path}"),
                seed=seed,
            )
        )
    return Manifest(episode=episode, defaults=defaults, scenes=tuple(scenes))


def deterministic_seed(episode: str, scene_id: str) -> int:
    """Seed derivada de (episodio, escena): estable entre ejecuciones y maquinas."""
    return int.from_bytes(hashlib.sha256(f"{episode}/{scene_id}".encode()).digest()[:4], "big")


def scene_seed(episode: str, scene: Scene) -> int:
    """Seed efectiva de la escena: la fijada en el manifest o la determinista.

    La misma seed se usa para la imagen y para el video de la escena.
    """
    return scene.seed if scene.seed is not None else deterministic_seed(episode, scene.id)


def asset_id_for(episode: str, scene_id: str) -> str:
    return f"{episode}_{scene_id}"


def image_asset_path(assets_root: Path, episode: str, asset_id: str) -> Path:
    return assets_root / episode / "images" / f"{asset_id}.png"


def clip_asset_path(assets_root: Path, episode: str, asset_id: str) -> Path:
    return assets_root / episode / "clips" / f"{asset_id}.mp4"


def episode_of(asset_id: str) -> str:
    """Episodio implicito en el asset_id ('e01_s03' -> 'e01')."""
    if not ASSET_ID_RE.match(asset_id):
        raise SpecError(f"Invalid asset_id {asset_id!r}")
    return asset_id.split("_", 1)[0]


def build_image_spec(manifest: Manifest, scene: Scene, cfg: Config) -> ImageSpec:
    """ImageSpec resuelto: prompt + suffix, seed efectiva, tamano de config."""
    if not scene.image_prompt.strip():
        raise SpecError(f"scene '{scene.id}': image_prompt is empty in manifest for episode {manifest.episode}")
    return ImageSpec(
        asset_id=asset_id_for(manifest.episode, scene.id),
        prompt=scene.image_prompt + manifest.defaults.image_suffix,
        seed=scene_seed(manifest.episode, scene),
        width=cfg.image.width,
        height=cfg.image.height,
    )


def build_video_spec(manifest: Manifest, scene: Scene, cfg: Config) -> VideoSpec:
    """VideoSpec resuelto: el still de la escena es la imagen fuente."""
    if not scene.motion_prompt.strip():
        raise SpecError(f"scene '{scene.id}': motion_prompt is empty in manifest for episode {manifest.episode}")
    asset_id = asset_id_for(manifest.episode, scene.id)
    return VideoSpec(
        asset_id=asset_id,
        source_image=image_asset_path(cfg.paths.assets, manifest.episode, asset_id),
        prompt=scene.motion_prompt + manifest.defaults.motion_suffix,
        seed=scene_seed(manifest.episode, scene),
        width=cfg.video.width,
        height=cfg.video.height,
        frames=cfg.video.frames,
    )


# ------------------------------------------------------- params y hashes §3


def image_params(spec: ImageSpec) -> dict[str, Any]:
    """Bloque "params" del sidecar de imagen (tambien entrada del hash)."""
    return {
        "prompt": spec.prompt,
        "negative": spec.negative,
        "seed": spec.seed,
        "width": spec.width,
        "height": spec.height,
    }


def video_params(spec: VideoSpec) -> dict[str, Any]:
    """Bloque "params" del sidecar de video (tambien entrada del hash)."""
    return {
        "prompt": spec.prompt,
        "negative": spec.negative,
        "seed": spec.seed,
        "width": spec.width,
        "height": spec.height,
        "frames": spec.frames,
    }


def source_image_sha256(path: Path) -> str:
    """SHA-256 hex del still fuente (entra en el hash de idempotencia del clip)."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image_params_hash(spec: ImageSpec, workflow_sha256: str) -> str:
    return workflows.params_hash(image_params(spec), workflow_sha256)


def video_params_hash(spec: VideoSpec, workflow_sha256: str, source_sha256: str) -> str:
    """El hash del clip incluye el sha del still: si cambia el still, cambia el clip."""
    payload = video_params(spec) | {"source_image_sha256": source_sha256}
    return workflows.params_hash(payload, workflow_sha256)


def rel_to_root(path: Path, root: Path) -> str:
    """Ruta relativa a la raiz del modulo en formato posix (para sidecars portables)."""
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return str(path)


# ------------------------------------------------------------- sidecar §3


def build_sidecar(
    *,
    asset_id: str,
    kind: str,
    params_hash_value: str,
    workflow_file: str,
    workflow_sha256: str,
    params: dict[str, Any],
    models: dict[str, Any],
    comfyui_pin: str,
    gpu: str,
    timings: dict[str, float],
    source_image: str | None = None,
    created_at: str | None = None,
) -> dict[str, Any]:
    """Construye el dict del sidecar segun el esquema v1 (SPEC_PIPELINE §3).

    `source_image` solo se acepta para kind="video". El bloque `models` debe
    venir de workflows.collect_models sobre el grafo parametrizado, nunca de
    constantes.
    """
    sidecar: dict[str, Any] = {
        "schema": SIDECAR_SCHEMA,
        "asset_id": asset_id,
        "kind": kind,
        "created_at": created_at or datetime.now().astimezone().isoformat(timespec="seconds"),
        "params_hash": params_hash_value,
        "workflow": {"file": workflow_file, "sha256": workflow_sha256},
        "params": params,
    }
    if source_image is not None:
        sidecar["source_image"] = source_image
    sidecar["models"] = models
    sidecar["engine"] = {"comfyui_pin": comfyui_pin, "gpu": gpu}
    sidecar["timings"] = timings
    validate_sidecar(sidecar)
    return sidecar


def validate_sidecar(data: Any) -> None:
    """Valida el esquema v1 del sidecar; SidecarError con el campo ofensivo."""
    if not isinstance(data, dict):
        raise SidecarError("Sidecar must be a JSON object")
    if data.get("schema") != SIDECAR_SCHEMA:
        raise SidecarError(f"Unsupported sidecar schema {data.get('schema')!r} (expected {SIDECAR_SCHEMA})")

    asset_id = data.get("asset_id")
    if not isinstance(asset_id, str) or not ASSET_ID_RE.match(asset_id):
        raise SidecarError(f"Sidecar has invalid asset_id: {asset_id!r}")

    kind = data.get("kind")
    if kind not in ("image", "video"):
        raise SidecarError(f"Sidecar {asset_id}: kind must be 'image' or 'video', got {kind!r}")

    if not isinstance(data.get("created_at"), str) or not data["created_at"]:
        raise SidecarError(f"Sidecar {asset_id}: missing or invalid 'created_at'")

    params_hash_value = data.get("params_hash")
    if not isinstance(params_hash_value, str) or not params_hash_value.startswith("sha256:"):
        raise SidecarError(f"Sidecar {asset_id}: 'params_hash' must be a 'sha256:...' string")

    workflow = data.get("workflow")
    if (
        not isinstance(workflow, dict)
        or not isinstance(workflow.get("file"), str)
        or not isinstance(workflow.get("sha256"), str)
    ):
        raise SidecarError(f"Sidecar {asset_id}: 'workflow' must be an object with 'file' and 'sha256' strings")

    params = data.get("params")
    if not isinstance(params, dict):
        raise SidecarError(f"Sidecar {asset_id}: 'params' must be an object")
    _require_param(asset_id, params, "prompt", str)
    _require_param(asset_id, params, "negative", str)
    _require_param(asset_id, params, "seed", int)
    _require_param(asset_id, params, "width", int)
    _require_param(asset_id, params, "height", int)
    if kind == "video":
        _require_param(asset_id, params, "frames", int)
        if not isinstance(data.get("source_image"), str) or not data["source_image"]:
            raise SidecarError(f"Sidecar {asset_id}: kind 'video' requires a 'source_image' string")
    elif "source_image" in data:
        raise SidecarError(f"Sidecar {asset_id}: 'source_image' is only allowed for kind 'video'")

    if not isinstance(data.get("models"), dict):
        raise SidecarError(f"Sidecar {asset_id}: 'models' must be an object")

    engine = data.get("engine")
    if (
        not isinstance(engine, dict)
        or not isinstance(engine.get("comfyui_pin"), str)
        or not isinstance(engine.get("gpu"), str)
    ):
        raise SidecarError(f"Sidecar {asset_id}: 'engine' must be an object with 'comfyui_pin' and 'gpu' strings")

    timings = data.get("timings")
    if not isinstance(timings, dict):
        raise SidecarError(f"Sidecar {asset_id}: 'timings' must be an object")
    for key in ("queue_s", "exec_s"):
        value = timings.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise SidecarError(f"Sidecar {asset_id}: timings['{key}'] must be a number")


def _require_param(asset_id: str, params: dict[str, Any], key: str, expected: type) -> None:
    value = params.get(key)
    if expected is int and isinstance(value, bool):
        raise SidecarError(f"Sidecar {asset_id}: params['{key}'] must be an integer, got a boolean")
    if not isinstance(value, expected):
        raise SidecarError(
            f"Sidecar {asset_id}: params['{key}'] must be {expected.__name__}, got {type(value).__name__}"
        )


def write_sidecar(path: Path, data: dict[str, Any]) -> None:
    """Valida y escribe el sidecar junto al binario."""
    validate_sidecar(data)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def read_sidecar(path: Path) -> dict[str, Any]:
    """Lee y valida un sidecar; SidecarError si falta, esta corrupto o no valida."""
    if not path.is_file():
        raise SidecarError(f"Sidecar not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SidecarError(f"Invalid JSON in sidecar {path}: {exc}") from exc
    validate_sidecar(data)
    return data


# --------------------------------------------------------- idempotencia §5


def should_skip(binary: Path, sidecar: Path, expected_hash: str, force: bool) -> bool:
    """Decision de idempotencia (SPEC_PIPELINE §5).

    Skip solo si binario + sidecar existen y el params_hash del sidecar
    coincide. --force la ignora. Sidecar huerfano (sin binario), hash distinto,
    binario sin sidecar o sidecar corrupto -> regenerar.
    """
    if force:
        return False
    if not binary.is_file():
        return False
    if not sidecar.is_file():
        return False  # binario sin sidecar: sin metadatos no hay reproducibilidad
    try:
        data = read_sidecar(sidecar)
    except SidecarError:
        return False  # sidecar corrupto o invalido -> regenerar
    return data.get("params_hash") == expected_hash
