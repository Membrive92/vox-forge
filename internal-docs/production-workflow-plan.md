# Production workflow plan — grabar, subir, editar, generar video enriquecido

**Fecha**: 2026-04-22
**Estado**: Planificado, pendiente de implementación
**Motivación**: La app hoy produce audiolibros via TTS (síntesis + edición + video con portada estática). Para convertirla en una herramienta de producción real necesita tres piezas adicionales: (a) ingerir audio humano (grabar en-app o subir un archivo), (b) enriquecer el video con imágenes por escena, y (c) procesado de audio de nivel publicable (LUFS, denoise). Este plan cubre las tres en tres bloques independientes que se pueden mergear por separado.

---

## Principio rector

**Conectar, no inflar.** Cada feature se apoya en infra existente (`studio_renders`, `generations`, `AudioRecorder`, `video_renderer`). Ninguna requiere nuevos motores, nuevas tablas grandes, ni dependencias pesadas salvo cuando se llega a Fase C real.

Orden recomendado: A1+A2 (grabar/subir) → C1+C2 (denoise+LUFS) → B1+B2 (slideshow con imágenes manuales) → pausa para producir un capítulo real → B3 o B4 (generar imágenes).

---

## Posición en la app

Los cambios tocan estos lugares:

- **Workbench → ChapterCard**: botones nuevos "Grabar" y "Subir audio"; chip multi-take; mini waveform.
- **Studio → EditOperationsPanel**: operaciones nuevas `denoise`, `loudness`, `compressor`; modal de punch-in.
- **Studio → VideoRenderPanel**: de single-cover a lista de imágenes con timestamps.
- **Activity → Settings**: campo nuevo para API key de imagen (si se usa externa).

Ningún tab nuevo. Todo se añade a los paneles ya visibles.

---

## Hoja de ruta

| Bloque | Fase | Qué aporta | Esfuerzo | Dependencias nuevas |
|--------|------|------------|----------|---------------------|
| **A** — Audio humano | A1 | Upload de audio como generación de capítulo | ~2h | Ninguna |
| | A2 | Grabar capítulo in-app (MediaRecorder) | ~3-4h | Ninguna |
| | A3 | Multi-take selector en chapter card | ~1.5h | Ninguna |
| | A4 | Punch-in (re-grabar trozo) desde Studio | ~3h | Ninguna |
| **C** — Polish producción | C1 | LUFS normalization (ffmpeg `loudnorm`) | ~1h | Ninguna |
| | C2 | Denoise (noisereduce, ya en requirements) | ~1.5h | Ninguna |
| | C3 | Compressor/limitador | ~1h | Ninguna |
| | C4 | Mini waveform en chapter card | ~1h | Ninguna |
| | C5 | Ambient mix integrado en Studio pipeline | ~1.5h | Ninguna |
| **B** — Video enriquecido | B1 | Slideshow multi-imagen (manual) | ~3h | Ninguna |
| | B2 | Detección de escenas desde transcripción | ~2h | Ninguna |
| | B3 | Generación imágenes via API externa | ~4h | `requests` (ya) + API key usuario |
| | B4 | Stable Diffusion local (Fase C del Studio) | ~15-20h | `diffusers`, LLM local, ~6 GB VRAM |

**Total MVP (A1+A2+C1+C2+B1+B2)**: ~12-13h. Produces complete pipeline: grabar → denoise → editar → LUFS → slideshow video → export.

---

## Bloque A — Audio humano como capítulo

### A1 — Upload de audio como generación (~2h)

#### Objetivo
Un botón "Subir audio" en la chapter card que acepta un archivo de audio y crea una row en `generations` con `engine="upload"`. A partir de ahí el flujo es idéntico al de un capítulo sintetizado: aparece con chip "Sintetizado", se puede editar en Studio, se incluye en el export.

#### Backend
- Nuevo endpoint `POST /api/chapters/{chapter_id}/upload-audio`
- Request: multipart con `audio` (reusar `validate_audio_upload` + `read_upload_safely`)
- Inserta en `generations` con `status="done"`, `engine="upload"`, `file_path=<destino>`, `duration=<via pydub>`
- Destino: `OUTPUT_DIR / f"upload_{chapter_id}_{uuid}.{ext}"` (persiste — no se auto-limpia a las 24h)

#### Frontend
- `src/api/chapterSynth.ts`: nueva `uploadChapterAudio(chapterId, file, signal?)` devolviendo la generation creada
- `ChapterCard`: botón "Subir audio" junto al de "Render video"; hidden `<input type="file">` + handler que llama al endpoint + refresca `loadStatus()`
- Opcional: drag-and-drop sobre la chapter card

#### Tests
- `test_upload_audio_creates_generation`
- `test_upload_audio_rejects_bad_mime`
- `test_upload_audio_nonexistent_chapter_404`

---

### A2 — Grabar capítulo in-app (~3-4h)

#### Objetivo
Panel de grabación con pause/resume, timer, medidor de nivel de entrada, visualizador simple de forma de onda. Al parar, sube al mismo endpoint que A1.

#### Backend
Ninguno nuevo — reutiliza A1 (`POST /api/chapters/{chapter_id}/upload-audio`).

Opcional si el navegador graba WebM/OPUS: que el endpoint detecte y transcode a MP3/WAV via pydub al vuelo (ya lo hace para otros endpoints cuando recibe WebM).

#### Frontend
- Nuevo componente `src/features/projects/ChapterRecorder.tsx`:
  - Usa `MediaRecorder` + `getUserMedia({ audio: true })`
  - Controles: Record / Pause / Resume / Stop
  - Timer `mm:ss`
  - Input level meter via `AnalyserNode` + `requestAnimationFrame`
  - Al Stop: muestra preview player + "Guardar como capítulo" / "Descartar"
  - Al Guardar: llama `uploadChapterAudio`
- `ChapterCard`: botón "Grabar" abre un modal con `ChapterRecorder`
- Gestión de permisos: si `navigator.mediaDevices` no disponible, mostrar mensaje claro

#### Tests
- Difícil de testear sin jsdom de MediaRecorder. Test manual + un test unitario que valide la composición del blob → llamada al API.

#### Decisiones cerradas
- **Formato de grabación**: dejamos que el navegador elija (`audio/webm;codecs=opus` en Chrome, `audio/mp4` en Safari). El backend transcode si hace falta.
- **Chunks client-side durante la grabación**: `MediaRecorder` ya chunk-ea internamente con `timeslice`. Reunimos al stop.
- **Máximo de duración**: sin límite duro; advertir al usuario a partir de 60 min (memory de la pestaña).

---

### A3 — Multi-take selector en chapter card (~1.5h)

#### Objetivo
Un capítulo puede tener varias `generations` (sintetizado + upload + grabación + regeneración). Hoy la UI muestra implícitamente la más reciente. Permitir al usuario elegir cuál es la "activa" (la que se exporta, la que alimenta Studio).

#### Backend
- Nueva columna opcional `chapters.active_generation_id` (ALTER TABLE migration como `cover_path`)
- `pm.update_chapter` acepta el nuevo campo
- `batch_export` y `/api/studio/sources` priorizan `active_generation_id` si está set; si no, usan "la más reciente done"

#### Frontend
- `ChapterCard`: si `generations.length > 1`, mostrar un dropdown con las generaciones (etiqueta: "Edge-TTS (hace 2h) · 3:45", "Subida (hace 10min) · 4:12", "Grabada (ahora) · 4:05"). Click marca activa → PATCH chapter.
- Indicador visual de cuál es la activa.

#### Tests
- `test_active_generation_wins_in_sources`
- `test_active_generation_wins_in_export`
- `test_active_generation_clearable_to_null`

---

### A4 — Punch-in re-grabar trozo (~3h)

#### Objetivo
En Studio, el usuario selecciona una región sobre el waveform → "Re-grabar este trozo". El sistema: reproduce el audio hasta el inicio de la selección, activa el mic durante la duración seleccionada, para. Produce un audio nuevo con el trozo re-grabado sustituido. Patrón clave en producción audiobook real ("punch-in").

#### Backend
- Nuevo endpoint `POST /api/studio/punch-in`
- Body: `{ source_path, start_ms, end_ms, new_audio (multipart en endpoint separado, o base64 inline) }`
- Lógica: `audio[:start] + new_audio + audio[end:]` con crossfades de 50ms en las uniones (via pydub `append` con `crossfade`)
- Persiste como `studio_renders` kind="audio" con `operations = [{type: "punch_in", params: {start_ms, end_ms}}]`

#### Frontend
- Nueva operación en `EditOperationsPanel`: botón "Re-grabar región" (solo activo con región + chapter context)
- Al click: abre modal con `ChapterRecorder` + preview del audio original de esa región como referencia de tempo/volumen
- Al Stop: llama endpoint, resultado aparece como "Result"

#### Tests
- `test_punch_in_length_matches_expected`
- `test_punch_in_rejects_bad_range`
- `test_punch_in_persists_to_studio_renders`

---

## Bloque C — Polish de producción

### C1 — Normalización LUFS (~1h)

#### Objetivo
El `normalize` actual usa peak (`pydub.apply_gain(target - max_dBFS)`). Las plataformas de audiolibros piden **LUFS** (Loudness Units Full Scale): Audible -18, Spotify -14, Apple Books -16. Peak normalize puede mantener un audio con peaks fuertes pero percepción floja.

#### Backend
- Nueva operación en `audio_editor.VALID_OPERATIONS`: `"loudness"` con `params = { target_lufs: -16 }`
- Implementación via `subprocess` a `ffmpeg -i in.wav -af loudnorm=I=-16:TP=-1.5:LRA=11 out.wav`
- Alternative: pydub no tiene LUFS; usar `pyloudnorm` (nueva dep ligera ~1 MB) para medición, ffmpeg para aplicación
- Añadir i18n + entrada en `EditOperationsPanel`

#### Frontend
- Botón nuevo "Normalizar LUFS" en Studio con input numérico `-24..-10` (default -16)
- Label aclaratoria: "Estándar audiolibros: Audible -18, Spotify -14"

#### Tests
- `test_loudness_op_calls_ffmpeg_with_correct_filter`
- `test_loudness_rejects_out_of_range_target`

---

### C2 — Denoise (~1.5h)

#### Objetivo
Limpiar grabaciones caseras (zumbidos, aire del micro, aire acondicionado). `noisereduce` ya está en requirements.txt (se usa en Voice Lab).

#### Backend
- Nueva operación `"denoise"` con `params = { strength: 0.5 }` (0 = off, 1 = agresivo)
- Implementación: cargar audio con librosa → `noisereduce.reduce_noise(y, sr, prop_decrease=strength)` → guardar
- Si no hay muestra de "ruido puro", usar estimación estacionaria (primeros 500ms suelen ser silencio con ruido ambiente)

#### Frontend
- Botón "Reducir ruido" con slider de intensidad 0-100%

#### Tests
- `test_denoise_preserves_length`
- `test_denoise_rejects_invalid_strength`

---

### C3 — Compressor/limitador (~1h)

#### Objetivo
Evitar peaks duros al mezclar con ambient o al combinar takes con niveles distintos.

#### Backend
- Nueva operación `"compressor"` con `params = { threshold_db: -18, ratio: 3, attack_ms: 10, release_ms: 150 }`
- Implementación: `pedalboard.Compressor` (ya en requirements via Voice Lab)

#### Frontend
- Un solo slider "Compresión" 0-100 que mapea a ratios 1:1 → 6:1 (oculta los otros parámetros). Preset para audiobook: threshold -18 dB, ratio 3:1, attack 10ms, release 150ms.

---

### C4 — Mini waveform en chapter card (~1h)

#### Objetivo
Ver de un vistazo qué capítulos tienen audio con qué forma. Útil para detectar capítulos cortos/silenciosos/ruidosos sin entrar a Studio.

#### Backend
Opcional: endpoint que devuelve un array de N samples normalizados (0-255) de un audio file. Tamaño ~200 bytes por capítulo.

Alternative: FE lo calcula cuando hay una generation, via `AudioContext.decodeAudioData`. Más costoso en CPU pero sin endpoint nuevo.

#### Frontend
- Nuevo componente `<MiniWaveform audioUrl={...} height={24} />`
- Lo meto en la fila de status chips de ChapterCard
- Click → abre Studio con ese capítulo

---

### C5 — Ambient mix integrado en Studio pipeline (~1.5h)

#### Objetivo
Hoy AmbienceMixer vive dentro de la ChapterCard (panel "Ambient"). Si editas un capítulo en Studio y luego quieres mezclar ambient, tienes que volver al Workbench. La edición hecha no se propaga.

Fix: permitir que el ambient se aplique como una **operación Studio** (input: ambient track id, volume, fade in/out) → se ejecuta sobre el audio ya editado, persiste como nueva versión.

#### Backend
- Nueva operación `"mix_ambient"` con `params = { track_id, volume_db, fade_in_ms, fade_out_ms }`
- Reutiliza `backend/services/ambience.py` (existe para el mixer actual)

#### Frontend
- Botón "Mezclar ambient" en `EditOperationsPanel` con submenu: selector de track + sliders (igual que AmbienceMixer actual pero compacto)

---

## Bloque B — Video enriquecido

### B1 — Slideshow multi-imagen (~3h)

#### Objetivo
Hoy `/api/studio/render-video` acepta **una** cover_path. Extender para aceptar una lista `[{image_path, start_s, end_s?}]`. El renderer usa `ffmpeg` concat + crossfade.

#### Backend
- `RenderVideoRequest` añade `images: Optional[list[VideoImage]]` donde `VideoImage = {path, start_s, end_s?}`
- `video_renderer._build_ffmpeg_argv`: si `images` está presente, usa `-i` múltiples + `filter_complex` con `concat` + `xfade` filter. Si no, cae al comportamiento actual (single cover con zoompan).
- Decisión: `cover_path` sigue siendo obligatorio y se usa como fallback antes del primer timestamp y después del último. O hacerlo opcional cuando hay `images`.

#### Frontend
- `VideoRenderPanel`: si hay transcripción, mostrar lista de escenas (B2 lo produce) con slot para subir imagen + input de duración
- Si no hay transcripción, permitir modo "portada única" (actual) o "añadir imágenes manualmente con timestamps"

#### Tests
- `test_render_video_with_images_produces_mp4`
- `test_render_video_image_order_matches_timestamps`
- `test_render_video_gap_falls_back_to_cover`

---

### B2 — Detección de escenas desde transcripción (~2h)

#### Objetivo
A partir del SRT de la transcripción (B.1 del Studio plan original), agrupar líneas consecutivas en "escenas" de ~20-30s. Cada escena es un slot para una imagen.

#### Backend
- Nuevo endpoint `POST /api/studio/scenes/detect`
- Body: `{ srt_path, target_scene_seconds: 25 }`
- Lógica: leer SRT, agrupar entradas hasta llegar a N segundos O a un cambio mayor (línea en mayúsculas, paragraph break según pausa larga, punto de pausa `[pause]`). Devuelve `[{start_s, end_s, text_preview}]`.
- Sin persistencia — el cliente guarda el array y lo manda a `/render-video` con `images`.

#### Frontend
- `VideoRenderPanel`: botón "Detectar escenas" (habilitado con transcripción cargada) → muestra lista con preview de texto + slot de imagen por escena (drop-zone)

#### Tests
- `test_detect_scenes_groups_by_target_duration`
- `test_detect_scenes_respects_paragraph_breaks`

---

### B3 — Generación de imágenes via API externa (~4h)

#### Objetivo
Para cada escena, botón "Generar imagen" con prompt editable. Usa una API externa (usuario aporta API key). Proveedor soportado inicial: uno (probablemente Replicate o Stable Horde gratuito).

#### Backend
- Nuevo servicio `backend/services/image_gen.py` con adapter para el proveedor elegido
- Config: nuevo campo `image_api_key` en settings (almacenado en `data/settings.json`, no en git)
- Endpoint `POST /api/studio/generate-image`
- Body: `{ prompt, aspect_ratio, seed? }`
- Returns: `{ image_path }` (guardado en `STUDIO_COVERS_DIR`)

#### Frontend
- `VideoRenderPanel`: botón "Generar" por escena → modal con prompt + variantes (4 imágenes en grid) → usuario elige una → rellena el slot de imagen de la escena
- Settings: panel "API keys" en Activity → Settings con campo para la key

#### Decisiones abiertas
- **Proveedor**: Replicate (más modelos, pay-per-use) vs Stable Horde (gratis, cola compartida, calidad variable) vs DALL·E 3 (mejor calidad pero más caro, no-consentido para contenido no-explícito). Mi recomendación: **Replicate con SDXL**. Primer coste ~$0.005 por imagen, ratios aceptables, razonable para pruebas.
- **Prompt assist**: ¿LLM local para generar el prompt desde el texto de la escena o pedir al usuario escribirlo? Recomendación: **campo libre con plantilla pre-rellena** ("A cinematic illustration of: {primera línea de la escena}").

---

### B4 — Stable Diffusion local (Fase C completa del Studio) (~15-20h)

Ver `studio-module-plan.md § Fase C`. No se duplica aquí. Entra cuando B3 deja de cumplir (cost, latencia, privacidad). Requiere:
- `diffusers` + SDXL en `requirements.txt`
- Ollama + modelo LLM local (Llama 3.1 8B o Phi-3-mini) para la extracción de prompts
- Memoria GPU compartida con XTTS: cargar/descargar por turnos

---

## Tests — bloque A, B, C

Total estimado: ~25-30 tests nuevos backend + test manual de UI.

Distribución:
- A1: 3 tests
- A2: 0 (manual)
- A3: 3 tests + update de export tests existentes
- A4: 3 tests
- C1: 2 tests
- C2: 2 tests
- C3: 2 tests (reutiliza infra de tests de audio_editor)
- C5: 2 tests
- B1: 3 tests
- B2: 2 tests
- B3: 3 tests (mock del proveedor via MSW-like en backend)

---

## Dependencias nuevas

| Dep | Bloque | Tamaño | Crítica |
|-----|--------|--------|---------|
| `pyloudnorm` | C1 | ~1 MB | Opcional (alternativa: solo ffmpeg loudnorm) |
| `diffusers` + `torch` SDXL weights | B4 | ~7 GB | Solo si se implementa B4 |
| Ollama + LLM local | B4 | ~4-8 GB | Solo si se implementa B4 |
| API provider SDK (e.g. `replicate`) | B3 | ~5 MB | Sólo B3 |

Bloques A y C no añaden ninguna dependencia pesada. Todo lo necesario (`pydub`, `noisereduce`, `pedalboard`, `librosa`, `ffmpeg`) ya está en el proyecto.

---

## Decisiones abiertas para revisitar

1. **Max duración de grabación in-app (A2)**: ¿advertir a los 30min, 60min, sin límite? El navegador puede quedarse sin memoria en grabaciones largas. Recomendación: warning amarillo >60min + guardado parcial en localStorage cada 5min para recover en reload.

2. **Formato de subida (A1)**: ¿aceptamos m4a, webm, flac, wav, mp3, ogg o solo un subset? Recomendación: todos los que pydub puede leer (todos los listados), el endpoint transcode al formato del proyecto si es necesario.

3. **Multi-take (A3)**: ¿mantener TODOS los takes indefinidamente en disco o auto-limpiar los >30 días no-activos? Cada generación puede pesar 20-50 MB en un capítulo largo — con 40 capítulos y 3 takes cada uno, son 2-6 GB. Recomendación: **mantener**, añadir botón explícito de "Limpiar takes antiguos" en Activity.

4. **Punch-in crossfade length (A4)**: ¿25ms, 50ms, 100ms? Depende del tipo de material. Recomendación: 50ms default + parámetro avanzado.

5. **LUFS target default (C1)**: -16 es un término medio. Audible quiere -18, Spotify -14. Recomendación: default -16, dropdown con los 3 estándares etiquetados.

6. **Denoise agressiveness default (C2)**: depende del ruido base. Recomendación: 0.5 con preview en vivo ("antes/después" antes de aplicar) — ya que el usuario puede previsualizar antes.

7. **Slideshow crossfade length (B1)**: 1.5s por defecto, configurable.

8. **Proveedor de imágenes externas (B3)**: Replicate vs Stable Horde vs DALL·E 3. Ver sección B3.

---

## Orden de implementación recomendado

### Sprint 1 — Audio humano (~5-6h)
1. A1 (upload) — ~2h
2. A2 (grabar) — ~3-4h
3. A3 (multi-take) — ~1.5h (opcional aquí o después)

**Entregable**: un usuario puede grabar un capítulo en-app o subir uno existente, listarlo como generación del capítulo, y editarlo en Studio como si fuera una síntesis TTS.

### Sprint 2 — Publicable (~3h)
4. C1 (LUFS) — ~1h
5. C2 (denoise) — ~1.5h
6. C3 (compressor) — ~1h (opcional)

**Entregable**: el audio grabado se puede limpiar + normalizar a target de plataforma antes del export.

### Sprint 3 — Video narrativo (~5h)
7. B1 (slideshow multi-imagen) — ~3h
8. B2 (scene detection) — ~2h

**Entregable**: video MP4 con imágenes por escena, sin generación automática aún (usuario provee las imágenes).

### Sprint 4 — Pausa y producción
Producir un capítulo real completo con lo anterior. Anotar fricciones. Sin código nuevo.

### Sprint 5 — Imágenes automáticas (~4-20h)
9. B3 (API externa) — ~4h
   O
10. B4 (SD local) — ~15-20h

**Entregable**: generación de imágenes integrada en la línea de producción.

### Backlog (sin sprint asignado)
- A4 (punch-in) — añade polish cuando las grabaciones requieran correcciones finas
- C4 (mini waveform) — quality-of-life visual
- C5 (ambient en Studio) — consolida la UX

---

## Lo que NO entra en este plan

- **Editor multi-pista tipo Audacity**: demasiado scope. Studio + AmbienceMixer cubren narrador+fondo, que es el caso real.
- **Publicar directamente a Audible/Spotify**: cada plataforma tiene su propio flujo de revisión y metadata. Mejor exportar limpio y subir manualmente.
- **Cloud sync / multi-usuario**: contradice el principio local-first del proyecto.
- **Fase D (video generativo LTX/CogVideoX)**: exploratoria, no ready para producción.
- **Edición de subtítulos in-app**: el SRT se puede editar manualmente; un editor WYSIWYG sería meses de trabajo.

---

## Resumen ejecutivo

La app actual **genera audiolibros** (TTS) muy bien. Este plan la convierte en un **estudio de producción**: ingesta audio humano, lo limpia y nivela para plataformas, y produce video con imágenes por escena.

El camino crítico es **Bloque A + Bloque C (parcial) + Bloque B (parcial)** = ~13h. Con esto una persona puede sentarse a producir un episodio real end-to-end sin abrir ninguna otra herramienta.

Bloque B.4 (SD local) es el único punto donde el scope explota (15-20h, varios GB de modelos). Se deja para cuando el resto esté probado y el usuario realmente lo necesite.
