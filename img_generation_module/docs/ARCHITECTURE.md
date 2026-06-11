# ARCHITECTURE.md

## 1. Visión

Pipeline por episodio. La unidad de trabajo es la **escena**; cada escena produce
una imagen fija (still) y un clip que la anima.

```
guion ──► audio (módulo existente, fuera de este trabajo)
            │
manifest ──► FASE images ──► assets/<ep>/images/*.png  (+ sidecar .json)
            │
            └► FASE videos ──► assets/<ep>/clips/*.mp4  (+ sidecar .json)
                                      │
                                      └► edición manual (DaVinci / CapCut)
```

El flujo replica el método de trabajo actual del autor (still → animación I2V),
pero en local: la imagen generada es el primer frame del clip.

## 2. Modelo de procesos

Dos procesos, un solo dueño de la GPU en cada instante:

```
┌─────────────────────────────┐         HTTP :8188 (REST)        ┌──────────────────────────────┐
│  Proceso app (Python)       │ ───────────────────────────────► │  Subproceso ComfyUI          │
│                             │         WS /ws?clientId=...      │  (vendor/ComfyUI, venv       │
│  pipeline.orchestrator      │ ◄─────────────────────────────── │   propio, dueño de la GPU)   │
│  pipeline.comfy_engine ─────┼── Popen / terminate ───────────► │                              │
│  módulo de audio (existente)│                                  │  modelos: Z-Image fp8,       │
└─────────────┬───────────────┘                                  │  Wan2.2 I2V GGUF Q5 ×2,      │
              │ filesystem compartido                            │  umt5 fp8, VAEs, LoRAs       │
              ▼                                                  └──────────┬───────────────────┘
   workflows/*.api.json (lectura)                                           │
   vendor/ComfyUI/input/   (la app deposita stills para I2V)  ◄─────────────┤
   vendor/ComfyUI/output/  (ComfyUI deposita resultados)      ──────────────┘
   assets/<ep>/...         (destino final: la app mueve y escribe sidecars)
```

Por qué dos procesos y no uno (resumen; evidencia en ADR-001):

- La combinación que hace viable Wan 2.2 A14B en 12 GB (GGUF + LoRAs Lightning
  4-step + offload inteligente) está empaquetada en el ecosistema ComfyUI y sin
  soporte oficial en diffusers.
- Aislamiento de VRAM: el proceso de la app (y su TTS) nunca compite en el mismo
  espacio CUDA con los modelos de visión. La frontera es el sistema operativo.
- Las dependencias de torch de ComfyUI no contaminan el venv de la app.

## 3. Componentes (paquete `pipeline/`)

| Módulo | Responsabilidad única |
|---|---|
| `config.py` | Carga y valida `config/pipeline.toml`; expone un objeto `Config` inmutable |
| `comfy_engine.py` | Ciclo de vida del subproceso ComfyUI + cliente HTTP/WS. No sabe nada de escenas ni assets |
| `workflows.py` | Carga de JSON API, localización de nodos por `_meta.title`, setters de parámetros, hash de parámetros. Puro, sin red, 100% testeable sin GPU |
| `images.py` | `generate_image(ImageSpec) -> AssetResult`. Orquesta engine + workflows para T2I |
| `videos.py` | `animate_image(VideoSpec) -> AssetResult`. Sube el still a `input/`, orquesta I2V |
| `orchestrator.py` | Lee el manifest del episodio, planifica jobs, ejecuta en serie, idempotencia, resumen |
| `cli.py` | Entrypoints `python -m pipeline ...` |

Dependencias entre módulos (estricto, sin ciclos):

```
cli ──► orchestrator ──► images / videos ──► comfy_engine
                                  │                │
                                  └────► workflows ┘
                                  (todos) ──► config
```

## 4. Flujo de datos de un asset de vídeo (secuencia)

1. Orchestrator lee `assets/e01/manifest.json`, construye `VideoSpec` para la
   escena (seed determinista si el manifest no lo fija).
2. Comprueba idempotencia: si existe `clips/e01_s03.mp4` y su sidecar tiene el
   mismo `params_hash`, marca SKIP y pasa al siguiente.
3. `videos.py` copia `assets/e01/images/e01_s03.png` a
   `vendor/ComfyUI/input/e01_s03__<hash8>.png` (nombre único, sin colisiones).
4. `workflows.py` carga `workflows/wan22_i2v_q5.api.json`, fija prompt de
   movimiento, seed, imagen de entrada, tamaño y nº de frames por título de nodo.
5. `comfy_engine.submit(wf)` → `prompt_id`. `wait(prompt_id, timeout=900)`
   escucha el WS (frames binarios de preview se descartan) hasta completion o
   `execution_error`.
6. `collect_outputs(prompt_id)` resuelve los ficheros en `vendor/ComfyUI/output/`
   vía `/history/{prompt_id}`.
7. La app **mueve** el MP4 a `assets/e01/clips/e01_s03.mp4` y escribe
   `assets/e01/clips/e01_s03.json` (sidecar con parámetros efectivos, hashes,
   tiempos y versión del motor).
8. Limpieza: borra el still temporal de `input/`.

El flujo de imagen es idéntico sin los pasos 3 y 8.

## 5. Gestión de memoria

Regla única: **secuenciar, no convivir**.

- Dentro de una fase, los jobs van uno a uno. ComfyUI gestiona su propio offload
  (umt5 a CPU, swap entre experto high-noise y low-noise).
- Entre fases no hay nada que liberar en la app: visión vive en el subproceso.
- El módulo de audio existente debe liberar su VRAM **antes** de lanzar fases
  visuales si comparte máquina y proceso. El mecanismo concreto se decide en
  Fase 5 explorando ese código; hasta entonces el pipeline asume GPU libre al
  arrancar (y `validate` lo comprueba leyendo `nvidia-smi`).
- Ante OOM en un job: `POST /free` + 1 reintento; si reincide, reinicio
  controlado del subproceso + 1 reintento final. Detalle en SPEC_COMFY_ENGINE §6.

## 6. Layout del repositorio

```
repo/
├── CLAUDE.md
├── config/
│   └── pipeline.toml
├── docs/
│   ├── ARCHITECTURE.md  DECISIONS.md  SETUP_PROVISIONING.md
│   ├── SPEC_COMFY_ENGINE.md  SPEC_PIPELINE.md  IMPLEMENTATION_PLAN.md
│   └── BENCHMARK.md            # lo rellena el humano en el gate
├── pipeline/                   # paquete nuevo (este trabajo)
│   ├── __init__.py  __main__.py  cli.py  config.py
│   ├── comfy_engine.py  workflows.py  images.py  videos.py  orchestrator.py
├── workflows/                  # artefactos versionados, exportados de la GUI
│   ├── zimage_t2i_fp8.api.json
│   └── wan22_i2v_q5.api.json
├── scripts/
│   └── setup.ps1
├── assets/                     # salida por episodio
│   └── e01/
│       ├── manifest.json
│       ├── images/  e01_s01.png  e01_s01.json ...
│       └── clips/   e01_s01.mp4  e01_s01.json ...
├── tests/
│   ├── unit/        # sin GPU: workflows, sidecars, config, manifest
│   ├── fixtures/    # JSONs de workflow reducidos para tests
│   └── gpu/         # @pytest.mark.gpu: smoke image / smoke video
├── vendor/                     # NO versionado (.gitignore)
│   └── ComfyUI/                # workspace instalado por comfy-cli (venv propio dentro)
└── <código existente de audio> # no tocar hasta Fase 5
```

`.gitignore`: `vendor/`, `assets/**/*.png`, `assets/**/*.mp4` (los sidecars y
manifests **sí** se versionan: son la reproducibilidad del proyecto).

## 7. Estados de un job

`PENDING → SUBMITTED → RUNNING → (DONE | SKIPPED | FAILED_OOM | FAILED)`

El orchestrator imprime al final una tabla por escena con estado, duración y
ruta, y devuelve exit code ≠ 0 si hay algún FAILED. Los detalles de detección de
error y reintentos viven en SPEC_COMFY_ENGINE; la política (cuántos reintentos,
cuándo abortar el episodio) en SPEC_PIPELINE §6.
