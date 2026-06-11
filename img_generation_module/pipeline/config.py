"""Carga y validacion de config/pipeline.toml (SPEC_PIPELINE §8).

Las rutas del TOML son relativas a la raiz del modulo (el directorio que
contiene config/); aqui se resuelven a absolutas. Dataclasses congeladas:
la configuracion es inmutable una vez cargada.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Raiz del modulo: el padre del directorio que contiene este fichero (pipeline/).
MODULE_ROOT: Path = Path(__file__).resolve().parent.parent

DEFAULT_CONFIG_PATH: Path = MODULE_ROOT / "config" / "pipeline.toml"


class ConfigError(Exception):
    """Configuracion ausente, malformada o con claves que faltan."""


@dataclass(frozen=True)
class EngineConfig:
    workspace: Path
    python_exe: Path
    host: str
    port: int
    start_timeout_s: int
    comfyui_pin: str
    log_file: Path  # vendor/logs/comfyui.log, derivado de la raiz del modulo
    # Cadena informativa para el bloque "engine" del sidecar (SPEC_PIPELINE seccion 3).
    # Clave opcional [engine].gpu en el TOML; el default es el hardware objetivo del proyecto.
    gpu: str = "RTX 4070 Super 12GB"


@dataclass(frozen=True)
class ImageConfig:
    workflow: Path
    width: int
    height: int
    timeout_s: int


@dataclass(frozen=True)
class VideoConfig:
    workflow: Path
    width: int
    height: int
    frames: int
    timeout_s: int
    oom_max_retries: int


@dataclass(frozen=True)
class ModelsConfig:
    video_quant: str


@dataclass(frozen=True)
class PathsConfig:
    assets: Path


@dataclass(frozen=True)
class PostConfig:
    enabled: bool


@dataclass(frozen=True)
class Config:
    engine: EngineConfig
    image: ImageConfig
    video: VideoConfig
    models: ModelsConfig
    paths: PathsConfig
    post: PostConfig
    root: Path  # raiz del modulo respecto a la que se resolvieron las rutas


def _section(data: dict[str, Any], name: str, path: Path) -> dict[str, Any]:
    """Extrae una seccion del TOML; error claro si falta."""
    try:
        section = data[name]
    except KeyError:
        raise ConfigError(f"Missing section [{name}] in {path}") from None
    if not isinstance(section, dict):
        raise ConfigError(f"Section [{name}] in {path} must be a table")
    return section


def _key(section: dict[str, Any], section_name: str, key: str, expected: type, path: Path) -> Any:
    """Extrae una clave tipada de una seccion; error claro si falta o el tipo no cuadra."""
    try:
        value = section[key]
    except KeyError:
        raise ConfigError(f"Missing key '{key}' in section [{section_name}] of {path}") from None
    # bool es subclase de int en Python: distinguirlos explicitamente.
    if expected is int and isinstance(value, bool):
        raise ConfigError(f"Key '{key}' in [{section_name}] of {path} must be an integer, got a boolean")
    if not isinstance(value, expected):
        raise ConfigError(
            f"Key '{key}' in [{section_name}] of {path} must be {expected.__name__}, got {type(value).__name__}"
        )
    return value


def _optional_key(
    section: dict[str, Any], section_name: str, key: str, expected: type, path: Path, default: Any
) -> Any:
    """Como _key pero con valor por defecto si la clave no esta presente."""
    if key not in section:
        return default
    return _key(section, section_name, key, expected, path)


def load_config(path: Path = DEFAULT_CONFIG_PATH) -> Config:
    """Carga y valida el TOML; las rutas se resuelven respecto a la raiz del modulo.

    La raiz es el padre del directorio config/ que contiene el fichero.
    """
    if not path.is_file():
        raise ConfigError(f"Config file not found: {path}")
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"Invalid TOML in {path}: {exc}") from exc

    root = path.resolve().parent.parent

    eng = _section(data, "engine", path)
    engine = EngineConfig(
        workspace=root / _key(eng, "engine", "workspace", str, path),
        python_exe=root / _key(eng, "engine", "python_exe", str, path),
        host=_key(eng, "engine", "host", str, path),
        port=_key(eng, "engine", "port", int, path),
        start_timeout_s=_key(eng, "engine", "start_timeout_s", int, path),
        comfyui_pin=_key(eng, "engine", "comfyui_pin", str, path),
        log_file=root / "vendor" / "logs" / "comfyui.log",
        gpu=_optional_key(eng, "engine", "gpu", str, path, default="RTX 4070 Super 12GB"),
    )

    img = _section(data, "image", path)
    image = ImageConfig(
        workflow=root / _key(img, "image", "workflow", str, path),
        width=_key(img, "image", "width", int, path),
        height=_key(img, "image", "height", int, path),
        timeout_s=_key(img, "image", "timeout_s", int, path),
    )

    vid = _section(data, "video", path)
    video = VideoConfig(
        workflow=root / _key(vid, "video", "workflow", str, path),
        width=_key(vid, "video", "width", int, path),
        height=_key(vid, "video", "height", int, path),
        frames=_key(vid, "video", "frames", int, path),
        timeout_s=_key(vid, "video", "timeout_s", int, path),
        oom_max_retries=_key(vid, "video", "oom_max_retries", int, path),
    )

    mod = _section(data, "models", path)
    models = ModelsConfig(video_quant=_key(mod, "models", "video_quant", str, path))

    pth = _section(data, "paths", path)
    paths = PathsConfig(assets=root / _key(pth, "paths", "assets", str, path))

    pst = _section(data, "post", path)
    post = PostConfig(enabled=_key(pst, "post", "enabled", bool, path))

    return Config(engine=engine, image=image, video=video, models=models, paths=paths, post=post, root=root)
