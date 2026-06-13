# Ritmo de narración — plan de futura implementación

**Fecha**: 2026-06-13
**Estado**: Propuesto, pendiente de implementar en rama propia (`feat/narration-pacing`)
**Origen**: feedback de uso real (audiolibro) + investigación dirigida sobre el
pipeline de velocidad/cadencia (rama `remediation`, post VOZ-01..05).
**Relación**: complementa VOZ-01..06 del `remediation_plan/REMEDIATION_PLAN.md`.
No bloquea el merge de `remediation`; es trabajo posterior.

> **Cómo trabajar esto**: rama aparte, cada fase mergeable sola con la suite en
> verde, y **validación a oído sobre un capítulo real antes de cada commit**
> (regla del repo: verificar en la app, no solo en tests). Los valores de
> milisegundos de este documento son puntos de partida, no dogma: se afinan
> escuchando.

---

## 1. Problema (feedback del autor)

Probando síntesis con voz clonada para audiolibro:

1. **La cadencia por defecto va rápida.** Para narración de audiolibro la voz
   "empieza muy rápido" / suena apresurada de fábrica.
2. **Al bajar la velocidad aparecen matices robóticos.** Tocar el slider de
   velocidad para ir más lento degrada la voz (suena metálica/artificial).

## 2. Diagnóstico (verificado contra el código)

Son **dos problemas distintos** que el código mete bajo un único control de
"velocidad". Principio de dominio que lo ordena todo:

> La "velocidad" percibida de una voz tiene dos componentes **independientes**:
> **(a) velocidad de articulación** (sílabas/seg dentro de la frase) — solo se
> cambia en el modelo al generar, o estirando el audio después (con pérdida); y
> **(b) duración de las pausas** (silencio entre comas/frases/párrafos) — se
> cambia **gratis, sin tocar el audio**. Un locutor de audiolibro suena
> "pausado" sobre todo por (b), no articulando despacio.

### 2.1 Cadencia base rápida — es el modelo, no un bug
- La voz clonada la genera **XTTS v2**, cuya velocidad de articulación está
  fijada en el checkpoint. **No hay ningún parámetro de inferencia que la baje**
  (temperature 0.70, top_p 0.85, top_k 50, repetition_penalty 6.0,
  gpt_cond_len 30 — `backend/config.py:63-71` — ninguno afecta al ritmo).
- Política **VOZ-04**: a XTTS **nunca** se le pasa el kwarg `speed`
  (`backend/services/clone_engine.py:304-309`) — con `speaker_wav` largo el
  modelo lo ignora, y cuando actúa la calidad es mala.
- Las **pausas entre fragmentos son cortas y fijas**:
  `COMMA=200 ms`, `SENTENCE=500 ms`, `PARAGRAPH=900 ms`
  (`backend/services/tts_engine.py:125-127`). Brusco para audiolibro.
- `_trim_silences` (`clone_engine.py:189-234`) **colapsa cualquier silencio
  interno >150 ms a 80 ms** (`short_gap` en `:215`), incluido el respiro de
  apertura → refuerza el "empieza muy rápido".
- Por defecto `SynthesisRequest.speed=100` (`backend/schemas.py:32`) ⇒ **cero
  estiramiento**: se oye XTTS crudo a su ritmo natural con pausas finas.

### 2.2 "Robótico" al ir más lento — artefacto estructural de time-stretch
- Bajar el slider a 85 **no llega al modelo** (XTTS nunca recibe el valor) y
  **no toca las pausas**. Solo dispara **una pasada Rubber Band sobre el máster
  entero a 0.85×** (`clone_engine.py:625-633` → `time_stretch_wav` →
  `castilian_warmup.py:156-161`, `high_quality=True`, `preserve_formants=True`).
- Aun con el mejor estiramiento con preservación de formantes, **por encima de
  ~±10-15% se deforma** la micro-prosodia de XTTS (transitorios, sibilantes) →
  los "matices robóticos".
- Agravante: como las pausas **no escalan**, la voz se arrastra pero los huecos
  siguen cortos → suena robótico **y** descompasado a la vez.
- **Todo el "ir más lento" se gasta en la única palanca que degrada**
  (estiramiento), dejando intacta la palanca gratis (pausas).
- El clamp `[0.75, 1.25]` (`backend/services/audio_stretch.py:26-27`) permite
  hasta 0.75× (25% más lento), muy dentro de la zona audible: demasiado ancho
  para el camino de síntesis.

### 2.3 Edge-TTS NO sufre esto
Su `rate` es **prosódico** (re-síntesis en el modelo neuronal,
`tts_engine.py:64-66, 346`), rango completo 50-200%, sin DSP ni clamp. Solo los
**perfiles clonados** sufren el robótico al bajar velocidad.

## 3. Soluciones analizadas (priorizadas)

| # | Solución | Coste calidad | Esfuerzo | Qué arregla |
|---|---|---|---|---|
| 3 | Subir pausas por defecto (frase 500→~650, párrafo 900→~1300, coma 200→~250) | **cero** | S | El "va rápido" de fábrica, sin interacción |
| 6 | Suavizar `_trim_silences` en el arranque (respiro inicial ~150-200 ms) | bajo | S | El "empieza muy rápido" concreto |
| 4 | Aviso de zona degradada en el slider de Quick Synth + guía Edge para narración lenta sin clon | cero | S | Evitar arrastrar el slider a la zona robótica a ciegas |
| 1 ⭐ | **Control "Ritmo / pausas"** separado de la velocidad (multiplica los `pause_ms`) | **cero** | M | La raíz de ambos problemas |
| 2 | Estrechar el estiramiento a ~0.88-1.12× y mandar el resto del slowdown a pausas | bajo | M | Elimina el caso robótico |
| 5 | Curar muestras lentas + `gpt_cond_len` para sesgar la cadencia en origen | cero | L | Único que bajaría la articulación real — **sin verificar** |

## 4. Plan de implementación por fases (rama `feat/narration-pacing`)

### Fase P1 — Quick wins de defaults (sol. 3 + 6 + aviso de 4) · esfuerzo S
**Objetivo**: que la cadencia por defecto deje de sentirse apresurada **sin que
el usuario toque nada** y sin degradación.

- **P1a (sol. 3)**: subir las constantes de pausa en `tts_engine.py:125-127`
  hacia normas de audiolibro (punto de partida: `SENTENCE 500→650`,
  `PARAGRAPH 900→1300`, `COMMA 200→250`; valorar también el gap fijo de Edge
  `tts_engine.py:378`, 400 ms). **Afinar a oído.**
- **P1b (sol. 6)**: en `_trim_silences` (`clone_engine.py:189-234`) **no
  aplastar el silencio de apertura** del fragmento (subir `short_gap` a
  ~150-200 ms solo en el borde inicial, o saltar el trim del silencio líder).
  Mantener el trim agresivo de silencios fantasma intra-frase (su razón de ser).
  **Conservador** — verificar contra los casos de alucinación de
  `tests/test_clone_engine.py`.
- **P1c (parte de sol. 4)**: añadir aviso de zona degradada al slider de
  velocidad en Quick Synth (`SynthTab.tsx:481`) reusando las props
  `degradedBelow/degradedAbove` de `Slider.tsx` que **ya usa** el Lab
  (`LabTab.tsx:181-193`). Sin cambio de backend.

**Gate**: capítulo real suena más medido por defecto; suite verde; **veredicto a
oído** anotado.

### Fase P2 — Control "Ritmo / pausas" (sol. 1) · esfuerzo M · ⭐ núcleo
**Objetivo**: una palanca de primera clase, **desacoplada de la velocidad**, que
alarga las pausas sin tocar el audio.

- Nuevo campo `pause_scale: float` (p. ej. 1.0-2.0, default 1.0) en
  `SynthesisRequest` (`backend/schemas.py`), `response_model`/openapi
  regenerados (`npm run openapi`, commitear `schema/openapi.json` +
  `generated.ts`).
- Threadearlo por `synthesize_long` (`clone_engine.py:547-555` — `speed` ya está
  en scope ahí) hasta la inserción de pausas
  (`clone_engine.py:621-623`: `AudioSegment.silent(duration=round(pause_ms * pause_scale))`)
  y al gap de Edge (`tts_engine.py:378`).
- Frontend: control **"Ritmo / pausas"** separado del de Velocidad en
  `SynthTab.tsx` / `synthFormContext.tsx:74`, con copy i18n (es/en) que explique
  la diferencia (velocidad = articulación, ritmo = pausas). Enviar en
  `src/api/synthesis.ts`.
- Tests: la duración total crece con `pause_scale` sin cambiar la duración de
  los fragmentos de habla; `pause_scale=1.0` es no-op; el factor llega a ambos
  motores.

**Gate**: subir el ritmo hace la narración medida **sin artefactos**; suite
verde; veredicto a oído.

### Fase P3 — Confinar el estiramiento y derivar a pausas (sol. 2) · esfuerzo M
**Objetivo**: que la "Velocidad" solo aplique estiramiento **inaudible**.

- Hacer el límite de clamp **un parámetro por-llamada** (NO estrechar el global
  `audio_stretch.py:26-27`: el Lab usa el ±25% a propósito,
  `voice_lab_engine.py:309`, `voice_lab.py:84,113`). Para el camino de síntesis
  de clon usar ~`[0.88, 1.12]`.
- En `synthesize_long`, **repartir** el slowdown pedido: la fracción pequeña a
  `time_stretch_wav` (dentro de la zona limpia), el resto a `pause_scale`
  (`clone_engine.py:625-633`, `speed` ya en scope en `:628`).

**Gate**: bajar la velocidad de un clon ya no suena robótico; el Lab conserva su
rango; suite verde.

### Fase P4 — Guía de motor (resto de sol. 4) · esfuerzo S
Explicitar en UX que **Edge-TTS** da narración lenta limpia (prosódica, rango
completo) cuando no se necesita la identidad clonada — sugerirlo cuando el
usuario lleve el slider de clon a la zona degradada. Sin cambio de backend.

### Fase P5 — Experimento de cadencia en origen (sol. 5) · esfuerzo L · OPCIONAL
**No es un arreglo garantizado.** Único lever que podría bajar la articulación
real: curar muestras de referencia lentas (usar la métrica `rhythm_sps` del
analizador, `analyze.py:48-69`, objetivo ~5-7 síl/s) + experimentar con
`gpt_cond_len` (`config.py:71`, env `VOXFORGE_XTTS_GPT_COND_LEN`) y el
conditioning multi-muestra de VOZ-10.

> **Caveat explícito**: la investigación es clara en que **no hay evidencia** de
> que muestras más lentas produzcan salida más lenta — el conditioning afecta al
> timbre, no al timing. Tratar como experimento detrás del analizador, validado
> a oído, **no** como vía principal.

## 5. Orden recomendado y razón

`P1 → P2 → P3 → P4` (P5 en paralelo/opcional). La lógica: mover **todo el
presupuesto de "ir más lento" de la palanca con pérdida (estiramiento) a la
palanca sin pérdida (pausas)**. Tras P1-P3, el slider de velocidad solo aplica
un estiramiento suave e inaudible, y la sensación "medida" de audiolibro viene
de las pausas — exactamente como lo logra un narrador humano.

## 6. Caveat global (a tener presente)

**Nada de esto baja la velocidad de articulación real de XTTS** — no existe
palanca de inferencia para ello (confirmado). Lo que se consigue es trasladar el
"ir más lento" a las pausas (sin degradación), que para audiolibro es lo
correcto. Solo P5 tocaría la articulación, y está sin verificar.

## 7. Criterios de aceptación (cierre del plan)

1. Por defecto, un capítulo de prueba suena con cadencia de audiolibro **sin que
   el usuario toque sliders** (P1).
2. Existe un control de **Ritmo/pausas** independiente que hace la narración más
   medida con **cero artefactos** (P2).
3. Bajar la **Velocidad** de un perfil clonado ya **no suena robótico** en el
   rango de uso normal (P3); el Lab conserva su ±25%.
4. Suite verde (`pytest`, `vitest`, `typecheck`, e2e) y, si se tocaron modelos
   Pydantic, sin drift de esquema.
5. Veredicto a oído del autor anotado por fase (P1, P2, P3).

## 8. Mapa de ficheros (referencia rápida)

| Área | Fichero:línea |
|---|---|
| Pausas por defecto | `backend/services/tts_engine.py:125-127` |
| Gap Edge entre chunks | `backend/services/tts_engine.py:378` |
| Inserción de pausa (clon) | `backend/services/clone_engine.py:621-623` |
| Firma `synthesize_long` (speed en scope) | `backend/services/clone_engine.py:547-555` |
| speed→stretch factor | `backend/services/tts_engine.py:500` |
| Post-stretch del máster | `backend/services/clone_engine.py:625-633` |
| Rubber Band | `backend/services/castilian_warmup.py:156-161` |
| Clamp `[0.75,1.25]` | `backend/services/audio_stretch.py:26-27` |
| Clamp consumido (Lab) | `backend/services/voice_lab_engine.py:309` |
| `_trim_silences` | `backend/services/clone_engine.py:189-234` (`short_gap` :215) |
| Rate prosódica Edge | `backend/services/tts_engine.py:64-66, 346` |
| Schema de la request | `backend/schemas.py:32` |
| Slider + zona degradada (ya en Lab) | `src/components/Slider.tsx`, `src/features/audio-tools/LabTab.tsx:181-193` |
| Slider Quick Synth (sin aviso) | `src/features/quick-synth/SynthTab.tsx:481` |
| Estado del formulario / default speed | `src/features/voices-unified/synthFormContext.tsx:74` |
| Analizador de ritmo (síl/s) | `backend/routers/analyze.py:48-69` |
| `gpt_cond_len` | `backend/config.py:71` (env `VOXFORGE_XTTS_GPT_COND_LEN`) |
