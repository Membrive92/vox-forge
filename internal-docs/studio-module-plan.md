# Studio module — architecture + phased plan

**Fecha**: 2026-04-15
**Estado**: Planificado, pendiente de implementacion
**Motivacion**: El flujo actual termina en un archivo de audio descargado. Se necesita una etapa de post-produccion donde el usuario pueda pulir el audio generado (trim, fades, normalize) y empaquetarlo como video publicable (cover + subtitulos + waveform). El modulo Studio cubre ambas necesidades en un unico tab.

---

## Principio rector

**POC primero, expansion despues.** La Fase A (editor de audio) no introduce ninguna dependencia nueva y resuelve el 60% del valor. Las fases siguientes anaden capacidades sin tocar el contrato que establece la A.

Cada fase deja la app verde y testeable. Ninguna fase bloquea la siguiente — las operaciones de audio, el renderer de video, la generacion de imagenes y la generacion de video son modulos independientes detras de una misma UI.

---

## Posicion en la app

Studio es un **sexto tab top-level**, entre Audio Tools y Activity:

```
Workbench | Quick Synth | Voices | Audio Tools | Studio | Activity
```

Razon para no meterlo dentro del Workbench como un panel mas:

1. El editor necesita mucho ancho horizontal (waveform + regiones + transport)
2. El compositor de video necesita preview + timeline + props
3. Un usuario puede combinar varios capitulos en un solo video reel
4. El Workbench ya tiene 4 paneles por capitulo; anadir un quinto lo satura
5. Studio es post-produccion — un espacio mental distinto del "crear"

---

## Hoja de ruta

| Fase | Qué hace | Esfuerzo | Dependencias nuevas |
|------|----------|----------|---------------------|
| **A** — Audio editor POC | Cargar capitulo, regiones, trim/fade/normalize/delete, apply batch, exportar | ~6-8h | Ninguna (pydub + wavesurfer.js ya estan) |
| **B** — Video Level 1 | Cover + Ken Burns + waveform overlay + subtitulos automaticos → MP4 | ~10-12h | `faster-whisper` (~50MB modelo) |
| **C** — Visual storytelling | Prompt extraction per capitulo (LLM local) + SD images + slideshow animado | ~15-20h | Ollama/llama.cpp + diffusers |
| **D** — Video generativo | LTX-Video / CogVideoX para clips animados | Exploratorio | modelo video local (>10GB VRAM) |

La Fase A es el POC que vamos a construir ya. Las demas son la hoja de ruta.

---

## Fase A — Audio Editor POC

### Objetivo

Cargar un capitulo sintetizado del Workbench, visualizar su waveform, aplicar una cola de operaciones (trim / fade / normalize / delete region), escuchar el resultado y descargarlo.

### Decisiones cerradas

- **Input del Studio**: chapters con generacion completa (row en `generations` con `file_path`) **+** mezclas ambient previamente guardadas. Para que las mezclas sean accesibles hace falta una persistencia minima (ver seccion "Ambient mixes" mas abajo).
- **Output**: solo descarga en el POC. La persistencia como nueva row en `generations` llega en Fase B junto con la persistencia de videos.
- **Sin tabla SQLite para el POC**. Las operaciones viven en client state, se envian en batch, y el output queda en `data/studio/` como fichero fisico hasta que el usuario lo borra o se limpie manualmente.
- **Single-track only**. Nada de multi-pista tipo Audacity completo. El ambient mixer ya cubre el caso "narracion + ambiente" y vive en el Workbench.
- **Operaciones acumuladas, apply manual**. Nada de preview live de cada operacion. El usuario compone su lista y cuando esta contento pulsa Apply.

### Operaciones soportadas (POC)

5 operaciones, suficientes para el 90% de pulido de un audiobook:

| Tipo | Params | Qué hace |
|------|--------|----------|
| `trim` | `{ start_ms, end_ms }` | Mantiene solo `[start, end]`. Recorta cabeza, cola, o ambos. |
| `delete_region` | `{ start_ms, end_ms }` | Quita un trozo intermedio. `audio[:start] + audio[end:]`. Util para coughs/tropiezos. |
| `fade_in` | `{ duration_ms }` | Fade lineal desde silencio hasta el inicio. |
| `fade_out` | `{ duration_ms }` | Fade lineal hasta silencio al final. |
| `normalize` | `{ headroom_db }` | Normaliza al pico dejando N dB de headroom. Default -1 dBFS. |

Las operaciones se aplican en el orden en el que estan en la cola. El usuario puede reordenar con drag-drop.

### Operaciones que NO entran en el POC

- Pitch/formant/reverb/compression (eso es el Lab, ya existe en Audio Tools)
- Insertar audio (pegar otro clip)
- Split en varios ficheros
- Cambiar sample rate / bit depth
- Multi-track
- Undo/redo historico (solo eliminar de la queue)
- Atajos de teclado
- Persistencia de sesiones
- Editor de subtitulos (eso llega en Fase B)

---

### Backend — Fase A

#### Nuevo servicio: `backend/services/audio_editor.py`

Wrapper fino sobre pydub. No tiene estado. Recibe path + operaciones → produce path nuevo.

```python
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from pydub import AudioSegment

from ..paths import STUDIO_DIR

@dataclass(frozen=True)
class EditOperation:
    type: str   # "trim" | "delete_region" | "fade_in" | "fade_out" | "normalize"
    params: dict[str, Any]

def apply_operations(
    source_path: Path,
    operations: list[EditOperation],
    output_format: str = "mp3",
) -> Path:
    audio = AudioSegment.from_file(str(source_path))
    for op in operations:
        audio = _dispatch(audio, op)
    STUDIO_DIR.mkdir(parents=True, exist_ok=True)
    output = STUDIO_DIR / f"edit_{_short_uuid()}.{output_format}"
    _export(audio, output, output_format)
    return output
```

`_dispatch` llama a helpers pydub: `audio[start:end]` para trim/delete, `audio.fade_in(ms)` / `audio.fade_out(ms)` para fades, `audio.apply_gain(target_dbfs - audio.max_dBFS)` para normalize.

#### Nuevo router: `backend/routers/studio.py`

Tres endpoints:

```
GET  /api/studio/sources
     → Lista fuentes editables:
       - chapters sintetizados (generations table con status=done y file_path existente)
       - ambient mixes persistidas (ver seccion "Ambient mixes")
     Respuesta: [{ id, kind: "chapter"|"mix", project_name, chapter_title,
                   source_path, duration_s, created_at }]

POST /api/studio/edit
     Body: { source_path: string,
             operations: [{ type, params }],
             output_format: "mp3" | "wav" | "ogg" | "flac" }
     Returns: FileResponse del audio editado
     Headers: X-Audio-Duration, X-Source-Path, X-Operations-Count

GET  /api/studio/audio?path=<absolute_path>
     Sirve un audio de los directorios permitidos para que wavesurfer.js
     pueda cargarlo via URL. Valida que el path resuelto pertenezca a:
     - data/output/
     - data/studio/
     - data/jobs/{id}/
     - data/ambience-mixes/ (si llega Fase A.1)
     Fuera de esos paths → 403. Evita path traversal con Path.resolve() +
     relative_to() como en /api/voices/samples/.
```

El endpoint `GET /audio` es necesario porque el navegador no puede leer file:// de forma segura y wavesurfer.js necesita una URL.

#### Storage: `data/studio/`

Nuevo directorio, separado de `data/output/` para que el cleanup horario no borre las ediciones:

```
data/
├── output/             ← efimero, cleanup 24h
├── jobs/               ← crash-safe job state
├── ambience/           ← biblioteca de tracks ambientales
├── ambience-mixes/     ← NUEVO (Fase A.1): mezclas persistidas
└── studio/             ← NUEVO: ediciones del Studio
```

Los archivos de `data/studio/` persisten indefinidamente. En Fase B se añade un botón de cleanup manual en el tab Studio.

#### Ambient mixes — persistencia minima (Fase A.1)

Hoy el endpoint `POST /api/ambience/mix-chapter/{chapter_id}` devuelve el archivo al cliente pero no lo guarda en un lugar estable. Para que Studio pueda editar una mezcla, necesitamos una persistencia minima:

1. Antes de borrar el archivo de mezcla, moverlo a `data/ambience-mixes/mix_{chapter_id}_{timestamp}.{fmt}`
2. Crear una tabla SQLite `ambience_mixes` con `id`, `chapter_id`, `file_path`, `created_at`, `ambient_track_id`, `settings` (JSON)
3. Listar estas mezclas en `GET /api/studio/sources`

**Esto es un cambio pequeño pero añade scope al POC**. Si prefieres ahorrar tiempo, **empezamos por chapters solo** y dejamos ambient mixes para Fase A.1 justo despues.

#### Validaciones y errores

- `source_path` tiene que pasar el mismo check de path seguridad que `GET /audio`. Si esta fuera de los directorios permitidos → 400 con `invalid_sample`.
- `operations` vacio → 400 "No operations to apply".
- `output_format` fuera de `AUDIO_FORMATS` → 400.
- Si el archivo source no existe → 404.
- Si pydub lanza excepcion → 500 pero con mensaje friendly en `detail` (reusamos el pattern de exceptions.py).

---

### Frontend — Fase A

#### Nueva carpeta: `src/features/studio/`

```
src/features/studio/
├── StudioTab.tsx           ← layout principal del tab
├── SourcePicker.tsx        ← dropdown jerarquico project > chapter | mix
├── EditOperationsPanel.tsx ← sidebar con la cola de operaciones + Apply
├── StudioWaveform.tsx      ← extiende WaveformEditor con region API
└── useStudioSession.ts     ← hook con state + apply
```

#### API client: `src/api/studio.ts`

```ts
export interface StudioSource {
  id: string;
  kind: "chapter" | "mix";
  project_name: string;
  chapter_title: string;
  source_path: string;
  duration_s: number;
  created_at: string;
}

export interface EditOperation {
  type: "trim" | "delete_region" | "fade_in" | "fade_out" | "normalize";
  params: Record<string, number>;
}

export interface EditResult {
  blob: Blob;
  duration: number;
  operationsCount: number;
}

export function listStudioSources(): Promise<StudioSource[]>;
export function getStudioAudioUrl(path: string): string;
export function applyEdit(
  sourcePath: string,
  operations: EditOperation[],
  outputFormat: string,
): Promise<EditResult>;
```

#### Hook `useStudioSession`

```ts
interface StudioSession {
  source: StudioSource | null;
  operations: EditOperation[];
  isProcessing: boolean;
  resultBlob: Blob | null;
  resultUrl: string | null;
  resultDurationMs: number;
}

function useStudioSession() {
  // ...
  return {
    session,
    loadSource(source: StudioSource): void;
    addOperation(op: EditOperation): void;
    removeOperation(index: number): void;
    moveOperation(from: number, to: number): void;
    clearOperations(): void;
    apply(outputFormat: string): Promise<void>;
    download(): void;
  };
}
```

Pattern clave: las operaciones viven en **client state**, se envian en **batch** cuando el usuario pulsa Apply. Beneficios:
- Cero round-trips por operacion
- Undo gratis (remover de la queue)
- Reordering con drag-drop gratis
- Si se cancela, no hay nada que limpiar en backend

#### Waveform: extension del existente

El componente [src/components/WaveformEditor.tsx](src/components/WaveformEditor.tsx) ya existe y usa wavesurfer.js. Para el POC necesitamos una variante con capacidades extra:

- Crear regions desde codigo (a partir de un click en "Add region from current selection")
- Evento `onRegionChange(region)` cuando el usuario arrastra los bordes
- Evento `onRegionDelete(region)`
- Boton "Clear regions"

Opciones:
1. **Extender el existente** con props nuevas y mantener backward compat
2. **Crear `StudioWaveform.tsx`** especifico del Studio con las features nuevas

Recomendacion: **crear `StudioWaveform.tsx`**. El editor actual es read-only (lo usa el WaveformEditor de la Fase 3 del Tier 3) y mezclar los dos modos complica su API. Copiamos la logica base y anadimos lo del Studio.

#### Layout del StudioTab

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  ┌──────────┐  ┌────────────────────────────────────────────────┐│
│  │ Source   │  │  StudioWaveform (wavesurfer.js)                ││
│  │ Picker   │  │  ┌──────────────────────────────────────────┐  ││
│  │          │  │  │ ████████░░░░░░██████████░░░░██████████   │  ││
│  │ Project: │  │  │      └──reg──┘           └──reg──┘       │  ││
│  │ ▼ La...  │  │  └──────────────────────────────────────────┘  ││
│  │          │  │    Play -10s +10s Stop    0:42 / 5:13  1×     ││
│  │ Chapter: │  │    ──────────────●─────────────────────       ││
│  │ ▼ Cap 1  │  │                                                 ││
│  │          │  │    [Add region from selection]                 ││
│  │ Source:  │  │    [Clear regions]       Zoom: ────●────       ││
│  │ 5:13     │  │                                                 ││
│  │ 4.2 MB   │  │  ┌────────────── Result preview ─────────────┐ ││
│  │          │  │  │  ████████████████████████████████████████ │ ││
│  └──────────┘  │  │  Play Stop   0:00 / 5:08   [Download]     │ ││
│                │  └────────────────────────────────────────────┘ ││
│                └────────────────────────────────────────────────┘│
│                ┌────────────────────────────────────────────────┐│
│                │  Edit queue                                     ││
│                │  ┌──────────────────────────────────────────┐  ││
│                │  │ 1. Trim      0:00 → 0:03    [×]           │  ││
│                │  │ 2. Normalize  -1 dBFS       [×]           │  ││
│                │  │ 3. Delete    2:14 → 2:18    [×]           │  ││
│                │  │ 4. Fade out  1.5s           [×]           │  ││
│                │  └──────────────────────────────────────────┘  ││
│                │                                                 ││
│                │  [Apply 4 operations] [Clear queue]             ││
│                └────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

- **SourcePicker** (sidebar 200px): dropdown jerarquico project > chapter, muestra duration y size del source seleccionado
- **StudioWaveform** (centro, full width): waveform editor con regiones + transport controls + region tools (Add from selection, Clear) + Zoom slider
- **Result preview** (bajo el waveform, visible solo tras apply): audio player con el blob resultante + Download
- **Edit queue** (bajo el result preview): lista de operaciones con delete por item, drag-to-reorder, Apply total + Clear

### Operaciones UX

- **Trim**: usuario arrastra una region sobre el waveform, click "Trim to selection". Op `trim` con `start_ms` y `end_ms` se anade a la queue.
- **Delete region**: usuario arrastra una region, click "Delete region". Op `delete_region`.
- **Fade in/out**: no necesita region, usuario click en el boton, modal pequeño con slider de duracion (0-5s, default 1s).
- **Normalize**: click en el boton. Modal con un slider para headroom_db (-6 a 0, default -1). O preset button con `-1 dBFS` directo.

### Flujo del usuario (POC)

1. Usuario abre Studio (6th tab)
2. SourcePicker carga `GET /api/studio/sources`, muestra lista
3. Usuario selecciona "La Torre / Capitulo 1"
4. Frontend hace `GET /api/studio/audio?path=...`, wavesurfer carga el waveform
5. Usuario arrastra region en los 3 segundos iniciales de silencio
6. Click "Trim to selection" → op `trim` anadida a la queue
7. Usuario escucha hasta 2:14 donde oye un cough, crea otra region, click "Delete region"
8. Usuario click "Apply 2 operations"
9. POST `/api/studio/edit` con `{source_path, operations: [...], output_format: "mp3"}`
10. Backend procesa con pydub (~1-2s para un capitulo de 30 min)
11. Frontend recibe blob, lo carga en el preview player con su propio controles
12. Usuario escucha resultado
13. Click "Download"
14. El archivo queda en `data/studio/edit_{uuid}.mp3` en el servidor hasta que se borre manualmente

---

### Tests — Fase A

**Backend** (~6 tests en `tests/test_studio.py`):
- `test_trim_produces_correct_duration`: audio de 10s con trim 0-3s → output 3s
- `test_delete_region_shortens_audio`: 10s con delete 3-5s → output 8s
- `test_fade_in_out_applied`: verifica que el pico en los primeros/ultimos ms es bajo
- `test_normalize_brings_peak_to_headroom`: verifica pico del output
- `test_invalid_source_path_returns_400`
- `test_apply_empty_operations_returns_400`
- `test_path_traversal_blocked_in_audio_endpoint`

**Frontend** (~3 tests):
- `StudioTab` renderiza con SourcePicker + waveform placeholder
- `useStudioSession` añade y elimina operations correctamente
- `useStudioSession.apply` llama al endpoint con la queue correcta (MSW mock)

---

### Dependencias: cero nuevas

- `pydub`: ya instalado
- `wavesurfer.js`: ya instalado
- `ffmpeg`: ya instalado (dependencia de pydub para formatos distintos a WAV)

---

## ✅ Estado de la Fase A (POC audio editor)

**Implementada** en los commits `cb35c98` (backend) y `5339615` (frontend).

### Lo que quedó dentro

- **Backend**: `backend/services/audio_editor.py` + `backend/routers/studio.py` (3 endpoints), 17 tests en `tests/test_studio.py`. Operaciones: trim, delete_region, fade_in, fade_out, normalize. Storage en `data/studio/`.
- **Frontend**: `src/features/studio/` completo (5 archivos), `src/api/studio.ts`, icono `Scissors`, i18n ES/EN, tab registrado en `App.tsx` como 6ª posición. Responsive via `.vf-studio-grid`.
- **Seguridad**: path-traversal blindado en `/api/studio/audio` y `/api/studio/edit` (validación contra `OUTPUT_DIR` / `STUDIO_DIR` / `JOBS_DIR`).

### Lo que quedó fuera (intencionalmente)

- **Ambient mixes como fuente**: no listadas en `/api/studio/sources`. Requieren persistencia adicional (ver "Fase A.1" abajo).
- **Save as new generation**: el resultado solo se descarga; no se inserta en `generations`.
- **Undo/redo histórico**: sólo eliminar items de la cola.
- **Reordering drag-drop de ops**: el hook expone `moveOperation(from, to)` pero la UI todavía no lo cablea. Fácil de añadir.
- **Zoom-to-selection en el waveform**: sólo el slider genérico.

---

## Fase A.1 — Ambient mixes como fuente (opcional, pequeña)

Hoy `POST /api/ambience/mix-chapter/{chapter_id}` devuelve el archivo al cliente pero no lo guarda en un lugar estable. Si en algún momento quieres poder editarlas en Studio:

1. Antes de borrar el archivo de mezcla, moverlo a `data/ambience-mixes/mix_{chapter_id}_{timestamp}.{fmt}`
2. Nueva tabla SQLite `ambience_mixes`: `id`, `chapter_id`, `file_path`, `created_at`, `ambient_track_id`, `settings` (JSON)
3. Incluirlas en `GET /api/studio/sources` con `kind: "mix"` (el schema ya lo contempla)
4. Añadir `AMBIENCE_MIXES_DIR` al whitelist de `_ALLOWED_ROOTS` en `studio.py`

**Esfuerzo**: ~1-2h. No es prioritario hasta que tengas una librería de mezclas guardadas con la que quieras trabajar.

---

## Fase B — Video Level 1 (render MP4)

La Fase B se construye encima sin tocar el audio editor. Sigue en el mismo tab Studio como una sub-sección "Render video" que aparece tras aplicar una edición (o directamente sobre una fuente).

### Scope

- **Cover image**: upload manual del usuario (la auto-generación con SD es Fase C)
- **Ken Burns effect**: pan/zoom lento sobre la cover con ffmpeg `zoompan` filter
- **Waveform overlay**: opcional, barra reactiva al audio al pie del frame, renderizada offline con `showwaves` de ffmpeg
- **Subtítulos automáticos**: transcripción via `faster-whisper` (model `small`, ~244 MB) → SRT → burn-in con filter `subtitles` o soft-track opcional
- **Título opcional**: text overlay centrado los primeros N segundos, con fade-out
- **Output**: MP4 H.264 + AAC, 1920x1080 o 1280x720, ~2-3 MB/min

### Nuevas dependencias

```
faster-whisper          # transcripción (CUDA + CPU)
```

Primera descarga del modelo `small`: ~244 MB, cacheado en `~/.cache/huggingface/`. Carga lazy (como CloneEngine) y queda residente. En RTX 4070 Super, 30 min de audio se transcriben en <30s.

ffmpeg ya está instalado (Fase A lo usa via pydub), así que no hay deps extra para el render.

### Servicios nuevos

```
backend/services/transcriber.py    # wrap de faster-whisper
backend/services/video_renderer.py # build + run ffmpeg command, parse progress
```

Estructura orientativa de `video_renderer.render_video`:

```python
@dataclass(frozen=True)
class VideoOptions:
    resolution: Literal["1920x1080", "1280x720"] = "1920x1080"
    ken_burns: bool = True
    waveform_overlay: bool = True
    title_text: str | None = None
    subtitles_mode: Literal["none", "burn", "soft"] = "burn"

async def render_video(
    audio_path: Path,
    cover_path: Path | None,
    subtitles_path: Path | None,
    options: VideoOptions,
    progress_cb: Callable[[float], None] | None = None,
) -> Path:
    # 1. Build ffmpeg argv (zoompan + showwaves + subtitles + aac)
    # 2. Run via asyncio.create_subprocess_exec, capture stderr for -progress pipe
    # 3. Parse "out_time=..." lines → progress_cb
    # 4. Output to data/studio/video_{uuid}.mp4
```

El comando ffmpeg es la pieza con más detalle técnico. Un render típico (Ken Burns + wave overlay + burned subs, 1080p):

```bash
ffmpeg -loop 1 -i cover.png -i audio.wav \
  -filter_complex "
    [0:v]zoompan=z='min(zoom+0.0002,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080,fps=30[v];
    [1:a]showwaves=s=1920x120:mode=cline:colors=white|cyan[wv];
    [v][wv]overlay=0:H-h:format=auto[vw];
    [vw]subtitles=subs.srt:force_style='FontName=Inter,FontSize=28'[vout]
  " \
  -map "[vout]" -map 1:a \
  -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -shortest -movflags +faststart \
  output.mp4
```

### Endpoints

```
POST /api/studio/transcribe
     Body: { source_path }
     Returns: { srt_path, duration_s, word_count, engine: "faster-whisper:small" }

POST /api/studio/render-video
     Body: { audio_path, cover_path?, subtitles_path?, options: {...} }
     Returns: FileResponse del MP4
     Headers: X-Video-Duration, X-Video-Size, X-Video-Resolution
```

Subidas de cover: reutilizar `upload_utils.validate_image_upload` (nuevo, pequeño) → storage en `data/studio/covers/{uuid}.{png|jpg}`.

### Persistencia — tabla `studio_renders`

Es el momento de añadir persistencia. La Fase A vive sin SQL, pero con video los archivos son grandes (~100 MB por capítulo) y el usuario querrá volver a ellos:

```sql
CREATE TABLE studio_renders (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,       -- "audio" | "video"
  source_path   TEXT NOT NULL,
  output_path   TEXT NOT NULL,
  operations    TEXT,                -- JSON de la queue (audio) o VideoOptions (video)
  project_id    TEXT REFERENCES projects(id),
  chapter_id    TEXT REFERENCES chapters(id),
  duration_s    REAL DEFAULT 0,
  size_bytes    INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_studio_renders_chapter ON studio_renders(chapter_id);
```

Con esta tabla, Studio muestra un panel "Recent renders" a la izquierda o debajo de SourcePicker. Click → carga el output en el player.

### Frontend — componentes nuevos en `src/features/studio/`

```
VideoRenderPanel.tsx     # Cover upload + opciones + botón render
TranscribePanel.tsx      # Botón transcribir + preview SRT + editar lineas
RecentRenders.tsx        # Lista de studio_renders, play + download
```

Integración con `useStudioSession`: añadir `transcribe()` y `renderVideo(options)` al API del hook; el estado de la sesión se extiende con `{ transcript: SrtEntry[] | null, videoResult: Blob | null }`.

Layout: debajo del panel "Result" actual, añadir colapsable "Video" con tabs Cover / Subtítulos / Opciones.

### Tests

Backend (añadir a `tests/test_studio.py` o en `test_video.py`):
- `test_transcribe_returns_srt` — con audio stub, valida que vuelve SRT con formato correcto
- `test_render_video_minimal` — mock ffmpeg via subprocess stub, valida argv
- `test_render_video_rejects_bad_resolution` — 400
- `test_studio_renders_table_inserted_after_video`

Frontend (MSW):
- `useStudioSession.transcribe` popula state con entries parseadas
- `VideoRenderPanel` muestra progress cuando `isRendering`

### Tiempo estimado: 10-12h

Desglose:
- Whisper wrap + transcribe endpoint + test (~2h)
- Video renderer service + ffmpeg recipe + progress parsing (~3h)
- `studio_renders` table + CRUD helpers (~1h)
- FE: VideoRenderPanel + TranscribePanel + RecentRenders (~3h)
- FE: wire hook, layout, i18n keys, iconos (~1h)
- Tests BE + FE + pulido visual (~2h)

---

## Fase C — Visual storytelling (esquema)

La Fase B produce un video estático (cover fijo con Ken Burns). La Fase C lo convierte en un slideshow narrativo: imágenes generadas por IA que cambian según lo que se cuenta en cada escena.

### Scope

- **Escenas**: la transcripción de B se agrupa en bloques semánticos (~20-30s cada uno) como "escenas"
- **Prompt extraction**: un LLM local lee cada escena y produce un prompt visual tipo SD (estilo, personajes presentes, ambiente, acción)
- **Image generation**: Stable Diffusion genera 1-4 variantes por escena; el usuario aprueba
- **Slideshow video**: ffmpeg encadena las imágenes aprobadas con crossfade de 1-2s, sincronizado a los timestamps de la escena
- **Consistencia de personajes** (opcional): LoRAs entrenados con las descripciones de personajes del proyecto

### Dependencias potenciales

| Componente | Opciones | VRAM |
|------------|----------|------|
| LLM local | Ollama + Llama 3.1 8B (Q4) / Phi-3-mini-128k | ~6 GB |
| Stable Diffusion | `diffusers` + SDXL-Turbo o SD 1.5 | ~6 GB |
| LoRA training | `kohya_ss` externo; cargar LoRAs via diffusers | offline |

En una RTX 4070 Super (12 GB) los tres corren secuencialmente — el LLM saca los prompts, se descarga, luego SD genera. No intentar los dos en paralelo.

### Flujo propuesto

1. **Transcribir** (ya está en B) → SRT con timestamps
2. **Segmentar en escenas**: regla simple — agrupar líneas hasta alcanzar N segundos o un cambio de personaje/ambiente detectado
3. **LLM → prompts**: prompt system "You are a visual director. Given this paragraph of audiobook text, output a single JSON with { style: '...', setting: '...', characters: [...], action: '...' }"
4. **Render prompts a SD**: generar 4 variantes, mostrar al usuario en un grid, deja aprobar una
5. **Ensamblar slideshow**: para cada escena, frame de la imagen aprobada dura hasta el timestamp siguiente, con crossfade de 1.5s

### Nuevos endpoints

```
POST /api/studio/scenes/extract       # SRT → list of scenes
POST /api/studio/scenes/{id}/prompt   # scene text → SD prompt via LLM
POST /api/studio/scenes/{id}/image    # prompt → N image variants
PATCH /api/studio/scenes/{id}         # approve variant / edit prompt
POST /api/studio/slideshow/{render_id} # ensamblar MP4 con escenas aprobadas
```

### Tablas SQLite nuevas

```sql
CREATE TABLE studio_scenes (
  id          TEXT PRIMARY KEY,
  chapter_id  TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  start_s     REAL NOT NULL,
  end_s       REAL NOT NULL,
  text        TEXT NOT NULL,
  prompt      TEXT,
  approved_image_path TEXT,
  sort_order  INTEGER NOT NULL
);

CREATE TABLE studio_scene_images (
  id          TEXT PRIMARY KEY,
  scene_id    TEXT NOT NULL REFERENCES studio_scenes(id) ON DELETE CASCADE,
  image_path  TEXT NOT NULL,
  seed        INTEGER,
  created_at  TEXT NOT NULL
);
```

### Complejidad

Esta es la fase grande. El salto de "un cover estático" a "generar imágenes coherentes sincronizadas al audio" mete LLM + difusión + UI de aprobación. Estimación: **15-20h**, pero muchas más si hay que iterar sobre la calidad de los prompts.

Se diseña en detalle **cuando la Fase B esté estable y realmente quieras usar video narrativo**, no antes.

---

## Fase D — Video generativo (exploratoria)

Reservado para experimentación. Clips cortos (2-6s) animados por escena clave, no para el capítulo entero. Se **intercalan** con las imágenes estáticas de la Fase C para dar vida a momentos de acción.

### Opciones de modelo

| Modelo | VRAM pico | Calidad | Velocidad |
|--------|-----------|---------|-----------|
| LTX-Video | ~8 GB | media | rápida (2-5s por clip) |
| CogVideoX-2b | ~12 GB | alta | lenta (30s-1min por clip) |
| HunyuanVideo | ~24 GB+ | muy alta | no cabe en 4070S |

En la RTX 4070 Super, **LTX-Video** es el único viable con margen. CogVideoX-2b cabe justo pero compite con SD y LLM.

### Scope mínimo viable

- En Fase C, al aprobar una escena, un toggle "Animar (experimental)" genera un clip 4s
- El clip reemplaza la imagen estática en el slideshow, con crossfade a la imagen aprobada de la escena siguiente
- Un panel de "video variants" muestra regeneraciones con seeds distintos

### Por qué dejarlo para el final

1. Los modelos de video generativo local cambian rápido — lo que vale hoy puede estar obsoleto en 3 meses
2. Los fallos son más visibles que en SD (warping, motion artifacts)
3. El valor marginal sobre un slideshow bien hecho de Fase C no siempre es alto para un audiolibro

Se diseña cuando quieras presumir de reel, no cuando quieras producir episodios.

---

## Decisiones abiertas (para revisitar con cada fase)

1. ~~**Ambient mixes** como fuente en Fase A — pospuesto a Fase A.1.~~ Resuelto.
2. **Save edit as new generation**: la edición de audio se guarda como row en `generations` (útil para el Workbench) o siempre es download puro? — Mi recomendación: **con la tabla `studio_renders` de Fase B, los audios editados se persisten ahí, no en `generations`**. `generations` queda como audio directo-de-TTS.
3. **Undo/redo**: sólo remove-from-queue o historial completo? — Mi recomendación: **sólo remove en A y B**; historial si vemos que el usuario lo pide tras usar la app un tiempo.
4. **Multi-track**: no en todo el plan. El caso narrador+ambient ya vive en el Workbench.
5. **Cola de render en background**: para videos largos (>30 min de audio) el render puede tardar minutos. Fase B lo hace síncrono en el primer corte; si el usuario se queja, mover a `BackgroundTasks` + polling tipo `/progress/{job_id}`.

---

## Orden de implementación — histórico

### Fase A (POC) — ✅ hecha

1. ✅ Backend: paths + service + router + tests (~2h)
2. ✅ Backend: registrar router en main.py + verificar con curl
3. ✅ Frontend: API client + useStudioSession hook (~1h)
4. ✅ Frontend: SourcePicker + llamada a /sources (~1h)
5. ✅ Frontend: StudioWaveform con wavesurfer + regions plugin (~1.5h)
6. ✅ Frontend: EditOperationsPanel + UI de operaciones (~1.5h)
7. ✅ Frontend: StudioTab layout + wiring (~1h)
8. ⏳ Test visual manual del flujo completo (pendiente por parte del usuario)
9. ✅ Tests unitarios BE (17 tests); FE tests opcionales
10. ✅ Wire el tab en App.tsx + i18n keys + icono Scissors

### Fase B (video Level 1) — orden recomendado

1. Backend: `services/transcriber.py` (faster-whisper wrap) + test con stub (~1.5h)
2. Backend: `services/video_renderer.py` con el ffmpeg recipe + progress parsing (~2.5h)
3. Backend: migración SQLite para `studio_renders` + CRUD helpers (~1h)
4. Backend: endpoints `/transcribe` y `/render-video` + tests (~1h)
5. Frontend: `TranscribePanel.tsx` (ver SRT, editar lineas) (~1.5h)
6. Frontend: `VideoRenderPanel.tsx` + cover upload (~2h)
7. Frontend: `RecentRenders.tsx` + wire al SourcePicker layout (~1h)
8. Frontend: hook extensions + i18n + iconos (~0.5h)
9. Test manual del flujo completo + pulido (~1h)

**Total estimado Fase B**: 10-12h.

### Fase C y D

Se planifican con detalle cuando llegue el momento — la brecha de alcance entre "MP4 con cover" (B) y "slideshow narrativo" (C) es grande, y entre C y D es mayor. Iterar en B unas cuantas semanas antes de decidir si C merece la pena.
