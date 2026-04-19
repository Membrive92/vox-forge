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

## Fase B — Video Level 1 (design inicial)

Cuando la Fase A funcione, la Fase B se construye encima sin tocar nada del audio editor.

### Scope

- **Cover image**: upload del usuario o cover autogenerado (en C sale de SD, en B es upload manual)
- **Ken Burns effect**: pan/zoom lento sobre la cover con ffmpeg `zoompan` filter
- **Waveform overlay**: opcional, barra reactiva al audio al pie del frame
- **Subtitulos automaticos**: generacion via `faster-whisper` (model `small` para espanol, ~244 MB), formato SRT, burn-in con ffmpeg `subtitles` filter o soft-track
- **Output**: MP4 H.264 + AAC audio, 1920x1080, ~2-3 MB/min

### Nueva dependencia: faster-whisper

```bash
pip install faster-whisper
```

Primera descarga del modelo: ~244 MB para small, cacheado en `~/.cache/huggingface/`. Modelo se carga lazy (como CloneEngine) y se queda residente. CPU o GPU — en RTX 4070 Super la transcripcion de un capitulo de 30 min tarda <30s con `small`.

### Nuevo servicio: `backend/services/video_renderer.py`

Composicion via subprocess a ffmpeg:

```python
def render_video(
    audio_path: Path,
    cover_path: Path | None,
    subtitles_path: Path | None,
    options: VideoOptions,
) -> Path:
    # 1. Build ffmpeg command
    # 2. Run subprocess with progress parsing
    # 3. Return output path
```

### Endpoints

```
POST /api/studio/transcribe
     Body: { audio_path }
     Returns: { srt_path, duration_s, word_count }

POST /api/studio/render-video
     Body: { audio_path, cover_path?, subtitles_path?, options: {
             resolution: "1920x1080" | "1280x720",
             ken_burns: boolean,
             waveform_overlay: boolean,
             title_text?: string,
           }}
     Returns: FileResponse del MP4
```

### Persistencia

Es el momento de anadir tabla `studio_renders` para persistir tanto ediciones de audio (Fase A) como videos (Fase B):

```sql
CREATE TABLE studio_renders (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,           -- "audio" | "video"
  source_path TEXT NOT NULL,
  output_path TEXT NOT NULL,
  operations TEXT,               -- JSON array (audio edits) o options (video)
  project_id TEXT REFERENCES projects(id),
  chapter_id TEXT REFERENCES chapters(id),
  created_at TEXT NOT NULL
);
```

Studio tendra una seccion "Recent renders" listando estas rows.

---

## Fase C — Visual storytelling (esquema)

- **Transcripcion** via Whisper ya disponible desde B
- **Local LLM** (Ollama + Llama 3.1 8B o Phi-3-mini) extrae prompts visuales por escena
- **Stable Diffusion** (diffusers + SDXL o SD 1.5) genera 1-4 imagenes por capitulo
- **Slideshow** con crossfade entre imagenes, sincronizado al audio
- **Opcional**: character LoRA para consistencia de personajes

Esto es el salto grande de complejidad. Se disena cuando la B este estable.

---

## Fase D — Video generativo (esquema)

Reservado para experimentacion. Requiere modelo de video local (LTX-Video o CogVideoX). Clips cortos (2-6s) por escena clave, no todo el capitulo. El usuario marca puntos de interes, cada punto genera un clip, se intercalan con las imagenes estaticas de la Fase C.

---

## Decisiones abiertas para revisitar

1. **Ambient mixes**: las incluimos desde el POC (requiere persistencia minima), o empezamos solo con chapters? — Mi recomendacion: **empezar con chapters**, anadir ambient mixes como Fase A.1 si el POC va bien.
2. **Save as new generation**: la edicion de audio se guarda como una nueva row en `generations` o siempre es download puro? — Mi recomendacion: **download puro en A**, persistencia como row en B junto con video renders.
3. **Undo/redo**: solo remove from queue o historial completo? — Mi recomendacion: **solo remove from queue en A**, historial en B o C cuando haya sesiones persistidas.
4. **Multi-track**: si o no? — Mi recomendacion: **no** en todo el plan. El caso narrador+ambient lo cubre ya el Workbench.

---

## Orden de implementacion del POC

1. Backend: paths + service + router + tests (~2h)
2. Backend: integrar con el router registry en main.py + verificar endpoints con curl
3. Frontend: API client + useStudioSession hook (~1h)
4. Frontend: SourcePicker + llamada a /sources (~1h)
5. Frontend: StudioWaveform (extiende del WaveformEditor existente o copia) (~1.5h)
6. Frontend: EditOperationsPanel + UI de operaciones (~1.5h)
7. Frontend: StudioTab layout + wiring (~1h)
8. Test visual manual del flujo completo (~30 min)
9. Tests unitarios FE (~30 min)
10. Wire el tab en App.tsx + i18n keys + icono nuevo (~15 min)

**Total estimado**: 8-9h. Al final de la Fase A tendras un tab funcional que recorta, normaliza y exporta audio.
