# Región de generación de imágenes (texto→imagen) — plan de implementación

**Fecha**: 2026-06-13
**Estado**: Propuesto, listo para implementar en rama propia (`feat/image-gen-region`)
**Origen**: el autor quiere una región dedicada para generar imágenes por prompt
(escribir prompt → generar → galería/biblioteca → reutilizar en portadas, escenas
de vídeo y B-roll).
**Investigación**: verificada contra el código (rama `remediation`, 2026-06-13).
**Restricción de licencia**: solo stack **Apache-2.0** (Z-Image-Turbo). Nunca
FLUX/Hunyuan. No modificar `img_generation_module/` (sus convenciones se
**reutilizan**, no se importan).

---

## 1. Estado actual (qué ya existe — bastante)

**La generación de UNA imagen ya funciona de punta a punta.** Lo que falta es la
**biblioteca**: persistencia, galería y reutilización.

### Ya construido y reutilizable
- **Endpoint** `POST /api/studio/generate-image` (`backend/routers/studio.py:309-342`):
  `prompt` (1-500) + `aspect_ratio` (16:9/9:16/1:1/4:3) + `seed` opcional →
  `GenerateImageResponse{filename,path,provider,seed,size_kb}` (`schemas.py:357-377`).
- **Dos proveedores** (`backend/services/image_gen.py`):
  - `PlaceholderProvider` (default, `:98-162`): PNG texto-sobre-gradiente con PIL,
    sin GPU/red — **siempre funciona**, ideal para construir y demostrar la UI.
  - `ComfyUIProvider` (PROD-02, `:284-502`): HTTP a ComfyUI local (`/prompt` →
    poll `/history` → `/view`), parametrización por `_meta.title`
    (`PROMPT_POSITIVE`/`SEED`/`SIZE`/`SAVE`, mirror de ADR-005 del módulo),
    buckets de tamaño (`:193-198`), **descarga de VRAM del TTS antes de generar**
    (PROD-01, `:505-510`).
- **Health check** `GET /api/studio/image-provider/status` (`studio.py:345-360`):
  offline-first (valida el workflow, luego pingea ComfyUI).
- **Frontend**: `ImageGenDialog` (`VideoRenderPanel.tsx:656-850`) ya tiene
  textarea de prompt + `<select>` de aspecto + seed numérico + **banner de estado
  del proveedor**; `api/studio.ts:233-245` `generateImage()` y `:219-231`
  `getImageProviderStatus()`.
- **Errores accionables** (`exceptions.py:73-92`): `ImageWorkflowError` (503),
  `ImageProviderUnavailableError` (503), `ImageGenerationError` (502) → JSON
  `{detail,code,technical}` con el mensaje que la UI muestra en toast/modal.
- **Tests**: `tests/test_image_gen_comfyui.py` con `MockTransport` (sin red).

### Gaps (verificado: cero referencias en backend/ y src/)
- **No hay biblioteca**: sin tabla `media_assets`, sin listado, sin borrado, sin
  servir-por-id, sin thumbnails, sin sidecar persistido. Las PNG generadas son
  **fire-and-forget** en `data/studio/covers/` (las recoge el cleanup salvo que
  se incrusten en un render de vídeo).
- **No hay galería** ni composer dedicado: generar está atado a una escena de
  vídeo dentro del panel de vídeo.
- Sin subida de imágenes propias, sin importar las salidas del módulo, sin batch.

## 2. Decisión de diseño central (lo más importante)

> **Esta región ES la biblioteca de medios de UX-03 (Studio de Montaje),
> entregada antes — NO un almacén paralelo.**

`internal-docs/studio-montage-redesign.md` (líneas 67-78, 137-139, 216-227) ya
especifica la tabla `media_assets`, el "media bin", los endpoints servir-por-id y
el botón **"IA ✦"** que abre el `ImageGenDialog` existente y registra el
resultado como `origin='generated'`. **Eso es exactamente el camino de escritura
de esta región.** Construir una segunda tabla o galería bifurcaría los datos y
contradiría UX-03. Por tanto: implementar la biblioteca (tabla + endpoints +
`MediaBin`) **como las fases M1-M2 de UX-03**, y la timeline de montaje (M3-M4)
leerá la **misma** tabla después.

### Dónde vive: **sección dentro de Studio**, no pestaña nueva
Toggle en la cabecera de Studio: **Audio | Imágenes | Montaje**. Razones de este
repo:
1. Studio ya posee los endpoints con imágenes (`upload-cover`, `generate-image`,
   `render-video`) y el allowed-root `STUDIO_DIR`; una pestaña hermana partiría
   la propiedad de imágenes en dos routers.
2. Studio ya se abre contextualmente desde un capítulo (`App.tsx:62`), así que
   "reutilizar en vídeo/portada" cae donde el usuario renderiza.
3. Una 5ª pestaña contradice la nav deliberada de 4 entradas (`App.tsx:408-413`)
   y el principio "ningún tab nuevo" del production-workflow-plan.
   *(Si más adelante se quiere descubribilidad de nivel superior, es una línea en
   el array `tabs` apuntando a la misma sección — sin bifurcar datos.)*

## 3. Modelo de datos (reusar el de UX-03 verbatim)

- Tabla nueva `media_assets` vía el patrón `_SCHEMA_SQL`/`_MIGRATION_COLUMNS` de
  `backend/database.py` (subir `SCHEMA_VERSION` 3→4):
  `id` PK, `kind` ('image'|'clip'), `filename` (relativo a `data/studio/media/`),
  `thumb_filename`, `origin` ('upload'|'imported'|'generated'), `source_path`,
  `meta_json`, `width`, `height`, `duration_s` (null en imágenes), `created_at`,
  **+ `prompt`, `seed`, `aspect_ratio`** (para búsqueda/reutilización rápida sin
  parsear `meta_json`).
- Servicio nuevo `backend/services/media_store.py` espejo de `studio_store.py`
  (`create_asset`/`get_asset`/`list_assets`/`delete_asset`, uuid 12, ISO-utc).
- **Almacenamiento**: `STUDIO_MEDIA_DIR = STUDIO_DIR/"media"` (+ `/thumbs`) en
  `paths.py`, dentro de `STUDIO_DIR` → cubierto por `is_within_allowed_roots`.
- **Sidecar**: para `origin='generated'`, escribir JSON propio junto al PNG y en
  `meta_json` con la forma de `img_generation_module/docs/SPEC_PIPELINE.md §3`
  (`{params:{prompt,seed,negative}, models, workflow, timings, created_at}`) para
  que un asset importado del módulo y uno generado in-app se lean igual.
- **Thumbnails**: 256 px con PIL (ya dependencia) en `asyncio.to_thread`.
- **Servir por id, nunca por ruta** (`studio-montage-redesign.md:229`): cierra de
  raíz la clase de path-traversal que la auditoría cazó dos veces.
- `studio_renders` **no se toca** (sigue siendo el historial de salidas
  audio/vídeo); `media_assets` es la biblioteca de imágenes fuente.

## 4. Endpoints

**Reutilizar**: `POST /generate-image` (motor), `GET /image-provider/status`
(banner), `POST /render-video` (reutilizar imagen → pasar su ruta en `images[]`).

**Nuevos** (`backend/routers/studio.py`):
- `POST /api/studio/media/generate` — genera vía `image_gen.generate_image()` a
  `STUDIO_MEDIA_DIR`, escribe sidecar + thumb, inserta fila `media_assets`
  (`origin=generated`); `count` 1-4 para batch **secuencial** (una GPU).
- `GET /api/studio/media?kind=image&origin=&q=` — listado newest-first con filtro
  por substring de prompt → `MediaAssetsResponse{assets,count}`.
- `POST /api/studio/media` — subida multi-fichero (`validate_image_upload` +
  `read_upload_safely`), copia a `STUDIO_MEDIA_DIR`, thumb, `origin=upload`.
- `GET /api/studio/media/external` — lista PNG/MP4 bajo `settings.media_watch_dirs`
  (default `img_generation_module/assets`) con su sidecar, read-only, guarda de
  dir local + existencia.
- `POST /api/studio/media/import` — copia salida del módulo + sidecar,
  `origin=imported`.
- `DELETE /api/studio/media/{id}` — fila + fichero + thumb (espejo de
  `delete_render`).
- `GET /api/studio/media/file/{id}?thumb=` — `FileResponse` **por id**.

Todos con `response_model` + `npm run openapi` (commitear schema + tipos).

## 5. Frontend

Sección **Imágenes** en Studio bajo el toggle de cabecera. Nuevos en
`src/features/studio/`:
- `ImagesPanel.tsx` — shell: composer arriba/izquierda, galería abajo.
- `PromptComposer.tsx` — **extraer** el `ImageGenDialog` actual
  (`VideoRenderPanel.tsx:656-850`) a componente reutilizable: prompt + aspecto +
  seed (+ randomize) + banner de proveedor (vía `getImageProviderStatus`);
  añadir `count` 1-4 y (stretch) campo de prompt negativo (ignorado por backend
  hasta que el workflow lo exponga). Al enviar → `generateIntoLibrary()` (nuevo
  en `api/studio.ts`) → `POST /media/generate`; **registrar el trabajo en
  `JobsContext` (UX-01)** para que el progreso sobreviva al cambio de
  sección/pestaña.
- `MediaBin.tsx` (nombre de UX-03) — grid de thumbnails desde `GET /media`, cada
  tile servido por `/media/file/{id}?thumb=true`, con snippet de prompt/seed y
  badge de origen; zona drag-drop de subida + botón Refrescar (`/media/external`
  + `/media/import`); borrar con confirmación. Acciones por tile: **"Usar en
  vídeo"** (ruta del asset → `renderVideo images[]`/`cover_path`), **"Poner como
  portada"**, y con UX-03: **"Añadir al montaje"**.
- `useMediaBin.ts` — estado remoto list/upload/delete/import.
- i18n: extender el set `studioScenesGen*` (`en.ts:543-552`, `es.ts`).

## 6. Fases

| Fase | Entrega | Esfuerzo | Depende | Gate |
|---|---|---|---|---|
| **T2I-1** | **Biblioteca backend**: tabla `media_assets` (SCHEMA v4) + `media_store.py` + `STUDIO_MEDIA_DIR`; endpoints generate-into-library / list / delete / file-by-id; tests con PlaceholderProvider | M | — (reusa PROD-02) | Funciona con placeholder; pytest verde; migración aditiva (sin tocar `studio_renders`) |
| **T2I-2** | **UI región**: toggle Audio\|Imágenes\|Montaje; `ImagesPanel`+`PromptComposer`+`MediaBin`; `generateIntoLibrary/listMedia/deleteMedia` en api; reutilizar→vídeo/portada; `JobsContext`; i18n | M | T2I-1 | typecheck+vitest; generar placeholder → verlo en galería → usarlo de portada |
| **T2I-3** | **Subida + import del módulo**: `POST /media` multi-fichero; `/media/external`+`/media/import` leyendo sidecars; `media_watch_dirs`; drag-drop + Refrescar; batch 1-4 | M | T2I-1,2 | rechaza MIME falso; external solo dentro de watch_dirs (`..`→400); import no duplica |
| **T2I-4** | **Generación real** (post-PROD-05): `VOXFORGE_IMAGE_PROVIDER=comfyui`, verificar end-to-end contra ComfyUI real, README/`.env.example` | S | T2I-1, **PROD-05 (humano)** | workflow presente; imagen 1248×720 real generada dentro de `comfyui_timeout_s` y aterriza en la biblioteca |
| **T2I-5** | **Hand-off a UX-03**: la timeline de montaje consume `media_assets` sin cambios; acción "Añadir al montaje"; absorber VideoRenderPanel según orden M6 de UX-03 | L | T2I-1..3 (= UX-03 M1-M2 anticipadas) | UX-03 M3+ construye sobre `media_assets` sin bifurcar esquema |

**MVP usable = T2I-1 + T2I-2** (generas por prompt, lo ves en galería, lo usas de
portada/escena) — todo sobre el **PlaceholderProvider**, sin depender de PROD-05.

## 7. Riesgos

- **PROD-05 (humano) bloquea las imágenes REALES**: `zimage_t2i_fp8.api.json` no
  existe aún → `ComfyUIProvider` lanza `ImageWorkflowError` (503). **Mitigación**:
  construir y demostrar TODO sobre el `PlaceholderProvider` (default), que siempre
  funciona y falla con gracia; el composer ya muestra el banner accionable.
- **Contención de GPU** (4070S compartida con XTTS/OpenVoice): PROD-01 descarga
  antes de difundir; el batch debe ir **secuencial**, nunca en paralelo; respetar
  `gpu_semaphore`.
- **Licencia**: stack bloqueado a Z-Image-Turbo (buckets + workflow path); nunca
  FLUX/Hunyuan; nunca importar fuente de `img_generation_module`.
- **⚠️ Riesgo de producto #1 — solape con UX-03**: construir una tabla/galería
  paralela bifurcaría los datos y contradiría UX-03. **Mitigación vinculante**:
  tratar T2I-1..T2I-3 **como las fases M1-M2 de UX-03** bajo los **mismos**
  nombres (`media_assets`, `MediaBin.tsx`, `useMediaBin.ts`, `/api/studio/media/*`)
  para que la timeline posterior encaje sin bifurcar esquema ni componentes.
- **Compat**: no romper el contrato de `generate-image` mientras `VideoRenderPanel`
  dependa de él (absorberlo solo en UX-03 M6).

## 8. Mapa de ficheros (reutilización)

| Reutilizable | Fichero:línea |
|---|---|
| `ComfyUIProvider` (HTTP submit/poll/download) | `backend/services/image_gen.py:284-502` |
| Parametrización por título | `backend/services/image_gen.py:396-422` |
| Buckets de tamaño / aspecto | `backend/services/image_gen.py:62-75, 193-198` |
| `generate_image()` (entry point) | `backend/services/image_gen.py:545-574` |
| Política de descarga GPU (PROD-01) | `backend/services/image_gen.py:505-510`, `backend/routers/engines.py` |
| Health/status del proveedor | `backend/services/image_gen.py:346-366`, `studio.py:345-360` |
| Config del proveedor | `backend/config.py:84-93` |
| Allowed-roots / STUDIO_DIR | `backend/paths.py:19,38,41-57` |
| Errores accionables | `backend/exceptions.py:73-92` |
| Mock de tests ComfyUI | `tests/test_image_gen_comfyui.py` |
| Dialog a extraer → PromptComposer | `src/features/studio/VideoRenderPanel.tsx:656-850` |
| API cliente imagen | `src/api/studio.ts:219-245` |
| Diseño media bin / tablas / endpoints | `internal-docs/studio-montage-redesign.md:67-78,137-139,216-227` |
| Sidecar schema del módulo | `img_generation_module/docs/SPEC_PIPELINE.md §3` |
| Convención de títulos (ADR-005) | `img_generation_module/docs/DECISIONS.md` |
