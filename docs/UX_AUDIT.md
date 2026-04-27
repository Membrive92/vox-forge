# VoxForge — Auditoría de UX

Fecha: 2026-04-26.

Este documento sintetiza un escaneo exhaustivo de la app: cada pestaña, cada flujo crítico, cada fricción concreta. La sección **TL;DR** lista los problemas que rompen flujos. La sección **Plan de acción** los ordena por impacto/coste para que se ataquen en orden.

No hay propuestas decorativas — solo cosas que hoy te están costando tiempo cuando usas la app.

---

## TL;DR — los 8 puntos que hay que arreglar primero

1. **Descargar el capítulo es imposible sin pasar por Studio.** [`ChunkMap.tsx:187-199`](src/features/projects/ChunkMap.tsx#L187-L199) — el reproductor del capítulo sintetizado solo tiene play/pause/stop. La acción más esperada (descargar) no está. Único camino: "Editar en Studio" → exportar → descargar. Esto es UX rota.

2. **"Sintetizar capítulo" está enterrado en una sub-pestaña.** [`ChunkMap.tsx:175-181`](src/features/projects/ChunkMap.tsx#L175-L181) — el botón principal del flujo principal exige primero ir al sub-tab "Mapa de chunks". Debería ser la acción primaria del capítulo, visible siempre.

3. **"Anclar acento castellano" existe en dos sitios con la misma etiqueta y mecánicas distintas.** [`expCastilianWarmup`](src/i18n/es.ts) (modo experimental, toggle global) y [`profileCastilianAnchor`](src/i18n/es.ts) (flag por perfil) se llaman igual y hacen cosas que se solapan. Confusión garantizada.

4. **Los hints del modo multilingüe son párrafos.** [`expCastilianWarmupHint`](src/i18n/es.ts) tiene 200 caracteres; varios pasan de 140. El panel lateral del experimental se convierte en un muro de texto que esconde los controles.

5. **No hay vuelta de Studio a Workbench.** [`StudioTab.tsx:38-55`](src/features/studio/StudioTab.tsx#L38-L55) — el flujo "editar capítulo en Studio" funciona en una dirección. Una vez editas, descargas un blob al PC. No hay "actualizar la generación del capítulo" ni breadcrumb que diga "vienes de Capítulo X".

6. **El perfil activo no se ve en ningún sitio.** Ni en la card de Voces (no hay badge de "activo"), ni en el header. La selección de voz vive en estado interno de varias pestañas y el usuario no sabe qué está usando.

7. **La pronunciación está 3 niveles enterrada** en Actividad → Configuración (colapsado) → Diccionario. Cuando oyes una mala pronunciación, el flujo natural es arreglarla *ahí mismo*, no navegar al otro lado de la app.

8. **El previsualizar genera audio real pero no deja descargar el snippet.** [`QuickPreview.tsx:147-169`](src/features/projects/QuickPreview.tsx#L147-L169) — incoherente con el resto del flujo. Si le pongo a XTTS a generar 300 caracteres, dame el botón de descargar.

---

## Problemas transversales (afectan a toda la app)

### Inconsistencia de nombres y verbos

- **Tabs**: "Proyecto" (ES) vs "Workbench" (EN); "Estudio" (ES) vs "Studio" (EN). Los nombres ES son evocativos, los EN son jerga. La metáfora del usuario no coincide entre idiomas.
- **Tres verbos para borrar**: `eliminar`, `borrar`, `quitar` se usan indistintamente. Hay diálogos de confirmación que dicen "¿Eliminar esta operación?" pero usan la clave `studioRemoveOperation`.
- **Síntesis vs generación** se usan como sinónimos en español, pero no en inglés. "Generar Audio" y "Sintetizar capítulo" hacen lo mismo conceptualmente.
- **Mayúsculas inconsistentes** en botones y secciones (Title Case vs Sentence case sin patrón).
- **Anglicismos sin traducir en ES**: `chunks`, `presets`, `reverb`, `headroom`. Si el usuario es ES nativo, ve un chapurreo.

### Hints/explicaciones demasiado largos

11+ strings con más de 100 caracteres. Los peores: `infoNoiseReduction` (280), `expCastilianWarmupHint` (200), todos los `info*` del Lab (190-230). Los hints abarrotan los paneles laterales y compiten con los controles que pretenden explicar.

Tres hints distintos explican el anchor castellano con casi las mismas palabras (`expCastilianWarmupHint`, `expCastilianReferenceHint`, `profileCastilianAnchorHint`). Un usuario lee tres veces "antepone la voz castellana" y sigue sin entender la diferencia entre los toggles.

### Estilos inline mezclados con tokens

- App.tsx: 70%+ inline (header, nav, fondo).
- LogsTab.tsx: hex colors hardcoded (`#c4b5fd`, `#f87171`) en vez de tokens.
- Si un día cambias `colors.primary`, la nav se actualiza y los logs no.
- Visualmente la app ya tiene incoherencias de tono entre pestañas.

### Estado del usuario invisible

- Qué proyecto está abierto: no se ve en el header.
- Qué voz/perfil está activo: no se ve en el header ni en la card.
- Qué pestaña venía de dónde: no hay breadcrumbs.
- Qué tabs están "vivos" en background (con jobs en curso): no hay indicador.

---

## Por pestaña: fricciones específicas

### Workbench (Proyecto)

**Lo que el usuario quiere hacer aquí:** crear un proyecto, importar un texto, dividirlo en capítulos, ajustar voz, sintetizar y descargar.

| Fricción | Severidad | Ubicación |
|---|---|---|
| Audio del capítulo no descargable desde la card | Alta | `ChunkMap.tsx:187-199` |
| "Sintetizar capítulo" exige sub-tab "Chunks" | Alta | `ChunkMap.tsx:175-181` |
| Dos UIs distintas para importar capítulos (caja paste vs `window.prompt`) | Alta | `WorkbenchTab.tsx:1069`, `873` |
| Marcado `[Personaje]` indescubrible (solo se explica DENTRO del panel Cast, después de abrirlo) | Alta | `CharacterCasting.tsx:151-185` |
| Estado de panel activo (chunks/preview/cast/ambient) no se persiste al cambiar de capítulo | Media | `WorkbenchTab.tsx:70,133` |
| Botón delete del capítulo con el mismo peso visual que el título | Media | `WorkbenchTab.tsx:330-337` |
| Voice picker con label TODO EN MAYÚSCULAS más prominente que el dropdown mismo | Media | `WorkbenchTab.tsx:1410-1418` |
| Selector de tomas solo aparece con 2+ generaciones (la 1ª recording es invisible) | Media | `WorkbenchTab.tsx:577-584` |
| Mezcla de ambientación sin preview en tiempo real | Media | `AmbienceMixer.tsx:95-121` |
| `chunkRegen: "Regen"` (abreviatura) en español | Baja | `i18n/es.ts:248` |

### Quick Synth + Experimental

**Lo que el usuario quiere hacer aquí:** texto a audio rápido (modo standard) o clonar una voz cross-lingual (modo experimental).

| Fricción | Severidad | Ubicación |
|---|---|---|
| Modo experimental tiene 8 secciones simultáneas en el panel lateral | Alta | `ExperimentalTab.tsx` |
| Anchor castellano expone DOS toggles que se solapan + un botón "guardar como perfil" | Alta | `ExperimentalTab.tsx:455-508` |
| Hints del Castilian section (140-200 chars) crowdean la columna | Alta | `expCastilianWarmupHint`, `expCastilianReferenceHint` |
| Speed slider de SynthTab (temporal) vs speed del perfil (persistente): nada lo distingue en UI | Media | `SynthTab.tsx:487` |
| Profile picker solo dice "XTTS v2" cuando hay perfil seleccionado, no el nombre del perfil | Media | `SynthTab.tsx:410-441` |
| Subir nueva muestra deselecciona el perfil silenciosamente | Media | `ExperimentalTab.tsx:82` |
| `outputFormat` hardcoded a "mp3" en experimental — no se puede pedir wav/flac | Media | `ExperimentalTab.tsx:121` |
| Diálogo "Guardar como perfil" no muestra QUÉ se está guardando (sample del usuario vs reference voice) | Media | `ExperimentalTab.tsx:587-600` |
| Coste de generar 3 candidatos (3× tiempo GPU) no se comunica | Baja | `ExperimentalTab.tsx:529-561` |
| Mode toggle Standard/Cross-lingual usa botón pill, no tab — el segundo modo se puede pasar por alto | Baja | `QuickSynthTab.tsx:41-66` |

### Voices

**Lo que el usuario quiere hacer aquí:** ver voces del sistema, crear/editar perfiles propios, comparar voces.

| Fricción | Severidad | Ubicación |
|---|---|---|
| El perfil "activo" (el que se está usando para generar) no tiene indicador visual en su card | Alta | `ProfilesTab.tsx:44-58` |
| Dos paths para crear perfil con UX distinta: upload card o "+ Nuevo perfil" (que solo hace scroll y no resetea el form) | Alta | `ProfilesTab.tsx:35`, `VoicesTab.tsx:229` |
| Editar perfil: scroll silencioso al top, sin toast ni indicación de "estás editando X" | Alta | `App.tsx:135-146` |
| Modo edición no tiene botón cancelar — el único cambio visual es el texto del save button | Alta | `VoicesTab.tsx:410` |
| Toggle "Anclar acento castellano" inserto en medio de la card, rompiendo el ritmo header→params→sample→buttons | Media | `ProfilesTab.tsx:269-302` |
| 3-4 botones de play distintos en pantalla a la vez (system voice preview, profile sample, profile base voice preview, compare quick-preview) | Media | `VoicesTab.tsx:144`, `ProfilesTab.tsx:204,240`, `CompareTab.tsx:305` |
| Speed/pitch/volume en la card parecen editables (estilo input) pero son read-only — para editar hay que ir al form | Media | `ProfilesTab.tsx:148-188` |
| Compare panel colapsado por defecto y poco descubrible | Baja | `VoicesUnifiedTab.tsx:118-151` |
| Estado vacío con botón "+ Nuevo perfil" que no comunica que necesitas subir una muestra | Baja | `ProfilesTab.tsx:40-84` |

### Audio Tools (oculto)

**Pero está oculto del nav.** [`App.tsx:397-400`](src/App.tsx#L397-L400) tiene un comentario que dice que es intencional, pero un usuario que abre la app por primera vez no descubre la pestaña. Solo se llega via "legacy links". Si ya no se usa, hay que eliminarla. Si se usa, hay que devolverla al nav.

| Fricción | Severidad | Ubicación |
|---|---|---|
| **Pestaña entera oculta** del tab strip | Alta | `App.tsx:397-400` |
| Asimetría de formatos de salida: Convert ofrece mp3/wav/ogg/flac, Lab solo mp3/wav. Sin razón visible | Baja | `ConvertTab.tsx:424` vs `LabTab.tsx:187` |
| Sin progreso ni estimación de tiempo durante el procesado | Baja | `ConvertTab.tsx:449`, `LabTab.tsx:205` |

### Studio

**Lo que el usuario quiere hacer aquí:** editar audios sintetizados (trim, fades, normalize), opcionalmente generar video.

| Fricción | Severidad | Ubicación |
|---|---|---|
| **No hay manera de "guardar back" la edición a Workbench** — la edición vive solo en Studio o se descarga manualmente | Alta | `StudioTab.tsx`, `App.tsx` |
| Sin scrubber/zoom de timeline en formas de onda largas (15+ min imposibles de navegar precisamente) | Alta para audios largos | `StudioWaveform.tsx` |
| Botones de operaciones que requieren región (trim, delete, fade) están siempre habilitados — al pulsarlos sin región sale toast pero no hay disabled state | Media | `EditOperationsPanel.tsx:111-177` |
| No se puede reordenar operaciones en la cola (la función existe en backend, no está cableada en UI) | Media | `useStudioSession.ts:56` |
| Cuando vienes de Workbench → Studio con un sourceId, no hay breadcrumb "Editando: Capítulo X" | Media | `StudioTab.tsx:38-55` |
| Si el sourceId pendiente no se encuentra (sources no cargados aún), se limpia silenciosamente y queda editor vacío | Media | `StudioTab.tsx:44-47` |
| VideoRenderPanel está debajo del fold — flow audio→video se descubre por scroll | Media | `StudioTab.tsx:208-230` |
| Preview vs Apply: el preview tiene download button "deshabilitado" sin explicación | Baja | `StudioTab.tsx:175-182` |
| TranscribePanel sin contexto de para qué sirve (lo necesita VideoRender, no se ve esa dependencia) | Baja | `StudioTab.tsx:199-206` |

### Activity

| Fricción | Severidad | Ubicación |
|---|---|---|
| Pronunciation enterrada 3 niveles (Activity → Configuración colapsable → Diccionario) | Alta | `SettingsSection.tsx` |
| Click en error badge va a Activity pero no scrollea ni expande la sección de errores | Media | `App.tsx:406` |
| Cards de uso de disco son puramente informativas: ves "12.4 GB en generaciones" pero no puedes limpiar desde ahí | Media | `ActivityTab.tsx:98-103` |
| Toggle de dev mode (LogsTab) inconspicuo en el bottom de Activity | Baja | `ActivityTab.tsx:111-120` |

---

## Plan de acción priorizado

Ordenado por **impacto en flujos críticos / coste de implementación**. Empezamos por lo que más duele al usuario y menos tiempo come.

### Fase 1 — Acciones primarias visibles (1-2h)

Estas son cambios pequeños con impacto altísimo. Sin ellos la app sigue siendo "no usable".

1. **Botón de descarga en el reproductor de capítulo del Workbench.** ChunkMap.tsx, +5 líneas. Crítico.
2. **Sintetizar capítulo accesible sin sub-tab.** Mover el botón principal del capítulo a la cabecera de la card (al lado del nombre), y dejar el sub-tab solo para ver/regenerar chunks individuales.
3. **Botón de descarga en QuickPreview.** Coherencia: si genera audio, deja descargar.
4. **Devolver edited audio a Workbench desde Studio.** Botón "Guardar como nueva generación del capítulo X". Backend ya tiene la noción de generation; falta el endpoint que la inserte.
5. **Mostrar "vienes de Capítulo X" en Studio** cuando llegas con `pendingSourceId`. Breadcrumb pequeño en la cabecera del tab.

### Fase 2 — Modo experimental simplificado (2-3h)

Ahora mismo es el panel más cargado y el más confuso de toda la app.

6. **Unificar el toggle "Anclar acento castellano".** Que sea un solo toggle en el panel experimental: si hay reference voice → audio anchor (E), si no → text warmup (B). El toggle separado de "Usar voz castellana de referencia" desaparece (era el caso D1, equivalente a anchor 100%, redundante con tener el anchor a tope).
7. **Hints concisos** (max 80 chars). Tooltip si necesitas explicar más.
8. **Acceso visible al formato de salida** en experimental (igualar a SynthTab).
9. **El profile picker muestra el nombre del perfil seleccionado** (no solo "XTTS v2"). Y un botón "ninguno" explícito para deseleccionar.

### Fase 3 — Voces como cockpit (1-2h)

10. **Indicador visual del perfil activo** (badge "EN USO" o borde resaltado). Lo lee del estado global.
11. **Botón "Cancelar edición"** en el upload card cuando se está editando un perfil.
12. **Toast al editar**: "Editando perfil X — desplázate al formulario de arriba" en lugar de scroll silencioso.
13. **Quitar el toggle "Anclar acento castellano" de la card** y moverlo al formulario de edición. Ese toggle no es información de un vistazo, es configuración.
14. **Renombrar params box**: en vez de tres cajas que parecen inputs, usar texto inline ("100% velocidad · 0st tono · 80% volumen"). Lo hace claramente informativo.

### Fase 4 — Pronunciation accesible (30 min)

15. **Quick-link a pronunciation desde QuickPreview y desde el reproductor del capítulo.** Ya existe el botón en QuickPreview ("¿Pronuncia mal una palabra?") — replicar en ChunkMap. Más botón "Diccionario" en el header de Voices.

### Fase 5 — Limpieza i18n + naming (1-2h)

16. **Unificar verbos**: solo `eliminar` (no borrar/quitar), solo `guardar` (no confirmar).
17. **Reemplazar "Proyecto" → "Workbench"** o ambos a "Estudio de proyecto" / "Project workspace". Aliñar metáforas ES/EN.
18. **Traducir anglicismos**: chunks → fragmentos, presets → ajustes, reverb → reverberación, headroom → margen.
19. **Recortar todos los hints a ≤80 caracteres**. Mover el detalle a tooltips opt-in.

### Fase 6 — Decisión sobre Audio Tools (sin coste)

20. **Decidir**: o devolver Audio Tools al tab strip o eliminar el tab y los componentes. Tener un tab oculto reachable solo por links es deuda técnica pura.

### Fase 7 — Studio precisión (3-4h, opcional)

21. **Scrubber/zoom timeline** para audios largos. Ya intentamos zoom y rompimos render loops, pero el problema era el cableado React, no la idea. Implementación correcta: zoom imperativo con botones +/− que llaman directamente a `ws.zoom()` (lo tenemos resuelto en `StudioWaveform.test.tsx`).
22. **Disabled state en operaciones que requieren región**, en vez de toast post-click.
23. **Reorder ops en la cola** (drag handles, ya hay `moveOperation` en backend).

### Fase 8 — Header como cockpit global (1h)

24. **Mostrar contexto activo en el header**: "Proyecto: X · Voz: Y". Click → navegar a la pestaña pertinente.
25. **Indicador de jobs en background** (si hay síntesis/render en otra pestaña, marca discreta en el tab strip).

---

## Lo que NO entra en el plan

Para no añadir más alcance a una app que ya tiene demasiado:

- **No añadir más toggles/modos**. Cada toggle nuevo cuesta 3× su peso visual en complejidad cognitiva.
- **No añadir Compare panel**. Si está colapsado y poca gente lo usa, posiblemente no haga falta. Considera retirarlo.
- **No tocar el motor TTS** salvo bug fixing concreto. El comportamiento actual (anchor + time-stretch + per-profile flag) ya cubre las necesidades reportadas; el resto es UX.

---

## Métricas para validar el plan

Después de Fase 1+2, deberías poder responder "sí" a:

- ¿Puedo descargar el audio del capítulo en menos de 2 clicks?
- ¿Puedo sintetizar el capítulo entero sin abrir sub-tabs?
- ¿Sé qué voz estoy usando sin abrir la pestaña Voces?
- ¿El panel experimental cabe en una pantalla 1080p sin scroll en su columna lateral?
- ¿Las palabras "anclar acento castellano" significan lo mismo en cada sitio donde aparecen?

Si alguna sigue siendo "no" después de las primeras dos fases, el problema es de implementación, no de plan.

---

*Este documento NO incluye cambios de código. Cada fase requiere implementación + verificación manual + commit explícito por el usuario.*
