# IMPLEMENTATION_PLAN.md

Reglas de trabajo: una fase por vez, commit(s) por fase, no avanzar sin cumplir
el criterio de aceptación. Las fases 0.5 y el gate de benchmark son del humano.
Ante cualquier ambigüedad sobre el código de audio existente: preguntar, no
asumir.

---

## Fase 0 — Provisión

**Entregables**: `scripts/setup.ps1` + `scripts/_checks.ps1` según
SETUP_PROVISIONING (§1–§4, §7), `config/pipeline.toml` inicial,
`docs/BENCHMARK.md` (plantilla vacía con la tabla de §Gate), `.gitignore`.

**Criterios de aceptación**:
- `setup.ps1` es idempotente: segunda ejecución termina en segundos sin
  re-descargar.
- Árbol de modelos completo bajo `vendor/ComfyUI/models/` (9 ficheros, ~55 GB).
- `comfy launch` abre la GUI sin errores en consola.
- `vendor/comfyui.pin` escrito y `[engine].comfyui_pin` actualizado.

## Fase 0.5 — Export de workflows (HUMANO)

Seguir SETUP_PROVISIONING §5. Entregables: `workflows/zimage_t2i_fp8.api.json`
y `workflows/wan22_i2v_q5.api.json` commiteados, con los títulos reservados de
SPEC_COMFY_ENGINE §7.

**Criterio**: ambos JSON recargan en la GUI sin nodos rojos; un grep de los
títulos reservados sobre cada JSON encuentra exactamente los esperados (el de
vídeo con `SEED` ×2).

## Fase 1 — Motor

**Entregables**: `pipeline/config.py`, `pipeline/errors.py`,
`pipeline/comfy_engine.py`, `pipeline/workflows.py`, `pipeline/cli.py` con
`validate` y `engine up|down`, `tests/unit/` de workflows y config con fixtures.

**Criterios**:
- `pytest` (unitarios) en verde, sin GPU.
- `python -m pipeline validate` → OK: nodos requeridos (incluido
  `UnetLoaderGGUF`) en object_info, workflows validan, modelos presentes,
  reporta si `POST /free` existe en la versión pineada.
- `python -m pipeline engine up` deja la GUI accesible; `down` no deja
  procesos huérfanos (comprobar en el administrador de tareas).
- Script temporal o test gpu mínimo: submit del workflow de imagen con prompt
  fijo produce un PNG en `output/`.

## GATE — Benchmark (HUMANO, bloquea Fase 2)

Rellenar `docs/BENCHMARK.md`:

| Medida | Valor | Condiciones |
|---|---|---|
| Imagen 1248×720, 8 pasos | ___ s | VRAM libre inicial: ___ |
| Clip 832×480×81f, Q5_K_M + Lightning | ___ s | pico VRAM: ___ |
| OOM observado | sí/no | en qué paso |
| Decisión de cuantización | Q5_K_M / Q4_K_M / Q4_K_S | |

Expectativas orientativas (no contractuales): imagen en segundos de un dígito
alto; clip en 2–6 min. Si el clip Q5 da OOM estable → bajar a Q4_K_M
(SETUP §4), re-exportar el workflow apuntando a los nuevos ficheros, actualizar
`[models].video_quant` y repetir. La decisión queda escrita; el código no la
adivina.

## Fase 2 — Imágenes

**Entregables**: `pipeline/specs.py`, `pipeline/images.py`, sidecars,
idempotencia, `run --episode --phase images`, manifest de un episodio demo
(`assets/e01/manifest.json` con 3 escenas de prueba).

**Criterios**:
- `run --episode e01 --phase images` genera 3 PNG + 3 sidecars válidos contra
  el esquema de SPEC_PIPELINE §3.
- Re-ejecución inmediata: 3 SKIP, < 30 s total (incluyendo arranque del motor).
- `--only s02 --force` regenera exactamente una escena.
- Unitarios de sidecar, hash e idempotencia en verde.

## Fase 3 — Vídeos

**Entregables**: `pipeline/videos.py` (upload a `input/`, limpieza, política
OOM completa de SPEC_COMFY_ENGINE §6), `run --phase videos`.

**Criterios**:
- Desde los stills de Fase 2: 2 clips MP4 + sidecars con `source_image` y
  `models` extraídos del workflow real.
- Un job con still inexistente → FAILED con mensaje accionable, sin tocar el
  motor.
- `vendor/ComfyUI/input/` queda limpio tras el run (éxito y fallo).

## Fase 4 — Orchestrator completo

**Entregables**: `pipeline/orchestrator.py` final (fases, `only`, `force`,
resumen tabla, exit codes, ciclo de vida del motor en `finally`), manejo del
caso "dos restarts → abortar episodio".

**Criterios**:
- `run --phase all` sobre el episodio demo: tabla final coherente, exit 0.
- Inyectar un fallo (escena con prompt vacío en manifest → rechazada en
  validación; escena con still borrado en fase videos) → el episodio continúa,
  exit ≠ 0, la tabla refleja FAILED solo donde toca.
- Prueba manual de OOM (subir `frames` a 161 en una escena): se observa la
  secuencia free_vram → retry y el log lo cuenta. Revertir después.

## Fase 5 — Integración con la app de audio (HUMANO EN EL LOOP)

1. Explorar el código existente: cómo se invoca la generación de audio, si el
   modelo TTS reside en GPU de forma persistente, desde dónde tendría sentido
   lanzar `pipeline run`.
2. Proponer (en un comentario/PR, sin implementar): punto de enganche, mecanismo
   de liberación de VRAM si aplica, y el comando unificado por episodio
   (audio → imágenes → clips).
3. Tras confirmación del autor: implementar. El paquete `pipeline/` no debe
   ganar imports del código de audio; la dependencia va en sentido contrario o
   vive en un script orquestador superior.

**Criterio**: un comando produce, para el episodio demo, audio + stills + clips
sin intervención manual ni conflictos de VRAM.

## Fase 6 (opcional, post-v1) — Postproceso

Workflow separado `wan_post_upscale_rife.api.json` (upscale ×2 + RIFE 16→32 fps),
custom nodes opcionales de SETUP §3, flag `[post].enabled`, fase `post` en el
orchestrator. Solo si el autor decide no hacer el escalado en DaVinci. Requiere
su propio mini-benchmark de VRAM antes de activarse por defecto.

---

## Definición de hecho global (v1 = fin de Fase 4)

Un episodio definido en un manifest se materializa en assets reproducibles con
metadatos completos mediante dos comandos (`validate`, `run --phase all`), en
una RTX 4070 Super de 12 GB, sin tocar la GUI de ComfyUI salvo en la fase de
diseño de workflows, y sin que ningún fallo individual tire el run completo.
