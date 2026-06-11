"""Configuracion comun de tests: hace importable el paquete pipeline/.

Sin red, sin GPU, sin websocket-client: solo stdlib + pytest. Aporta ademas
el FakeEngine (stub con la superficie de ComfyEngine) y una Config completa
enraizada en tmp_path para los tests de images/videos/orchestrator.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import pytest

MODULE_ROOT = Path(__file__).resolve().parent.parent
if str(MODULE_ROOT) not in sys.path:
    sys.path.insert(0, str(MODULE_ROOT))

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"

# TOML de pruebas: mismas secciones que el real, workflows = fixtures minimos.
TEST_TOML = """\
[engine]
workspace = "vendor/ComfyUI"
python_exe = "vendor/ComfyUI/python.exe"
host = "127.0.0.1"
port = 8188
start_timeout_s = 5
comfyui_pin = "testpin"
gpu = "Test GPU 12GB"

[image]
workflow = "workflows/image_minimal.api.json"
width = 1248
height = 720
timeout_s = 30

[video]
workflow = "workflows/video_minimal.api.json"
width = 832
height = 480
frames = 81
timeout_s = 60
oom_max_retries = 2

[models]
video_quant = "Q5_K_M"

[paths]
assets = "assets"

[post]
enabled = false
"""


@pytest.fixture()
def fixtures_dir() -> Path:
    return FIXTURES_DIR


@pytest.fixture()
def image_wf_path() -> Path:
    return FIXTURES_DIR / "image_minimal.api.json"


@pytest.fixture()
def video_wf_path() -> Path:
    return FIXTURES_DIR / "video_minimal.api.json"


@pytest.fixture()
def pipeline_cfg(tmp_path: Path):
    """Config completa enraizada en tmp_path con los workflows fixture copiados."""
    from pipeline.config import load_config

    (tmp_path / "config").mkdir()
    (tmp_path / "workflows").mkdir()
    shutil.copy2(FIXTURES_DIR / "image_minimal.api.json", tmp_path / "workflows" / "image_minimal.api.json")
    shutil.copy2(FIXTURES_DIR / "video_minimal.api.json", tmp_path / "workflows" / "video_minimal.api.json")
    (tmp_path / "vendor" / "ComfyUI" / "input").mkdir(parents=True)
    (tmp_path / "vendor" / "ComfyUI" / "output").mkdir(parents=True)
    config_path = tmp_path / "config" / "pipeline.toml"
    config_path.write_text(TEST_TOML, encoding="utf-8")
    return load_config(config_path)


class FakeEngine:
    """Stub con la superficie publica de ComfyEngine: sin subproceso, sin red.

    - `wait_script`: lista de resultados por llamada a wait(); None = exito,
      una instancia de excepcion = se lanza. Vacia = exito siempre.
    - `collect_outputs` materializa un fichero en <workspace>/output/ cuyo
      tipo (png/mp4) se infiere del grafo enviado (nodo SaveVideo -> mp4).
    """

    def __init__(self, workspace: Path, object_info_data: dict[str, Any] | None = None) -> None:
        self.workspace = workspace
        self._object_info = object_info_data if object_info_data is not None else _fixture_object_info()
        self.wait_script: list[Exception | None] = []
        self.submitted: list[tuple[str, dict[str, Any]]] = []
        self.uploads: list[str] = []
        self.start_calls = 0
        self.stop_calls = 0
        self.restart_calls = 0
        self.free_vram_calls = 0
        self.interrupt_calls = 0
        self._counter = 0

    # ciclo de vida
    def start(self) -> None:
        self.start_calls += 1

    def stop(self) -> None:
        self.stop_calls += 1

    def restart(self) -> None:
        self.restart_calls += 1

    def is_alive(self) -> bool:
        return True

    # validacion
    def object_info(self) -> dict[str, Any]:
        return self._object_info

    def validate_nodes(self, required: set[str]) -> None:
        return None

    # trabajo
    def submit(self, workflow: dict[str, Any]) -> str:
        self._counter += 1
        prompt_id = f"prompt-{self._counter}"
        # Copia profunda: el llamador puede seguir mutando el grafo.
        self.submitted.append((prompt_id, json.loads(json.dumps(workflow))))
        return prompt_id

    def wait(self, prompt_id: str, timeout_s: float) -> dict[str, Any]:
        outcome = self.wait_script.pop(0) if self.wait_script else None
        if isinstance(outcome, Exception):
            raise outcome
        return {"outputs": {}, "timings": {"queue_s": 0.1, "exec_s": 1.5}}

    def collect_outputs(self, prompt_id: str) -> list[Path]:
        workflow = dict(self.submitted)[prompt_id]
        is_video = any(
            isinstance(node, dict) and node.get("class_type") == "SaveVideo" for node in workflow.values()
        )
        name = f"{prompt_id}.mp4" if is_video else f"{prompt_id}.png"
        out = self.workspace / "output" / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"fake-binary-" + prompt_id.encode("ascii"))
        return [out]

    def upload_input(self, src: Path) -> str:
        if not src.is_file():
            raise FileNotFoundError(f"Input image not found: {src}")
        digest = hashlib.sha1(src.read_bytes()).hexdigest()[:8]
        filename = f"{src.stem}__{digest}{src.suffix}"
        dest = self.workspace / "input" / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        self.uploads.append(filename)
        return filename

    def interrupt(self) -> None:
        self.interrupt_calls += 1

    def free_vram(self) -> None:
        self.free_vram_calls += 1


def _fixture_object_info() -> dict[str, Any]:
    """object_info sintetico que cubre todos los class_type de ambos fixtures."""
    info: dict[str, Any] = {}
    for name in ("image_minimal.api.json", "video_minimal.api.json"):
        data = json.loads((FIXTURES_DIR / name).read_text(encoding="utf-8"))
        for node in data.values():
            info[node["class_type"]] = {}
    return info


@pytest.fixture()
def fake_engine(pipeline_cfg) -> FakeEngine:
    return FakeEngine(pipeline_cfg.engine.workspace)
