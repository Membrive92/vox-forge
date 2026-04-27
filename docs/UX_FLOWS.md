# VoxForge — Flujos reales de uso y rediseño arquitectural

Complemento al [UX_AUDIT.md](./UX_AUDIT.md). El primer documento listaba parches sobre la estructura actual. Este documento pregunta una cosa más fundamental: **¿la estructura actual es la correcta?**

Spoiler: no del todo. La app está organizada por **tipo de tarea** (Workbench, Voices, Studio, Audio Tools, Activity) cuando debería estar organizada por **objetivo del usuario** (crear un relato narrado, gestionar mis voces, publicar a YouTube).

---

## 1. Quién usa esta app

Lo poco que sé del usuario real:

- Hardware: RTX 4070S 12GB
- Fin: relatos narrados (probablemente para YouTube)
- Quiere voz natural en castellano
- Local + gratis

De ahí se deduce el caso de uso dominante: **producir un relato narrado de principio a fin, posiblemente un video, posiblemente una serie de capítulos**.

Todo lo demás de la app (clonación, voice conversion, lab DSP, studio editor, video render) son **medios** para ese fin, no fines en sí. Hoy están a la misma altura jerárquica que el flujo principal y eso ya es un problema.

---

## 2. Los flujos reales

He identificado cuatro. Ordenados por frecuencia esperada.

### Flujo A — Producir un relato (el flujo dominante)

> "Tengo un texto, quiero un audio narrado en castellano, quizá un video sencillo para YouTube."

```
[Texto del relato]
       ↓
[Elegir voz]                  ← (depende del Flujo D — clonar voz)
       ↓
[Generar audio del relato]
       ↓
[Escuchar y decidir si hay que regenerar partes]
       ↓
[Edición fina opcional: trim al inicio/fin, normalizar]
       ↓
[Portada o imágenes]
       ↓
[Render video]
       ↓
[Descargar / publicar]
```

**Lo que la app hace bien hoy:** cada paso individual existe.

**Lo que la app hace mal hoy:**
- Cada paso vive en una pestaña distinta (Workbench/Studio/Audio Tools).
- No hay vista única del proyecto que muestre **dónde estoy en este flujo**.
- No hay continuidad: edito en Studio → descargo a disco → si quiero re-importar al proyecto tengo que subirlo manualmente como recording.
- "Render video" está debajo del fold dentro de Studio, no en el flujo principal del proyecto.
- Decidir "regenerar este chunk" exige meterse en un sub-tab (Mapa de chunks).

### Flujo B — Iterar capítulos en serie

> "Tengo una novela en 12 capítulos. Voy haciendo 1 o 2 al día."

Mismo Flujo A repetido pero con **estado entre sesiones**: "qué capítulos ya están hechos, qué falta, qué cambié ayer".

**Lo que falta:** un dashboard de proyecto que diga de un vistazo el estado de cada capítulo (sin sintetizar / generado / editado / video listo / exportado). Hoy hay status chips dispersos en la card del capítulo que cuesta interpretar.

### Flujo C — Crear/probar una voz castellana

> "He encontrado una muestra de voz en inglés que me gusta. Quiero ver si puedo hacer que hable castellano y suene bien."

Este es **un flujo iterativo de horas**, no un setup de 2 minutos. El usuario:
1. Sube muestra
2. Genera 2-3 frases de prueba
3. Activa/desactiva anchor castellano
4. Activa/desactiva candidates
5. Cambia velocidad
6. Comparar tomas
7. Vuelve a 2

Hoy este flujo vive **fragmentado** entre Voices (subir muestra), Quick Synth Experimental (probar cross-lingual), y luego volver a Voices para guardar el perfil. No hay un sitio donde se haga el bucle completo de iteración.

**Lo que falta:** un **laboratorio de voz** dedicado. "Voice Lab" o "Estudio de voz" donde el bucle iteración sea de primera clase, con historial de takes, comparación A/B, y un botón "guardar como perfil" cuando estés satisfecho.

### Flujo D — Gestión de voces ya existentes

> "Tengo 5 voces clonadas. Quiero usar una en este proyecto."

Es el flujo simple: **catálogo + acción de seleccionar**. El usuario solo necesita:
- Ver sus voces
- Probar rápido (3 segundos de ejemplo)
- Click → "usar en proyecto X" o "abrir en lab para retocar"

Hoy la pestaña "Voces" mezcla este flujo con el de creación. Resultado: confuso para el usuario que ya tiene sus voces y solo quiere elegir una.

---

## 3. La organización actual no apoya estos flujos

Mapeo: pestaña actual → qué flujo apoya

| Pestaña | Flujo A | Flujo B | Flujo C | Flujo D |
|---|---|---|---|---|
| Workbench | parcial | parcial | — | — |
| Quick Synth (estándar) | — | — | parcial | parcial |
| Quick Synth (experimental) | — | — | parcial | — |
| Voices | — | — | parcial | sí |
| Audio Tools | parcial | — | — | — |
| Studio | parcial | — | — | — |
| Activity | — | — | — | — |

Observa que **ningún flujo se completa en una sola pestaña**. Todos saltan entre 2-4. Eso es el síntoma de que los pliegues están en el sitio incorrecto.

---

## 4. La organización propuesta

Tres niveles, no seis pestañas planas.

### Nivel 1 — Inicio / Dashboard

Lo primero que ves al abrir la app.

```
┌─ VoxForge ──────────────────────────────────────────┐
│                                                       │
│   [ + Nuevo relato ]                                  │
│                                                       │
│   Mis relatos                                         │
│   ├─ "Cuento del Norte"      ▶ generando capítulo 3  │
│   ├─ "El faro"               ✓ video listo           │
│   └─ "Niebla"                · borrador (sin audio)  │
│                                                       │
│   Mis voces (3)            [ + Crear voz ]           │
│   ├─ Permenides 90 (castellana, anchor)              │
│   ├─ Mivoz                                           │
│   └─ Deep                                            │
│                                                       │
│   Hay 2 generaciones en curso · 0 errores             │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Reemplaza la actual pestaña "Workbench" como home. Da contexto inmediato: qué proyectos tienes, qué voces, qué se está cocinando ahora mismo. La pestaña "Activity" desaparece como destino — su contenido se incorpora aquí (1 línea de actividad + acceso a logs si hay errores).

### Nivel 2 — Vista de relato

Click en un relato → vista única que linealiza el Flujo A. Sin sub-pestañas; cada paso es una sección que se expande.

```
┌─ "Cuento del Norte" ←  Inicio                        ┐
│                                                       │
│  ① Texto                                       [Edit]│
│     12 capítulos · 24,300 palabras                    │
│                                                       │
│  ② Voz narradora                                      │
│     Permenides 90 · castellano   [Cambiar] [Probar]  │
│                                                       │
│  ③ Audio                                              │
│     Cap 1: ✓ generado · 4:32 · [▶] [↓] [✎]           │
│     Cap 2: ✓ generado · 5:01 · [▶] [↓] [✎]           │
│     Cap 3: ⏳ generando 7/14 fragmentos...           │
│     Cap 4: · sin generar     [Generar]                │
│     ...                                              │
│                                                       │
│  ④ Edición                                  Opcional │
│     Capítulo 1: trim de silencio inicial aplicado    │
│                                                       │
│  ⑤ Video                                    Opcional │
│     Portada subida · sin renderizar    [Renderizar]  │
│                                                       │
│  ⑥ Exportar                                          │
│     [Descargar audios .zip]  [Descargar video .mp4]  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Cada paso se autocompleta cuando el anterior está hecho. El usuario ve **dónde está y qué falta**.

Las acciones avanzadas (regenerar un chunk concreto, abrir Studio, configurar render) viven dentro de la sección correspondiente, no en otra pestaña. Studio y Audio Tools dejan de ser destinos: se invocan desde el paso ④ o ③ del relato.

### Nivel 3 — Herramientas y assets

Dos secciones a las que se llega desde el Nivel 1:

**Mis voces / Voice Lab** (mezcla del actual Voices + el modo experimental)
- Galería de voces con preview
- Click en una → abre el lab para esa voz
- Lab = el bucle iterativo del Flujo C: subir/grabar muestra, probar frases, ajustar anchor + candidates + velocidad, comparar tomas, guardar perfil. Aquí entran TODAS las opciones avanzadas que hoy contaminan el experimental tab.
- Un perfil "guardado" tiene su configuración baked-in (anchor sí/no, etc) y se usa de manera transparente desde los proyectos.

**Estudio de audio** (el actual Studio, pero para uso suelto)
- Solo para cuando alguien quiere editar un audio externo no-asociado a proyecto. Si vienes de un capítulo (Nivel 2), el Studio se abre **dentro del contexto del capítulo** y el resultado vuelve al capítulo automáticamente.

**Audio Tools** desaparece como destino. Sus dos funciones (cambiar voz, lab DSP):
- "Cambiar voz" se integra como opción dentro del Voice Lab: "haz que esta muestra suene como aquella otra voz".
- "Lab DSP" se integra como una operación más en Estudio (al lado de trim/normalize).

---

## 5. Qué cambia en cada flujo con esta organización

### Flujo A (producir un relato): hoy 4 pestañas → mañana 1 vista

| Hoy | Mañana |
|---|---|
| 1. Workbench → crear proyecto | 1. Inicio → "+ Nuevo relato" |
| 2. Voces → subir/elegir muestra | 2. Paso ② Voz |
| 3. Workbench (otra vez) → texto | 3. Paso ① Texto |
| 4. Workbench → Mapa de chunks → Sintetizar | 4. Paso ③ "Generar" |
| 5. Studio → editar | 5. Paso ④ "Editar" (sin salir) |
| 6. Studio → render video | 6. Paso ⑤ "Video" |
| 7. ¿Cómo descargo? → Activity / Studio | 7. Paso ⑥ Exportar |

7 saltos → 6 secciones lineales sin saltos.

### Flujo C (clonar voz castellana): hoy disperso → mañana lab

| Hoy | Mañana |
|---|---|
| Voces → upload card → guardar perfil base | Voice Lab → nueva voz |
| Quick Synth → cambiar a Experimental | (mismo lab, pestaña "Probar") |
| Marcar 2 toggles + slider velocidad + 1/2/3 versiones | (controles agrupados con vista de iteraciones previas) |
| Generar y escuchar | (igual) |
| Si gusta: Voces → Editar perfil → activar Anchor | (botón "Guardar como perfil con esta config") |
| Volver al proyecto | (botón "Usar en relato X") |

Iteración + guardado en un solo sitio.

---

## 6. Lo que sobra

Cosas presentes hoy que no aportan a ningún flujo y se eliminan:

- **Compare panel (CompareTab)**: redundante con la galería de voces que tiene preview.
- **Tab Audio Tools entera**: sus piezas se reubican.
- **Tab Activity como destino**: se convierte en una franja en el Inicio.
- **El sub-tab "Mapa de chunks"**: el mapa se ve por defecto en el paso ③ del relato; ya no necesita una vista propia.
- **El modo experimental de Quick Synth**: se absorbe en el Voice Lab. Quick Synth (estándar) se mantiene como scratchpad rápido fuera-de-proyecto.
- **`window.prompt()`** y otras UIs alternativas para tareas similares: una sola UI por tarea.

---

## 7. Cómo se llega ahí (sin reescribir todo)

No hay que tirar la app y reescribirla. Hay tres pasos viables:

### Paso 1 — Reorganizar nav (Sprint 1, ~4h)

- Renombrar pestañas y reordenar:
  - "Proyecto" → "**Inicio**" (con lista de proyectos)
  - "Síntesis rápida" → "**Probar**" (scratchpad)
  - "Voces" → "**Voces**" (sin cambio, pero el experimental se quita)
  - Eliminar Audio Tools del nav (ya está oculto, ratificarlo)
  - "Estudio" → "**Estudio**" (sin cambio)
  - "Actividad" → fusionar con Inicio
- En el header, mostrar contexto activo ("Editando: Cuento del Norte / Cap 3").

### Paso 2 — Vista de relato unificada (Sprint 2, ~6-8h)

- WorkbenchTab actual → mantenerlo internamente, pero la vista por defecto al abrir un proyecto pasa a ser la lista de pasos ①-⑥ descrita arriba.
- Cada paso es un componente colapsable o sección con su propio contenido. La mayor parte del código existente (ChunkMap, ChapterRecorder, etc.) se reutiliza dentro de los pasos.
- "Editar en Studio" abre Studio en modal o panel deslizante, NO cambia de pestaña; el resultado vuelve al capítulo automáticamente.

### Paso 3 — Voice Lab consolidado (Sprint 3, ~4-6h)

- Tomar ExperimentalTab + parte de VoicesTab + create form → fusionar en un solo "Voice Lab".
- Lista de voces a la izquierda (tu galería actual). Click en una abre el lab a la derecha. "+ Nueva voz" inicia el lab vacío.
- El experimental tab actual (Quick Synth → cross-lingual) deja de existir como destino; queda como modo dentro del lab.

Total estimado: 14-18 horas de trabajo concentrado para tener Niveles 1+2+3 funcionales. Con el código existente reutilizado al 80%.

---

## 8. Las preguntas que necesito que respondas tú

Para no asumir cosas:

1. **¿El destino final es YouTube o algo más amplio?** Si es solo YouTube, el flujo "render video MP4 con cara fija + audio" debería ser el botón principal del paso ⑥ y todos los demás render quedan secundarios.

2. **¿Tienes un puñado de voces fijas que reutilizas en muchos relatos, o experimentas con voces nuevas a menudo?** Si es lo primero, el Voice Lab puede ser muy reducido. Si es lo segundo, es la pieza más importante.

3. **¿Los proyectos suelen tener 1 capítulo o 12?** Cambia el peso entre "vista de capítulo único" vs "vista de proyecto multi-capítulo".

4. **¿Capítulos largos (15+ min) o cortos (3-5 min)?** Cambia la prioridad del scrubber/zoom de Studio.

5. **¿Editas mucho el audio post-generación o casi nunca?** Si casi nunca: Studio puede colapsarse a "trim/normalize" mínimo y olvidar el resto.

Con esas respuestas afino el plan y elimino lo que no aplica. Si prefieres, hablamos de las preguntas y te entrego una versión 2 del plan adaptada.

---

*Este documento NO incluye cambios de código. Es una propuesta de rediseño. El siguiente paso, si lo apruebas, es trabajar Paso 1 (Sprint 1) y validar el approach antes de seguir.*
