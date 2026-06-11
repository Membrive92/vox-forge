"""Tests de la CLI: fallos elegantes sin vendor/ provisionado, sin red ni GPU."""

from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import cli

MINIMAL_TOML = """\
[engine]
workspace = "vendor/ComfyUI"
python_exe = "vendor/ComfyUI/.venv/Scripts/python.exe"
host = "127.0.0.1"
port = 8188
start_timeout_s = 5
comfyui_pin = "UNSET"

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


@pytest.fixture()
def temp_config(tmp_path: Path) -> Path:
    config_dir = tmp_path / "config"
    config_dir.mkdir()
    path = config_dir / "pipeline.toml"
    path.write_text(MINIMAL_TOML, encoding="utf-8")
    return path


def test_validate_missing_config_fails_gracefully(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    rc = cli.main(["--config", str(tmp_path / "nope.toml"), "validate"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "[FAIL]" in out
    assert "Traceback" not in out


def test_validate_unprovisioned_vendor_fails_with_actionable_messages(
    temp_config: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    # Sin nvidia-smi real: el check de GPU debe reportar FAIL, no reventar.
    monkeypatch.setattr(cli, "_check_gpu_free", lambda report: report.fail("gpu: skipped in test"))
    rc = cli.main(["--config", str(temp_config), "validate"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "setup.ps1" in out  # mensajes accionables hacia la provision
    assert "Traceback" not in out
    # Modelos, workflows y motor reportan FAIL individualmente.
    assert out.count("[FAIL]") >= 3


def test_engine_down_without_lockfile_is_noop(temp_config: Path, capsys: pytest.CaptureFixture[str]) -> None:
    rc = cli.main(["--config", str(temp_config), "engine", "down"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "nothing to stop" in out


def test_engine_down_with_stale_lockfile_cleans_up(
    temp_config: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    import subprocess
    import sys

    proc = subprocess.Popen([sys.executable, "-c", "pass"])
    proc.wait()
    lock = tmp_path / "vendor"
    lock.mkdir()
    lock_file = lock / "engine.lock"
    lock_file.write_text(str(proc.pid), encoding="ascii")

    rc = cli.main(["--config", str(temp_config), "engine", "down"])
    out = capsys.readouterr().out
    assert rc == 0
    assert "stale lockfile" in out
    assert not lock_file.exists()


def test_engine_up_unprovisioned_fails_gracefully(
    temp_config: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline.comfy_engine import ComfyEngine

    # Sin sondas de socket en tests: puerto libre y sin instancia previa.
    monkeypatch.setattr(ComfyEngine, "_system_stats_ok", lambda self: False)
    monkeypatch.setattr(ComfyEngine, "_port_open", lambda self: False)
    # Sin workspace ni python_exe: EngineStartError -> mensaje, exit 1, sin traceback.
    rc = cli.main(["--config", str(temp_config), "engine", "up"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "[FAIL]" in out
    assert "Traceback" not in out


def test_unknown_command_exits_nonzero() -> None:
    with pytest.raises(SystemExit) as excinfo:
        cli.main(["frobnicate"])
    assert excinfo.value.code != 0


# ----------------------------------------------------------------------- run


def test_run_wires_arguments_to_orchestrator(
    temp_config: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline import orchestrator

    captured: dict = {}

    def fake_run_episode(episode, phase, only, force, cfg):
        captured.update(episode=episode, phase=phase, only=only, force=force)
        return orchestrator.Summary(episode=episode, outcomes=())

    monkeypatch.setattr(orchestrator, "run_episode", fake_run_episode)
    rc = cli.main(
        ["--config", str(temp_config), "run", "--episode", "e01", "--phase", "images", "--only", "s03,s07", "--force"]
    )
    assert rc == 0
    assert captured == {"episode": "e01", "phase": "images", "only": {"s03", "s07"}, "force": True}


def test_run_defaults_phase_all_and_no_only(
    temp_config: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline import orchestrator

    captured: dict = {}

    def fake_run_episode(episode, phase, only, force, cfg):
        captured.update(phase=phase, only=only, force=force)
        return orchestrator.Summary(episode=episode, outcomes=())

    monkeypatch.setattr(orchestrator, "run_episode", fake_run_episode)
    assert cli.main(["--config", str(temp_config), "run", "--episode", "e01"]) == 0
    assert captured == {"phase": "all", "only": None, "force": False}


def test_run_exit_code_nonzero_when_any_failed(
    temp_config: Path, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    from pipeline import orchestrator
    from pipeline.orchestrator import SceneOutcome, Summary

    def fake_run_episode(episode, phase, only, force, cfg):
        return Summary(
            episode=episode,
            outcomes=(
                SceneOutcome("s01", "image", "DONE", 1.0, None),
                SceneOutcome("s02", "image", "FAILED", 0.5, None, "boom"),
            ),
        )

    monkeypatch.setattr(orchestrator, "run_episode", fake_run_episode)
    rc = cli.main(["--config", str(temp_config), "run", "--episode", "e01"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "FAILED" in out  # la tabla refleja el estado por escena


def test_run_missing_manifest_fails_gracefully(
    temp_config: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    rc = cli.main(["--config", str(temp_config), "run", "--episode", "e99"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "[FAIL]" in out
    assert "Traceback" not in out
