"""CLI del pipeline: `python -m pipeline validate | engine up | engine down`.

argparse puro, sin dependencias extra (SPEC_PIPELINE §7). Cada check de
`validate` imprime OK/FAIL/WARN; exit code != 0 si hay algun FAIL. Con
vendor/ sin provisionar debe fallar con mensajes accionables, no tracebacks.
"""

from __future__ import annotations

import argparse
import logging
import subprocess
import sys
import urllib.error
from pathlib import Path

from .comfy_engine import ComfyEngine, pid_alive, terminate_pid
from .config import Config, ConfigError, DEFAULT_CONFIG_PATH, load_config
from .errors import EngineStartError, ManifestError, NodeMissingError, SpecError, WorkflowParamError
from .workflows import IMAGE_REQUIRED_TITLES, VIDEO_REQUIRED_TITLES
from . import orchestrator, workflows

logger = logging.getLogger("pipeline.cli")

# Ficheros de modelo esperados bajo <workspace>/models (SETUP_PROVISIONING §4).
# Los GGUF dependen del nivel de cuantizacion activo ([models].video_quant).
_GIB = 1024**3
_MIB = 1024**2


def _expected_models(cfg: Config) -> list[tuple[str, int]]:
    """(ruta relativa bajo models/, bytes minimos plausibles) por fichero."""
    quant = cfg.models.video_quant
    return [
        (f"unet/Wan2.2-I2V-A14B-HighNoise-{quant}.gguf", 7 * _GIB),
        (f"unet/Wan2.2-I2V-A14B-LowNoise-{quant}.gguf", 7 * _GIB),
        ("text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors", 5 * _GIB),
        ("vae/wan_2.1_vae.safetensors", 200 * _MIB),
        ("loras/wan22_i2v_lightning4_high.safetensors", 400 * _MIB),
        ("loras/wan22_i2v_lightning4_low.safetensors", 400 * _MIB),
        # bf16 oficial (Comfy-Org retiro el fp8 pre-cuantizado); el workflow lo
        # carga con weight_dtype=fp8_e4m3fn. Ver SETUP_PROVISIONING seccion 4.
        ("diffusion_models/z_image_turbo_bf16.safetensors", 11 * _GIB),
        ("text_encoders/qwen_3_4b.safetensors", 6 * _GIB),
        ("vae/ae.safetensors", 250 * _MIB),
    ]


class _Report:
    """Acumulador de checks: imprime cada linea y recuerda si hubo FAIL."""

    def __init__(self) -> None:
        self.failed = False

    def ok(self, msg: str) -> None:
        print(f"[OK]   {msg}")

    def warn(self, msg: str) -> None:
        print(f"[WARN] {msg}")

    def fail(self, msg: str) -> None:
        self.failed = True
        print(f"[FAIL] {msg}")


def _check_gpu_free(report: _Report) -> None:
    """GPU libre via nvidia-smi: el pipeline asume VRAM disponible al arrancar."""
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except FileNotFoundError:
        report.fail("gpu: nvidia-smi not found in PATH; cannot verify GPU availability")
        return
    except subprocess.TimeoutExpired:
        report.fail("gpu: nvidia-smi timed out")
        return
    if proc.returncode != 0:
        report.fail(f"gpu: nvidia-smi failed: {proc.stderr.strip()}")
        return
    line = proc.stdout.strip().splitlines()[0] if proc.stdout.strip() else ""
    try:
        used_mib, total_mib = (int(part.strip()) for part in line.split(","))
    except ValueError:
        report.fail(f"gpu: could not parse nvidia-smi output: {line!r}")
        return
    free_mib = total_mib - used_mib
    if free_mib < 10_000:
        report.warn(
            f"gpu: only {free_mib} MiB VRAM free of {total_mib} MiB; close other GPU apps "
            f"(browser, TTS) before running generation"
        )
    else:
        report.ok(f"gpu: {free_mib} MiB VRAM free of {total_mib} MiB")


def _check_models(cfg: Config, report: _Report) -> None:
    models_dir = cfg.engine.workspace / "models"
    if not models_dir.is_dir():
        report.fail(f"models: directory not found: {models_dir}. Run scripts/setup.ps1 to provision.")
        return
    for rel, min_bytes in _expected_models(cfg):
        path = models_dir / rel
        if not path.is_file():
            report.fail(f"model missing: models/{rel}. Run scripts/setup.ps1 to download it.")
            continue
        size = path.stat().st_size
        if size < min_bytes:
            report.fail(
                f"model too small: models/{rel} is {size} bytes (< {min_bytes}); "
                f"truncated download — delete it and re-run scripts/setup.ps1"
            )
        else:
            report.ok(f"model present: models/{rel} ({size / _GIB:.2f} GiB)")


def _load_workflows(cfg: Config, report: _Report) -> dict[str, dict]:
    """Carga ambos workflows y valida titulos requeridos. Devuelve los que cargaron."""
    loaded: dict[str, dict] = {}
    for label, path, titles in (
        ("image", cfg.image.workflow, IMAGE_REQUIRED_TITLES),
        ("video", cfg.video.workflow, VIDEO_REQUIRED_TITLES),
    ):
        if not path.is_file():
            report.fail(
                f"workflow ({label}): file not found: {path}. Export it from the ComfyUI GUI "
                f"(SETUP_PROVISIONING section 5, human step of Fase 0.5)."
            )
            continue
        try:
            wf = workflows.load(path)
        except (WorkflowParamError, ValueError) as exc:
            report.fail(f"workflow ({label}): cannot load {path.name}: {exc}")
            continue
        missing = [t for t in sorted(titles) if not any(
            isinstance(n, dict) and n.get("_meta", {}).get("title") == t for n in wf.values()
        )]
        if missing:
            report.fail(
                f"workflow ({label}): {path.name} is missing reserved titles: {', '.join(missing)} "
                f"(rename nodes in the GUI per SPEC_COMFY_ENGINE section 7 and re-export)"
            )
            continue
        report.ok(f"workflow ({label}): {path.name} loads and has all reserved titles")
        loaded[label] = wf
    return loaded


def _check_engine(cfg: Config, loaded: dict[str, dict], report: _Report) -> None:
    """Checks que requieren motor: object_info, UnetLoaderGGUF, POST /free."""
    workspace_ready = (cfg.engine.workspace / "main.py").is_file() and cfg.engine.python_exe.is_file()
    engine = ComfyEngine(cfg.engine)
    started_here = False

    if not engine.is_alive():
        if not workspace_ready:
            report.fail(
                f"engine: ComfyUI workspace not provisioned at {cfg.engine.workspace} "
                f"(or python_exe missing: {cfg.engine.python_exe}). Run scripts/setup.ps1; "
                f"object_info checks skipped."
            )
            return
        try:
            engine.start()
            started_here = True
        except EngineStartError as exc:
            report.fail(f"engine: could not start ComfyUI: {exc}")
            return

    try:
        try:
            engine.validate_nodes({"UnetLoaderGGUF"})
            report.ok("engine: UnetLoaderGGUF available in object_info")
        except NodeMissingError as exc:
            report.fail(f"engine: {exc}")

        info = engine.object_info()
        for label, wf in loaded.items():
            try:
                titles = IMAGE_REQUIRED_TITLES if label == "image" else VIDEO_REQUIRED_TITLES
                workflows.assert_workflow(wf, titles, info)
                report.ok(f"engine: {label} workflow validates against object_info")
            except (WorkflowParamError, NodeMissingError) as exc:
                report.fail(f"engine: {label} workflow does not validate: {exc}")

        # free_vram() es best-effort y se traga el 404 (SPEC §1); el check de
        # Fase 1 usa la sonda, que si distingue disponible / 404 / otro error.
        try:
            if engine.probe_free_vram():
                report.ok("engine: POST /free is available in the pinned ComfyUI version")
            else:
                report.warn("engine: POST /free not available (404); OOM policy will rely on restart only")
        except urllib.error.HTTPError as exc:
            report.fail(f"engine: POST /free returned HTTP {exc.code}")
        except Exception as exc:
            report.warn(f"engine: could not probe POST /free: {exc}")
    finally:
        if started_here:
            engine.stop()


def cmd_validate(config_path: Path) -> int:
    report = _Report()

    try:
        cfg = load_config(config_path)
        report.ok(f"config: loaded {config_path}")
    except ConfigError as exc:
        report.fail(f"config: {exc}")
        print("\nvalidate: FAILED (config is a prerequisite for every other check)")
        return 1

    if cfg.engine.comfyui_pin == "UNSET":
        report.warn("config: [engine].comfyui_pin is UNSET; run scripts/setup.ps1 and record the pin")

    _check_models(cfg, report)
    loaded = _load_workflows(cfg, report)
    _check_engine(cfg, loaded, report)
    _check_gpu_free(report)

    if report.failed:
        print("\nvalidate: FAILED (see [FAIL] lines above)")
        return 1
    print("\nvalidate: OK")
    return 0


def cmd_engine_up(config_path: Path) -> int:
    try:
        cfg = load_config(config_path)
    except ConfigError as exc:
        print(f"[FAIL] config: {exc}")
        return 1
    engine = ComfyEngine(cfg.engine)
    try:
        engine.start()
    except EngineStartError as exc:
        print(f"[FAIL] engine: {exc}")
        return 1

    lock_path = cfg.engine.workspace.parent / "engine.lock"
    pid = lock_path.read_text(encoding="ascii").strip() if lock_path.is_file() else "unknown (attached)"
    # Dejarlo corriendo: desarmar el atexit antes de salir de la CLI.
    engine.detach()
    print(f"[OK]   engine up: pid={pid}")
    print(f"       GUI: http://{cfg.engine.host}:{cfg.engine.port}")
    print("       Stop it with: python -m pipeline engine down")
    return 0


def cmd_engine_down(config_path: Path) -> int:
    try:
        cfg = load_config(config_path)
    except ConfigError as exc:
        print(f"[FAIL] config: {exc}")
        return 1
    lock_path = cfg.engine.workspace.parent / "engine.lock"
    if not lock_path.is_file():
        print("[WARN] engine down: no lockfile found; nothing to stop (was the engine started by this app?)")
        return 0
    try:
        pid = int(lock_path.read_text(encoding="ascii").strip())
    except ValueError:
        print(f"[WARN] engine down: corrupt lockfile {lock_path}; removing it")
        lock_path.unlink(missing_ok=True)
        return 0
    if not pid_alive(pid):
        print(f"[WARN] engine down: PID {pid} is not running; removing stale lockfile")
        lock_path.unlink(missing_ok=True)
        return 0
    terminate_pid(pid)
    lock_path.unlink(missing_ok=True)
    print(f"[OK]   engine down: stopped PID {pid}")
    return 0


def cmd_run(config_path: Path, episode: str, phase: str, only: str | None, force: bool) -> int:
    """`pipeline run`: genera los assets de un episodio desde su manifest."""
    try:
        cfg = load_config(config_path)
    except ConfigError as exc:
        print(f"[FAIL] config: {exc}")
        return 1

    only_set: set[str] | None = None
    if only:
        only_set = {part.strip() for part in only.split(",") if part.strip()}
        if not only_set:
            only_set = None

    try:
        summary = orchestrator.run_episode(episode, phase, only_set, force, cfg)  # type: ignore[arg-type]
    except (ManifestError, SpecError) as exc:
        print(f"[FAIL] {exc}")
        return 1
    print(orchestrator.format_summary(summary))
    return summary.exit_code


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(prog="pipeline", description="Local visual pipeline (images + video clips)")
    parser.add_argument(
        "--config", type=Path, default=DEFAULT_CONFIG_PATH, help="path to pipeline.toml (default: config/pipeline.toml)"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("validate", help="check provision: nodes, models, workflows, GPU")

    engine_parser = sub.add_parser("engine", help="manual engine control (debug / GUI use)")
    engine_parser.add_argument("action", choices=("up", "down"))

    run_parser = sub.add_parser("run", help="generate the assets of an episode from its manifest")
    run_parser.add_argument("--episode", required=True, help="episode id, e.g. e01")
    run_parser.add_argument("--phase", choices=("images", "videos", "all"), default="all")
    run_parser.add_argument("--only", default=None, help="comma-separated scene ids, e.g. s03,s07")
    run_parser.add_argument("--force", action="store_true", help="regenerate even if params_hash matches")

    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            return cmd_validate(args.config)
        if args.command == "engine":
            if args.action == "up":
                return cmd_engine_up(args.config)
            return cmd_engine_down(args.config)
        if args.command == "run":
            return cmd_run(args.config, args.episode, args.phase, args.only, args.force)
    except KeyboardInterrupt:
        print("\nInterrupted.")
        return 130
    return 2
