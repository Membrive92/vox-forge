# REMEDIATION_PLAN.md — Plan de remediación integral de VoxForge

**Fecha**: 2026-06-11
**Audiencia**: Claude Code (agente ejecutor) + autor (decisiones marcadas como HUMANO)
**Objetivo**: cerrar el 100% de los hallazgos conocidos, eliminar código roto y
muerto, y subir la calidad del producto al máximo. No hay usuarios externos ni
compatibilidad que preservar: **se permite romper API interna, renombrar y
borrar con agresividad**, siempre con la suite en verde al final de cada lote.

## Fuentes de hallazgos (tres, en orden de autoridad)

1. **`AUDIT_2026-06-08.md`** — 68 hallazgos técnicos (3 críticos, 15 altos,
   35 medios, 15 bajos). Es la fuente de detalle: este plan lo referencia por
   sección/título, no lo copia.
2. **Auditoría de producto 2026-06-11** (no está en el repo; hallazgos
   embebidos en §F7 de este documento): estrategia visual triplicada, política
   de GPU entre procesos inexistente, QC de audio manual, deuda documental.
3. **Diagnóstico de calidad de voz 2026-06-11** (no está en el repo; espec
   embebida en §F2 y §F2b): el cambio de velocidad usa phase vocoder de
   librosa y destruye la voz; además, el bucle de decodificación de XTTS está
   en un óptimo local (selector de candidatos ciego a la dicción + sampler
   estrangulado a `temperature=0.1`) y el conditioning usa una sola muestra.

---

## 0. Estado pre-verificado (2026-06-11) — NO retrabajar lo cerrado

El burn-down del audit está activo y avanzado. Verificación directa sobre el
working tree (commit de hoy):

### Resueltos con evidencia — solo marcar en BURNDOWN, no tocar

| Hallazgo (AUDIT 06-08) | Evidencia de cierre |
|---|---|
| CRÍTICO: path traversal vía `job_id` | `routers/synthesis.py:60` valida con `job_store.is_valid_job_id` |
| CRÍTICO: deletes destructivos sin confirmación | `useConfirm` cableado en `ChapterCard.tsx:73`, `WorkbenchTab.tsx:799` |
| CRÍTICO: `cleanup_old_files` borra audio persistido | `backend/utils.py:14-22` carga rutas referenciadas en DB y las salta |
| ALTO: escrituras atómicas sin fsync | `backend/atomic_io.py:29-30` (`flush` + `os.fsync` antes del replace) |
| ALTO: CORS `["*"]` | `config.py:32` lista explícita localhost; `main.py:43` `allow_credentials=False` |
| ALTO: `narration_path` sin confinar | `routers/ambience.py:130-134` usa `is_within_allowed_roots` |
| ALTO/sistémico: regenerate-chunk con éxito falso | `routers/chapter_synth.py:249-269` `_resplice_chapter` + header `X-Chapter-Respliced` |
| ALTO: event loop bloqueado (Studio/ZIP/analyze) | `asyncio.to_thread` en `studio.py:166-172`, `batch_export.py:159`, `analyze.py:143` |
| ALTO: contratos sin `response_model` (projects) | `routers/projects.py:141-174` |
| ALTO: `useProfiles` cuádruple sin contexto | `src/hooks/profilesContext.ts` existe y se consume |
| ALTO: Audio Tools inalcanzable / `tabs.ts` muerto | `App.tsx:237-239` lo monta; `src/constants/` ya solo contiene `voices.ts` |
| MEDIO/BAJO: formateador M:SS, download anchor, audio oculto duplicados | `src/utils/format.ts` (`formatClock`), `src/utils/download.ts`, `src/components/HiddenAudio.tsx` existen — **verificar que todos los call sites migraron** |

### Probablemente abiertos (verificados hoy como pendientes)

- `moveOperation` sigue definido en `useStudioSession.ts:168` y sin ningún
  consumidor en UI (reorder inalcanzable).
- Constantes `_PAUSE_TAG_*` siguen en `tts_engine.py:106-108` (el audit las
  marca muertas tras refactor — confirmar cero usos y borrar).
- Sin lock anti-concurrencia en resume (`routers/synthesis.py` no contiene
  ningún `asyncio.Lock` por `job_id`).
- Todo lo nuevo de las fuentes 2 y 3 (§F2, §F2b, §F7, §F8).

**El resto de los 68 se triajea en F0.** Prohibido asumir abierto o cerrado sin
mirar el código: este plan tiene 3 días menos que el último commit.

---

## 1. Reglas de trabajo (vinculantes para todo el plan)

1. **Verificar-primero.** Antes de tocar un hallazgo: reproducirlo o localizar
   la evidencia en el código actual. Si ya está resuelto → estado
   `RESUELTO-PREVIO` en BURNDOWN y siguiente. Si no es reproducible y el código
   cambió → `NO-REPRODUCIBLE` con explicación.
2. **Un lote coherente = un commit.** Mensaje con prefijo y referencia:
   `fix(audit-alto): serialize resume per job_id (AUDIT §3 Concurrencia)`.
   Nunca mezclar refactor estructural con fix de comportamiento en el mismo
   commit.
3. **Gate por lote**: `python -m pytest -q && npm test -- --run && npm run typecheck`
   en verde antes de cada commit. Si se tocó un modelo Pydantic:
   `npm run openapi` y commitear el schema + tipos regenerados (CI lo exige).
4. **Tests primero cuando el hallazgo es de comportamiento**: el test que
   demuestra el bug entra en el mismo commit que el fix.
5. **El código muerto se borra, no se comenta.** Git es la memoria
   (principio 4 del CLAUDE.md del repo). Antes de borrar un símbolo: grep de
   referencias en `src/`, `backend/`, `e2e/`, `tests/`.
6. **BURNDOWN.md se actualiza en el mismo commit** que cierra cada hallazgo.
7. **Dependencias nuevas**: solo las explícitamente autorizadas en este plan
   (`pyloudnorm` si aún falta; `rapidfuzz`, compartida por F8 y VOZ-08;
   `vulture`/`knip` como dev-only en F4; `resemble-enhance` solo en
   F9-opcional; un predictor MOS ligero clase UTMOS solo como opcional de
   VOZ-08 si la dependencia es estable). El tooling de fine-tuning (VOZ-11)
   vive fuera del runtime (`tools/`, entorno propio), nunca en
   `requirements.txt`. Cualquier otra: parar y preguntar.
8. **Licencias**: prohibido introducir modelos o pesos FLUX dev/klein, Hunyuan
   (excluye la UE) o cualquier licencia no comercial nueva. El stack visual
   canónico es el de `img_generation_module/docs/DECISIONS.md` (Apache 2.0).
9. **No tocar** `img_generation_module/` salvo lo indicado en F7 (es un módulo
   con sus propios specs y gates); no tocar `AUDIT_*.md` salvo para añadir
   marcas de estado si se decide hacerlo ahí además de en BURNDOWN.
10. Tareas marcadas **HUMANO** no se automatizan: se deja preparado el terreno
    y se documenta qué debe hacer el autor.

---

## F0 — Baseline y triaje completo

**Entregables**: `BURNDOWN.md` en la raíz.

1. Ejecutar la suite completa (backend, frontend, typecheck; e2e si el entorno
   lo permite) y registrar el baseline en la cabecera de BURNDOWN.
2. Construir la tabla de tracking con **todos** los hallazgos: los 68 del
   audit (id = sección + título corto), más todos los IDs definidos en este
   plan: `VOZ-01..11` (§F2, §F2b, §F9), `PROD-01..05` y `UX-01..02` (§F7),
   `PROD-06..08` (§F9), `QC-01` (§F8), `PUB-01`, `MET-01`, `DOG-01` y
   `UX-03` (§F9). Columnas:
   `id | severidad | título | estado | evidencia | commit de cierre`.
3. Estados permitidos: `RESUELTO-PREVIO`, `ABIERTO`, `NO-REPRODUCIBLE`,
   `WONTFIX` (requiere justificación de una línea; reservado a hallazgos que
   contradigan decisiones del autor), `HUMANO-PENDIENTE` y `DIFERIDO`
   (solo válido para items de §F9: opcional pospuesto con motivo de una
   línea; no bloquea el cierre del plan).
4. Pre-rellenar con la tabla de §0 y triajear el resto leyendo el código
   (no por intuición). Los hallazgos Medio/Bajo del audit incluyen ruta y
   línea: comprobar cada uno.

**Criterio de aceptación**: BURNDOWN sin ningún estado vacío; baseline de
tests documentado.

## F1 — Remanentes de severidad Alta del audit

Cerrar todo `ABIERTO` con severidad Crítico/Alto tras el triaje. Candidatos ya
confirmados o probables (verificar el resto en AUDIT §3):

- **Concurrencia**: resume concurrente con el job original sobre el mismo
  `job_id` → `asyncio.Lock` por job o rechazo con 409 si `status == "running"`;
  escritura de chunks con `os.replace` (AUDIT §3-Concurrencia y §5).
- **Fuga de tareas monitoras de cancelación** (`backend/cancellation.py:61`):
  garantizar cancelación/await del monitor al terminar la petición.
- **Integridad**: takes con `status='done'` sin `file_path`
  (`chapter_synth.py:107` según audit) → persistir per-chunk o introducir un
  estado honesto.
- **Testing (Alto)**: los gaps que el audit lista (rama de fallo de
  `VideoRenderer._run_command`, concat de character-cast, invariante del
  semáforo GPU) entran aquí porque protegen lo demás.

**Criterio**: cero hallazgos Crítico/Alto en estado ABIERTO.

## F2 — Calidad de voz: erradicar el phase vocoder (espec completa)

**Contexto** (diagnóstico 2026-06-11): todo cambio de velocidad post-síntesis
pasa por `librosa.effects.time_stretch` (phase vocoder) en dos sitios, y el
preset-stacking añade una segunda pasada de phase vocoder vía
`librosa.effects.pitch_shift`. Resultado audible: voz metálica/rota. El kwarg
nativo `speed` de XTTS es inerte con speaker_wav largo (documentado en
`castilian_warmup.py:130-136`) y de mala calidad cuando actúa.

**Decisión**: Rubber Band vía `pedalboard.time_stretch` (pedalboard ya está en
requirements y ya se importa en Voice Lab; **cero dependencias nuevas**).
Semántica verificada en vivo: `stretch_factor=2.0` ⇒ doble velocidad y mitad
de duración (misma dirección que el `rate` actual); acepta
`pitch_shift_in_semitones` independiente y `preserve_formants=True`.
Plan B documentado por si pedalboard fallara en alguna plataforma:
`ffmpeg -af atempo` (ffmpeg ya es dependencia de runtime vía `loudnorm`);
calidad clase WSOLA — un escalón bajo Rubber Band, muy por encima del phase
vocoder.

Tareas (VOZ-01..06):

1. **VOZ-01** `voice_lab_engine`: sustituir `_apply_pitch` + `_apply_speed`
   por una única pasada:

   ```python
   from pedalboard import time_stretch

   @staticmethod
   def _apply_pitch_and_speed(audio: np.ndarray, sr: int,
                              semitones: float, speed: float) -> np.ndarray:
       if abs(semitones) < 0.01 and abs(speed - 1.0) < 0.01:
           return audio
       return time_stretch(
           audio.astype(np.float32), sr,
           stretch_factor=speed,
           pitch_shift_in_semitones=semitones,
           high_quality=True,
           preserve_formants=True,
       )
   ```

   Mantener el orden del chain (speed/pitch ANTES de EQ/comp/reverb — el orden
   actual ya es correcto; no estirar colas de reverb).
2. **VOZ-02** `castilian_warmup.time_stretch_wav`: misma sustitución (cargar
   con `soundfile`, `time_stretch`, guardar). Actualizar el docstring: ya no
   es phase vocoder.
3. **VOZ-03** Clamp de seguridad: el schema permite speed 50–200; cualquier
   algoritmo rompe la voz fuera de ±25%. Backend: clamp efectivo del estiraje
   post a `[0.75, 1.25]` con warning en log si el valor pedido excede.
   Frontend: marcar la zona >±25% del slider como degradada (estilo + tooltip
   i18n). Edge-TTS conserva su rango completo (su `rate` es prosódico, no DSP).
   Nota de producto: la velocidad como preferencia del oyente NO se hornea en
   el máster — YouTube y el `InteractivePlayer` ya dan 0.75–2× client-side y
   reversible; el slider existe para ajustar la cadencia del narrador
   (±10–15%) y así debe explicarse en la UI.
4. **VOZ-04** Política XTTS `speed`: dejar de reenviar el kwarg al modelo en
   todos los caminos (hoy condicional en `clone_engine.py:281-287`); la
   velocidad de clonación se resuelve SIEMPRE como post-stretch Rubber Band
   sobre salida a cadencia natural. Documentarlo donde estaba el comentario
   del acento.
5. **VOZ-05** Tests: longitud esperada tras stretch (1 s × factor 0.8 ⇒
   1.25 s ± tolerancia), no-op dentro del epsilon, clamp aplicado, y que
   `_apply_pitch_and_speed` se invoca una sola vez por proceso (no apilado).
   Los tests CI deben funcionar con pedalboard real (ya está en
   requirements-ci vía Voice Lab; si no, stub coherente en conftest).
6. **VOZ-06 (HUMANO)**: A/B de escucha con un párrafo real a 0.9× y 1.15×,
   preset "Anciano sabio" antes/después. Una frase de veredicto en BURNDOWN.

**Criterio**: cero llamadas a `librosa.effects.time_stretch` y
`librosa.effects.pitch_shift` en el repo; A/B humano aprobado.

## F2b — Dicción y calidad a nivel de modelo (XTTS: decodificación, conditioning y pesos)

**Contexto** (diagnóstico 2026-06-11): el pipeline XTTS está en un óptimo
local. El selector de candidatos `_score_audio` (`clone_engine.py:179`) puntúa
solo señal — varianza de energía, pico/media, ratio de silencio — y es ciego a
la dicción: un candidato fluido con palabras equivocadas puntúa perfecto. Para
compensar, `_XTTS_QUALITY_PARAMS` (`clone_engine.py:45`) estrangula el muestreo
(`temperature=0.1`, `top_p=0.4`, `top_k=20`, `repetition_penalty=10.0`):
prosodia plana y monótona, y un `repetition_penalty` extremo que por sí mismo
distorsiona finales de palabra al vetar repeticiones legítimas de tokens.
Círculo cerrado: scorer débil → sampler casi-greedy → voz sin vida.

**Orden vinculante**: VOZ-08 antes que VOZ-09 — primero la red de seguridad,
después soltar el sampler. Nunca al revés.

1. **VOZ-08 — Re-ranking de candidatos con objetivo de inteligibilidad
   (ASR-in-the-loop).** Núcleo compartido nuevo
   `backend/services/intelligibility.py`:
   `score_intelligibility(audio_path, expected_text) -> float` — transcripción
   con `faster-whisper` (modelo configurable, default `small`), normalización
   de ambos textos con el `text_normalizer` existente, similitud con
   `rapidfuzz.fuzz.ratio`. En `clone_engine`: el `_score_audio` actual queda
   como pre-filtro barato de descarte; la **selección final** del candidato la
   decide la inteligibilidad. Escalado adaptativo: 2 candidatos por defecto;
   si el mejor queda bajo umbral (default 0.90), generar 2 más (máx. 4) y
   aceptar el mejor disponible con warning en log. La transcripción corre bajo
   `gpu_semaphore`. QC-01 (§F8) consume este mismo núcleo: el primero de los
   dos que se implemente crea el módulo, el otro lo reutiliza. Tests con el
   stub de transcriber del conftest: candidato saboteado pierde contra el
   fiel; el escalado solo se dispara bajo umbral.
   Opcional no bloqueante: predictor neural de MOS (clase UTMOS) como
   desempate de naturalidad entre candidatos que superan el umbral; si la
   dependencia no es ligera/estable, `WONTFIX` justificado.
2. **VOZ-09 — Reapertura del sampler (requiere VOZ-08 mergeado).** Nuevos
   defaults en `_XTTS_QUALITY_PARAMS`: `temperature` 0.65–0.75, `top_p` 0.85,
   `top_k` 50, `repetition_penalty` 5.0–7.0; mantener `num_beams=1` y
   `gpt_cond_len=30`. Exponer estos valores en settings/env para iterar sin
   tocar código. **HUMANO**: A/B de escucha — mismo texto, params de
   emergencia vs nuevos con el reranker activo — y veredicto en BURNDOWN. Los
   números finales los fija la escucha, no este documento.
3. **VOZ-10 — Conditioning multi-muestra.** XTTS acepta una *lista* en
   `speaker_wav` y promedia los latents de condicionamiento; los perfiles hoy
   guardan una sola muestra (`profile_manager.py`, `sample_filename`). Migrar
   el schema de perfil a lista de muestras (1–5) con migración de los
   `profiles.json` existentes, UI de gestión en Voices (añadir / escuchar /
   borrar; el sample analyzer corre por muestra y se le añade una métrica de
   ritmo —sílabas/segundo— para curar muestras al tempo objetivo) y paso de la
   lista completa al engine. Documentar la receta de curación: 3–5 clips de 6–10 s, limpios,
   mismo micrófono, registros variados. Tras mergear: re-evaluar con A/B si el
   hack `castilian_warmup` sigue aportando (la deriva de acento es en parte un
   problema de conditioning); si no aporta, retirarlo es limpieza de F4.
4. **VOZ-11 — Fine-tuning del checkpoint sobre la voz del autor
   (HUMANO-intensivo).** Claude Code prepara, el autor entrena y decide.
   Entregables: `tools/finetune/prepare_dataset.py` (trocea y transcribe con
   faster-whisper 20–60 min de voz al formato del trainer de Coqui) y
   `internal-docs/xtts-finetune.md` con la receta (pipeline de AllTalk o
   trainer oficial), los requisitos verificados (12 GB de VRAM viable en
   Windows; 8 GB con ≥24 GB de RAM vía sysmem fallback; mínimo 2–3 min de
   datos, 5+ recomendado, 20–60 min objetivo para narración) y cómo cargar el
   checkpoint resultante en VoxForge (ruta de modelo XTTS configurable en
   settings). Caveats por escrito: horas de GPU, y los pesos fine-tuneados
   heredan la licencia CPML no comercial del checkpoint base.
   `HUMANO-PENDIENTE` hasta que el autor entrene y escuche.

**Criterio de F2b**: VOZ-08 y VOZ-09 mergeados con A/B documentado; VOZ-10
operativo en UI; VOZ-11 preparado (script + doc) aunque el entrenamiento quede
pendiente. El techo restante — fallos estructurales del AR de 2023 (saltos,
deriva de acento, sensibilidad a la longitud) — queda explícitamente delegado
a PROD-06; no intentar resolverlo con más heurísticas.

## F3 — Barrido de severidad Media

Recorrer AUDIT §4 categoría a categoría (Seguridad, correctitud backend,
async, rendimiento back/front, errores, integridad, a11y-medios, UX, i18n,
tipos, tests, arquitectura). Para cada item: triaje → fix → test si es de
comportamiento. Sin criterio nuevo: el audit ya da ruta, línea y remedio
sugerido por item.

**Criterio**: cero Medios ABIERTOS.

## F4 — Código roto, muerto y duplicado (la limpieza pedida)

Lista dirigida (del audit §5 + triaje de hoy), más un sweep instrumentado:

1. Borrar `_PAUSE_TAG_*` y el bloque en blanco en `tts_engine.py:106-116`
   (tras confirmar cero usos).
2. `moveOperation`: decidir por la opción barata — **cablear** reorder en
   `EditOperationsPanel` (botones ↑/↓ por operación) o **eliminar** del hook.
   Elegir cablear solo si cuesta <1 h; si no, borrar (YAGNI).
3. Verificar la migración completa a los helpers ya creados y borrar restos:
   todos los M:SS a `formatClock`, todos los anchors a `download.ts`, todos
   los `<audio>` ocultos a `HiddenAudio`, extracción de duración backend a un
   único `audio_duration_seconds` (crear en `backend/audio_meta.py` si aún no
   existe), `ALLOWED_AUDIO_EXTS` único, re-imports locales de
   `SynthesisRequest` al nivel de módulo, lookup "latest done generation" a
   `pm.get_latest_done_generation`.
4. **Particionar `WorkbenchTab.tsx` (~1745 líneas)**: extraer `ChapterCard` ya
   dividido en `ChapterAudioPanel` + `ChapterVideoActions`, pickers y helpers
   a ficheros propios. Refactor puro: cero cambios de comportamiento, los
   tests existentes y e2e deben pasar sin tocar sus asserts (si un e2e depende
   de un selector movido, actualizar el selector, no el flujo).
5. **Prop drilling de Voices** (`VoicesPlusLab` ~17 props): bajar el estado del
   formulario de síntesis a un contexto propio del subárbol Voices.
6. `catch {}` vacíos del Workbench/ChunkMap: distinguir "sin datos" de fallo
   real (logger + estado de error con retry), per audit §5.
7. **Sweep instrumentado** (dev-only, no entra en requirements de runtime):
   `vulture backend/ --min-confidence 90` y `npx knip` (o `ts-prune`) sobre
   `src/`. Cada candidato se verifica a mano antes de borrar; los falsos
   positivos se anotan en BURNDOWN para no re-investigarlos.
8. Al final: `grep -rn "TODO\|FIXME\|XXX"` y resolver o convertir en issues de
   BURNDOWN con id propio (nada de TODOs huérfanos).

**Criterio**: vulture/knip sin hallazgos accionables nuevos; WorkbenchTab
<600 líneas; suite y e2e verdes.

## F5 — Accesibilidad (AUDIT Fase 3, barrido único)

Patrón ARIA tabs en la navegación (`role=tablist/tab`, `aria-selected`,
roving tabindex con flechas), `aria-label` en todos los `<audio>/<video>`
(Workbench, Studio, Recorder, VideoRenderPanel), tooltips de `Slider` y
`EditOperationsPanel` como `<button aria-expanded aria-controls>`, y
verificación de que `useFocusTrap` está aplicado en todos los modales
(ConfirmDialog, PromptDialog, recorder, image dialog). Los items a11y de
severidad Alta que sigan abiertos tras F1 se cierran aquí también.

**Criterio**: navegación completa por teclado de los 6 tabs y de un flujo
entero (crear proyecto → sintetizar → Studio) sin ratón.

## F6 — i18n y contratos restantes

- Corregir los diacríticos del bloque convert/lab en `src/i18n/es.ts`
  (lista exacta en AUDIT §5) y hacer requeridos los labels de
  `InteractivePlayer` (sin defaults hardcodeados en inglés).
- Cerrar cualquier endpoint que siga emitiendo `{[key]: unknown}` en el
  schema: `response_model` + regenerar tipos (`npm run openapi`). Objetivo:
  cero `unknown` estructurales en `src/api/generated.ts` para los recursos de
  datos principales.

## F7 — Hallazgos de producto (auditoría 2026-06-11, no presentes en el repo)

- **PROD-01 — Política de GPU entre procesos.** `gpu_lock.py` solo serializa
  dentro del backend; ComfyUI es otro proceso sobre la MISMA 4070S de 12 GB.
  Crear `POST /api/engines/unload` que invoque `clone_engine.unload_model()` y
  `convert_engine.unload_model()` (+ `torch.cuda.empty_cache()`), con test.
  Documentar en el router que debe llamarse antes de cargas visuales pesadas.
- **PROD-02 — `ComfyUIProvider` real (F1+F2 del plan de abril, corregido).**
  Implementar el provider en `backend/services/image_gen.py` siguiendo
  `internal-docs/comfyui-integration-plan.md` PERO con tres enmiendas
  vinculantes: (a) modelos del stack canónico Apache 2.0 (Z-Image-Turbo fp8;
  nada de JuggernautXL/FLUX), reutilizando la MISMA instancia y workspace de
  ComfyUI del `img_generation_module` (puerto/config compartidos); (b)
  parametrización por `_meta.title` como en
  `img_generation_module/pipeline/workflows.py`, no por ID numérico;
  (c) settings nuevos en `config.py` (`image_provider`, `comfyui_url`,
  `comfyui_timeout_s`, ruta de workflow). Health check + UX de error (F2 del
  plan) incluidos. Tests con transport mockeado, como prescribe ese plan.
  El provider invoca PROD-01 antes de generar.
- **PROD-03 — Detección de escenas (B2 del production-workflow-plan).**
  `POST /api/studio/scenes/detect` agrupando el SRT en escenas de ~25 s; el
  plan ya trae la espec y los tests. Es el pegamento transcripción→slideshow.
- **PROD-04 — Coherencia documental.** Añadir cabecera `> SUPERSEDED:` con
  enlace al documento vigente en: `production-workflow-plan.md` §B3/§B4 y la
  tabla de modelos de `comfyui-integration-plan.md` (la arquitectura del plan
  sigue válida; los modelos no). Actualizar README: retirar de "Planned" lo ya
  implementado (slideshow, subtítulos, LUFS/denoise, upload/grabación),
  matizar "local-first" explicitando que Edge-TTS es cloud, y añadir la
  sección de setup de ComfyUI cuando PROD-02 esté hecho.
- **PROD-05 (HUMANO)** — Exportar los dos workflows del
  `img_generation_module` (Fase 0.5 de su IMPLEMENTATION_PLAN) y rellenar
  `docs/BENCHMARK.md`. Sin esto, PROD-02 no tiene workflow real que cargar y
  el módulo de clips sigue sin verificar. Estado `HUMANO-PENDIENTE` en
  BURNDOWN; Claude Code lo deja preparado y documentado, no lo simula.
- **UX-01 — Progreso global no bloqueante (job tray).** Diagnóstico: las
  pestañas ya quedan montadas tras la primera visita precisamente para que
  los trabajos sobrevivan a la navegación (`App.tsx:30-38`), pero todo el
  estado de progreso es local al componente (`useSynthesis` por consumidor,
  `ExperimentalTab.tsx:47` con su propio `isGenerating`, síntesis de capítulo
  dentro del ChunkMap): al cambiar de pestaña el progreso se vuelve invisible
  y el usuario aprende a quedarse clavado — bloqueo percibido, no real. Fix:
  `JobsContext` a nivel de App — registro de trabajos activos
  `{id, kind, label, progress, chunksDone/Total, originTab, status}` que los
  hooks existentes alimentan (el polling sigue viviendo en el hook dueño; el
  contexto solo refleja, sin duplicar polling). UI: (a) barra fina de
  progreso bajo `TabsNav` agregando el trabajo activo; (b) tray en el
  `Header` con la lista de trabajos y click → navegar a la pestaña de origen
  (generalizar el patrón `pendingStudioSourceId` a intents de navegación);
  (c) badge de progreso en el botón de la pestaña dueña (patrón ya existente:
  `errorBadge` en Activity). Cubrir: quick synth, síntesis de capítulo,
  conversión, render de vídeo y transcripción. Tests: unit del contexto +
  e2e "lanzar síntesis en Voices → cambiar a Workbench → el tray muestra
  progreso → click vuelve".
- **UX-02 — Studio: de cul-de-sac invisible a paso del flujo.** Diagnóstico
  triple verificado: (a) Studio se retiró de la navegación en la
  reestructuración ("Studio opens as a panel from a chapter, so neither needs
  its own nav entry", `App.tsx:462-465`) y solo se alcanza desde chips de la
  ChapterCard → descubribilidad colapsada; (b) sus operaciones de mayor valor
  para audiolibro (LUFS, denoise, compresor) exigen una sesión manual de
  editor por capítulo — nadie lo repite 40 veces; (c) el export YA prioriza
  en silencio la última edición de Studio sobre el take activo
  (`batch_export.py:66`: Studio > activa > síntesis fresca) — una edición
  vieja puede pisar una regeneración nueva sin aviso. Fix en tres
  movimientos: (1) **mastering one-click**: acción de capítulo "Masterizar"
  que llama a `/api/studio/edit` headless con preset
  [denoise → loudness −16 → compressor] sin abrir el editor, chip
  "Masterizado ✓", y el mismo toggle en el batch export — el motor de Studio
  pasa a ser paso del pipeline y el editor queda para cirugía; (2) **fuente
  de export visible**: la ChapterCard muestra qué audio ganará el export
  ("Exportará: edición Studio del 3-jun" vs "take activo") con acción de
  descartar la edición — la prioridad silenciosa pasa a elección consciente;
  (3) **afordancia uniforme**: botón "Abrir en Studio" en todo capítulo con
  audio (los deep-links ya existen: `ChapterCard.tsx:351, 498`). MET-01 mide
  el uso de Studio antes/después para validar el cambio.

## F8 — QC automático de audio (ASR-diff)

La feature de mayor palanca ausente: con capítulos largos el cuello es
escuchar, y XTTS falla por omisión/repetición/alucinación.

- **QC-01**: nuevo `backend/services/qc.py` que **consume el núcleo
  compartido `intelligibility.py` de VOZ-08** (el primero de los dos que se
  implemente crea el módulo): para cada chunk de la generación activa,
  transcripción con `faster-whisper`, normalización con el `text_normalizer`
  existente y similitud `rapidfuzz.fuzz.ratio`. Umbral configurable
  (default 0.90). Persistir el score por chunk junto al chunk map.
- Endpoint `POST /api/chapters/{id}/qc` (procesa la generación activa, usa el
  semáforo GPU si el modelo corre en CUDA) y campo `qc_score`/`qc_flagged` en
  la respuesta del chunk map. Frontend: badge ámbar en los chunks marcados del
  ChunkMap con el texto esperado vs transcrito en tooltip/expansión, y botón
  de regenerar ya existente al lado.
- Tests: stub del transcriber en conftest (patrón ya usado para los engines);
  casos: chunk fiel ⇒ sin flag; chunk con frase omitida ⇒ flag; normalización
  hace que "Dr." vs "Doctor" no dispare falso positivo.

**Criterio**: sobre un capítulo de prueba con un chunk saboteado a propósito,
el QC lo marca y solo a él.

## F9 — Opcionales de cierre (orden libre, tras F1–F8)

- **PUB-01 — Paquete de publicación YouTube**: endpoint que componga la
  descripción con timestamps por capítulo (duraciones ya en SQLite), derive
  thumbnail 1280×720 del cover y exporte un `.txt`/`.json` de metadatos junto
  al MP4.
- **VOZ-07 — `resemble-enhance` (MIT)** como operación opcional de Studio
  (`enhance`): denoise+enhancement a 44.1 kHz para subir el techo del máster
  XTTS. Dependencia pesada: instalarla solo tras confirmar VRAM/tiempos con un
  test manual (HUMANO valida el A/B).
- **PROD-06 — Spike de motor de voz (HUMANO decide)**: evaluación documentada
  de Chatterbox Multilingual (MIT, español, clonación zero-shot) frente a
  XTTS v2 (licencia CPML no comercial) con 3 muestras A/B de la voz propia.
  Comparar contra el XTTS **ya optimizado** (post VOZ-08/09/10): medir contra
  el sampler estrangulado sería hacerse trampas.
  Entregable: una página en `internal-docs/` con veredicto y plan de
  migración si procede. Claude Code prepara el harness de comparación; la
  escucha y la decisión son del autor.
- **PROD-07 — RVC para la ruta de conversión (opcional, HUMANO decide)**: si
  la feature Audio Tools → Change Voice importa, sustituir OpenVoice V2 por
  RVC (entrena un modelo por voz objetivo con ~10 min de datos; fidelidad de
  timbre muy superior; MIT). Claude Code prepara el harness de comparación
  sobre el mismo audio fuente; si el autor no usa la conversión, `WONTFIX` y
  evaluar retirar la feature en F4 como código sin uso real.
- **PROD-08 — Clips animados como B-roll (gated por PROD-05)**: con el
  benchmark del `img_generation_module` validado, integrar sus clips I2V
  (Wan 2.2) en el slideshow como B-roll selectivo — el `VideoRenderPanel`
  acepta también `.mp4` por escena (verificar si el filtro de concat del
  `video_renderer` admite vídeo además de imagen estática; extenderlo si no).
  Regla de producto: 3–5 planos clave animados por capítulo, no 60 — cada
  clip cuesta minutos de GPU.
- **MET-01 — Métricas de producción en el dashboard**: extender `/api/stats`
  con cinco números por proyecto: minutos de audio publicable por hora de
  trabajo (aproximado vía timestamps de generaciones), % de chunks
  regenerados, nº de chunks marcados por QC, tiempo texto→MP4, y toques
  manuales (contador best-effort). Son los datos con los que se prioriza el
  trimestre siguiente.
- **DOG-01 (HUMANO) — Episodio dogfood**: con F1–F8 cerradas, producir y
  **publicar** un capítulo real de punta a punta, registrando cada fricción
  en BURNDOWN como backlog nuevo. El "Sprint 4" del plan de abril sigue
  pendiente; este plan no lo sustituye, lo desbloquea. La Definición de hecho
  §5 valida el pipeline técnico; DOG-01 valida el producto.
- **UX-03 — Studio de montaje (rediseño completo del módulo Studio)**:
  biblioteca de medios (subida desde explorador + import desde los
  directorios del `img_generation_module` leyendo sus sidecars + generación
  in-app vía PROD-02), timeline con bloques drag/resize sobre el audio del
  capítulo, preview client-side sincronizada y render por bloque. Diseño
  completo, modelo de datos, endpoints, fases M1–M7 con esfuerzos y gates en
  `internal-docs/studio-montage-redesign.md`. Ejecutar tras UX-01/UX-02;
  M5 requiere PROD-03, el botón de generación requiere PROD-02 y la pista de
  clips requiere PROD-08. Absorbe `VideoRenderPanel` al cierre de M6.

---

## Definición de hecho global

1. `BURNDOWN.md`: cero estados `ABIERTO` en F0–F8; los items de §F9 pueden
   quedar `DIFERIDO` con motivo; los `HUMANO-PENDIENTE` listados al final
   con instrucciones de una línea cada uno.
2. Suite completa verde: `pytest`, `vitest`, `typecheck`, e2e, y CI de schema
   sin drift.
3. Cero referencias a `librosa.effects.time_stretch`/`pitch_shift`;
   `vulture`/`knip` limpios; ningún TODO huérfano.
4. README veraz respecto al producto real (features, "Planned", local-first
   matizado, setup de ComfyUI).
5. Un capítulo de prueba recorre texto → síntesis → QC → Studio → slideshow
   con imagen real generada → MP4, sin tocar la GUI de ComfyUI ni perder
   datos por el camino.
6. La selección de candidatos XTTS optimiza inteligibilidad medida (VOZ-08)
   y los defaults de emergencia del sampler (`temperature=0.1`) han sido
   sustituidos con A/B documentado (VOZ-09).

## Qué NO hacer

No introducir frameworks ni reescrituras horizontales (nada de migrar a otra
UI lib, otro ORM, otro test runner). No añadir telemetría ni servicios cloud
en runtime. No "arreglar" hallazgos del audit que el triaje demuestre ya
cerrados — marcar y seguir. No tocar los specs internos de
`img_generation_module` (tiene su propio plan y gates); la integración de F7
consume su instancia y convenciones, no las reescribe. Y no simular los pasos
HUMANO: el benchmark, los A/B de escucha y la decisión de motor de voz son
del autor.
