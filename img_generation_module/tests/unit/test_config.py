"""Tests de pipeline.config: carga de TOML, resolucion de rutas y errores claros."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline.config import Config, ConfigError, load_config

VALID_TOML = """\
[engine]
workspace = "vendor/ComfyUI"
python_exe = "vendor/ComfyUI/.venv/Scripts/python.exe"
host = "127.0.0.1"
port = 8188
start_timeout_s = 180
comfyui_pin = "abc123"

[image]
workflow = "workflows/zimage_t2i_fp8.api.json"
width = 1248
height = 720
timeout_s = 180

[video]
workflow = "workflows/wan22_i2v_q5.api.json"
width = 832
height = 480
frames = 81
timeout_s = 900
oom_max_retries = 2

[models]
video_quant = "Q5_K_M"

[paths]
assets = "assets"

[post]
enabled = false
"""


def _write_config(tmp_path: Path, content: str) -> Path:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    path = config_dir / "pipeline.toml"
    path.write_text(content, encoding="utf-8")
    return path


def test_load_config_happy_path(tmp_path: Path) -> None:
    path = _write_config(tmp_path, VALID_TOML)
    cfg = load_config(path)
    assert isinstance(cfg, Config)
    assert cfg.root == tmp_path
    # Rutas resueltas respecto a la raiz del modulo (padre de config/).
    assert cfg.engine.workspace == tmp_path / "vendor" / "ComfyUI"
    assert cfg.engine.python_exe == tmp_path / "vendor" / "ComfyUI" / ".venv" / "Scripts" / "python.exe"
    assert cfg.engine.log_file == tmp_path / "vendor" / "logs" / "comfyui.log"
    assert cfg.engine.host == "127.0.0.1"
    assert cfg.engine.port == 8188
    assert cfg.engine.start_timeout_s == 180
    assert cfg.engine.comfyui_pin == "abc123"
    assert cfg.image.workflow == tmp_path / "workflows" / "zimage_t2i_fp8.api.json"
    assert (cfg.image.width, cfg.image.height, cfg.image.timeout_s) == (1248, 720, 180)
    assert cfg.video.workflow == tmp_path / "workflows" / "wan22_i2v_q5.api.json"
    assert (cfg.video.width, cfg.video.height, cfg.video.frames) == (832, 480, 81)
    assert cfg.video.timeout_s == 900
    assert cfg.video.oom_max_retries == 2
    assert cfg.models.video_quant == "Q5_K_M"
    assert cfg.paths.assets == tmp_path / "assets"
    assert cfg.post.enabled is False


def test_config_is_immutable(tmp_path: Path) -> None:
    cfg = load_config(_write_config(tmp_path, VALID_TOML))
    with pytest.raises(AttributeError):
        cfg.engine.port = 9999  # type: ignore[misc]


def test_load_config_missing_file(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "config" / "pipeline.toml")


def test_load_config_missing_key(tmp_path: Path) -> None:
    broken = VALID_TOML.replace("port = 8188\n", "")
    path = _write_config(tmp_path, broken)
    with pytest.raises(ConfigError, match=r"Missing key 'port' in section \[engine\]"):
        load_config(path)


def test_load_config_missing_section(tmp_path: Path) -> None:
    broken = VALID_TOML.replace("[video]", "[video_x]")
    path = _write_config(tmp_path, broken)
    with pytest.raises(ConfigError, match=r"Missing section \[video\]"):
        load_config(path)


def test_load_config_wrong_type(tmp_path: Path) -> None:
    broken = VALID_TOML.replace("port = 8188", 'port = "8188"')
    path = _write_config(tmp_path, broken)
    with pytest.raises(ConfigError, match="'port'"):
        load_config(path)


def test_load_config_invalid_toml(tmp_path: Path) -> None:
    path = _write_config(tmp_path, "[engine\nbroken")
    with pytest.raises(ConfigError, match="Invalid TOML"):
        load_config(path)


def test_repo_config_file_loads() -> None:
    # El pipeline.toml versionado del modulo debe cargar tal cual.
    cfg = load_config()
    assert cfg.engine.comfyui_pin == "UNSET"  # placeholder hasta setup.ps1
    assert cfg.video.frames == 81
