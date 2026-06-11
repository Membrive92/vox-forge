"""Ciclo de vida del subproceso ComfyUI + cliente HTTP/WS (SPEC_COMFY_ENGINE).

No sabe nada de escenas ni assets: el motor mueve grafos y ficheros, punto.
HTTP con urllib.request (stdlib); websocket-client se importa de forma
perezosa solo en la via rapida de wait(), para que los tests unitarios corran
sin el paquete instalado.
"""

from __future__ import annotations

import atexit
import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from .config import EngineConfig
from .errors import (
    EngineStartError,
    JobFailed,
    JobOOM,
    JobTimeout,
    NodeMissingError,
    WorkflowParamError,
    classify_execution_error,
)

logger = logging.getLogger("pipeline.engine")

# Claves conocidas de outputs en history; el nombre depende del nodo de guardado.
_OUTPUT_KEYS: tuple[str, ...] = ("images", "videos", "gifs", "audio")

_STILL_ACTIVE = 259  # GetExitCodeProcess: proceso aun vivo


def pid_alive(pid: int) -> bool:
    """True si el PID corresponde a un proceso vivo (deteccion de lock obsoleto)."""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        process_query_limited_information = 0x1000
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        exit_code = ctypes.c_ulong()
        ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
        kernel32.CloseHandle(handle)
        return bool(ok) and exit_code.value == _STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def terminate_pid(pid: int, timeout_s: float = 10.0) -> None:
    """Termina un proceso por PID de forma segura en Windows (taskkill /T)."""
    if not pid_alive(pid):
        return
    if sys.platform == "win32":
        # /T mata el arbol completo; primero intento suave sin /F.
        subprocess.run(["taskkill", "/PID", str(pid), "/T"], capture_output=True)
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if not pid_alive(pid):
                return
            time.sleep(0.5)
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True)
    else:
        import signal

        os.kill(pid, signal.SIGTERM)
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            if not pid_alive(pid):
                return
            time.sleep(0.5)
        os.kill(pid, signal.SIGKILL)


class ComfyEngine:
    """Subproceso ComfyUI gestionado: arranque, readiness, trabajo y parada."""

    def __init__(self, cfg: EngineConfig) -> None:
        self._cfg = cfg
        self._proc: subprocess.Popen[bytes] | None = None
        self._log_fh: Any | None = None
        self._attached = False  # instancia previa adoptada: NO matarla en stop()
        self._client_id = uuid.uuid4().hex
        self._submit_times: dict[str, float] = {}
        # vendor/engine.lock: el workspace es vendor/ComfyUI, el lock vive en vendor/.
        self._lock_path: Path = cfg.workspace.parent / "engine.lock"

    # ------------------------------------------------------------- ciclo de vida

    def start(self) -> None:
        """Lanza el subproceso y espera readiness; adopta una instancia previa si responde."""
        if self.is_alive():
            return

        # Proteccion ante un segundo proceso de la app (SPEC §8): el lockfile
        # se comprueba ANTES de cualquier adopcion. Si existe con PID vivo,
        # otro proceso ya gestiona un motor -> EngineStartError, nunca attach.
        self._check_lockfile()

        # Puerto ocupado sin lock vivo: si /system_stats responde es una
        # instancia previa nuestra (p. ej. GUI lanzada a mano) -> adoptarla en
        # modo attach; si no, abortar.
        if self._system_stats_ok():
            logger.info("Existing ComfyUI instance found at %s:%s; attaching (will not stop it)",
                        self._cfg.host, self._cfg.port)
            self._attached = True
            return
        if self._port_open():
            raise EngineStartError(
                f"Port {self._cfg.port} on {self._cfg.host} is occupied by a process that does not "
                f"answer /system_stats. Free the port or change [engine].port in pipeline.toml."
            )

        if not self._cfg.python_exe.is_file():
            raise EngineStartError(
                f"ComfyUI python interpreter not found: {self._cfg.python_exe}. "
                f"Run scripts/setup.ps1 and check [engine].python_exe in pipeline.toml."
            )
        if not (self._cfg.workspace / "main.py").is_file():
            raise EngineStartError(
                f"ComfyUI workspace not provisioned: {self._cfg.workspace}\\main.py missing. "
                f"Run scripts/setup.ps1 first."
            )

        # stdout/stderr al log: nunca a DEVNULL, es la unica forma de
        # diagnosticar cuelgues de carga de modelos.
        self._cfg.log_file.parent.mkdir(parents=True, exist_ok=True)
        self._log_fh = self._cfg.log_file.open("ab")

        cmd = [str(self._cfg.python_exe), "main.py", "--port", str(self._cfg.port), "--disable-auto-launch"]
        creationflags = 0
        if sys.platform == "win32":
            # Grupo de proceso propio: un Ctrl+C en la CLI no mata al motor a traves de la consola.
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
        logger.info("Starting ComfyUI: %s (cwd=%s, log=%s)", " ".join(cmd), self._cfg.workspace, self._cfg.log_file)
        self._proc = subprocess.Popen(
            cmd,
            cwd=str(self._cfg.workspace),
            stdout=self._log_fh,
            stderr=subprocess.STDOUT,
            creationflags=creationflags,
        )
        self._attached = False
        self._write_lockfile(self._proc.pid)
        atexit.register(self.stop)

        # Readiness: poll de /system_stats cada 1 s. El primer arranque tras la
        # provision tarda (kernels, escaneo de modelos): el timeout es generoso.
        deadline = time.monotonic() + self._cfg.start_timeout_s
        while time.monotonic() < deadline:
            if self._proc.poll() is not None:
                self._cleanup_after_failure()
                raise EngineStartError(
                    f"ComfyUI process exited with code {self._proc.returncode} during startup. "
                    f"See log: {self._cfg.log_file}"
                )
            if self._system_stats_ok():
                logger.info("ComfyUI ready at http://%s:%s (pid=%s)", self._cfg.host, self._cfg.port, self._proc.pid)
                return
            time.sleep(1.0)

        self.stop()
        raise EngineStartError(
            f"ComfyUI did not become ready within {self._cfg.start_timeout_s}s. See log: {self._cfg.log_file}"
        )

    def stop(self) -> None:
        """terminate -> wait 10 s -> kill. No mata instancias adoptadas (attach)."""
        atexit.unregister(self.stop)
        if self._attached:
            # No la lanzamos nosotros: solo soltamos la referencia.
            logger.info("Detaching from adopted ComfyUI instance (left running)")
            self._attached = False
            return
        proc = self._proc
        if proc is not None and proc.poll() is None:
            logger.info("Stopping ComfyUI (pid=%s)", proc.pid)
            if sys.platform == "win32":
                terminate_pid(proc.pid, timeout_s=10.0)
            else:
                proc.terminate()
                try:
                    proc.wait(timeout=10.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
            try:
                proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                logger.warning("ComfyUI process did not exit after kill (pid=%s)", proc.pid)
        self._proc = None
        self._remove_lockfile()
        if self._log_fh is not None:
            self._log_fh.close()
            self._log_fh = None

    def restart(self) -> None:
        """Reinicio controlado (politica OOM, SPEC §6)."""
        logger.info("Restarting ComfyUI engine")
        self.stop()
        self.start()

    def detach(self) -> None:
        """Deja el motor corriendo al salir la CLI (`engine up`): desarma el atexit.

        El lockfile se conserva: `engine down` lo usa para parar el proceso.
        """
        atexit.unregister(self.stop)
        self._proc = None
        if self._log_fh is not None:
            self._log_fh.close()
            self._log_fh = None

    def is_alive(self) -> bool:
        """Proceso vivo (o adoptado) y /system_stats responde."""
        if self._attached:
            return self._system_stats_ok()
        if self._proc is None or self._proc.poll() is not None:
            return False
        return self._system_stats_ok()

    # ---------------------------------------------------------------- validacion

    def object_info(self) -> dict[str, Any]:
        """Catalogo de nodos instalados (GET /object_info)."""
        return self._http_json("GET", "/object_info", timeout=30.0)

    def validate_nodes(self, required: set[str]) -> None:
        """NodeMissingError si algun class_type requerido no esta instalado."""
        available = self.object_info()
        missing = sorted(required - set(available))
        if missing:
            raise NodeMissingError(
                f"Required node classes not installed in ComfyUI: {', '.join(missing)}. "
                f"Check custom nodes provision (scripts/setup.ps1, SETUP_PROVISIONING section 3)."
            )

    # -------------------------------------------------------------------- trabajo

    def submit(self, workflow: dict[str, Any]) -> str:
        """Encola el grafo (POST /prompt) y devuelve prompt_id.

        Un 400 aqui significa grafo invalido (nodo desconocido, input mal
        tipado): error de programacion o de provision -> excepcion, sin retry.
        """
        payload = {"prompt": workflow, "client_id": self._client_id}
        try:
            response = self._http_json("POST", "/prompt", payload=payload, timeout=30.0)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if exc.code == 400:
                raise WorkflowParamError(
                    f"ComfyUI rejected the workflow (HTTP 400, invalid graph — do not retry): {body}"
                ) from exc
            raise
        prompt_id = response.get("prompt_id")
        if not isinstance(prompt_id, str):
            raise JobFailed(f"POST /prompt returned no prompt_id: {response}")
        self._submit_times[prompt_id] = time.monotonic()
        logger.info("Submitted prompt %s", prompt_id)
        return prompt_id

    def wait(self, prompt_id: str, timeout_s: float) -> dict[str, Any]:
        """Espera el fin del job: WS como via rapida, history polling como verdad.

        Devuelve la entrada de history con "timings" = {"queue_s", "exec_s"}
        anadido (SPEC §9). Lanza JobOOM/JobFailed/JobTimeout.
        """
        submit_t = self._submit_times.pop(prompt_id, time.monotonic())
        deadline = time.monotonic() + timeout_s
        first_exec_t: float | None = None
        done = False
        entry: dict[str, Any] | None = None

        try:
            first_exec_t, done = self._wait_ws(prompt_id, deadline, submit_t)
        except (JobOOM, JobFailed):
            raise  # veredicto de ejecucion (via WS o history): final, sin fallback
        except JobTimeout:
            # El WS no vio la senal de fin dentro del plazo ("no llega senal de
            # fin", SPEC §4): antes de declarar timeout, el history -- la
            # verdad -- tiene la ultima palabra.
            entry = self._history_entry(prompt_id)
            if entry is None or not self._entry_completed(prompt_id, entry):
                raise
            logger.warning(
                "WS saw no end signal for %s but history shows populated outputs; treating as completed",
                prompt_id,
            )
            done = True
        except Exception as exc:  # caida del WS o paquete ausente -> fallback
            logger.warning("WebSocket fast-path unavailable (%s); falling back to history polling", exc)

        if not done:
            entry = self._wait_poll(prompt_id, deadline)
        if entry is None:
            # El history puede tardar un instante en materializarse tras la senal WS.
            settle_deadline = time.monotonic() + 10.0
            while entry is None and time.monotonic() < settle_deadline:
                entry = self._history_entry(prompt_id)
                if entry is None:
                    time.sleep(0.5)
        if entry is None:
            raise JobFailed(f"Prompt {prompt_id} finished but has no history entry")

        end_t = time.monotonic()
        if first_exec_t is None:
            # Sin eventos WS no hay separacion fiable cola/ejecucion.
            queue_s = 0.0
            exec_s = round(end_t - submit_t, 3)
        else:
            queue_s = round(first_exec_t - submit_t, 3)
            exec_s = round(end_t - first_exec_t, 3)
        entry["timings"] = {"queue_s": queue_s, "exec_s": exec_s}
        return entry

    def collect_outputs(self, prompt_id: str) -> list[Path]:
        """Rutas absolutas de los outputs del job bajo <workspace>/output/.

        Recorre history[prompt_id]["outputs"] mirando las claves conocidas
        (images/videos/gifs/audio) en todos los nodos de salida; el nombre de
        la clave depende del nodo de guardado del template.
        """
        entry = self._history_entry(prompt_id)
        if entry is None:
            raise JobFailed(f"No history entry for prompt {prompt_id}")
        outputs = entry.get("outputs", {})
        paths: list[Path] = []
        for node_output in outputs.values():
            if not isinstance(node_output, dict):
                continue
            for key in _OUTPUT_KEYS:
                for item in node_output.get(key, []):
                    if not isinstance(item, dict):
                        continue
                    filename = item.get("filename")
                    if not filename:
                        continue
                    # Los previews llevan type "temp" y no viven en output/.
                    if item.get("type", "output") != "output":
                        continue
                    subfolder = item.get("subfolder", "") or ""
                    path = (self._cfg.workspace / "output" / subfolder / filename).resolve()
                    if not path.is_file():
                        raise JobFailed(f"Output listed in history does not exist on disk: {path}")
                    paths.append(path)
        return paths

    def upload_input(self, src: Path) -> str:
        """Copia src a <workspace>/input/ con nombre unico; devuelve el filename.

        Nombre: "{asset_id}__{sha1(src)[:8]}{ext}" (asset_id = stem del fichero).
        El borrado al terminar el job es responsabilidad de quien llama.
        """
        if not src.is_file():
            raise FileNotFoundError(f"Input image not found: {src}")
        digest = hashlib.sha1(src.read_bytes()).hexdigest()[:8]
        filename = f"{src.stem}__{digest}{src.suffix}"
        dest_dir = self._cfg.workspace / "input"
        dest_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest_dir / filename)
        logger.info("Uploaded input %s -> input/%s", src.name, filename)
        return filename

    def interrupt(self) -> None:
        """Cancela el job en ejecucion (POST /interrupt)."""
        self._http_json("POST", "/interrupt", payload={}, timeout=10.0)
        logger.info("Interrupt requested")

    def free_vram(self) -> None:
        """POST /free best-effort (SPEC §1, §6): nunca lanza.

        Se invoca en plena escalada OOM, justo cuando el motor puede estar mas
        tocado: cualquier fallo (404, 500, conexion rechazada) se registra y la
        escalada continua hacia el siguiente peldano (retry / restart).
        """
        try:
            self.probe_free_vram()
        except Exception as exc:
            logger.warning("POST /free failed (%s); continuing best-effort", exc)

    def probe_free_vram(self) -> bool:
        """Ejecuta POST /free y reporta si el endpoint existe en la version pineada.

        Check de Fase 1 de `pipeline validate` (SPEC §3): True = disponible;
        False = 404 (warn + no-op). Otros errores HTTP/red se propagan para que
        validate los reporte.
        """
        try:
            self._http_json(
                "POST", "/free", payload={"unload_models": True, "free_memory": True}, timeout=30.0
            )
            logger.info("Requested VRAM free (POST /free)")
            return True
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                logger.warning("POST /free not available in the pinned ComfyUI version; treating as no-op")
                return False
            raise

    # ------------------------------------------------------------ helpers internos

    def _http_json(
        self, method: str, path: str, payload: dict[str, Any] | None = None, timeout: float = 10.0
    ) -> dict[str, Any]:
        """Peticion HTTP JSON a ComfyUI via urllib (stdlib)."""
        url = f"http://{self._cfg.host}:{self._cfg.port}{path}"
        data: bytes | None = None
        headers: dict[str, str] = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read()
        if not body:
            return {}
        return json.loads(body)

    def _system_stats_ok(self) -> bool:
        """True si GET /system_stats responde (readiness / deteccion de instancia previa)."""
        try:
            self._http_json("GET", "/system_stats", timeout=3.0)
            return True
        except Exception:
            return False

    def _port_open(self) -> bool:
        """True si algo escucha en host:port (aunque no sea ComfyUI)."""
        import socket

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(2.0)
            return sock.connect_ex((self._cfg.host, self._cfg.port)) == 0

    def _check_lockfile(self) -> None:
        """Aborta si otro proceso de la app ya lanzo el motor; limpia locks obsoletos."""
        if not self._lock_path.is_file():
            return
        try:
            pid = int(self._lock_path.read_text(encoding="ascii").strip())
        except ValueError:
            logger.warning("Corrupt lockfile %s; removing it", self._lock_path)
            self._lock_path.unlink(missing_ok=True)
            return
        if pid_alive(pid):
            raise EngineStartError(
                f"Lockfile {self._lock_path} exists and its PID {pid} is alive: a ComfyUI engine "
                f"launched by this app is already running (possibly managed by another app process). "
                f"Stop it first (python -m pipeline engine down)."
            )
        logger.warning("Stale lockfile %s (PID %s is dead); removing it", self._lock_path, pid)
        self._lock_path.unlink(missing_ok=True)

    def _write_lockfile(self, pid: int) -> None:
        self._lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock_path.write_text(str(pid), encoding="ascii")

    def _remove_lockfile(self) -> None:
        self._lock_path.unlink(missing_ok=True)

    def _cleanup_after_failure(self) -> None:
        atexit.unregister(self.stop)
        self._proc = None
        self._remove_lockfile()
        if self._log_fh is not None:
            self._log_fh.close()
            self._log_fh = None

    def _wait_ws(self, prompt_id: str, deadline: float, submit_t: float) -> tuple[float | None, bool]:
        """Via rapida por WebSocket. Devuelve (primer_executing_ts, terminado).

        Frames binarios = previews de imagen: descartar SIEMPRE antes de
        json.loads. Tipos desconocidos se ignoran (versiones nuevas anaden tipos).
        En cada silencio del WS (timeout de recv, ~2 s) consulta el history por
        si la senal de fin se perdio (SPEC §4). Lanza JobOOM/JobFailed en
        execution_error y JobTimeout si vence el plazo.
        """
        try:
            import websocket  # importacion perezosa: los unit tests no lo necesitan
        except ImportError as exc:
            raise RuntimeError(
                "websocket-client is not installed (pip install websocket-client); "
                "history polling will be used instead"
            ) from exc

        url = f"ws://{self._cfg.host}:{self._cfg.port}/ws?clientId={self._client_id}"
        ws = websocket.create_connection(url, timeout=5.0)
        first_exec_t: float | None = None
        last_progress_log = 0.0
        try:
            ws.settimeout(2.0)
            while time.monotonic() < deadline:
                try:
                    msg = ws.recv()
                except websocket.WebSocketTimeoutException:
                    # 2 s sin trafico WS: consultar history por si la senal de
                    # fin nunca llega (socket medio abierto, job terminado antes
                    # de conectar el WS). Equivale al polling cada 2 s del
                    # fallback (SPEC §4): el history es la verdad.
                    entry: dict[str, Any] | None = None
                    try:
                        entry = self._history_entry(prompt_id)
                    except Exception as exc:
                        # Fallo transitorio del HTTP: el WS sigue siendo la via.
                        logger.debug("History check during WS wait failed: %s", exc)
                    if entry is not None and self._entry_completed(prompt_id, entry):
                        logger.warning(
                            "End signal not seen on WS; history reports prompt %s completed", prompt_id
                        )
                        return first_exec_t, True
                    continue
                if isinstance(msg, bytes):
                    continue  # preview binario: descartar
                try:
                    event = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                etype = event.get("type")
                data = event.get("data", {}) or {}
                if etype == "executing":
                    if data.get("prompt_id") != prompt_id:
                        continue
                    if first_exec_t is None:
                        first_exec_t = time.monotonic()
                    if data.get("node") is None:
                        return first_exec_t, True  # senal canonica de fin
                elif etype == "execution_error":
                    if data.get("prompt_id") not in (None, prompt_id):
                        continue
                    logger.error("execution_error payload: %s", json.dumps(data))
                    raise classify_execution_error(data)
                elif etype == "progress":
                    now = time.monotonic()
                    if now - last_progress_log >= 10.0:
                        logger.info("Progress %s/%s", data.get("value"), data.get("max"))
                        last_progress_log = now
                # status / execution_start / execution_cached / executed /
                # desconocidos: informativos, ignorar sin romper.
            raise JobTimeout(f"Prompt {prompt_id} did not finish within the timeout (WS path)")
        finally:
            try:
                ws.close()
            except Exception:
                pass

    def _wait_poll(self, prompt_id: str, deadline: float) -> dict[str, Any]:
        """Fallback de robustez: polling de /history cada 2 s. El history es la verdad."""
        while time.monotonic() < deadline:
            entry = self._history_entry(prompt_id)
            if entry is not None and self._entry_completed(prompt_id, entry):
                return entry
            time.sleep(2.0)
        raise JobTimeout(f"Prompt {prompt_id} did not finish within the timeout (history polling)")

    def _entry_completed(self, prompt_id: str, entry: dict[str, Any]) -> bool:
        """Interpreta una entrada de history: True si equivale a completado (SPEC §4).

        Completado = `outputs` poblados o `status.completed == true`. Si la
        entrada registra un execution_error, lanza JobOOM/JobFailed: el history
        es la verdad tambien para los fallos.
        """
        status = entry.get("status", {}) or {}
        for message in status.get("messages", []) or []:
            if isinstance(message, (list, tuple)) and len(message) >= 2 and message[0] == "execution_error":
                payload = message[1] if isinstance(message[1], dict) else {}
                logger.error("execution_error payload (history): %s", json.dumps(payload))
                raise classify_execution_error(payload)
        if status.get("status_str") == "error":
            raise JobFailed(f"Prompt {prompt_id} ended in error state: {status}")
        return bool(entry.get("outputs")) or status.get("completed") is True

    def _history_entry(self, prompt_id: str) -> dict[str, Any] | None:
        """Entrada de GET /history/{prompt_id}, o None si aun no existe."""
        history = self._http_json("GET", f"/history/{prompt_id}", timeout=10.0)
        entry = history.get(prompt_id)
        return entry if isinstance(entry, dict) else None
