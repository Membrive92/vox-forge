"""Tests de los helpers de ComfyEngine que no requieren red ni GPU."""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import types
import urllib.error
from pathlib import Path

import pytest

from pipeline.comfy_engine import ComfyEngine, pid_alive
from pipeline.config import EngineConfig
from pipeline.errors import EngineStartError, JobFailed, JobTimeout


def _make_engine(tmp_path: Path) -> ComfyEngine:
    cfg = EngineConfig(
        workspace=tmp_path / "vendor" / "ComfyUI",
        python_exe=tmp_path / "vendor" / "ComfyUI" / "python.exe",
        host="127.0.0.1",
        port=8188,
        start_timeout_s=5,
        comfyui_pin="test",
        log_file=tmp_path / "vendor" / "logs" / "comfyui.log",
    )
    (tmp_path / "vendor" / "ComfyUI").mkdir(parents=True)
    return ComfyEngine(cfg)


def _dead_pid() -> int:
    proc = subprocess.run([sys.executable, "-c", "pass"], capture_output=True)
    assert proc.returncode == 0
    # El proceso ya termino: su PID (con altisima probabilidad) no esta vivo.
    spawned = subprocess.Popen([sys.executable, "-c", "pass"])
    spawned.wait()
    return spawned.pid


# ---------------------------------------------------------------- pid_alive


def test_pid_alive_current_process() -> None:
    assert pid_alive(os.getpid()) is True


def test_pid_alive_invalid_pids() -> None:
    assert pid_alive(0) is False
    assert pid_alive(-5) is False


def test_pid_alive_dead_process() -> None:
    assert pid_alive(_dead_pid()) is False


# ------------------------------------------------------------- upload_input


def test_upload_input_naming_and_copy(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    src = tmp_path / "e01_s03.png"
    src.write_bytes(b"fake png bytes")
    expected_digest = hashlib.sha1(b"fake png bytes").hexdigest()[:8]

    filename = engine.upload_input(src)

    assert filename == f"e01_s03__{expected_digest}.png"
    dest = tmp_path / "vendor" / "ComfyUI" / "input" / filename
    assert dest.is_file()
    assert dest.read_bytes() == b"fake png bytes"


def test_upload_input_missing_source(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    with pytest.raises(FileNotFoundError):
        engine.upload_input(tmp_path / "missing.png")


# ----------------------------------------------------------------- lockfile


def test_lockfile_with_alive_pid_blocks_start(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    lock = tmp_path / "vendor" / "engine.lock"
    lock.write_text(str(os.getpid()), encoding="ascii")
    with pytest.raises(EngineStartError, match="engine down"):
        engine._check_lockfile()


def test_stale_lockfile_is_removed(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    lock = tmp_path / "vendor" / "engine.lock"
    lock.write_text(str(_dead_pid()), encoding="ascii")
    engine._check_lockfile()  # no debe lanzar
    assert not lock.exists()


def test_corrupt_lockfile_is_removed(tmp_path: Path) -> None:
    engine = _make_engine(tmp_path)
    lock = tmp_path / "vendor" / "engine.lock"
    lock.write_text("not-a-pid", encoding="ascii")
    engine._check_lockfile()
    assert not lock.exists()


def test_start_lockfile_takes_precedence_over_attach(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SPEC §8: lock vivo -> EngineStartError aunque /system_stats responda (nunca attach)."""
    engine = _make_engine(tmp_path)
    lock = tmp_path / "vendor" / "engine.lock"
    lock.write_text(str(os.getpid()), encoding="ascii")
    monkeypatch.setattr(engine, "_system_stats_ok", lambda: True)
    with pytest.raises(EngineStartError, match="engine down"):
        engine.start()
    assert engine._attached is False


# ---------------------------------------------------------- free_vram / probe


def test_free_vram_never_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Best-effort (SPEC §1, §6): un fallo de red en plena escalada OOM no la rompe."""
    engine = _make_engine(tmp_path)

    def refused(*args: object, **kwargs: object) -> dict:
        raise urllib.error.URLError("connection refused")

    monkeypatch.setattr(engine, "_http_json", refused)
    engine.free_vram()  # no debe lanzar


def test_probe_free_vram_distinguishes_availability(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = _make_engine(tmp_path)

    monkeypatch.setattr(engine, "_http_json", lambda *a, **k: {})
    assert engine.probe_free_vram() is True

    def http_404(*args: object, **kwargs: object) -> dict:
        raise urllib.error.HTTPError("http://x/free", 404, "Not Found", None, None)  # type: ignore[arg-type]

    monkeypatch.setattr(engine, "_http_json", http_404)
    assert engine.probe_free_vram() is False  # 404 = no-op con warning (SPEC §3)

    def http_500(*args: object, **kwargs: object) -> dict:
        raise urllib.error.HTTPError("http://x/free", 500, "Server Error", None, None)  # type: ignore[arg-type]

    monkeypatch.setattr(engine, "_http_json", http_500)
    with pytest.raises(urllib.error.HTTPError):
        engine.probe_free_vram()  # otros errores se propagan: validate los reporta


# --------------------------------------------------- wait: history es la verdad


_COMPLETED_ENTRY = {
    "outputs": {"9": {"images": [{"filename": "x.png", "subfolder": "", "type": "output"}]}},
    "status": {"completed": True, "messages": []},
}


def test_wait_ws_timeout_is_arbitrated_by_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """SPEC §4: si no llega senal de fin por WS pero history tiene outputs -> completado."""
    engine = _make_engine(tmp_path)

    def no_end_signal(prompt_id: str, deadline: float, submit_t: float) -> tuple:
        raise JobTimeout("no end signal (WS path)")

    monkeypatch.setattr(engine, "_wait_ws", no_end_signal)
    entry = dict(_COMPLETED_ENTRY)
    monkeypatch.setattr(engine, "_history_entry", lambda prompt_id: entry)

    result = engine.wait("p1", timeout_s=5.0)

    assert result is entry
    assert result["timings"]["queue_s"] == 0.0  # sin eventos WS no hay separacion cola/ejecucion


def test_wait_ws_timeout_without_history_is_final(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = _make_engine(tmp_path)

    def no_end_signal(prompt_id: str, deadline: float, submit_t: float) -> tuple:
        raise JobTimeout("no end signal (WS path)")

    monkeypatch.setattr(engine, "_wait_ws", no_end_signal)
    monkeypatch.setattr(engine, "_history_entry", lambda prompt_id: None)
    with pytest.raises(JobTimeout):
        engine.wait("p1", timeout_s=5.0)


def test_wait_ws_silence_polls_history(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Socket medio abierto: silencio WS -> history reporta completado sin agotar el timeout."""
    engine = _make_engine(tmp_path)

    class _FakeWsTimeout(Exception):
        pass

    class _SilentConnection:
        def settimeout(self, value: float) -> None:
            return None

        def recv(self) -> str:
            raise _FakeWsTimeout()

        def close(self) -> None:
            return None

    fake_ws = types.ModuleType("websocket")
    fake_ws.WebSocketTimeoutException = _FakeWsTimeout  # type: ignore[attr-defined]
    fake_ws.create_connection = lambda url, timeout=None: _SilentConnection()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "websocket", fake_ws)

    entry = dict(_COMPLETED_ENTRY)
    monkeypatch.setattr(engine, "_history_entry", lambda prompt_id: entry)

    result = engine.wait("p1", timeout_s=30.0)

    assert result is entry
    assert "timings" in result


# ----------------------------------------------------------- collect_outputs


def test_collect_outputs_resolves_known_keys(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _make_engine(tmp_path)
    output_dir = tmp_path / "vendor" / "ComfyUI" / "output"
    (output_dir / "wan").mkdir(parents=True)
    (output_dir / "img.png").write_bytes(b"png")
    (output_dir / "wan" / "clip.mp4").write_bytes(b"mp4")

    entry = {
        "outputs": {
            "9": {"images": [{"filename": "img.png", "subfolder": "", "type": "output"}]},
            "24": {
                "videos": [{"filename": "clip.mp4", "subfolder": "wan", "type": "output"}],
                # Los previews (type temp) no viven en output/: se descartan.
                "images": [{"filename": "preview.png", "subfolder": "", "type": "temp"}],
            },
        }
    }
    monkeypatch.setattr(engine, "_history_entry", lambda prompt_id: entry)

    paths = engine.collect_outputs("fake-prompt-id")

    assert sorted(p.name for p in paths) == ["clip.mp4", "img.png"]
    assert all(p.is_absolute() for p in paths)


def test_collect_outputs_missing_file_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _make_engine(tmp_path)
    entry = {"outputs": {"9": {"images": [{"filename": "ghost.png", "subfolder": "", "type": "output"}]}}}
    monkeypatch.setattr(engine, "_history_entry", lambda prompt_id: entry)
    with pytest.raises(JobFailed, match="does not exist on disk"):
        engine.collect_outputs("fake-prompt-id")


def test_collect_outputs_no_history_raises(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    engine = _make_engine(tmp_path)
    monkeypatch.setattr(engine, "_history_entry", lambda prompt_id: None)
    with pytest.raises(JobFailed, match="No history entry"):
        engine.collect_outputs("fake-prompt-id")
