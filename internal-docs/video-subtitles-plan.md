# Subtítulos de vídeo — plan de implementación

**Fecha**: 2026-06-13
**Estado**: Propuesto, pendiente de implementar en rama propia (`feat/video-subtitles`)
**Origen**: feedback de uso real — al generar el vídeo de un audiolibro el usuario
ve la **onda de audio** ("pulsos del tono") y quiere **subtítulos sincronizados
con la voz** en su lugar.
**Investigación**: verificada contra el código (rama `remediation`, 2026-06-13).

> **Cómo trabajar esto**: rama aparte, cada fase mergeable sola con la suite en
> verde, validación a ojo sobre un vídeo real antes de cada commit.

---

## 1. Estado actual (verificado)

**Lo que el usuario quiere YA es posible** — solo está escondido por los defaults.

- Onda y subtítulos son **opciones independientes** del render; pueden ir las
  dos, una, otra o ninguna (`backend/services/video_renderer.py:88-141`, cadena
  lineal: escala/Ken Burns → onda → título → subtítulos).
- `VideoOptions` (`backend/schemas.py:290-301`): `waveform_overlay: bool`
  (default **True**) y `subtitles_mode: "none"|"burn"|"soft"` (default `burn`).
- Subtítulos quemados: `subtitles={path}:force_style='FontName=Arial,FontSize=28'`
  (`video_renderer.py:130-137`). Estilo **fijo, no configurable**.
- Transcripción: `POST /api/studio/transcribe` → **faster-whisper** sobre el
  audio sintetizado (`backend/services/transcriber.py:49-157`). Genera SRT con
  tiempos **a nivel de segmento** (≈frase). **No** extrae timestamps por palabra.
- Frontend (`src/features/studio/VideoRenderPanel.tsx`): la onda arranca en
  `useState(true)` (:64); el selector de subtítulos está **deshabilitado hasta
  que existe transcripción**; subtítulos se pone solo en `burn` si hay
  transcripción. `DEFAULT_VIDEO_OPTIONS.waveform_overlay = true`
  (`src/api/studio.ts:143`).

**Camino actual para "subtítulos sin onda" (funciona, pero incómodo)**:
transcribir → desmarcar "Onda de audio" → subtítulos ya en "Quemar" → renderizar.
La fricción es que la onda vuelve a ON en cada sesión.

## 2. El problema de fondo para audiolibro

Los subtítulos salen de **re-transcribir el audio con Whisper**, NO del **texto
real del capítulo** que se sintetizó. Para audiolibro esto es un fallo de
calidad: Whisper puede **escribir mal nombres propios, de fantasía o términos
poco comunes** en los subtítulos, aunque el texto correcto exista en la BD
(`chapters.text`). El guion es conocido y autoritativo — debería usarse.

## 3. Plan por fases (rama `feat/video-subtitles`)

### Fase S1 — Quick win de defaults (esfuerzo S, riesgo nulo)
Hacer que "subtítulos sin onda" sea el camino natural, sin pelear los toggles.
- `src/api/studio.ts:143`: `waveform_overlay: false` por defecto.
- `VideoRenderPanel.tsx:64`: `useState(false)` para la onda.
- Al elegir subtítulos `burn`, **desactivar la onda automáticamente** (o aviso
  "onda + subtítulos se solapan") — `VideoRenderPanel.tsx:65-80`.
- Mejorar el hint de subtítulos deshabilitados (i18n es/en) para que el paso
  "transcribe primero" sea evidente aunque no se mire el control gris.

**Gate**: por defecto el vídeo sale con subtítulos y sin onda; suite verde.

### Fase S2 — Subtítulos desde el texto real con alineación por palabra (esfuerzo M-L) · ⭐ núcleo
El cambio que de verdad pidió el usuario: subtítulos que **acompañan a la voz**
con el **texto exacto** del capítulo, no una aproximación de la ASR.
- **Exponer timestamps por palabra** en `Transcriber`
  (`transcriber.py:74-102`): faster-whisper soporta `word_timestamps=True`; los
  objetos de segmento traen `.words` con `start/end`. Añadir un campo opcional
  `words: list[SrtWord]` al resultado (sin romper la firma actual).
- **Nuevo modo/endpoint** `POST /api/studio/transcribe-aligned` (o flag en el
  existente, `studio.py` tras :247): recibe `source_path` + `source_text` (el
  texto del capítulo; el render ya conoce `chapter_id`, así que se puede leer de
  `chapters.text`), corre Whisper con `word_timestamps=True`, **alinea** el texto
  conocido a los timestamps por palabra con `rapidfuzz` (reutilizar
  `backend/services/intelligibility.py:text_similarity` — ya está para el QC y
  hace exactamente la normalización + similitud que necesitamos), y emite un SRT
  con el **texto correcto** y **tiempos del audio**. Devuelve confianza de
  alineación por bloque.
- `RenderVideoRequest`/`VideoOptions`: pasar `source_text`/`chapter_id` para que
  el render pueda preferir subtítulos alineados.
- **Reutilización clave**: el QC ya transcribe el mismo audio; idealmente
  transcribir **una sola vez** y compartir resultado entre QC y subtítulos.

**Gate**: los subtítulos muestran el texto del capítulo (nombres propios
correctos) sincronizados a la voz; test de alineación (texto conocido + audio
stub → SRT con el texto fuente y tiempos plausibles).

### Fase S3 — Calidad y estilo de subtítulo (esfuerzo M)
- Estilo configurable: `subtitle_font_size`, color, posición en `VideoOptions`
  (`schemas.py`) y `force_style` (`video_renderer.py:136,305`).
- **Post-proceso de legibilidad**: nuevo `backend/services/subtitle_postprocessor.py`
  que reparte líneas (máx. ~2 líneas / ~42 chars), fuerza duración mínima en
  pantalla y evita bloques larguísimos. Aplicar antes de escribir el SRT
  (`transcriber.py:141-156`).

**Gate**: subtítulos legibles (2 líneas, tiempo en pantalla suficiente).

### Fase S4 — UX del flujo (esfuerzo M)
- Previsualización (mockup de portada con etiqueta de subtítulo/onda) antes de
  renderizar.
- Conexión visual transcribir → subtítulos (hoy son paneles separados; el
  selector se habilita "por arte de magia").
- Aviso si onda + subtítulos están ambos activos.

## 4. Orden recomendado
`S1` ahora (trivial, da lo que el usuario pidió por defecto) → `S2` (el valor
real de audiolibro: texto correcto sincronizado) → `S3`/`S4` (pulido).

## 5. Mapa de ficheros

| Área | Fichero:línea |
|---|---|
| Opciones de vídeo (onda/subs) | `backend/schemas.py:290-301` |
| Cadena de filtros (onda + subs coexisten) | `backend/services/video_renderer.py:88-141`, slideshow `:218-310` |
| Filtro de subtítulos quemados (estilo fijo) | `backend/services/video_renderer.py:130-137` |
| Endpoint transcribe | `backend/routers/studio.py:220-247` |
| Transcriber (Whisper, sin word-level) | `backend/services/transcriber.py:49-157` |
| Reutilizable: similitud/normalización QC | `backend/services/intelligibility.py:text_similarity` |
| Endpoint render-video | `backend/routers/studio.py:364-428` |
| Default onda ON | `src/api/studio.ts:143`, `VideoRenderPanel.tsx:64` |
| Selector de subtítulos (disabled sin transcript) | `src/features/studio/VideoRenderPanel.tsx:291-308` |
| Panel de transcripción | `src/features/studio/TranscribePanel.tsx` |

## 6. Notas
- S2 depende de que faster-whisper de esta versión exponga `word_timestamps`
  (verificar en `transcriber.py` al implementar).
- La alineación texto-conocido↔audio es "forced alignment ligero" vía fuzzy
  matching sobre las palabras de Whisper; suficiente para subtítulos, sin meter
  dependencias nuevas pesadas (no hace falta un alineador dedicado para v1).
