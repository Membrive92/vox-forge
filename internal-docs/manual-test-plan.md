# Plan de testing manual — VoxForge UI

**Para cuándo**: tras la reestructuración UX (de 10 tabs a 5).
**Quién testea**: tú (no puedo abrir un navegador).
**Qué hago yo**: monitorizo el backend y los logs mientras testeas, y voy capturando errores en tiempo real.

## Setup

1. **Backend levantado**: `python -m uvicorn backend:app --reload --port 8000` ya está corriendo.
2. **Frontend**: en otra terminal, `npm run dev` → abre http://localhost:5173
3. **DevTools del browser**: abre la consola (F12) para ver errores JS y los logs del logger del frontend.
4. **Tab de Network**: déjalo abierto para ver requests/responses.

Mientras testeas, yo ejecuto este comando en background y voy capturando:
```bash
tail -f data/logs/app.log
```

---

## Tab 1: Workbench (default)

### W1. Carga inicial
- [ ] Al abrir http://localhost:5173, ¿se ve el tab Workbench seleccionado?
- [ ] ¿Aparece el botón "+ New Project"?
- [ ] ¿Se ve el mensaje "Select a project or create a new one to get started"?
- [ ] **Esperado en consola**: dos requests `GET /projects` y `GET /logs/error-count?minutes=60`. Sin errores.

### W2. Crear proyecto
- [ ] Click "+ New Project"
- [ ] ¿Aparece "Untitled Project" en la sidebar?
- [ ] ¿Se selecciona automáticamente?
- [ ] ¿El input del nombre del proyecto está enfocado y seleccionado?
- [ ] Cambia el nombre a "Mi historia" y hacer click fuera (blur)
- [ ] **Esperado**: PATCH /projects/{id}, name actualizado en sidebar.

### W3. Crear capítulo manual
- [ ] Click "+ Chapter"
- [ ] ¿Aparece una tarjeta de capítulo "Chapter 1"?
- [ ] Edita el título → blur → debe persistir
- [ ] Pega texto en el textarea (ej: "Hola mundo. Este es un texto de prueba.") → espera 1s (debounce) → debe llamar PATCH /chapters/{id}
- [ ] ¿Se ve el contador de chars + duración estimada al pie del textarea?

### W4. Split de texto
- [ ] Click "Split Text"
- [ ] Pega:
```
# Capítulo Uno
Esto es el primer capítulo.

# Capítulo Dos
Esto es el segundo capítulo.
```
- [ ] **Esperado**: aparecen 2 capítulos con los títulos correctos. Los capítulos previos se borran.

### W5. Botones de un capítulo (4 botones)
- [ ] Expande un capítulo. Verifica que aparecen 4 botones: **Preview**, **Chunk Map**, **Cast**, **Ambient**
- [ ] Cada uno se puede abrir/cerrar independientemente
- [ ] El icono de colapsar el capítulo (chevron izquierda) funciona

### W6. Quick Preview
- [ ] Click "Preview" en un capítulo con texto
- [ ] **Esperado**: aparece un panel pequeño "Quick Preview" con un botón "Preview"
- [ ] Click "Preview" → genera audio de los primeros ~300 chars
- [ ] **Esperado**: spinner → player aparece con scrubber, ±10s, velocidad
- [ ] Reproduce → debe sonar
- [ ] Pausa con barra espaciadora → ¿funciona?

### W7. Chunk Map
- [ ] Click "Chunk Map" en un capítulo con texto
- [ ] **Esperado**: aparece "Chunk Map — {título}" con botón "Synthesize Chapter"
- [ ] Click "Synthesize Chapter" → genera el capítulo entero
- [ ] **Esperado**: el player aparece arriba del chunk map con el audio completo
- [ ] **Esperado**: la lista de chunks se popula con números, texto truncado, status verde, botón "Regen"
- [ ] Click "Regen" en el chunk 1 → **Esperado**: spinner → toast "Chunk 1 regenerated"

### W8. Character Casting
- [ ] Click "Cast" en un capítulo
- [ ] Si el texto NO tiene `[Personaje]`, debe mostrar el ejemplo de cómo usarlo
- [ ] Edita el texto del capítulo a:
```
[Narrador] Era una noche oscura.
[Kael] No me lo puedo creer.
[Narrador] Kael se acercó.
```
- [ ] Click "Rescan"
- [ ] **Esperado**: lista con 2 personajes (Narrador, Kael) con dropdowns
- [ ] Asigna voces (cualquier voz del sistema)
- [ ] Click "Cast 2 voices"
- [ ] **Esperado**: spinner → player con audio mezclado de las dos voces

### W9. Ambient Mixer
- [ ] Click "Ambient" en un capítulo ya sintetizado (importante: tiene que tener una generación previa con file_path en disco)
- [ ] **Esperado**: panel "Ambient Mixer" con upload + 3 sliders
- [ ] Sube un audio (cualquier mp3/wav corto, idealmente algo ambient)
- [ ] **Esperado**: aparece en la lista con play/preview funcional
- [ ] Selecciona el track → ajusta volumen, fade in/out
- [ ] Click "Mix with ambient"
- [ ] **Esperado**: spinner → player con la mezcla → botón download

### W10. Batch Export
- [ ] Click "Export All" en un proyecto con 2+ capítulos con texto
- [ ] **Esperado**: descarga un ZIP con archivos `01_titulo.mp3`, `02_titulo.mp3`...

### W11. Borrar proyecto
- [ ] Click "x" junto al proyecto en la sidebar
- [ ] **Esperado**: desaparece, se queda sin proyecto seleccionado
- [ ] Verifica en sidebar que ya no está

---

## Tab 2: Quick Synth

### Q1. Modo Standard (default)
- [ ] Click en tab "Síntesis rápida"
- [ ] **Esperado**: toggle arriba con dos botones, "Sintetizar" activo
- [ ] Debajo: textarea + sidebar con voces, sliders, etc.
- [ ] El textarea debe restaurar cualquier draft que tuvieses (autosave)
- [ ] Si no hay draft: textarea vacío

### Q2. Síntesis simple
- [ ] Escribe "Hola mundo, esto es una prueba"
- [ ] **Esperado**: el contador de chars se actualiza + estimación de duración
- [ ] Selecciona una voz (es-ES-AlvaroNeural) o un perfil
- [ ] Click "Generar Audio" o pulsa Ctrl+Enter
- [ ] **Esperado**: barra de progreso → toast "Audio listo - Voz del sistema (Edge-TTS)"
- [ ] Player aparece con scrubber funcional
- [ ] Pulsa Space → play/pause (solo si el textarea NO tiene focus)
- [ ] Pulsa Ctrl+S → descarga

### Q3. Resume de jobs interrumpidos
- [ ] Si hay jobs interrumpidos previos, debe aparecer un banner amarillo "⚠ Interrupted jobs"
- [ ] Click "Resume" → debe completar el job
- [ ] Click "x" en otro job → debe descartarlo

### Q4. Export panel
- [ ] Click "Export" para abrir el panel colapsable
- [ ] Edita Title, Artist, Album, Track, Filename pattern
- [ ] **Esperado**: el preview del filename se actualiza al pie del panel
- [ ] Genera audio → descarga → verifica que el filename usa el patrón
- [ ] Verifica con un editor de tags (o `ffprobe`) que los ID3 tags están embebidos

### Q5. Modo Cross-lingual
- [ ] Click el segundo botón del toggle ("Modo multilingüe")
- [ ] **Esperado**: el UI cambia a la pantalla del experimental (textarea + upload de muestra + selector de idioma)
- [ ] Banner amarillo "Modo experimental — los resultados pueden variar"
- [ ] Sube una muestra de voz (wav/mp3) — un archivo corto de tu voz
- [ ] Selecciona idioma "English"
- [ ] Escribe texto en inglés
- [ ] Click "Generar"
- [ ] **Esperado**: spinner → audio con tu voz hablando en inglés (o un intento de eso, es experimental)

### Q6. Vuelta al modo standard
- [ ] Click el primer botón del toggle
- [ ] **Esperado**: el textarea sigue con el draft autosaved del modo standard, no se pierde

---

## Tab 3: Voices

### V1. Sección "System voices"
- [ ] Click en tab "Voces"
- [ ] **Esperado**: 3 secciones scrolleables: System voices, My profiles, Compare (colapsable)
- [ ] La sección de arriba (system voices) muestra el grid de voces built-in
- [ ] Click "Preview" en cualquier voz → debe sonar
- [ ] Click "Use" → la voz se selecciona (visible en otro tab)

### V2. Subir muestra + quality analyzer
- [ ] En la zona de upload (UploadCard), arrastra o selecciona un wav/mp3
- [ ] **Esperado**: aparece la preview + el quality analyzer feedback debajo:
  - Rating badge (Excellent/Good/Fair/Poor) con color
  - Métricas: duración, SNR, peak dBFS
  - Lista de issues si hay
- [ ] Si el sample tiene problemas (muy corto, muy ruidoso, clipping), deben aparecer issues

### V3. Crear perfil
- [ ] Pon nombre al perfil
- [ ] Click "Guardar perfil"
- [ ] **Esperado**: toast "Perfil guardado correctamente"
- [ ] **Esperado**: el perfil aparece en la sección "My profiles" debajo (sin navegación)

### V4. Profiles section
- [ ] El perfil recién creado debe estar visible
- [ ] Click "Use" → carga la config y navega a Quick Synth
- [ ] Vuelve a Voices → click "Edit" → carga el perfil en el form de upload (modo edit)
- [ ] Click "Delete" → elimina

### V5. Compare (colapsable)
- [ ] Click el botón "Compare voices" al fondo
- [ ] **Esperado**: se despliega el A/B + Quick Preview
- [ ] Escribe texto, selecciona Profile A y B, genera ambos
- [ ] **Esperado**: dos columnas con players independientes
- [ ] En Quick Preview, click "Preview All" → genera contra todos los perfiles a la vez

---

## Tab 4: Audio Tools

### A1. Modo Change Voice (default)
- [ ] Click en tab "Herramientas de audio"
- [ ] **Esperado**: toggle con 2 modos. "Cambiar voz" activo.
- [ ] Sube un audio source
- [ ] Selecciona target (perfil o file)
- [ ] Ajusta sliders (pitch, formant, bass)
- [ ] Click "Convertir voz"
- [ ] **Esperado**: requiere CUDA (OpenVoice). Si no tienes GPU, debe dar error claro, no 500.

### A2. Modo Effects
- [ ] Click el segundo botón del toggle
- [ ] **Esperado**: cambia al UI del Lab (8 sliders + presets)
- [ ] **Importante**: si los sliders comparten estado entre modos (pitch, formant, bass), deberían mantenerse al cambiar
- [ ] Sube un audio
- [ ] Selecciona un preset → todos los sliders se actualizan
- [ ] Click "+ Save" → guarda preset custom
- [ ] **Esperado**: aparece en la categoría "Custom" con badge verde
- [ ] Click "Procesar" → procesa con DSP

### A3. Random preset
- [ ] Click "Aleatorio"
- [ ] **Esperado**: carga un preset random + toast con el nombre

---

## Tab 5: Activity

### AC1. Vista principal
- [ ] Click en tab "Actividad"
- [ ] **Esperado**: 3 secciones siempre visibles:
  - Recent issues (solo si hay errores)
  - Recent generations (lista de las últimas síntesis del Workbench)
  - Storage (4 cards: Generated audio, Voice samples, Logs, Total)
- [ ] Si el nav muestra "Actividad (N)" con un número, debe coincidir con la sección de issues

### AC2. Settings (colapsable)
- [ ] Click "Settings" para desplegar
- [ ] **Esperado**: dos subsecciones:
  - Export defaults (form con title/artist/album/track/filename pattern)
  - Pronunciation dictionary (tabla CRUD)
- [ ] Edita los export defaults → verifica que se persisten en localStorage
- [ ] Vuelve a Quick Synth → click Export → verifica que los valores están sincronizados
- [ ] En Pronunciation: añade una entrada (ej: "Caelthir" → "Quelzir")
- [ ] Genera audio en Quick Synth con un texto que contenga "Caelthir"
- [ ] **Esperado**: el audio dice "Quelzir" en su lugar (no fácil de verificar visualmente — confía en los logs)

### AC3. Developer logs (toggle oculto)
- [ ] Scroll hasta el fondo → click "Developer logs"
- [ ] **Esperado**: se despliega la LogsTab completa con server/client/stats
- [ ] Server tab → debe listar logs recientes
- [ ] Click en un request-id → debe filtrar
- [ ] Activa "Auto (5s)" → verifica que refresca solo
- [ ] Stats tab → debe mostrar contadores reales

---

## Errores en consola del browser

Mientras testeas, anota CUALQUIER error en la consola del navegador (F12 → Console). En particular:
- Warnings de React (sobre keys, hooks, deps array)
- Errores 500 en Network
- Errores de "cannot read property of undefined"
- Warnings de a11y
- Memory leaks visibles en Performance

## Errores en mi monitor

Yo voy a estar mirando los logs del backend. Si ves un error en el browser, dime el request ID y yo lo busco en `data/logs/app.jsonl`.

---

## Cómo reportar bugs

Para cada bug que encuentres:
1. **Tab + sección** donde lo encontraste (ej: "Workbench → Chunk Map")
2. **Pasos exactos** para reproducirlo
3. **Lo que esperabas** vs **lo que pasó**
4. **Request ID** si hay una request fallida (visible en el response header X-Request-ID o en el toast de error)
5. Si es un crash visual: screenshot

Yo voy capturando lo que pasa en backend mientras tú vas testeando.
