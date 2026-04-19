# UX Restructure Plan — De 10 tabs a 5

**Fecha**: 2026-04-12
**Estado**: ✅ Implementado (Phases 0-6 en commits `704fc24` ... `9e1a329`)
**Motivacion**: La aplicacion ha crecido a 10 tabs organizados por tecnologia (Convert, Lab, Experimental) en vez de por flujo de trabajo del usuario. Un narrador de audiolibros no piensa en "OpenVoice vs DSP" — piensa en "quiero modificar este audio". Esta reestructuracion agrupa por tarea, no por engine.

> **Nota posterior (2026-04-15)**: tras esta reestructuracion se anadio un
> **sexto tab** — **Studio** — entre Audio Tools y Activity, para
> post-produccion (editor de audio, futuro render de video). Ver
> [studio-module-plan.md](studio-module-plan.md). La distribucion final
> es: `Workbench | Quick Synth | Voices | Audio Tools | Studio | Activity`.

---

## Estado actual (10 tabs)

```
Synth | Workbench | Voices | Profiles | Convert | Compare | Lab | Experimental | Pronunciation | Activity
```

### Problemas detectados

1. **Voices + Profiles** son el mismo concepto ("mis voces") partido en dos tabs sin razon de usuario.
2. **Convert + Lab** ambos modifican audio con 3 sliders identicos (pitch, formant, bass). La distincion (clonacion vs DSP) es tecnica.
3. **Experimental** es un tab permanente para una feature que se usa 5 minutos al probar una voz cross-lingual.
4. **Pronunciation** es una tabla de configuracion, no un flujo de trabajo. No justifica un tab propio.
5. **Compare** es una utilidad puntual (casting de voces), no un flujo que ocupe tab permanente.
6. **Workbench** deberia ser el tab principal (donde el usuario pasa el 80% del tiempo) pero esta en segunda posicion.
7. **10 tabs** causa paralisis de eleccion en un usuario nuevo.

---

## Estructura objetivo (5 tabs)

```
Workbench | Quick Synth | Voices | Audio Tools | Activity
```

| Tab | Contenido | Tabs actuales que absorbe |
|-----|-----------|--------------------------|
| **Workbench** | Proyectos, capitulos, chunk map, ambient mixer, character casting, batch export, preview. Tab principal. | Workbench |
| **Quick Synth** | Textarea rapido + modo "voice sample" con cross-lingual. Autosave, shortcuts, resume. | Synth + Experimental |
| **Voices** | Voces del sistema + perfiles custom (upload + preview + A/B compare + quality analyzer). | Voices + Profiles + Compare |
| **Audio Tools** | Dos modos: "Change Voice" (OpenVoice) + "Effects" (Lab DSP). Presets unificados. Sliders no duplicados. | Convert + Lab |
| **Activity** | Historial de generaciones, errores, uso de disco. Seccion "Settings" con pronunciacion + export config. | Activity + Pronunciation |

---

## Principio rector

Cada fase deja la app funcional y testeable. El patron es: **crear nuevo tab -> migrar contenido -> eliminar viejo**. Nunca hay un momento donde una funcionalidad desaparece.

El backend no se toca. Todos los endpoints siguen iguales; solo cambia quien los llama desde el frontend.

---

## Fase 0 — Preparacion (sin cambios visibles)

**Objetivo**: estructura de carpetas y tipos sin tocar nada que el usuario vea.

**Pasos**:

1. Crear estructura de features vacia:
   ```
   src/features/
   ├── workbench/          (ya existe como projects/)
   ├── quick-synth/        (nuevo, vacio)
   ├── voices-unified/     (nuevo, vacio)
   ├── audio-tools/        (nuevo, vacio)
   └── activity/           (ya existe)
   ```

2. Definir el nuevo tipo Tab en fichero aparte (no en App.tsx todavia):
   ```ts
   type NewTab = "workbench" | "quick-synth" | "voices" | "audio-tools" | "activity"
   ```

3. Anadir todas las i18n keys nuevas sin borrar las viejas. Los dos sistemas coexisten.

**Riesgo**: Ninguno. Ficheros vacios y keys extra.

**Criterio de completado**: `npm run typecheck` verde, sin cambios visibles en la app.

---

## Fase 1 — Unificar Voices + Profiles + Compare -> "Voices"

**Objetivo**: Un solo tab que gestiona voces del sistema, perfiles custom, y comparacion A/B.

**Dependencias**: Ninguna. Cambio mas aislado.

**Pasos**:

1. Crear `VoicesUnifiedTab` con tres secciones (no sub-tabs, secciones scrolleables):
   - **Voces del sistema**: grid de voces built-in con preview (del actual VoicesTab).
   - **Mis perfiles**: lista con Use/Edit/Delete + upload de muestra inline (de ProfilesTab + parte de upload de VoicesTab).
   - **Comparar voces**: A/B + Quick Preview (de CompareTab). Colapsable, cerrado por defecto.

2. Integrar quality analyzer inline: al subir muestra, llamar `POST /api/analyze/sample` y mostrar rating + issues como feedback inmediato bajo el upload.

3. Conectar en App.tsx: reemplazar voices + profiles + compare por uno solo.

4. Verificar: typecheck + tests + flujos "Use profile" y "Edit profile".

5. Limpiar: borrar `features/voices/`, `features/profiles/`, `features/compare/`.

**Riesgo**: Bajo. Componentes existentes, solo mover y componer.

**Criterio de completado**: Un tab "Voices" con las 3 secciones. Upload con quality feedback. A/B funcional. Tests verdes.

---

## Fase 2 — Unificar Convert + Lab -> "Audio Tools"

**Objetivo**: Un tab con dos modos y sliders no duplicados.

**Dependencias**: Ninguna. Independiente de Fase 1.

**Pasos**:

1. Crear `AudioToolsTab` con toggle de modo:
   - **Change Voice**: upload source + target (perfil o sample) + OpenVoice. Los 3 sliders DSP como "Fine-tune" (de ConvertTab).
   - **Effects**: upload audio + 8 sliders DSP + presets (de LabTab). Los 3 sliders compartidos (pitch, formant, bass) son los mismos.

2. Si el usuario cambia de modo, los valores de sliders compartidos se conservan.

3. Presets: built-in + custom aparecen en ambos modos (los aplicables a cada uno). Custom presets siguen en localStorage.

4. Grabacion de microfono (AudioRecorder) al nivel del tab, compartido por ambos modos.

5. Conectar en App.tsx: reemplazar convert + lab por audio-tools.

6. Verificar y limpiar.

**Riesgo**: Bajo. Misma logica, UI nueva.

**Criterio de completado**: Tab "Audio Tools" con toggle. Voice conversion funcional. Lab DSP funcional. Presets guardables. Sin sliders duplicados.

---

## Fase 3 — Absorber Experimental en Quick Synth

**Objetivo**: Quick Synth = SynthTab actual + modo "Use voice sample" que activa cross-lingual.

**Dependencias**: Fase 1 completada (para que Voices unificado ya exista y no confunda la seleccion de perfiles).

**Pasos**:

1. Crear `QuickSynthTab` basado en SynthTab con adiciones:
   - Toggle "Use voice sample" debajo del selector de voz. Cuando activo:
     - Muestra upload de muestra / grabar con micro
     - Muestra selector de "Target language" (es/en)
     - Oculta selector de voces built-in
     - Muestra banner: "Cross-lingual — experimental, results may vary"
   - Cuando desactivado: funciona igual que SynthTab actual.

2. Logica: si toggle activo, genera via `/api/experimental/cross-lingual`. Resto del UI (player, progress, resume, shortcuts) funciona igual.

3. Preservar TODO de SynthTab: autosave, duration estimate, keyboard shortcuts, export panel, incomplete jobs banner, interactive player.

4. Conectar en App.tsx: reemplazar synth + experimental por quick-synth.

5. Verificar y limpiar.

**Riesgo**: Medio. Toggle de modo + routing condicional al backend.

**Criterio de completado**: Quick Synth con ambos modos. Cross-lingual funcional con banner. Autosave, shortcuts, resume intactos.

---

## Fase 4 — Absorber Pronunciation en Activity -> "Settings"

**Objetivo**: Activity con dos secciones: historial + configuracion global.

**Dependencias**: Fase 3 completada (el export panel se mueve de Quick Synth a Settings).

**Pasos**:

1. Anadir seccion "Settings" al ActivityTab (colapsable, al final):
   - **Pronunciation dictionary**: tabla CRUD (de PronunciationTab).
   - **Export defaults**: title, artist, album, filename pattern (del ExportPanel de SynthTab).
   - Estos settings son globales (aplican a Quick Synth y Workbench).

2. Quick Synth lee los valores de export desde los settings globales. Solo tiene un enlace "Export settings" al tab Activity.

3. Conectar en App.tsx: eliminar tab pronunciation.

4. Verificar y limpiar.

**Riesgo**: Bajo.

**Criterio de completado**: Settings visibles en Activity. Pronunciacion funcional. Export config aplica globalmente.

---

## Fase 5 — Promover Workbench a tab principal

**Objetivo**: Workbench como primer tab. Features nuevas de UX integradas.

**Dependencias**: Fases 1-4 completadas.

**Pasos**:

1. Reordenar tabs en el nav:
   ```
   Workbench | Quick Synth | Voices | Audio Tools | Activity
   ```

2. Cambiar tab por defecto en `useState<Tab>` a `"workbench"`.

3. Anadir **character casting UI** al Workbench:
   - Boton "Cast characters" en cada capitulo.
   - Detecta personajes en el texto (`POST /api/character-synth/extract-characters`).
   - Lista de personajes con dropdown de perfil para cada uno.
   - Sintetiza con el cast asignado (`POST /api/character-synth/synthesize`).

4. Anadir **Quick Preview** al Workbench:
   - Boton "Preview" en cada capitulo.
   - Genera los primeros 300 chars antes del commit completo.
   - Usa el mismo backend que Quick Synth.

5. Verificar flujo completo: crear proyecto -> pegar texto -> split en capitulos -> preview -> sintetizar -> chunk map -> regen chunk -> ambient mix -> batch export.

**Riesgo**: Medio. Character casting UI y preview son features nuevas en el contexto del Workbench.

**Criterio de completado**: Workbench es tab principal. Character casting funcional con asignacion de perfiles. Preview por capitulo. Flujo completo e2e.

---

## Fase 6 — Limpieza final

**Objetivo**: Eliminar codigo muerto, actualizar docs, verificar tests.

**Pasos**:

1. Eliminar features viejas:
   ```
   src/features/synth/
   src/features/voices/
   src/features/profiles/
   src/features/compare/
   src/features/convert/
   src/features/lab/
   src/features/experimental/
   src/features/pronunciation/
   ```

2. Eliminar i18n keys huerfanas.

3. Actualizar App.tsx: tipo Tab con 5 valores, imports de los 5 nuevos componentes.

4. Actualizar README.md y CLAUDE.md con la nueva estructura.

5. Run completo: `pytest -q && npm test -- --run && npm run typecheck`.

**Criterio de completado**: 0 imports a features eliminadas. Docs actualizados. Tests verdes.

---

## Estimacion de esfuerzo

| Fase | Esfuerzo | Riesgo | Backend |
|------|----------|--------|---------|
| Fase 0 — Prep | 15 min | Ninguno | No |
| Fase 1 — Voices unificado | 2-3h | Bajo | No |
| Fase 2 — Audio Tools | 2-3h | Bajo | No |
| Fase 3 — Quick Synth + cross-lingual | 1-2h | Medio | No |
| Fase 4 — Settings en Activity | 1h | Bajo | No |
| Fase 5 — Workbench principal | 2-3h | Medio | No |
| Fase 6 — Limpieza | 30 min | Bajo | No |

**Total**: ~10-12h. El backend no se toca.

---

## Mapping de funcionalidades: donde va cada cosa

| Funcionalidad actual | Tab actual | Tab destino | Seccion dentro del tab |
|---------------------|-----------|-------------|----------------------|
| Textarea + generar audio | Synth | Quick Synth | Principal |
| Autosave draft | Synth | Quick Synth | Automatico |
| Keyboard shortcuts | Synth | Quick Synth | Globales |
| Duration estimate | Synth | Quick Synth | Bajo textarea |
| Export panel (title, artist, pattern) | Synth | Activity | Settings > Export defaults |
| Incomplete jobs / resume | Synth | Quick Synth | Banner superior |
| Interactive player | Synth | Quick Synth + Workbench | Compartido (componente) |
| Progress per-chunk | Synth | Quick Synth + Workbench | Compartido (hook) |
| Cross-lingual cloning | Experimental | Quick Synth | Toggle "Use voice sample" |
| Voces del sistema (grid) | Voices | Voices | Seccion superior |
| Upload muestra de voz | Voices | Voices | Dentro de "Mis perfiles" |
| Perfiles CRUD | Profiles | Voices | Seccion "Mis perfiles" |
| Usar perfil (cargar config) | Profiles | Voices | Boton "Use" en cada perfil |
| A/B comparison | Compare | Voices | Seccion colapsable "Compare" |
| Quick Preview all voices | Compare | Voices (+ Workbench) | Dentro de Compare + boton en capitulos |
| Quality analyzer | (endpoint suelto) | Voices | Inline al subir muestra |
| Voice conversion (OpenVoice) | Convert | Audio Tools | Modo "Change Voice" |
| DSP sliders (8 params) | Lab | Audio Tools | Modo "Effects" |
| Presets built-in | Lab | Audio Tools | Compartidos entre modos |
| Presets custom (localStorage) | Lab | Audio Tools | Compartidos entre modos |
| Random preset | Lab | Audio Tools | Compartido |
| AudioRecorder (microfono) | Lab + Voices | Audio Tools + Voices | Compartido (componente) |
| Pronunciation dictionary | Pronunciation | Activity | Settings > Pronunciation |
| Historial de generaciones | Activity | Activity | Seccion principal |
| Errores recientes | Activity | Activity | Seccion principal |
| Uso de disco | Activity | Activity | Seccion principal |
| Developer logs | Activity | Activity | Toggle oculto al fondo |
| Proyectos + capitulos | Workbench | Workbench | Principal |
| Chunk map + regen | Workbench | Workbench | Por capitulo |
| Ambient mixer | Workbench | Workbench | Por capitulo |
| Batch export (ZIP) | Workbench | Workbench | Boton "Export All" |
| Character casting UI | (backend only) | Workbench | Boton "Cast" por capitulo |
| Chapter preview | (no existe) | Workbench | Boton "Preview" por capitulo |

---

## Notas de diseno

### Sobre el toggle cross-lingual en Quick Synth

El toggle "Use voice sample" cambia el modelo de input:
- **OFF**: selector de voz built-in + perfil opcional. Ruta: `POST /api/synthesize`.
- **ON**: upload de muestra + selector de idioma target. Ruta: `POST /api/experimental/cross-lingual`.

El resto del UI (textarea, player, progress, shortcuts, autosave) es identico en ambos modos. La distincion es solo el source de la voz y el endpoint.

### Sobre los sliders compartidos en Audio Tools

Pitch, Formant y Bass aparecen una sola vez. Son los mismos 3 `<Slider>` renderizados en ambos modos. El estado se comparte via `useState` a nivel del tab (no del modo). Cambiar de modo no resetea los valores.

En modo "Change Voice", los 3 sliders se aplican como post-proceso al resultado de OpenVoice. En modo "Effects", se aplican junto con los otros 5 sliders como cadena DSP completa. El backend ya maneja ambos paths.

### Sobre la seccion Compare en Voices

Se renderiza colapsada por defecto (el narrador la abre solo cuando necesita hacer casting). Internamente usa el mismo `synthesize()` que Quick Synth — no hay backend extra.

### Sobre Settings en Activity

Los settings (pronunciacion + export defaults) son globales. Se guardan:
- Pronunciacion: en el backend (`data/pronunciations.json`).
- Export defaults: en localStorage (`voxforge.export.settings`).

Ambos se leen desde cualquier tab que los necesite (Quick Synth, Workbench). La UI de edicion esta solo en Activity > Settings.
