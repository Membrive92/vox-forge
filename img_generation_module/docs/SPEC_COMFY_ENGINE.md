# SPEC_COMFY_ENGINE.md

Contratos de `pipeline/comfy_engine.py` y `pipeline/workflows.py`. Todo lo de
este documento es implementable y testeable sin conocer nada de escenas,
episodios ni assets: el motor mueve grafos y ficheros, punto.

## 1. API pública de `ComfyEngine`

```python
class ComfyEngine:
    def __init__(self, cfg: EngineConfig): ...

    # ciclo de vida
    def start(self) -> None            # lanza subproceso y espera readiness
    def stop(self) -> None             # terminate → wait 10 s → kill
    def restart(self) -> None
    def is_alive(self) -> bool         # proceso vivo + /system_stats responde

    # validación
    def object_info(self) -> dict
    def validate_nodes(self, required: set[str]) -> None   # NodeMissingError

    # trabajo
    def submit(self, workflow: dict) -> str                # → prompt_id
    def wait(self, prompt_id: str, timeout_s: float) -> dict   # → history entry
    def collect_outputs(self, prompt_id: str) -> list[Path]    # rutas absolutas en output/
    def upload_input(self, src: Path) -> str               # → filename dentro de input/
    def interrupt(self) -> None
    def free_vram(self) -> None        # best-effort, ver §6
```

`EngineConfig` (subset de `[engine]` en pipeline.toml): `workspace: Path`,
`python_exe: Path`, `host: str = "127.0.0.1"`, `port: int = 8188`,
`start_timeout_s: int = 180`, `log_file: Path`.

## 2. Arranque del subproceso

```python
cmd = [str(cfg.python_exe), "main.py", "--port", str(cfg.port), "--disable-auto-launch"]
proc = subprocess.Popen(cmd, cwd=cfg.workspace, stdout=log_fh, stderr=subprocess.STDOUT)
```

- stdout/stderr a `vendor/logs/comfyui.log` (append; rotar por tamaño es
  opcional v1.1). Nunca a DEVNULL: el log es la única forma de diagnosticar
  cuelgues de carga de modelos.
- Readiness: poll de `GET http://host:port/system_stats` cada 1 s hasta
  `start_timeout_s`. El primer arranque tras la provisión tarda (compilación de
  kernels, escaneo de modelos): 180 s no es exagerado.
- `atexit.register(self.stop)` y manejo de Ctrl+C en CLI para no dejar huérfanos.
- Si el puerto está ocupado al arrancar: comprobar si responde `/system_stats`
  (instancia previa nuestra → adoptarla en modo "attach" y NO matarla en stop si
  no la lanzamos nosotros) o abortar con `EngineStartError` indicando el puerto.

## 3. Protocolo HTTP

| Endpoint | Uso |
|---|---|
| `POST /prompt` body `{"prompt": <workflow>, "client_id": <uuid>}` | encola; respuesta `{"prompt_id": ...}`. Un 400 aquí significa grafo inválido (nodo desconocido, input mal tipado): error de programación o de provisión, no reintentar |
| `GET /history/{prompt_id}` | resultado y outputs cuando termina |
| `GET /view?filename=&subfolder=&type=output` | descarga de un output (no necesario si compartimos filesystem; preferimos resolver la ruta en disco) |
| `POST /upload/image` multipart campo `image` | alternativa a copiar a `input/` (ver §5) |
| `POST /interrupt` | cancela el job en ejecución |
| `POST /free` body `{"unload_models": true, "free_memory": true}` | descarga modelos/VRAM. **Verificar en Fase 1 que existe en la versión pineada**; si responde 404 → tratar como no-op y dejar warning en log |
| `GET /object_info` | catálogo de nodos instalados (validación) |
| `GET /system_stats` | readiness + telemetría básica |

## 4. Protocolo WebSocket (`ws://host:port/ws?clientId=<uuid>`)

Mensajes de texto JSON `{"type": ..., "data": {...}}`. Los **frames binarios son
previews de imagen: descartar siempre** (comprobar `isinstance(msg, bytes)`
antes de `json.loads`, o el cliente revienta a mitad de un vídeo).

Tipos relevantes:

- `executing` con `data.node == None` y `data.prompt_id == <nuestro>` →
  **completado**. Es la señal canónica de fin.
- `execution_error` → fallo. `data` incluye `node_id`, `node_type`,
  `exception_type`, `exception_message`, `traceback`. Conservar entero en el log
  y en la excepción.
- `progress` (`value`/`max`) → opcional: alimentar log de progreso cada N saltos.
- `status`, `execution_start`, `execution_cached`, `executed` → informativos.
- Cualquier `type` desconocido → ignorar sin romper (versiones nuevas añaden tipos).

**Fallback de robustez**: si el WS se cae o no llega señal de fin, `wait()` pasa
a polling de `GET /history/{prompt_id}` cada 2 s hasta `timeout_s`. La entrada
de history con `outputs` poblados (o `status.completed == true` si el campo
existe en la versión pineada) equivale a completado. El WS es la vía rápida; el
history es la verdad.

## 5. Entradas y salidas de ficheros

- **Entrada (still para I2V)**: copiar a `<workspace>/input/` con nombre único
  `"{asset_id}__{sha1(src)[:8]}{ext}"`. El workflow referencia ese filename en el
  nodo `INPUT_IMAGE`. Borrar el fichero al terminar el job (éxito o fallo). El
  endpoint `/upload/image` queda como alternativa documentada por si algún día
  el motor corre en otra máquina; en v1 no se usa.
- **Salida**: tras `wait()`, leer `history[prompt_id]["outputs"]` y recolectar
  toda entrada que tenga `filename`, mirando las claves conocidas
  (`images`, `videos`, `gifs`, `audio`) en todos los nodos de salida — el nombre
  de la clave depende del nodo de guardado que use el template. Resolver a ruta
  absoluta: `<workspace>/output/<subfolder>/<filename>` y comprobar existencia.
  `collect_outputs` devuelve la lista; quien llama decide cuál es el principal
  (en nuestros grafos hay exactamente un nodo de guardado, título `SAVE`).

## 6. Errores y política de reintento

Excepciones tipadas (módulo `pipeline.errors`): `EngineStartError`,
`NodeMissingError`, `WorkflowParamError`, `JobTimeout`, `JobOOM`, `JobFailed`.

Clasificación de `execution_error`: si `exception_message` o `exception_type`
contiene `OutOfMemory` o `allocation on device` (case-insensitive) → `JobOOM`;
resto → `JobFailed`.

Política (la ejecuta quien llama, `images.py`/`videos.py`, no el engine):

```
intento 1 ──JobOOM──► engine.free_vram() ── intento 2 ──JobOOM──►
engine.restart() ── intento 3 ──JobOOM/“error──► FAILED definitivo
```

`JobFailed` (no-OOM) no se reintenta: un grafo determinista que falla sin OOM
volverá a fallar; el traceback va al log y al resumen. `JobTimeout` → interrupt()
+ FAILED (los timeouts por defecto, 180 s imagen / 900 s vídeo, ya llevan margen
amplio sobre los tiempos esperados; un timeout indica cuelgue, no lentitud).

## 7. `workflows.py` — parametrización por título

Funciones puras sobre `dict` (el JSON API cargado). Sin red, sin GPU: es el
módulo con mayor cobertura de tests unitarios.

```python
def load(path: Path) -> dict
def find_by_title(wf: dict, title: str) -> str          # → node_id; error si 0 o >1
def set_text(wf, title, text) -> None                   # escribe inputs["text"]
def set_seed(wf, title, seed) -> None                   # ver nota seed
def set_image(wf, title, filename) -> None              # inputs["image"]
def set_size(wf, title, width, height) -> None
def set_length(wf, title, frames) -> None               # inputs["length"]
def params_hash(spec_canonico: dict, workflow_sha: str) -> str
def workflow_sha(path: Path) -> str                     # sha256 del fichero
```

Nota seed: según el nodo, el campo se llama `seed` (KSampler) o `noise_seed`
(KSamplerAdvanced y variantes). `set_seed` escribe en la clave **que ya exista**
en `inputs` y lanza `WorkflowParamError` si no hay ninguna de las dos. En el
grafo de vídeo hay dos samplers (uno por experto): el título `SEED` se asigna a
**ambos** en la GUI y `set_seed` debe aceptar y escribir en múltiples nodos con
ese título — excepción a la regla de unicidad, documentada aquí y solo aquí.

### Títulos reservados (convención de la GUI, paso humano de SETUP §5)

| Título | Grafo imagen | Grafo vídeo | Campo escrito |
|---|---|---|---|
| `PROMPT_POSITIVE` | ✓ | ✓ (prompt de movimiento) | `text` |
| `PROMPT_NEGATIVE` | ✓ | ✓ (mantener el negative del template como valor base) | `text` |
| `SEED` | ✓ (1 nodo) | ✓ (2 nodos, ver nota) | `seed` / `noise_seed` |
| `SIZE` | ✓ | ✓ | `width`, `height` |
| `LENGTH` | — | ✓ | `length` |
| `INPUT_IMAGE` | — | ✓ | `image` |
| `SAVE` | ✓ | ✓ | (solo lectura: identifica el output principal) |

Campos permitidos = exactamente los de la tabla. Cualquier otra mutación del
grafo desde código es un bug (ADR-005).

### Validación al cargar (fail-fast)

`images.py`/`videos.py` llaman al arrancar a una función
`assert_workflow(wf, required_titles, engine.object_info())` que comprueba:
todos los títulos requeridos presentes, todos los `class_type` del grafo
existen en object_info. Así un bump de ComfyUI que rompa un nodo se detecta en
`pipeline validate`, no a mitad de un episodio.

## 8. Concurrencia y locking

El engine no impone cola propia: ComfyUI ya encola internamente. Pero el
contrato del proyecto es serial (ADR-006), así que `orchestrator` es el único
llamador y ejecuta `submit → wait` de uno en uno. Para protegerse de un segundo
proceso de la app por accidente: lockfile (`vendor/engine.lock` con PID) al
hacer `start()`; si existe y el PID vive → `EngineStartError` con mensaje claro.

## 9. Telemetría mínima por job

Devolver junto al resultado: `queue_s` (submit→primer `executing`), `exec_s`
(primer `executing`→fin). Opcional v1.1: muestrear `/system_stats` durante el
job para pico de VRAM. Estos números alimentan el sidecar y `docs/BENCHMARK.md`.
