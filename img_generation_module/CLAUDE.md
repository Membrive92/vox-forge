# CLAUDE.md — Pipeline visual local (imagen + vídeo)

## Qué es este proyecto

Aplicación Python que ya genera audio (TTS con modelos locales) para una serie de
ficción en YouTube. Este trabajo añade dos capacidades nuevas, 100% locales:

1. **Generación de imágenes** (text-to-image) con Z-Image-Turbo.
2. **Generación de clips de vídeo** (image-to-video) con Wan 2.2 I2V A14B.

Ambas se ejecutan a través de **ComfyUI embebido como subproceso gestionado** por
la app. La app envía grafos JSON por HTTP, escucha un WebSocket y recoge ficheros.
El usuario final nunca abre ComfyUI: es un motor interno.

El producto de la app son **assets** (PNG + MP4 + metadatos JSON) que el autor
monta a mano en DaVinci Resolve / CapCut. La app NO edita el vídeo final.

## Mapa de documentación

| Fichero | Contenido | Cuándo leerlo |
|---|---|---|
| `docs/ARCHITECTURE.md` | Componentes, procesos, flujo de datos, layout del repo | Antes de escribir cualquier código |
| `docs/DECISIONS.md` | ADRs: por qué ComfyUI, por qué estos modelos, por qué estas cuantizaciones | Antes de proponer cualquier cambio de stack |
| `docs/SETUP_PROVISIONING.md` | Instalación reproducible: comfy-cli, nodos, descargas de modelos con URLs exactas | Fase 0 |
| `docs/SPEC_COMFY_ENGINE.md` | Contrato de `ComfyEngine` y `workflows.py`: protocolo HTTP/WS, errores, parametrización de grafos | Fase 1 |
| `docs/SPEC_PIPELINE.md` | Contratos de imagen/vídeo, sidecars, manifest, orchestrator, CLI | Fases 2–4 |
| `docs/IMPLEMENTATION_PLAN.md` | Fases con criterios de aceptación y gates | Siempre: marca el orden de trabajo |

## Restricciones duras (no negociables)

- **Hardware objetivo fijo**: NVIDIA RTX 4070 Super, **12 GB VRAM**, Windows.
  Toda decisión de cuantización, resolución y concurrencia deriva de ese límite.
- **Un solo trabajo de GPU a la vez.** Nada de paralelismo de generación. El
  orchestrator es estrictamente serial (ver ADR-006).
- **Licencias**: solo modelos generativos con licencia que permita uso comercial
  en la UE. Z-Image y Wan 2.2 son Apache 2.0. **Prohibido** introducir modelos
  Hunyuan (su licencia excluye la Unión Europea) o FLUX.2 dev/klein (licencia
  no comercial de BFL). Detalle y fuentes en ADR-002.
- **Resolución nativa de vídeo: 832×480, 81 frames, 16 fps.** No subir sin pasar
  por el gate de benchmark (ver IMPLEMENTATION_PLAN).
- **Los workflows JSON (formato API) de `workflows/` son artefactos versionados.**
  El código los parametriza localizando nodos por `_meta.title`, nunca por ID
  numérico, y solo modifica los campos permitidos en SPEC_COMFY_ENGINE. El código
  jamás construye ni reordena grafos.
- **ComfyUI y custom nodes van pineados** (commit registrado en config).
  Actualizar es una decisión deliberada del humano, no un efecto secundario.
- El paquete `pipeline/` debe ser **autónomo**: cero imports del código de audio
  existente hasta la Fase 5 (integración), que requiere exploración del repo real
  y revisión humana.

## Qué NO hacer

- No migrar a `diffusers` ni a LightX2V "porque es más limpio". Está evaluado y
  descartado con evidencia en ADR-001. Si crees que el contexto cambió, propónlo
  como nueva ADR, no como refactor silencioso.
- No actualizar ComfyUI, torch ni custom nodes para "arreglar" un bug sin
  registrar el cambio de pin y re-pasar el smoke test.
- No cambiar el nivel de cuantización (Q5_K_M) ni añadir VRAM-tricks sin datos
  del benchmark en `docs/BENCHMARK.md`.
- No añadir telemetría, llamadas a APIs cloud ni dependencias de red en runtime.
  Todo el runtime es local; la red solo se usa en provisión.
- No tocar los IDs numéricos de los JSON de workflow desde código.
- No ejecutar generación de imagen y de vídeo concurrentemente.

## Convenciones de código

- Python ≥ 3.11, type hints completos, `dataclasses` para contratos de datos.
- Dependencias de runtime mínimas: stdlib + `websocket-client`. HTTP con
  `urllib.request` (o `httpx` si se justifica en PR; no ambas).
- Rutas siempre con `pathlib.Path`. Configuración en `config/pipeline.toml`
  (leer con `tomllib`).
- Logging con `logging` estándar; mensajes de log e identificadores en inglés,
  documentación y comentarios en español.
- Sin estado global salvo la configuración cargada. `ComfyEngine` es un objeto
  con ciclo de vida explícito.
- Tests: unitarios sin GPU por defecto; los de integración marcados `@pytest.mark.gpu`
  y excluidos del run normal.

## Comandos

```powershell
# Provisión (una vez, descarga ~55 GB)
scripts\setup.ps1

# Validar entorno (nodos, modelos, workflows)
python -m pipeline validate

# Motor manual (debug)
python -m pipeline engine up
python -m pipeline engine down

# Generación
python -m pipeline run --episode e01 --phase images
python -m pipeline run --episode e01 --phase videos
python -m pipeline run --episode e01 --phase all
python -m pipeline run --episode e01 --only s03 --force

# Tests
pytest                      # unitarios
pytest -m gpu               # integración (requiere GPU y modelos)
```

## Puntos que requieren al humano (no los automatices)

1. **Exportar los dos workflows desde la GUI de ComfyUI** (Fase 0.5): ajuste de
   loaders a GGUF, renombrado de títulos de nodos según convención y
   "Save (API Format)". Instrucciones en SETUP_PROVISIONING §5.
2. **Gate de benchmark** entre Fase 1 y Fase 2: el humano ejecuta el smoke test,
   rellena `docs/BENCHMARK.md` y decide Q5_K_M vs Q4_K_M.
3. **Fase 5** (integración con la app de audio existente): explorar primero el
   código real, proponer el punto de enganche y esperar confirmación.

Si algo en estos documentos contradice lo que encuentras en el código o en el
entorno, para y pregunta: los documentos tienen fecha (junio 2026) y el
ecosistema de modelos locales cambia rápido.
