# Studio de Montaje — rediseño del módulo Studio

**Fecha**: 2026-06-11
**Estado**: Propuesto, listo para implementación por fases
**Destino del fichero**: `internal-docs/studio-montage-redesign.md`
**Relación con REMEDIATION_PLAN**: id `UX-03`. Complementa (no sustituye) a
UX-01 (job tray) y UX-02 (mastering one-click + fuente de export visible).
Dependencias cruzadas: M5 usa PROD-03 (detección de escenas); el botón
"Generar" del bin usa PROD-02 (ComfyUIProvider); la pista de clips usa
PROD-08. Cada fase declara sus gates.

---

## Propósito

Studio deja de ser "editor de audio con un panel de render adjunto" y pasa a
ser una **mesa de montaje**: una línea de tiempo donde el audio del capítulo
manda y las imágenes (y más adelante clips) se colocan, se ajustan y se
previsualizan encima, con render final a MP4. El usuario monta un capítulo
completo sin salir de la app y sin tocar CapCut/DaVinci salvo para el acabado
que quiera hacer fuera.

## Principio rector

**Conectar, no inflar** (el mismo del production-workflow-plan). Todo lo
pesado ya existe: `video_renderer` soporta slideshow multi-imagen con
timestamps, xfade y subtítulos; `transcriber` produce SRT; `studio_store`
persiste renders; `upload_utils` valida subidas; el `img_generation_module`
deja PNG con sidecars JSON en un directorio conocido. Este rediseño añade el
**modelo de montaje persistente**, la **biblioteca de medios** y la
**timeline**; no añade motores nuevos. Y no es Premiere: una pista visual,
una de audio, una de subtítulos. Multicapa, keyframes y mezcla multipista
quedan explícitamente fuera.

## Modelo mental y layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Fuente: [Capítulo 3 ▾]  Audio: [● Masterizado (Studio, 10-jun) ▾]   Render│
├──────────────┬───────────────────────────────────────────────────────────┤
│ BIBLIOTECA   │                    PREVIEW                                │
│ [Subidas]    │        (imagen activa, Ken Burns CSS aprox.,              │
│ [Generadas]  │         subtítulos superpuestos opcionales)               │
│ [IA ✦]       │                                                           │
│ ┌──┐ ┌──┐    │   ▶ ⏸  00:42 / 04:13   −10s +10s   vol ▁▃▅               │
│ │th│ │th│ …  ├───────────────────────────────────────────────────────────┤
│ └──┘ └──┘    │ TIMELINE                                                  │
│ + Subir      │ visual  ▕▇▇▇▇▇▏▕▇▇▇▇▇▇▇▇▏▕▇▇▇▏ ← bloques drag/resize     │
│ ⟳ Refrescar  │ audio   ▁▂▃▅▃▂▁▂▃▅▅▃▂▁▂▃▅▃▂▁  (mini waveform)            │
│              │ subs    ▕──▏▕────▏▕──▏          (segmentos SRT, v1 RO)    │
│              │ marcas  ▴escena  ▴escena  ▴chunk                          │
├──────────────┴───────────────────────────────────────────────────────────┤
│ INSPECTOR (bloque seleccionado): Ken Burns [on/off, dirección]            │
│ Transición [xfade, 1500 ms]  Duración [hasta siguiente / fija]            │
└──────────────────────────────────────────────────────────────────────────┘
```

El **audio manda**: la duración del timeline es la del audio fuente; los
bloques visuales se colocan sobre él. La fuente de audio es el mismo selector
que UX-02 hace visible (edición de Studio vs take activo) — una sola verdad.

## Modelo de datos (backend)

Dos tablas nuevas en SQLite (migración tipo `cover_path`):

```sql
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,            -- 'image' | 'clip'
  filename TEXT NOT NULL,        -- relativo a data/studio/media/
  thumb_filename TEXT,           -- data/studio/media/thumbs/
  origin TEXT NOT NULL,          -- 'upload' | 'imported' | 'generated'
  source_path TEXT,              -- ruta original si origin='imported'
  meta_json TEXT,                -- sidecar del módulo de imágenes si existe
  width INTEGER, height INTEGER,
  duration_s REAL,               -- solo kind='clip' (NULL en imágenes)
  created_at TEXT NOT NULL
);

CREATE TABLE montages (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  audio_source_kind TEXT NOT NULL,   -- 'generation' | 'studio_render'
  audio_source_id TEXT NOT NULL,
  events_json TEXT NOT NULL,         -- ver esquema abajo
  subtitles_mode TEXT NOT NULL DEFAULT 'none',
  srt_path TEXT,
  resolution TEXT NOT NULL DEFAULT '1920x1080',
  updated_at TEXT NOT NULL
);
```

`events_json` (validado con Pydantic, no JSON libre):

```json
[
  { "media_id": "m_ab12", "start_s": 0.0, "end_s": null,
    "ken_burns": { "enabled": true, "direction": "in" },
    "transition_ms": 1500 }
]
```

`end_s: null` ⇒ hasta el siguiente bloque o fin del audio (la misma semántica
que `_compute_image_durations` ya implementa). Un montaje por capítulo
(upsert por `chapter_id`); el histórico de resultados sigue siendo
`studio_renders`.

Invariantes del modelo (los valida el `PUT`, con 400 y mensaje accionable si
se violan): `events` ordenados por `start_s` ascendente, sin inicios
duplicados; si un bloque fija `end_s`, debe cumplir `end_s ≤ start_s` del
siguiente (sin solapes); todo `media_id` debe existir en `media_assets`;
`ken_burns.direction ∈ {in, out, pan_left, pan_right}`;
`transition_ms ∈ [0, 5000]`.

## Sourcing de imágenes (el corazón de la petición)

Tres orígenes, un solo destino físico: **todo medio usable vive en
`data/studio/media/`**. Nunca se sirve ni se renderiza desde rutas externas —
lección directa del historial de path-traversal del audit: importar = copiar
dentro de los allowed-roots.

1. **Subida desde el explorador** — `POST /api/studio/media` multipart
   múltiple (reusa `validate_audio_upload`-equivalente para imagen:
   extensiones png/jpg/webp, tamaño máximo, MIME real). Genera thumbnail
   256px con PIL (ya en requirements) a `media/thumbs/`. El bin acepta
   drag&drop de N ficheros a la vez.
2. **Importar del módulo de imágenes** — setting nuevo
   `media_watch_dirs: list[str]` (default:
   `["img_generation_module/assets"]`). `GET /api/studio/media/external`
   lista recursivamente PNG/MP4 de esos directorios (read-only, con guarda de
   que el dir configurado existe y es local) devolviendo ruta, mtime y — el
   detalle que da valor — **el sidecar JSON si existe al lado**: el bin
   muestra prompt, seed y episodio de cada imagen generada.
   `POST /api/studio/media/import` copia el fichero a `media/`, persiste el
   sidecar en `meta_json` y crea el asset. Botón "⟳ Refrescar" re-lista.
3. **Generar in-app** — el botón "IA ✦" del bin abre el `ImageGenDialog`
   existente; el resultado se registra como `media_asset` `origin=generated`.
   Gate: con `PlaceholderProvider` el botón muestra el aviso de F2 del plan
   ComfyUI; con PROD-02 hecho, genera de verdad.

Clips `.mp4` del módulo: importables desde M2 (aparecen en el bin con badge
"clip"), **colocables en la pista solo cuando PROD-08 extienda el renderer**;
hasta entonces, deshabilitados con tooltip honesto.

## Preview: client-side, no server-side

Decisión central del diseño: la previsualización NO renderiza vídeo. Es el
audio real reproduciéndose (`useAudioPlayer`) + swap de la imagen activa por
`currentTime` (rAF), Ken Burns aproximado con CSS `transform` y crossfades
con `opacity`, subtítulos superpuestos parseando el SRT en cliente. Coste
cero de servidor, latencia cero, y para decidir *montaje* (qué imagen, cuándo,
cuánto) es fidelidad suficiente. La UI lo declara: "previsualización
aproximada — el render final puede variar ligeramente". El render ffmpeg
sigue siendo la única verdad del máster.

## Render

Reusa `POST /api/studio/render-video` con `images[]` (B1, ya implementado) y
lo extiende con opciones por bloque: `ken_burns` y `transition_ms` por
entrada. Nota de implementación honesta: hoy el zoompan es global (modo
cover) y el slideshow usa xfade uniforme — **verificar** si el
`filter_complex` admite zoompan por segmento; si se complica, la alternativa
robusta es pre-renderizar cada bloque a un segmento de vídeo (zoompan
individual) y concatenar, a coste de tiempo de render. El gap sin imagen cae
al cover (comportamiento B1). El resultado entra en `studio_renders` y en
RecentRenders como hoy — el trabajo de render se registra en el
`JobsContext` de UX-01 (progreso visible aunque el usuario navegue) — y por
la prioridad de export (UX-02), queda visible en la ChapterCard qué se
exportará.

**Sugerencia aceptable de propina**: añadir `1080x1920` a
`VALID_RESOLUTIONS` (hoy solo 1920×1080 y 1280×720, una línea en
`video_renderer.py:26`) — el mismo montaje sirve para un Short vertical
recolocando los bloques.

## Fases

| Fase | Qué entrega | Esfuerzo | Gates |
|---|---|---|---|
| **M1** | Biblioteca de medios: tablas, upload múltiple, thumbnails, bin UI con drag&drop | ~4-5 h | — |
| **M2** | Import desde `media_watch_dirs` con metadatos de sidecar | ~2-3 h | que existan assets (no exige PROD-05) |
| **M3** | Timeline v1: bloques drag/resize, snap a marcadores, persistencia `montages` + autosave (patrón `useDraftPersistence` + PATCH server con debounce) | ~6-8 h | — |
| **M4** | Preview sincronizado (swap + KB CSS + subs overlay + transport) | ~3-4 h | M3 |
| **M5** | Scaffolding: "Detectar escenas" rellena slots vacíos; "Auto-distribuir N imágenes"; marcadores desde chunk map | ~2 h | PROD-03 |
| **M6** | Render por bloque (KB/transición por entrada; vertical 1080×1920) | ~2-3 h | — |
| **M7** | Clips como B-roll en la pista visual (thumb = primer frame vía ffmpeg; `duration_s` poblado al importar) | ~3 h | PROD-08 |

MVP usable = M1–M4 (~16-20 h): subir/importar imágenes, montarlas sobre el
audio con preview, render con el slideshow actual. M5–M6 lo convierten en
herramienta rápida; M7 lo cierra.

## Qué pasa con lo que Studio ya tiene

- **Editor de audio (Fase A)**: se conserva como modo "Audio" del mismo
  Studio (toggle Montaje/Audio en la cabecera). Cero cambios funcionales; el
  mastering masivo ya no pasa por aquí (UX-02 one-click).
- **VideoRenderPanel**: queda absorbido por la timeline + inspector. Se
  elimina al final de M6 (no antes: convivencia durante M1–M5 para no romper
  el flujo actual). Su `upload-cover` se generaliza en M1 como caso
  particular de `media`.
- **TranscribePanel**: se mantiene; su SRT alimenta la pista de subtítulos y
  la detección de escenas.
- **SourcePicker/RecentRenders**: se mantienen; el picker incorpora el
  selector de audio de UX-02.

## Frontend — piezas nuevas

`src/features/studio/montage/`: `MediaBin.tsx`, `Timeline.tsx`
(+ `TimelineBlock`, drag/resize con pointer events propios — sin librería de
DnD nueva; son interacciones 1-D simples), `PreviewStage.tsx`,
`Inspector.tsx`, `useMontage.ts` (estado + autosave + undo simple de 1 nivel
en memoria), `useMediaBin.ts`. Accesibilidad desde el diseño (no como F5
a posteriori): bloques enfocables, flechas = nudge ±0,5 s, Shift+flechas =
±0,1 s, `aria-label` con "imagen 3, de 0:42 a 1:05".

## Backend — endpoints nuevos

```
GET    /api/studio/media                  → lista de media_assets
POST   /api/studio/media                  → upload múltiple
GET    /api/studio/media/external         → candidatos en media_watch_dirs (+sidecar)
POST   /api/studio/media/import           → copia + alta de asset
DELETE /api/studio/media/{id}             → borra asset (con confirmación UI)
GET    /api/studio/media/file/{id}?thumb= → sirve fichero/thumb (por id, no por ruta)
GET    /api/chapters/{id}/montage         → montaje del capítulo (o 404)
PUT    /api/chapters/{id}/montage         → upsert validado
```

Servir **por id, nunca por ruta** elimina de raíz la clase de bug de
path-traversal que el audit cazó dos veces. Todo endpoint con I/O pesado
(thumbnails, copia de imports) vía `asyncio.to_thread`, como el patrón ya
corregido.

## Tests

- M1: upload válido/MIME falso/límite de tamaño; thumbnail generado; DELETE
  borra fichero+thumb+fila.
- M2: external lista solo dentro de watch_dirs (intento de `..` → 400);
  import copia y persiste sidecar; refresco no duplica importados.
- M3: PUT montage valida solapes y `media_id` existentes; autosave no pisa un
  PUT en vuelo (último gana con `updated_at`).
- M4: util puro `activeEventAt(events, t)` con casos de borde (gap, t=0,
  t=fin) — testeable sin DOM.
- M6: argv de ffmpeg por bloque (mismo patrón de test que
  `_build_ffmpeg_argv`); vertical 1080×1920 aceptado.

## Decisiones tomadas

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| Preview client-side | Render de preview en servidor | Latencia/coste; para montaje basta; ffmpeg sigue siendo el máster |
| Importar = copiar a `data/studio/media/` | Servir rutas externas | Allowed-roots; historial de path-traversal del repo |
| Un montaje por capítulo (upsert) | Multi-montaje versionado | YAGNI; `studio_renders` ya guarda los resultados |
| Eventos en JSON validado en SQLite | Tabla relacional de eventos | Se leen/escriben siempre juntos; Pydantic valida el shape |
| Pointer events propios para drag | Librería DnD | Interacción 1-D simple; cero dependencias nuevas |
| Una pista visual | Multicapa | El caso real es slideshow+B-roll; capas = scope Premiere |

## Cuestiones abiertas (decidir en implementación, no bloquean M1)

1. ¿Música/ambient como propiedad del montaje (op `mix_ambient` ya existe)
   o se sigue mezclando en la fase de audio? Propuesta: v2, como opción de
   render ("mezclar ambient X a −15 dB"), reusando C5.
2. ¿Plantillas de montaje (cover 5 s + escenas + cierre)? Barato tras M5;
   esperar al uso real.
3. ¿Auto-montaje desde el `manifest.json` de un episodio del módulo de
   imágenes (mapear escenas→bloques de una vez)? Puente potente
   módulo↔Studio; evaluar tras M2 con datos reales.

## Orden de merge

M1 → M2 (ya se puede montar a mano con assets reales) → M3 → M4 (MVP) →
pausa de uso real con un capítulo → M5/M6 según fricción → M7 cuando PROD-08
exista. Cada fase mergeable sola, suite verde, sin tocar el flujo actual de
render hasta M6.
