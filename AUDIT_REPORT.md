# Informe de Auditoría — VoxForge

**Fecha**: 2026-04-10
**Auditores**: QA Engineer + Senior Product Specialist (Audio Production Software)
**Proyecto**: VoxForge — herramienta personal de narración de audiolibros fantásticos
**Hardware objetivo**: RTX 4070 SUPER 12GB, local-only, usuario único

---

## Parte 1 — QA / Bugs encontrados

### 🔴 Crítico (1)

#### C1 · Path traversal en descarga de muestras

- **Archivo**: `backend/routers/voices.py:97-103`
- **Descripción**: `get_voice_sample` construye `filepath = VOICES_DIR / filename` sin validar el parámetro `filename`. Una petición con `..%2F..%2Fbackend%2Fconfig.py` resuelve fuera de `VOICES_DIR` y sirve archivos arbitrarios del sistema.
- **Repro**: `GET /api/voices/samples/../../backend/config.py`
- **Fix**: Rechazar `filename` con separadores de ruta o `..`, y verificar `filepath.resolve().is_relative_to(VOICES_DIR.resolve())` antes de responder.

---

### 🟠 Alto (4)

#### H1 · Sin semáforo GPU ni timeout en `ConvertEngine`

- **Archivo**: `backend/services/convert_engine.py:98-169`
- **Descripción**: A diferencia de `CloneEngine._gpu_semaphore`, el motor de conversión no tiene mutex. Dos peticiones `POST /convert` paralelas ejecutan tres bloques `to_thread` sobre el mismo dispositivo CUDA simultáneamente, causando contención de VRAM, OOMs y cuelgues. Tampoco hay `asyncio.wait_for`, así que una conversión atascada nunca expira.
- **Repro**: Lanzar dos `convertVoice()` en paralelo mientras el clone_engine está cargado.
- **Fix**: Añadir un `_gpu_semaphore = asyncio.Semaphore(1)` a nivel de módulo protegiendo `convert()`, y envolver las llamadas `to_thread` con `asyncio.wait_for(..., timeout=N)`. Idealmente compartir un semáforo entre `CloneEngine` y `ConvertEngine` ya que ambos usan la misma GPU.

#### H2 · El endpoint experimental bypassea el semáforo GPU

- **Archivo**: `backend/routers/experimental.py:22-116`
- **Descripción**: `cross_lingual_synthesis` accede a `clone._model` y llama directamente a `model.tts_to_file`, saltándose el `CloneEngine._gpu_semaphore`. Enviar una petición experimental mientras el tab Sintetizar está corriendo causa inferencias XTTS simultáneas en el mismo modelo — contención de VRAM, errores cuBLAS o cuelgues.
- **Repro**: Iniciar una síntesis larga en Sintetizar, luego pulsar generar en Experimental en paralelo.
- **Fix**: Importar y adquirir `clone_engine._gpu_semaphore` alrededor de la llamada `to_thread`, y añadir un timeout `wait_for`. Mejor aún: enrutar a través de un nuevo método de `CloneEngine` en vez de acceder a atributos privados.

#### H3 · Endpoints de upload aceptan cualquier content type y cualquier tamaño

- **Archivos**:
  - `backend/routers/voices.py:47-94` (upload de muestra — `_ALLOWED_SAMPLE_TYPES` definido pero **nunca usado**)
  - `backend/routers/conversion.py:26-73` (source + target — `_ALLOWED_TYPES` definido pero **nunca usado**)
  - `backend/routers/voice_lab.py:69-125` (sin allowlist)
  - `backend/routers/experimental.py:22-54`
  - `backend/routers/preprocess.py:102-123`
- **Descripción**: Cada endpoint de upload llama a `await <upload>.read()` sin guard de tamaño. Un solo POST de 2GB se buffearía completo en RAM y crashearía el worker. `_ALLOWED_SAMPLE_TYPES` y `_ALLOWED_TYPES` están definidos pero **nunca se referencian** — código muerto. Solo `profiles.create_profile` valida realmente `content_type`.
- **Repro**: `curl -F "sample=@arbitrario.exe" .../voices/upload-sample` tiene éxito; `curl -F "audio=@2gb.bin" .../convert` OOMea el backend.
- **Fix**: Hacer cumplir `if sample.content_type not in _ALLOWED_SAMPLE_TYPES: raise InvalidSampleError(...)` en todos los endpoints. Leer en chunks con un contador de bytes máximo (ej: 100 MB).

#### H4 · `output_format` nunca validado en múltiples endpoints

- **Archivos**: `backend/routers/conversion.py:31`, `backend/routers/voice_lab.py:80`, `backend/routers/experimental.py:27`
- **Descripción**: `output_format: str = Form(default="mp3")` es input no confiable. Los servicios downstream llaman a `AUDIO_FORMATS.get(output_format, AUDIO_FORMATS["mp3"])`. El fallback produce un archivo MP3 pero `output_path = OUTPUT_DIR / f"{file_id}.{output_format}"` sigue usando la extensión proporcionada por el usuario, y el header media_type es `audio/{output_format}`. Resultado: un archivo `output.xyz` con bytes MP3 servido como `audio/xyz`, rompiendo navegadores y callers downstream.
- **Fix**: Validar `if output_format not in AUDIO_FORMATS: raise UnsupportedFormatError(...)` en el límite del router, igual que hace `synthesis.py` via Pydantic.

---

### 🟡 Medio (9)

#### M1 · Leak de interval al desmontar `useSynthesis`

- **Archivo**: `src/hooks/useSynthesis.ts:55-91`
- **Descripción**: `intervalRef.current = window.setInterval(...)` nunca se limpia en un cleanup de `useEffect`. Si el usuario navega fuera del tab Sintetizar mientras la generación está corriendo, el interval sigue disparando `setStepLabel`/`setProgress` en el componente desmontado (warning de React + leak de closure hasta que el fetch resuelve).
- **Fix**: Añadir `useEffect(() => () => clearInterval(), [clearInterval]);` al hook.

#### M2 · Archivos de muestra huérfanos cuando el perfil no existe

- **Archivo**: `backend/routers/voices.py:79-84`
- **Descripción**: Si el cliente proporciona un `profile_id` inválido, la muestra aún se escribe en `VOICES_DIR` pero nunca queda referenciada por ningún perfil. El almacenamiento se acumula indefinidamente. La respuesta sigue devolviendo `profile_id=profile_id` implicando éxito — mismatch de contrato frontend/backend.
- **Fix**: En `ProfileNotFound`, hacer `filepath.unlink(missing_ok=True)` y re-lanzar (o devolver `profile_id=None`).

#### M3 · Output files nunca limpiados en convert/voice_lab/experimental

- **Archivos**: `backend/routers/conversion.py`, `backend/routers/voice_lab.py`, `backend/routers/experimental.py`
- **Descripción**: Solo `synthesis.py` programa `background_tasks.add_task(cleanup_old_files)`. Todos los demás routers dejan el archivo final `OUTPUT_DIR/<uuid>.<fmt>` en disco permanentemente. Instalaciones de larga duración acumulan cientos de MB.
- **Fix**: Añadir el mismo cleanup `BackgroundTasks` a los otros routers.

#### M4 · `ProfileManager.get()` devuelve referencias mutables; race con writers

- **Archivo**: `backend/services/profile_manager.py:62-82`
- **Descripción**: `get()` devuelve el objeto `VoiceProfile` en memoria directamente (sin copia, sin lock). `update()` luego muta ese mismo objeto via `setattr(profile, ...)` dentro del lock. Un reader (ej: `TTSEngine.synthesize`) podría observar un perfil parcialmente mutado. Si `_write_atomic` lanza, el estado en memoria queda mutado mientras el archivo en disco está stale.
- **Fix**: Copiar al leer (`profile.model_copy()`). En `update()`, construir un nuevo `VoiceProfile` con `model_copy(update=...)` y solo cambiar en el dict tras éxito de `_write_atomic`.

#### M5 · `TTSEngine.synthesize` muta el request del caller

- **Archivo**: `backend/services/tts_engine.py:228`
- **Descripción**: `request.voice_id = profile.voice_id` muta in-place el modelo Pydantic del request. Inofensivo en el flujo actual pero un footgun: cualquier middleware o background task futuro que retenga el request original verá un `voice_id` diferente.
- **Fix**: Usar variables locales (`voice_id = profile.voice_id or request.voice_id`) y pasar explícitamente.

#### M6 · `_apply_volume` pierde parámetros de codec

- **Archivo**: `backend/services/tts_engine.py:310-329`
- **Descripción**: `_apply_volume` lee el archivo exportado y re-exporta con solo `format=path.suffix` — sin codec, sin parameters. Para MP3 esto re-codifica silenciosamente al bitrate por defecto (128 kbps), deshaciendo la configuración de mayor calidad en `AUDIO_FORMATS`. Para OGG/FLAC/Opus puede fallar o degradar calidad.
- **Fix**: Buscar `AUDIO_FORMATS[fmt]` y pasar `codec` / `parameters` en el re-export — o aplicar el ajuste de volumen al WAV crudo antes del export final.

#### M7 · El endpoint `preprocess/file` bypassea el límite de longitud de texto

- **Archivo**: `backend/routers/preprocess.py:102-123`
- **Descripción**: `PreprocessRequest` en el endpoint JSON aplica `max_length=settings.max_text_length`. La variante de upload de archivo extrae texto sin ningún check de longitud y lo alimenta a `normalize_for_tts`. Un PDF de 50 MB pasaría decenas de MB de texto por regex pesados.
- **Fix**: Rechazar si `len(text) > settings.max_text_length` tras la extracción.

#### M8 · El frontend no tiene wiring de aborto de requests

- **Archivos**: `src/api/client.ts`, `src/api/conversion.ts`, `src/api/synthesis.ts`
- **Descripción**: Ninguna de las llamadas `fetch` acepta un `AbortSignal`. El `CancellationToken` del backend depende de que el cliente cierre realmente la conexión TCP (que los navegadores hacen solo al cerrar la pestaña). Tampoco hay un botón de cancelar en SynthTab/ConvertTab, así que la cancelación a mitad de generación es prácticamente imposible.
- **Fix**: Pasar un `AbortController` a través de `useSynthesis`/`useConvert`; exponer un botón "Cancelar" cuando `isGenerating`.

#### M9 · Código de segmentación sin usar en `ConvertEngine`

- **Archivo**: `backend/services/convert_engine.py:31-32`
- **Descripción**: `_MAX_SEGMENT_SECONDS` y `_SEGMENT_OVERLAP_SECONDS` están definidos con un docstring que dice "longer files are split into segments", pero el código nunca los usa. Los archivos largos se pasan directamente a OpenVoice, que tiene límites prácticos de longitud.
- **Fix**: Implementar segmentación + crossfade o eliminar las constantes y arreglar el docstring; añadir también un guard de upper-bound en la longitud del source.

---

### 🟢 Bajo (6)

- **L1 · Doble revoke de object URLs** en `useAudioPlayer.ts:20-33`
- **L2 · Variable sin usar** `device` en `experimental.py:58`
- **L3 · `split_into_clone_chunks` descarta silenciosamente frases de menos de 2 caracteres** (ej: "¡O!")
- **L4 · `docx`/`pdf` import sin manejo de excepciones** en `preprocess.py:47-67` — uploads corruptos devuelven 500 en vez de 400
- **L5 · `cross_lingual_synthesis` acepta `language` sin validar** en `experimental.py:26,75`
- **L6 · `ProfileManager._load` no bloquea el archivo en disco** — race entre procesos

---

### Gaps de cobertura de tests

- No hay tests asertando rechazo de path-traversal en `voices.get_voice_sample`
- No hay tests para el path de concurrencia en `ConvertEngine` (dos conversiones simultáneas)
- `experimental.cross_lingual_synthesis` no tiene tests cubriendo el bypass de semáforo
- No hay test de frontend para limpieza de interval cuando `useSynthesis` se desmonta a mitad de generación
- No hay tests de `_apply_volume` preservando codec en formatos no-WAV

---

## Parte 2 — Producto / Mejoras sugeridas

### 1. Estado actual

VoxForge es, honestamente, inusual en buen sentido: una app web local-first, dual-engine (Edge-TTS + XTTS v2) con un pipeline de clonación de voz que la mayoría de hobbyists nunca terminan limpiamente. La arquitectura es sólida — FastAPI + TypeScript estricto, 95% cobertura backend, servicios en capas, lazy loading de GPU, cancellation tokens, escrituras atómicas de perfiles.

#### Lo que ya funciona bien para un narrador de audiolibros

- **Loop de síntesis quality-first**: 8 candidatos por chunk con scoring y hasta 4 retries. Más de lo que Play.ht o Murf exponen.
- **Chunking sentence-aware con jerarquía de pausas** (200ms coma / 500ms frase / 900ms párrafo). Lo más importante para narración larga.
- **Normalización de texto en español**: abreviaturas, números a palabras, ALL-CAPS, puntuación. Diferenciador enorme vs herramientas inglesa-céntricas.
- **Routing dual transparente**: el usuario no elige motor; la presencia de muestra decide.
- **Cancelación al desconectar el cliente**: raro en herramientas locales.
- **Ingestión de documentos** (`.txt/.docx/.pdf`): baja la fricción para escritores.

#### Lo que falta para uso diario (la lista brutal)

- **Sin concepto de "proyecto" o "historia"**. Cierras la pestaña a mitad de generación y tu texto se pierde. Sin `localStorage`, sin recuperación de drafts, sin "la historia de ayer". Para alguien produciendo historias de 11k palabras, este es el gap **#1**.
- **Sin segmentación de capítulos/escenas**. Una historia de 11k palabras es un solo textarea gigante. El estándar de la industria (Descript, Audiobook Creation Exchange) es chapter-aware.
- **Sin re-síntesis por chunk**. Si el chunk 14 de 40 tiene un glitch, la única opción es regenerar el archivo entero. **El mayor desperdicio de tiempo del flujo actual**.
- **Sin waveform con regiones**. `WaveformVisualizer` es decorativo, no editor interactivo.
- **Sin voces de personaje en diálogo**. Audiolibros fantásticos son dialogue-heavy. No hay forma de decir "narración = perfil A, diálogo de Kael = perfil B".
- **Sin metadata/ID3 tagging**. Los archivos exportados son `voxforge_output.mp3` — inutilizables directamente en un app de podcast, Plex, o reproductor de audiolibros sin post-proceso.
- **Perfiles planos**. Sin tags, sin agrupación, sin favoritos, sin notas.
- **Sin historial de generación**. Cada síntesis sobreescribe la anterior.
- **Sin SSML ni markup inline**. No hay forma de insertar `[pause 2s]`, enfatizar una palabra, o marcar un susurro.

---

### 2. Puntos de fricción UX

Recorriendo el loop diario del narrador — **escribir → generar → revisar → iterar → exportar** — aquí es donde la herramienta estorba:

1. **Fase escribir**: Solo un textarea. Sin autosave de drafts. Sin word count más allá del raw character count. Sin estimación de duración.
2. **Fase generar**: La barra de progreso es fake (4 pasos hardcodeados). Para una generación de 11k palabras que tarda minutos, el usuario está mirando una barra sin información real. El backend ya conoce el chunk count real.
3. **Fase revisar**: Playback es un solo `<audio>` con play/pause/stop. **Sin barra de seek, sin skip ±10s, sin velocidad de reproducción, sin marcadores de chunks**. Y en `SynthTab.tsx:191` el elemento audio tiene `display: none`, así que ni los controles nativos están visibles.
4. **Fase iterar**: Aquí es donde la herramienta falla más fuerte. Si oyes un glitch en el minuto 12, debes:
   - Encontrar la frase ofensiva en el textarea manualmente
   - Arreglarla
   - Regenerar **el archivo completo de 20 minutos**
5. **Fase exportar**: Filename hardcodeado `voxforge_output.${format}`. Sin nombre de capítulo, sin numeración, sin tags ID3.
6. **Coste de cambiar de tab**: Seis tabs, y el estado no fluye entre ellos. No puedes coger un audio del Lab y meterlo en un perfil.
7. **Lab pierde tu preset custom**: Tocas un slider y `setActivePreset(null)` descarta silenciosamente cualquier setting custom.
8. **Sin keyboard**. Ni Ctrl+Enter, ni Space, ni Ctrl+S.

---

### 3. Features faltantes (alto impacto)

Rankeado por **Impacto × Factibilidad** dado los constraints (local-only, single-user, GPU-bound).

| # | Feature | Impacto | Esfuerzo | Razón |
|---|---|---|---|---|
| 1 | **Persistencia de proyecto/historia** (SQLite: stories, chapters, generations) | 10 | 4 | Transforma la herramienta de "scratchpad" a "workbench". |
| 2 | **Re-síntesis por chunk con UI de chunk map** | 10 | 5 | El mayor win en la fase iterate. El backend ya hace chunking; solo hay que exponer las fronteras. |
| 3 | **Waveform interactivo con marcadores de chunks + seek/skip/rate** | 9 | 4 | Hacer clickable el `WaveformVisualizer` existente. |
| 4 | **Gestor de capítulos** (split por `# heading` o `---`) | 9 | 3 | Una historia de 11k palabras → capítulos de 2-3k. |
| 5 | **Casting de voces de personaje via markup inline** | 9 | 5 | `[Kael] "Lo sabía."` → enrutar esa línea al perfil "Kael". |
| 6 | **Crash recovery / autosave de draft** | 9 | 2 | `localStorage` cada 3s. Dos horas de código, evita disgustos. |
| 7 | **ID3/metadata embedding** (título, autor, capítulo, cover) | 8 | 2 | `mutagen` en backend. Esencial para que apps de podcast/audiolibro lo muestren bien. |
| 8 | **Guardar presets custom del Lab** | 8 | 2 | El schema ya tiene `Preset`; solo añadir presets de usuario. |
| 9 | **Progreso real streaming** (SSE con eventos por chunk) | 8 | 4 | El backend ya conoce N/total. |
| 10 | **Modo comparación** (A/B dos perfiles sobre el mismo párrafo) | 8 | 3 | Crítico al decidir qué voz castear a un personaje. |
| 11 | **Preview-before-commit** (primer párrafo en N voces candidatas) | 8 | 3 | Antes de quemar 3 minutos de GPU, generar 300 chars contra 3-5 perfiles. |
| 12 | **Diccionario de pronunciación** (overrides per-project) | 8 | 3 | Nombres fantásticos ("Caelthir", "Zyrrendal") los pronuncia mal cualquier TTS. |
| 13 | **Cortado de silencios / trim en exportación** (pase ffmpeg) | 7 | 2 | Trim automático de silencios largos al inicio/final. |
| 14 | **Historial de generación por capítulo** (últimos N takes, diff de texto) | 7 | 3 | "Regenerar el mismo chunk y comparar con take #3". |
| 15 | **Atajos de teclado** (Ctrl+Enter, Space, Ctrl+S, J/K/L scrub) | 7 | 2 | Para alguien pasando horas en la herramienta. |
| 16 | **Exportación batch de capítulos** (todos los capítulos → MP3s numerados) | 7 | 3 | "Generar 12 capítulos por la noche". |
| 17 | **Tagging/agrupación de perfiles + campo de notas** | 6 | 2 | |
| 18 | **Múltiples muestras de referencia por perfil** | 6 | 3 | XTTS v2 lo soporta nativo. |
| 19 | **SSML-lite: `[pause 1.5s]`, `[emph]`, `[whisper]`** | 6 | 4 | |
| 20 | **Analizador de calidad de muestra** (SNR, clipping, duración) | 6 | 3 | Previene el problema #1 de "mi clon suena mal": muestra mala. |

---

### 4. Features faltantes (polish)

- **Empty states con guía**. Synth tab con cero texto debería sugerir cargar archivo o el último draft.
- **Loading states reales por acción**. Hoy: `isGenerating`, `isUploading`, `isProcessing` globales. Sin skeleton loaders.
- **Mejores mensajes de error**. `Error: ${e instanceof Error ? e.message : "Unknown"}` filtra strings de stacktrace. Traducir excepciones de dominio a copy amigable en español.
- **Posicionamiento + stacking de toasts**. Generaciones largas que emiten múltiples notificaciones pierden contexto.
- **Tour de onboarding**. Primer arranque: overlay de 3 pasos.
- **Estimación de duración** junto a `charCount`. `~15 chars/segundo` es heurística decente para español.
- **Audio level meters** en el player.
- **Auditoría de contraste WCAG** del modo oscuro.
- **Botones "Copiar texto" y "Limpiar texto"** en la toolbar del editor.
- **Versión en el header**. `HealthResponse` ya devuelve `version`.
- **Dry-run de coste** antes de generar: "esto tardará ~2m30s en tu GPU, output ~20MB".
- **Drag-and-drop de archivos de texto al editor**.
- **Tooltip en el badge de motor** explicando qué significa CLONED vs EDGE-TTS.
- **Sort "usado recientemente"** en la lista de perfiles.
- **Preview de waveform de muestra** al subir voice sample.

---

### 5. Roadmap priorizado

#### Tier 1 — Quick Wins (días, no semanas)

**Objetivo**: dejar de perder trabajo y dejar de desperdiciar generaciones.

1. **Autosave de draft a `localStorage`** cada 3s; restaurar al recargar (2h)
2. **Generación crash-safe**: persistir job ID + chunk index; reanudar tras reinicio (1 día)
3. **Progreso real per-chunk** via SSE. Reemplazar barra fake (1 día)
4. **Player interactivo**: scrubber, ±10s, velocidad de reproducción (medio día)
5. **ID3 metadata embedding** en exportación (medio día con `mutagen`)
6. **Patrón de filename** configurable: `{story}_{chapter:02d}_{date}.{fmt}` (1h)
7. **Atajos de teclado**: Ctrl+Enter, Space, Ctrl+S (medio día)
8. **Presets custom del Lab**: guardar el estado actual con un nombre (medio día)
9. **Estimación de duración** junto al char counter (1h)
10. **Diccionario de pronunciación MVP**: JSON aplicado en `normalize_for_tts`, editor tabla simple (1 día)

**Total: ~1 semana, elimina ~70% de la fricción diaria**

#### Tier 2 — Medio plazo (semanas)

**Objetivo**: convertir VoxForge en un workbench real de audiolibros.

1. **Migración SQLite** para stories, chapters, generations, presets. Schema: `projects → chapters → generations (con chunk map) → takes` (3-4 días)
2. **Gestor de capítulos**: split del textarea por `# heading` o `---`, navegación, generación per-capítulo (2-3 días)
3. ⭐ **UI de chunk map + regeneración por chunk**: ver el capítulo como lista ordenada de chunks con texto + waveform + timestamp. Click → editar → regenerar → splice (1 semana — *la feature estrella*)
4. **Modo comparación (A/B)**: mismo texto, dos perfiles, side-by-side (2 días)
5. **Preview de primer párrafo** contra 3-5 perfiles antes del commit completo (1 día tras A/B)
6. **Exportación batch**: "Exportar los 12 capítulos de este proyecto" (2 días)
7. **Casting de personajes via markup**: parser `[Character]` + asignación per-character (3-4 días)
8. **Analizador de calidad de muestra de voz** (SNR, clipping, duración) (1-2 días)
9. **Múltiples muestras de referencia por perfil** (1 día)
10. **Mensajes de error mejorados** end-to-end, copy en español

#### Tier 3 — Largo plazo (meses, pero transformativo)

1. **Editor de audio chunk-level completo**: cut, trim silences, nudge pauses, drag chunks (2-3 semanas, `wavesurfer.js` como base)
2. **Markup SSML-lite**: `[pause 2s]`, `[emph]`, `[whisper]`, `[rate 0.9]` (1-2 semanas)
3. **Condicionamiento de emoción** — XTTS v2 tiene control limitado de emoción via selección de muestra de referencia (exploratorio)
4. **Diccionario de pronunciación con phoneme overrides** (per-project y global), con input IPA
5. **Plantillas de proyecto** — "Novela fantástica", "Relato corto", "Episodio de podcast"
6. **Track de ambientación / efectos de sonido** por chunk (mixer en el paso de export)
7. **Evaluar F5-TTS o Zonos como motor alternativo de clonación**. XTTS v2 es excelente pero envejece; modelos más nuevos pueden ofrecer mejor prosodia española en una tarjeta de 12GB

---

### 6. Perspectiva competitiva

| Feature | ElevenLabs | Descript | Play.ht | VoxForge | ¿Importa para audiolibros solo? |
|---|---|---|---|---|---|
| Proyectos / capítulos | Sí (Studio) | Sí | Sí | **No** | **Sí — crítico** |
| Regen por segmento | Sí | Sí | Sí | **No** | **Sí — crítico** |
| Clonación de voz | Sí (cloud) | Sí (cloud) | Sí (cloud) | **Sí (local)** | VoxForge gana |
| Normalización español | Débil | Débil | OK | **Fuerte** | VoxForge gana |
| Local / offline | No | No | No | **Sí** | Innegociable |
| Diccionario pronunciación | Sí | Sí | Sí | **No** | **Sí — crítico** para nombres fantásticos |
| Voces de personaje en diálogo | Sí (Studio) | Sí | No | **No** | **Sí — alto impacto** |
| Export ID3/metadata | Parcial | Sí | Sí | **No** | **Sí — importante** |
| Editor multi-track | No | **Sí** | No | No | Nice to have |
| Pause/SSML markup | Sí | Sí | Sí | **No** | **Sí — medio** |
| Control de emoción | Sí (v3) | No | Sí | **No** | Nice to have |
| Speech-to-speech | Sí | **Sí (flagship)** | Sí | **Sí (Convert)** | VoxForge ya lo tiene |
| Transcripción | Sí | **Sí (flagship)** | Sí | No | **Distracción** |
| Edición de video | No | **Sí (flagship)** | No | No | **Distracción** |
| Colaboración | Sí | Sí | Sí | No | **Distracción** — single user |
| Marketplace de voces | Sí | Sí | Sí | No | **Distracción** — local only |
| API/webhooks | Sí | Sí | Sí | No | **Distracción** para uso personal |

**Lo que importa y a VoxForge le falta**: proyectos/capítulos, regen por segmento, diccionario de pronunciación, casting de personajes, ID3, markup para pausas/énfasis. Los seis están en el roadmap.

**Lo que VoxForge ya hace mejor**: operación verdaderamente local, normalización de texto español, transparencia dual-engine, el tab Convertir (flagship de Descript), la suite DSP del Laboratorio (ningún competidor expone DSP slider-level con presets), y el tab cross-lingual Experimental.

**Lo que ignorar**: transcripción, video, colaboración, marketplaces, APIs. Distracciones para un productor solo de audiolibros español sin dependencia cloud.

---

## Veredicto

> *"VoxForge está técnicamente en el top 5% de proyectos hobby de voz — la arquitectura, disciplina de tests y manejo de texto español-first son trabajo serio. Pero como **producto** para producción diaria de audiolibros, está atascado en ~60% de su potencial porque trata cada generación como desechable y cada texto como un scratchpad.*
>
> *El unlock no es más modelos ni más tabs. Es **persistencia** (proyectos SQLite), **granularidad** (regen por chunk con UI de chunk map), y **fiabilidad** (autosave, resume, progreso real). Ship Tier 1 en una semana y Tier 2 durante el siguiente mes, y VoxForge se convierte en la herramienta sin equivalente: un workbench de audiolibros local-only, español-first, con clonación, chapter-aware. Es un nicho que ningún producto comercial atiende, y es exactamente donde este codebase está posicionado para ganar."*

---

## Resumen ejecutivo: top 3 acciones inmediatas

Las 3 acciones con mayor ROI inmediato:

1. **Arreglar C1 (path traversal)** — riesgo de seguridad, **15 minutos**
2. **Arreglar H1/H2 (semáforos GPU)** — previene cuelgues reales en convert + experimental, **30 minutos**
3. **Autosave en localStorage** — elimina la queja #1 (pérdida de trabajo), **2 horas**

Total: **menos de 3 horas** para resolver el bug crítico de seguridad, los dos bugs alto que causan cuelgues, y la mayor frustración UX del producto.
