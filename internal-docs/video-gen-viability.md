# Generación de vídeo por IA (Wan 2.2 I2V) — estudio de viabilidad

**Fecha**: 2026-06-13
**Estado**: Estudio de viabilidad. **No implementar** lógica de app hasta superar
el gate (ver §6).
**Hardware objetivo**: NVIDIA RTX 4070 Super, 12 GB VRAM, Windows.
**Investigación**: verificada contra código, docs y disco (rama
`feat/session-improvements`, 2026-06-13). Distingue **DISEÑADO** de **VERIFICADO**.

---

## 0. Aclaración: dos cosas distintas llamadas "vídeo"

1. **Render de slideshow** (ffmpeg: portada/imágenes + audio + subtítulos → MP4).
   **Ya hecho y funcionando** (`backend/services/video_renderer.py`). No es
   "generación", es montaje. Fuera del alcance de este estudio.
2. **Clips de vídeo por IA** (animar una imagen fija en movimiento, Wan 2.2 I2V).
   Diseñado en `img_generation_module`, **nunca ejecutado en GPU**. **Este estudio
   trata de (2).**

## 1. Veredicto: **CONDICIONALMENTE VIABLE** ⚠️

Está **diseñado para funcionar, pero no verificado**. Pipeline completo + modelos
en disco, pero: el workflow de Wan no existe (PROD-05 pendiente), `BENCHMARK.md`
está en blanco, y **nunca se ha corrido en la 4070S**. La viabilidad la decide un
único gate (§6). El factor decisivo es **datos reales de GPU**, que hoy no
existen.

## 2. Hecho (verificado — a nivel de código/disco)

- **Pipeline I2V completo** (`img_generation_module/pipeline/videos.py:26-105`):
  verificación de still → subida a `input/` → parametrización por título
  (`PROMPT_POSITIVE/NEGATIVE`, `SEED` en los **dos** samplers, `SIZE`, `LENGTH`,
  `INPUT_IMAGE`) → submit/wait → mover MP4 a `assets/<ep>/clips/` → sidecar con
  `source_image` → limpieza garantizada del still en `finally`.
- **Validación de specs** (`specs.py:73-88`): 832×480, frames 17-121, múltiplos
  de 16.
- **Política OOM de 3 niveles** (`job_runner.py:49-99`):
  `free_vram → restart → fail`, con contador de restarts.
- **Idempotencia** por `params_hash` (incluye SHA-256 del still origen + del
  workflow): si cambia el still o el grafo, se regenera.
- **13 tests unitarios de vídeo pasan SIN GPU** (`tests/test_videos.py`) con
  `FakeEngine` que mockea ComfyUI.
- **Modelos descargados** (`vendor/ComfyUI/models/`): los dos expertos Wan Q5
  (~11 GB cada uno), `umt5_xxl_fp8` (~6,3 GB), VAE, las dos LoRAs Lightning.
  ComfyUI pineado a `6d18f4ad`. Confirmado en disco (timestamps 10-11 jun).
- **App: `clip` ya es tipo de medio de primera clase**
  (`backend/services/media_store.py`: `_VALID_KINDS = {"image","clip"}` +
  `duration_s`). Un clip importado/generado encajaría en la biblioteca **sin
  tocar el esquema** (~90% listo el lado de datos).

## 3. Falta (bloqueante)

- **El workflow de Wan no existe**: `img_generation_module/workflows/wan22_i2v_q5.api.json`
  (glob confirma cero `.api.json` reales; solo el fixture de tests). Requiere el
  **paso humano PROD-05 / Fase 0.5** (export desde la GUI). Sin él
  `pipeline validate` falla y no se puede generar.
- **`BENCHMARK.md` es la plantilla vacía** (todos los valores `___`) → cero datos
  reales de la 4070S → el gate Fase 1→2 sin pasar.

## 4. Las tres dimensiones

### 4.1 Técnica — *cabe por diseño, sin medir*
- El presupuesto de 12 GB **cierra sobre el papel** (ADR-003): carga **secuencial**
  de los dos expertos GGUF + **offload del umt5 a CPU** + LoRAs Lightning (4 pasos
  en vez de 32). **Nada de esto se ha ejercitado en hardware.**
- **Sin verificar** (confianza explícitamente BAJA): pico de VRAM real, que el
  offload se mantenga <12 GB, overhead de swap/thrashing, tiempo de decode VAE
  por frame, y si la política OOM funciona ante un OOM real.
- **Tiempo estimado 2-6 min/clip** → el propio `BENCHMARK.md` lo marca como
  *"expectativas orientativas (no contractuales)"*: una conjetura, no una medida.
  Timeout por job = **900 s** (un clip que lo supere aborta).
- **Escalera de fallback** si OOM al primer Q5: `Q5_K_M → Q4_K_M → Q4_K_S`
  (ficheros menores ya descargados), **pero implica re-exportar el workflow**
  apuntando a los nuevos nombres.
- Defaults: **832×480 × 81f @ 16 fps = clip de ~5 s**. 720p descartado (14-16 GB,
  no cabe).

### 4.2 Producto — *encaje favorable*
- B-roll de audiolibro quiere **movimiento lento y sutil** (niebla, parallax
  tenue) — que **coincide con el punto débil de Lightning** (poco dinamismo). El
  compromiso de calidad que compra el margen de VRAM/velocidad **cuesta poco para
  ESTE contenido** (dañaría mucho más un caso de acción). *Calidad visual real de
  Lightning sobre stills de audiolibro: sin verificar.*
- **Uso selectivo es la intención de diseño, no una restricción del código**:
  `studio-montage-redesign.md` enmarca los clips como B-roll de **una sola pista
  visual** (explícitamente NO multicapa). Regla: **3-5 planos clave por capítulo,
  no 60**. ⚠️ Esa regla vive **solo en docs** — nada en settings/UI impide
  encolar 60.
- **Coste real y secuencial** (una GPU, un job a la vez): ~**8-20 min de GPU/
  capítulo** para 4-5 clips (estimado, hereda la incertidumbre del tiempo/clip).
  La disciplina en el nº de planos es lo que mantiene un capítulo en decenas de
  minutos y no en horas.

### 4.3 Integración — *datos ~90% listos, falta la capa de render*
- **Listo**: `media_assets` ya modela `kind='clip'` + `duration_s`. Clips
  importables/listables hoy.
- **Falta (no bloqueante, tras el gate)**:
  1. **El renderer es solo imágenes** (`video_renderer.py` `render()` toma
     `images: list[VideoImage]`; `_build_slideshow_filter` encadena stills con
     `xfade`). No hay camino para un stream MP4 → esto es **PROD-08** (~3h).
  2. **Thumbnail del primer frame** del clip (~1h).
  3. **Detección de `.mp4`** al importar del watch dir + leer `duration_s` del
     sidecar (~1h).
- **Riesgo abierto** (`studio-montage-redesign.md:161-163`, sin verificar): ¿acepta
  el `filter_complex` de ffmpeg entradas de **vídeo** con `xfade`? Si no → plan B:
  pre-renderizar cada bloque (zoompan/segmento) y concatenar (más tiempo de
  render).
- El contrato módulo→app (MP4 + sidecar JSON con `duration_s`) es **limpio** y
  encaja con lo que espera `media_store`.

## 5. Hecho vs Falta (resumen)

| | Estado |
|---|---|
| Provisión (modelos + ComfyUI pineado) | ✅ Hecho |
| Pipeline I2V (código + 13 tests offline) | ✅ Hecho |
| App: `clip` como tipo de medio | ✅ Hecho |
| **Export del workflow Wan (PROD-05, humano)** | ❌ **Bloquea** |
| **Benchmark en la 4070S** | ❌ **Bloquea** |
| Renderer acepta clips (PROD-08) | ⏳ ~3h, tras el gate |
| Thumbnails de clip + import `.mp4` | ⏳ ~2h, tras el gate |
| UI de montaje con pista de clips (UX-03 M7) | ⏳ ~6-8h, tras el gate |

## 6. Bloqueante: cadena única y ordenada

> **Una sesión corta de GPU convierte esto de "código listo, teóricamente
> viable" a "verificado en hardware".** Es el **mismo gate que las imágenes
> reales** — al hacerlo desbloqueas imágenes reales **Y** la verificación de
> vídeo a la vez.

1. **Exportar el workflow de Wan** desde la GUI → `workflows/wan22_i2v_q5.api.json`
   (`python -m pipeline engine up`; SETUP_PROVISIONING §5: loaders a los Q5 GGUF,
   títulos `PROMPT_POSITIVE/NEGATIVE/SEED×2/SIZE/LENGTH/INPUT_IMAGE/SAVE`, "Save
   API Format"). **Solo humano. Bloquea todo.**
2. `python -m pipeline validate` → `pytest -m gpu` (primera ejecución real del
   smoke de vídeo, 33 frames) → confirmar que los nodos Wan cargan y no hay OOM a
   Q5.
3. Rellenar `BENCHMARK.md` con **tiempo real por clip + pico de VRAM** y ratificar
   Q5 vs Q4.

**No empezar el wiring de la app (PROD-08, thumbnails, montaje M7) antes del
benchmark**: si OOM y hay que bajar a Q4, se re-exporta el workflow e
invalidarías el trabajo construido sobre la config asumida.

## 7. Recomendación

Hacer el paso humano que desbloquea todo (§6.1) y correr el smoke + benchmark
(§6.2-3). Ese único acto produce el dato que falta —**minutos de GPU por clip y
pico de VRAM en esta tarjeta de 12 GB**— del que dependen todas las decisiones de
coste, OOM y cuantización. Después, y solo después, decidir PROD-08 con datos.

## 8. Mapa de referencias

| Tema | Ubicación |
|---|---|
| Pipeline I2V | `img_generation_module/pipeline/videos.py:26-105` |
| VideoSpec (defaults/validación) | `img_generation_module/pipeline/specs.py:73-88` |
| Política OOM | `img_generation_module/pipeline/job_runner.py:49-99` |
| Tests offline | `img_generation_module/tests/test_videos.py` |
| Smoke GPU (nunca corrido) | `img_generation_module/tests/gpu/test_smoke.py` |
| Modelos + quant + resolución | `img_generation_module/docs/DECISIONS.md` ADR-002/003/004 |
| Gate de benchmark | `img_generation_module/docs/IMPLEMENTATION_PLAN.md` (GATE), `docs/BENCHMARK.md` |
| Export del workflow (humano) | `img_generation_module/docs/SETUP_PROVISIONING.md §5` |
| Renderer de la app (solo imágenes) | `backend/services/video_renderer.py` |
| Biblioteca: `clip` como tipo | `backend/services/media_store.py` |
| Clips como B-roll (plan) | `internal-docs/studio-montage-redesign.md` (M7), `internal-docs/image-gen-region-plan.md` |
| PROD-05 / PROD-08 | `BURNDOWN.md` |
