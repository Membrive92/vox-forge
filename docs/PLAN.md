# VoxForge — Plan v2 (basado en tu flujo real)

Reemplaza las propuestas previas en [UX_AUDIT.md](./UX_AUDIT.md) y [UX_FLOWS.md](./UX_FLOWS.md). Aquellos asumían demasiado. Este documento parte de **lo que efectivamente vas a hacer con la app**:

> "Subir libro (completo o por capítulos) → configurar voz → poder editar (sonido ambiente, otras ediciones) → generar portada → escuchar para validar → descargar."

> "Voces humanas. Castellano ya, inglés quizás en el futuro."

Eso es. Todo lo demás de la app actual o se elimina, o se simplifica drásticamente, o se esconde detrás de "Mis voces".

---

## 1. Lo que tu flujo NO necesita

Cosas presentes hoy que no tocan tu trabajo diario:

- **Modo experimental cross-lingual como pestaña** — lo usaste UNA VEZ para crear tu voz castellana con anchor. Ya está hecho. No tiene que vivir como destino visible.
- **Tab Quick Synth** — un scratchpad TTS rápido. No es parte de tu flujo de libros.
- **Tab Audio Tools** — change voice y lab DSP no aparecen en tu descripción. Si no los usas, fuera del nav.
- **Compare panel A/B en Voces** — comparar dos voces iterativamente no es tu caso.
- **Tab Activity como destino** — informativa, mejor empotrada en el home.

Resultado: pasamos de **6 pestañas** a **3 destinos**.

## 2. Lo que tu flujo SÍ necesita (que ya existe en la app)

Todas estas piezas YA están construidas, solo hay que reordenarlas:

| Necesidad tuya | Existe en | Estado |
|---|---|---|
| Subir libro completo + auto-split en capítulos | Workbench (split por # o separador) | ✅ funciona |
| Pegar texto manualmente | Workbench (caja paste) | ✅ funciona |
| Configurar voz por libro / por capítulo | Workbench (voice picker proyecto + capítulo) | ✅ funciona |
| Tu voz castellana con anchor | Profile con `castilian_anchor=true` | ✅ funciona |
| Generar audio del capítulo | `synthesizeChapter` | ✅ funciona |
| Regenerar fragmentos sueltos | ChunkMap | ✅ funciona |
| Sonido ambiente | AmbienceMixer | ✅ funciona |
| Trim / fade / normalize | Studio editor | ✅ funciona |
| Portada (subir o generar IA) | Studio image gen | ✅ funciona |
| Render video con portada | Studio video panel | ✅ funciona |
| Preview de chapter | QuickPreview + reproductor del capítulo | ✅ funciona |
| Descargar ZIP del libro | batch_export | ✅ funciona |

El problema **NO es funcionalidad** — está todo hecho. El problema es que **están dispersas en 4 pestañas distintas** y cada flujo te obliga a saltar.

## 3. La nueva estructura

### Tres destinos en el nav, no más:

1. **Mis libros** (default, home)
2. **Mis voces**
3. **Actividad** (opcional, solo si hay errores recientes)

### Mis libros

Pantalla de home y lista. Cada libro es una card con:
- Título
- Portada en miniatura (si hay)
- Estado: nº capítulos · cuántos con audio / total · tamaño aprox
- Botón "Abrir"

Más un botón grande "+ Nuevo libro".

### Vista de libro (Mis libros → un libro)

Una sola página, sin sub-pestañas. Secciones colapsables que se expanden por defecto cuando son la siguiente acción a hacer:

```
┌─ "Cuento del Norte" ←  Mis libros                           ┐
│                                                              │
│  Voz narradora:  Permenides 90 (castellano · anclaje)        │
│                                                  [Cambiar]   │
│                                                              │
│  ① Texto                                              ▼      │
│     [          paste / upload .txt .docx .pdf       ]        │
│     12 capítulos detectados (split automático por #)         │
│                                                              │
│  ② Capítulos                                          ▼      │
│     ┌────────────────────────────────────────────────┐       │
│     │ Cap 1 · "El faro"        ✓ 4:32  [▶][↓][edit] │       │
│     │ Cap 2 · "La niebla"      ✓ 5:01  [▶][↓][edit] │       │
│     │ Cap 3 · "El visitante"   ⏳ 7/14 generando... │       │
│     │ Cap 4 · "Sin título"     · sin audio  [Generar]│       │
│     │ ...                                            │       │
│     └────────────────────────────────────────────────┘       │
│                          [Generar todos los pendientes]      │
│                                                              │
│  ③ Edición global                            (opcional)  ▼   │
│     □ Sonido ambiente               [Configurar mezcla]      │
│     □ Normalizar todos los capítulos a -16 LUFS              │
│     □ Trim de silencios > 1s                                 │
│                                       [Aplicar a todos]      │
│                                                              │
│  ④ Portada                                              ▼   │
│     [imagen actual]                  [Cambiar] [Generar IA]  │
│                                                              │
│  ⑤ Descargar                                            ▼   │
│     ◯ Audios sueltos (.zip)                                 │
│     ◯ Audiolibro único (.mp3 con capítulos marcados)        │
│     ◯ Vídeo (.mp4 con portada fija)                         │
│     [Reproducir libro completo]      [Descargar]             │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Click en `[edit]` de un capítulo** → abre el Studio editor en panel/modal (no cambia de pestaña). Edita, aplica, vuelve al libro.

**Click en `[Configurar mezcla]` de sonido ambiente** → abre el AmbienceMixer en panel.

**Click en `[Generar IA]` de portada** → abre el panel de image gen.

Studio, AmbienceMixer y Image Gen NO son destinos del nav. Son herramientas que se invocan **dentro del contexto de un libro**.

### Mis voces

Galería simple. Sirve para:
- **Ver** las voces que tienes
- **Probar** una voz (3 segundos de muestra leyendo "Hola, qué tal")
- **Crear una nueva** (si en el futuro quieres una voz inglesa o cambiar)

Card por voz:
```
┌─ Permenides 90 ─────────────────┐
│ Castellano · CON ANCHOR · 15.4s │
│ [▶ probar]            [Editar]  │
└─────────────────────────────────┘
```

Botón grande "+ Nueva voz" → wizard simple:
1. **Sube o graba muestra** (cualquier idioma, 6-30s)
2. **Idioma objetivo**: ES / EN
3. **¿Es muestra inglesa para hablar castellano?** Si sí → activa anchor automáticamente
4. **Prueba con texto**: campo de texto + botón generar
5. **¿Suena bien?** [Sí, guardar] / [Probar otra vez] / [Ajustes avanzados]
6. Al guardar: nombre + listo

"Ajustes avanzados" expande:
- Slider velocidad
- 1/2/3 versiones para elegir
- Toggle anchor manual

Todo el actual modo experimental se reduce a este wizard. La pestaña Quick Synth desaparece.

### Actividad (opcional)

Solo aparece como destino si hay errores recientes (badge rojo en el nav). Click → ve el log. Si no hay errores, no es un destino.

Las stats de uso de disco se mueven a "Mis libros" como información secundaria al lado del listado.

## 4. Qué pasa con cada componente actual

| Componente actual | Destino en plan v2 |
|---|---|
| `App.tsx` tab strip | Reducido a 2 entradas + badge condicional |
| `WorkbenchTab.tsx` | Renombrado: "Vista de libro" — eje principal |
| `ChunkMap.tsx` | Sigue, pero como sección expandida en el capítulo |
| `ChapterRecorder.tsx` | Botón secundario dentro del capítulo |
| `AmbienceMixer.tsx` | Panel invocable desde el libro |
| `CharacterCasting.tsx` | Sigue como panel del capítulo (lo necesitas si haces diálogos) |
| `QuickPreview.tsx` | Eliminado: el reproductor del capítulo cubre el caso |
| `QuickSynthTab.tsx` | **Eliminado completo** |
| `SynthTab.tsx` | **Eliminado completo** |
| `ExperimentalTab.tsx` | Reducido a wizard "Nueva voz" en Mis voces |
| `VoicesUnifiedTab.tsx` | Renombrado: "Mis voces" — solo galería + wizard |
| `VoicesTab.tsx` (la del upload) | Sigue dentro del wizard nueva voz |
| `ProfilesTab.tsx` | Card simplificada en la galería |
| `CompareTab.tsx` | **Eliminado** |
| `AudioToolsTab.tsx` | **Eliminado del nav** (ya estaba oculto) |
| `ConvertTab.tsx` | **Eliminado** o reubicado a herramienta avanzada en Mis voces |
| `LabTab.tsx` | **Eliminado** o reubicado a operación dentro del editor de capítulo |
| `StudioTab.tsx` | Mantenido pero invocable solo desde libro/capítulo |
| `StudioWaveform.tsx` | Igual |
| `EditOperationsPanel.tsx` | Igual |
| `VideoRenderPanel.tsx` | Movido al paso ⑤ Descargar |
| `SourcePicker.tsx` | Eliminado: el contexto viene del libro |
| `SceneManager.tsx` | Movido a Edición global o eliminado si solo necesitas portada fija |
| `ActivityTab.tsx` | Reducido a info en home + log oculto |
| `SettingsSection.tsx` (pronunciación, export defaults) | Movido al modal "ajustes" del libro |
| `PronunciationTab.tsx` | Botón "Pronunciación" en cabecera del libro |

**Componentes que se eliminan**: ~6. **Líneas borradas**: estimo 1500-2000. Menos código, menos superficie, menos bugs.

## 5. Plan de implementación

Tres sprints. No reescribimos nada — reorganizamos.

### Sprint A — Reorganizar nav (3-4h)

- App.tsx: nav reduce a 2-3 entradas. "Workbench" → "Mis libros". Eliminar entries de Quick Synth, Audio Tools.
- Audio Tools y Quick Synth quedan inaccesibles en UI (código aún ahí, sin destinos).
- Header: añadir contexto activo ("Editando: Cuento del Norte").
- Activity → reducir a sección informativa en Mis libros.

**Resultado de este sprint**: navegación más limpia, ningún flujo roto, todo lo que ya hacías sigue funcionando.

### Sprint B — Vista de libro como flujo lineal (6-8h)

Reescribir el render de WorkbenchTab cuando hay un proyecto seleccionado, hacia las 5 secciones:

1. Texto (existente: caja paste + split)
2. Capítulos (existente: lista con audio + ChunkMap como expandible)
3. Edición global (mover AmbienceMixer aquí + añadir "normalizar todos" y "trim silencios")
4. Portada (mover image gen del Studio aquí)
5. Descargar (consolidar batch_export ZIP + opción mp3 unificado + opción video)

Studio editor invocable como modal/panel desde "edit" del capítulo. Vuelve al libro al cerrar, audio editado se persiste en la generación del capítulo.

**Resultado**: descargas el libro en 1 click desde la sección 5. Todo lo demás vive dentro de la misma vista.

### Sprint C — Simplificar Voces y eliminar Quick Synth (4-5h)

- Renombrar pestaña a "Mis voces"
- Eliminar VoicesUnifiedTab, sustituir por galería + botón "+ Nueva voz"
- "+ Nueva voz" abre wizard de 5 pasos arriba descrito
- Eliminar QuickSynthTab, SynthTab, ExperimentalTab del routing (código se queda en disco si quieres recuperar más tarde, pero no se importa)
- Eliminar CompareTab

**Resultado**: pestaña Voces deja de ser un mini-cockpit confuso, pasa a ser asset manager simple.

### Total: 13-17 horas

Después de los 3 sprints, la app que tienes hace exactamente esto:

```
1. Abro la app                    →  veo mis libros
2. + Nuevo libro                  →  pego texto, divido en capítulos
3. Elijo voz                      →  Permenides 90 (la tuya)
4. Genero audio                   →  click "Generar todos los pendientes"
5. Edito                          →  ambient + normalize en una sección
6. Portada                        →  subo o genero
7. Reproduzco                     →  click play global
8. Descargo                       →  botón al fondo
```

Ocho clicks, una pantalla. Todo lo demás sigue ahí (preview, regen chunks, character casting, scene-by-scene video) pero como **detalles** que se invocan, no como destinos que se navegan.

## 6. Lo que se queda fuera de los 3 sprints

Cosas que NO entran en este plan inicial pero podrían venir después si las pides:

- Cambio de voz (OpenVoice / ConvertTab): si nunca lo usas, eliminado para siempre.
- DSP avanzado (LabTab): si nunca lo usas, eliminado. Si quieres trim/normalize/denoise como parte de la edición global, eso ya está cubierto.
- Cross-lingual avanzado con candidates múltiples: queda dentro del wizard como "ajustes avanzados", no como modo principal.
- Compare A/B: eliminado. Si lo quieres más tarde, se reintroduce en Mis voces con 1 botón.

## 7. Decisiones tomadas (2026-04-26)

| Pregunta | Respuesta del usuario | Implicación |
|---|---|---|
| Modo experimental cross-lingual | **Se mantiene** — uso activo para probar voces y cruce de idiomas | No es solo un wizard de creación; necesita sitio propio para iterar |
| Clonación de voces | **Se mantiene** — el usuario narra y combina su voz con otras seleccionadas | Mis voces sigue siendo destino de primera clase |
| Sonido ambiente | **Por capítulo** | El AmbienceMixer actual sigue invocable desde cada capítulo, no se globaliza |
| Edición global vs por capítulo | **Ambas** — el usuario quiere elegir | La vista de libro tiene "Edición global" (operaciones que se aplican a todos) Y cada capítulo expone "Editar" (Studio individual) |

Esto invalida una parte del plan inicial: el modo experimental NO se elimina como destino, y la edición no se simplifica a "solo global". Ajusto la propuesta.

## 8. Estructura final acordada

### Tres destinos en el nav (igual que antes), con contenidos ajustados:

1. **Mis libros** (home, default)
2. **Mis voces** (galería + lab integrado — incluye los modos standard y cross-lingual)
3. **Actividad** (condicional: solo aparece si hay errores recientes)

### Mis voces — estructura interna ajustada

Dos sub-secciones dentro de la pestaña, sin tabs separados ya:

```
┌─ Mis voces ─────────────────────────────────────────────┐
│                                                          │
│  Galería de voces                       [+ Nueva voz]    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │
│  │ Permenides│ │ Mivoz    │ │ Deep     │                 │
│  │ ES anchor│ │ ES       │ │ EN       │                 │
│  │ [▶][edit]│ │ [▶][edit]│ │ [▶][edit]│                 │
│  └──────────┘ └──────────┘ └──────────┘                 │
│                                                          │
│  ─────────────── Lab de pruebas ───────────────         │
│                                                          │
│  Voz a probar:  [ Permenides 90 ▼ ]  [Subir nueva]      │
│                                                          │
│  Modo:  ◉ Estándar (mismo idioma)                       │
│         ○ Multilingüe (cross-lingual experimental)      │
│                                                          │
│  Idioma del texto:  [Español] [English]                 │
│                                                          │
│  [ Texto de prueba: "Hola, qué tal hoy..." ]            │
│                                                          │
│  Velocidad: [====●====] 100%                             │
│  Versiones: [1] [2] [3]                                  │
│  □ Anclar acento castellano (cross-lingual ES)          │
│                                                          │
│                              [Generar y escuchar]        │
│                                                          │
│  [▶ Audio de prueba] [Guardar como perfil] [Usar]       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Esto reemplaza tres pestañas actuales (`Quick Synth Standard`, `Quick Synth Experimental`, `Voices Compare`) con un único panel.

- "+ Nueva voz" abre el wizard simple (5 pasos descritos antes).
- "Editar" sobre una voz abre la card en modo edición inline.
- "Probar" escoge la voz y la mete en el lab.
- "Usar" tras una prueba en el lab → enlaza al libro activo (si hay).

### Vista de libro — estructura ajustada

Cinco secciones igual que antes, con dos cambios:

```
③ Edición                                                ▼
   Aplicar a:  ◉ Capítulo individual
               ○ Todos los capítulos del libro

   ☐ Sonido ambiente              [Configurar mezcla]
   ☐ Normalizar audio (-16 LUFS)
   ☐ Trim de silencios > 1s
   ☐ Limpieza de ruido (denoise suave)

                          [Aplicar selección]
```

- Por defecto está marcado "Capítulo individual" (lo más común).
- Las operaciones se aplican al capítulo activo o se barren por todos según la elección.
- "Configurar mezcla" siempre es por capítulo (sonido ambiente nunca es global).

Y en cada **fila de capítulo** (sección ②) sigue habiendo `[edit]` que abre Studio en panel para edición fina.

## 9. Sprint A — definitivo (3-4h)

Lo que voy a tocar exactamente:

**`src/features/tabs.ts`** — reduce a 3 entradas:
- `mis-libros` (default)
- `mis-voces`
- `actividad` (condicional)

Eliminadas del nav: `quick-synth`, `audio-tools`, `studio` (este último deja de ser destino visible; sigue accesible vía libro).

**`src/App.tsx`**:
- Renombrar el routing.
- Tab `mis-libros` carga el actual `WorkbenchTab` (sin cambios visuales en este sprint).
- Tab `mis-voces` carga un nuevo wrapper que combina `VoicesUnifiedTab` + `QuickSynthTab` apilados (estructura provisional; Sprint B/C lo refina).
- Header: añadir contexto activo (`Editando: Cuento del Norte`) basado en `activeProjectId`.

**`src/i18n/{es,en}.ts`**:
- Renombrar `tabWorkbench` → "Mis libros" / "My books"
- Eliminar uso visible de `tabQuickSynth`, `tabAudioTools`, `tabStudio` del nav (claves siguen existiendo para componentes internos).

**Sin tocar componentes individuales todavía.** Solo nav + wrapper.

**Resultado verificable:** abres la app y ves 2-3 entradas en lugar de 6. Click en "Mis libros" te lleva al Workbench actual. Click en "Mis voces" muestra la galería + el panel del Quick Synth experimental apilados. Todo lo que ya hacías sigue funcionando — solo cambia la organización.

**Lo que NO entra en Sprint A**:
- No se borra ningún componente.
- No se renombra ninguna función backend.
- No se reorganiza la vista de libro (Sprint B).
- No se rehace Mis voces (Sprint C).

Total estimado: 3-4h, 1 commit, fácil de revertir si te resulta peor.

---

*Si dices OK al Sprint A, lo ataco. Sin commit hasta que verifiques en navegador que la nueva nav funciona.*
