# SPEC_PIPELINE.md

Contratos de `images.py`, `videos.py`, `orchestrator.py` y `cli.py`, más los
formatos de datos (manifest y sidecar) que constituyen la reproducibilidad del
proyecto.

## 1. Specs de generación (dataclasses, `pipeline/specs.py`)

```python
@dataclass(frozen=True)
class ImageSpec:
    asset_id: str                 # p. ej. "e01_s03"
    prompt: str                   # prompt completo ya compuesto (ver §4 defaults)
    negative: str = ""            # vacío = respetar el del workflow
    seed: int = 0                 # siempre resuelto antes de llegar aquí (§4)
    width: int = 1248
    height: int = 720
    # steps/cfg NO van en el spec: son fuente de verdad del workflow (ADR-005).

@dataclass(frozen=True)
class VideoSpec:
    asset_id: str
    source_image: Path            # still ya generado
    prompt: str                   # prompt de movimiento
    negative: str = ""
    seed: int = 0
    width: int = 832
    height: int = 480
    frames: int = 81              # ~5 s a 16 fps

@dataclass(frozen=True)
class AssetResult:
    path: Path
    sidecar: Path
    timings: dict                 # {"queue_s": float, "exec_s": float}
    skipped: bool = False
```

Validaciones en `__post_init__` (vía función auxiliar, dataclass frozen):
`width % 16 == 0`, `height % 16 == 0`, `frames` en rango [17, 121], prompt no
vacío, `asset_id` con patrón `^e\d{2,}_s\d{2,}(_[a-z0-9]+)?$`.

## 2. Funciones principales

```python
def generate_image(spec: ImageSpec, engine: ComfyEngine, cfg: Config) -> AssetResult
def animate_image(spec: VideoSpec, engine: ComfyEngine, cfg: Config) -> AssetResult
```

Ambas siguen el mismo esqueleto: idempotencia → parametrizar workflow →
(`upload_input` solo vídeo) → `submit`/`wait` con la política de reintento OOM
de SPEC_COMFY_ENGINE §6 → mover output a `assets/` → escribir sidecar →
limpiar input temporal. Mover, no copiar: `vendor/ComfyUI/output/` no es un
almacén, es un buzón.

## 3. Sidecar — esquema (`<asset>.json` junto al binario)

```json
{
  "schema": 1,
  "asset_id": "e01_s03",
  "kind": "video",
  "created_at": "2026-06-10T18:42:11+02:00",
  "params_hash": "sha256:...",
  "workflow": { "file": "workflows/wan22_i2v_q5.api.json", "sha256": "..." },
  "params": {
    "prompt": "slow fog drifting around the tower, static camera, subtle wind",
    "negative": "",
    "seed": 990103,
    "width": 832, "height": 480, "frames": 81
  },
  "source_image": "assets/e01/images/e01_s03.png",
  "models": {
    "diffusion": ["Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf",
                   "Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf"],
    "loras": ["wan22_i2v_lightning4_high.safetensors",
               "wan22_i2v_lightning4_low.safetensors"],
    "text_encoder": "umt5_xxl_fp8_e4m3fn_scaled.safetensors",
    "vae": "wan_2.1_vae.safetensors"
  },
  "engine": { "comfyui_pin": "<git sha>", "gpu": "RTX 4070 Super 12GB" },
  "timings": { "queue_s": 0.4, "exec_s": 217.8 }
}
```

Para imagen: `kind: "image"`, sin `source_image`, `models` con los tres ficheros
de Z-Image. La lista `models` se extrae **leyendo el workflow parametrizado**
(valores de los nodos loader), no de constantes: así el sidecar nunca miente si
alguien cambia un fichero en la GUI.

`params_hash = sha256( canonical_json(params + source_image_sha256_si_video) + workflow_sha256 )`.
Canonical = claves ordenadas, sin espacios. Si cambia el workflow, cambia el
hash: correcto, porque el resultado cambiaría.

## 4. Manifest del episodio (`assets/<ep>/manifest.json`)

```json
{
  "schema": 1,
  "episode": "e01",
  "defaults": {
    "image_suffix": ", abandoned stone tower, dense fog, cold blue hour, ominous, cinematic, 35mm film grain",
    "motion_suffix": ", static camera, slow drift"
  },
  "scenes": [
    { "id": "s01",
      "image_prompt": "wide shot of the tower emerging from the mist",
      "motion_prompt": "fog rolling slowly across the frame" },
    { "id": "s02",
      "image_prompt": "rusted iron door at the tower base, peeling paint",
      "motion_prompt": "almost imperceptible camera push-in",
      "seed": 4471 }
  ]
}
```

Reglas de resolución:

- Prompt final = `image_prompt + defaults.image_suffix` (ídem motion). El
  suffix centraliza la coherencia visual de la serie; cambiarlo invalida los
  hashes de todo el episodio, que es exactamente el comportamiento deseado.
- Seed: si la escena no la fija →
  `int.from_bytes(sha256(f"{episode}/{id}".encode()).digest()[:4], "big")`.
  Determinista entre ejecuciones y máquinas. La misma seed se usa para imagen
  y para vídeo de la escena (son assets distintos con hash distinto igualmente).
- `asset_id = f"{episode}_{id}"`.
- Validar el manifest al cargar (schema, ids únicos, patrón de id) con mensajes
  de error que citen la escena ofensiva.

## 5. Idempotencia

Antes de generar: si existen binario + sidecar y `sidecar.params_hash` coincide
con el calculado → `AssetResult(skipped=True)`. `--force` ignora la
comprobación. Sidecar huérfano o hash distinto → regenerar (y sobrescribir).
Binario sin sidecar → regenerar: sin metadatos no hay reproducibilidad.

## 6. Orchestrator

```python
def run_episode(episode: str, phase: Literal["images","videos","all"],
                only: set[str] | None, force: bool, cfg: Config) -> Summary
```

- Orden estricto: fase `images` completa antes de `videos` (los clips dependen
  de los stills, y agrupar por modalidad evita recargar modelos: ADR-006).
- `videos` exige que el still de cada escena exista; si falta → FAILED de esa
  escena con mensaje "ejecuta primero --phase images", no generación implícita.
- Política de fallo: un FAILED no aborta el episodio; se continúa con el resto
  y se reporta al final. Excepción: `EngineStartError` o dos `restart()` del
  motor en el mismo run → abortar todo (el entorno está roto, seguir es ruido).
- `Summary`: por escena → estado, duración, ruta. Impreso como tabla y exit
  code 0 solo si no hay FAILED.
- El orchestrator es dueño del ciclo de vida del engine: `start()` al inicio
  del run, `stop()` en `finally`.

## 7. CLI (`python -m pipeline ...`, argparse, sin dependencias extra)

```
pipeline validate                  # engine up efímero: nodos requeridos en
                                   # object_info, workflows cargan y validan,
                                   # ficheros de modelos presentes con tamaño
                                   # plausible, GPU libre (nvidia-smi)
pipeline engine up|down            # modo debug / uso manual de la GUI
pipeline run --episode e01 [--phase images|videos|all] [--only s03,s07] [--force]
```

`validate` es el comando que se ejecuta tras cualquier provisión o bump de pin,
y el primer sospechoso ante cualquier fallo raro.

## 8. Configuración (`config/pipeline.toml`)

```toml
[engine]
workspace = "vendor/ComfyUI"
python_exe = "vendor/ComfyUI/.venv/Scripts/python.exe"   # lo fija setup.ps1
host = "127.0.0.1"
port = 8188
start_timeout_s = 180
comfyui_pin = "<git sha>"

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
oom_max_retries = 2        # free_vram → restart → fail

[models]
video_quant = "Q5_K_M"     # informativo: validate comprueba que los GGUF en
                           # disco coinciden con este nivel

[paths]
assets = "assets"

[post]
enabled = false            # fase opcional (ADR-004), sin implementar en v1
```

## 9. Integración con el módulo de audio existente (Fase 5 — humano en el loop)

Contrato desde el lado del pipeline: al ejecutar `run`, la GPU debe estar libre
(`validate` lo comprueba). Lo que falta por decidir explorando el código real:
si el TTS vive en el mismo proceso que invocará al pipeline, hay que descargar
su modelo (`del model; torch.cuda.empty_cache()`) antes de las fases visuales;
si la app de audio es un proceso/CLI separado, no hay nada que hacer. El audio
**no** pasa por ComfyUI bajo ningún concepto. Claude Code: en Fase 5, primero
explorar, después proponer el punto de enganche concreto y esperar confirmación.

## 10. Tests

- `tests/unit/` (sin GPU, corren en CI/local siempre): parametrización de
  workflows sobre fixtures reducidos (incluido el caso `SEED` duplicado del
  grafo de vídeo y los errores de título ausente/duplicado), estabilidad de
  `params_hash` (orden de claves irrelevante), resolución de seed determinista,
  validación de manifest y de specs, esquema de sidecar.
- `tests/gpu/` (`@pytest.mark.gpu`, ejecución manual): smoke imagen (512×512,
  seed fija → existe PNG + sidecar válido + re-run hace skip) y smoke vídeo
  (33 frames → existe MP4 + sidecar con `source_image`).
- Los fixtures de workflow son versiones mínimas hechas a mano con la misma
  estructura `{id: {class_type, inputs, _meta.title}}`; no requieren ComfyUI.
