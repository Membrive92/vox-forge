# Frontend polish plan — UX/UI/FE improvements

**Fecha**: 2026-04-13
**Estado**: Planificado, pendiente de implementacion
**Motivacion**: Tras el rediseno UX (10 -> 5 tabs) la aplicacion es funcionalmente coherente pero visualmente inconsistente: 8+ variantes de boton inline, 10+ tamanos de fuente sin escala, colores hardcoded fuera de tokens, zero focus states, empty states pobres, y el tab por defecto (Workbench) no guia a un usuario nuevo.

Alcance: puro frontend. Cero cambios en backend. De una app funcional y fea a una app funcional y pulida.

Total estimado: ~20-25h de trabajo, repartido en 7 fases.

---

## Principios rectores

1. **Cada fase deja la app verde y testeable**. Nunca hay un momento donde algo visible se rompe.
2. **Preservar funcionalidad**. Solo reorganizamos visualmente y anadimos feedback. Nada nuevo se incorpora.
3. **Migrar, no reescribir**. Los componentes existentes se adaptan a nuevos primitivos, no se tiran.
4. **Tokens primero, componentes despues, migracion al final**. Orden que minimiza rework.

---

## Fase 1 — Design system: tokens (fundacion)

**Objetivo**: establecer las escalas que todo lo demas va a consumir. Sin esta fase, el resto son parches.

**Dependencias**: ninguna.

**Pasos**:

1. Ampliar `src/theme/tokens.ts` con escala de tipografia:
   ```ts
   export const typography = {
     size: { xs: 11, sm: 13, base: 14, lg: 16, xl: 20, "2xl": 28 },
     weight: { regular: 400, medium: 500, semibold: 600, bold: 700 },
     leading: { tight: 1.2, normal: 1.5, relaxed: 1.7 },
     tracking: { normal: "0", wide: "1px", widest: "2px" },
   };
   ```

2. Anadir escala de espaciado basada en 4px:
   ```ts
   export const space = {
     0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48,
   };
   ```

3. Anadir tokens de color que hoy estan hardcoded en 12+ lugares:
   ```ts
   colors.warning = "#f59e0b";
   colors.warningSoft = "rgba(245,158,11,0.15)";
   colors.warningBorder = "rgba(245,158,11,0.3)";
   colors.success = "#34d399";
   colors.successSoft = "rgba(16,185,129,0.15)";
   colors.successBorder = "rgba(16,185,129,0.3)";
   colors.danger = "#f87171";
   colors.dangerSoft = "rgba(248,113,113,0.08)";
   colors.dangerBorder = "rgba(248,113,113,0.25)";
   ```

4. Arreglar contrastes que fallan WCAG AA:
   - `textGhost: #334155` (3.2:1) -> `#64748b` (4.6:1)
   - `textFaint: #475569` (4.2:1) -> `#7188a5` (5.1:1)

5. Anadir breakpoints aunque aun no se usen:
   ```ts
   export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 };
   ```

6. Anadir tokens de transiciones:
   ```ts
   export const transitions = {
     fast: "all 150ms ease",
     base: "all 250ms ease",
     slow: "all 400ms ease",
   };
   ```

**Riesgo**: Bajo. Solo anadir tokens y ajustar dos contrastes. Nadie los usa todavia.

**Esfuerzo**: ~45 min

**Criterio de completado**: `tokens.ts` ampliado, typecheck verde, la app sigue identica funcionalmente (cambios sutiles de contraste visibles).

---

## Fase 2 — Primitivos compartidos: Button, Card, IconButton

**Objetivo**: eliminar las 8 variantes de boton inline y la repeticion del patron card. Anadir los building blocks que las fases 3-5 van a usar.

**Dependencias**: Fase 1.

**Pasos**:

1. Crear `src/components/Button.tsx`:
   ```ts
   type Variant = "primary" | "secondary" | "ghost" | "danger" | "warning" | "success";
   type Size = "sm" | "md" | "lg";

   interface Props {
     variant?: Variant;
     size?: Size;
     icon?: ReactNode;
     loading?: boolean;
     children?: ReactNode;
     // + button HTML props
   }
   ```
   - `:focus-visible` con outline de 2px en `colors.primary`
   - Hover states consistentes (brightness-110 o elevation subtle)
   - Disabled state unificado (opacity 0.5 + pointer-events: none)
   - Transiciones de 150ms
   - Loading state con spinner inline (ocupa el slot del icon)

2. Crear `src/components/IconButton.tsx`:
   - Para icon-only circulares (play, stop, delete, edit, preview)
   - Tamanos: `sm` (28px), `md` (36px), `lg` (42px)
   - Click target minimo 44x44 garantizado via padding invisible
   - `aria-label` obligatorio (no opcional)
   - Focus ring visible

3. Crear `src/components/Card.tsx`:
   ```ts
   <Card padding="md" glass={true}>...</Card>
   ```
   Sustituye la repeticion del pattern:
   ```ts
   background: colors.surface,
   border: `1px solid ${colors.border}`,
   borderRadius: radii.xl,
   padding: 24,
   backdropFilter: "blur(12px)",
   ```

4. Tests unitarios basicos para los 3 componentes (~6 tests):
   - Button renderiza children
   - Button respeta disabled
   - Button con loading muestra spinner
   - IconButton requiere aria-label
   - Card renderiza children con padding correcto

5. **No migrar nada todavia**. Solo creamos los primitivos. Migracion en fases 3-5.

**Riesgo**: Bajo. Archivos nuevos no rompen nada.

**Esfuerzo**: ~1.5h

**Criterio de completado**: Los 3 componentes existen, tests verdes, typecheck verde.

---

## Fase 3 — Accesibilidad base

**Objetivo**: arreglar los fallos WCAG AA mas graves y migrar los botones principales al nuevo sistema. Es la fase de mayor ratio impacto/esfuerzo.

**Dependencias**: Fase 2.

**Pasos**:

1. **Migrar botones primarios** al nuevo `<Button>`:
   - `+ New Project` (WorkbenchTab)
   - `+ Chapter`, `Split Text`, `Export All` (WorkbenchTab)
   - `Save profile` (VoicesTab)
   - `Generate Audio` (SynthTab)
   - `Synthesize Chapter`, `Regen` (ChunkMap)
   - `Convert voice` (ConvertTab)
   - `Process` (LabTab)
   - `+ Save` preset (LabTab)
   - `Cast N voices` (CharacterCasting)
   - `Mix with ambient` (AmbienceMixer)
   - `Preview` (QuickPreview)
   - `Generate` (ExperimentalTab)
   - ~14 sustituciones

2. **Migrar icon buttons** al nuevo `<IconButton>`:
   - Play, Pause, Stop (InteractivePlayer, player inline en varios lugares)
   - Delete, Edit (ProfileCard)
   - Delete x (ChapterCard, project sidebar, pronunciation dict, ambience list)
   - Preview voice (VoicesTab voice list)
   - Preview ambient (AmbienceMixer list)
   - ~25 sustituciones

3. **Reemplazar `window.prompt()`** en LabTab (2 usos — nombre y descripcion del preset) por un componente `<PromptDialog>`:
   - Modal minimo con overlay
   - Input inline + botones Save/Cancel
   - Focus trap basico
   - ESC cierra, Enter confirma

4. **Anadir `aria-current="page"`** a la tab activa del nav.

5. **Click targets**: auditoria visual de todos los icon buttons para garantizar minimo 44x44 touch area.

6. **Contraste**: recorrer los usos de `colors.textGhost` y `colors.textFaint` — ya estan arreglados en los tokens pero verificar que no hay otros fallos visibles.

**Riesgo**: Medio. Muchas sustituciones pueden introducir bugs visuales sutiles (espaciado ligeramente distinto). Pasada visual por tab al final.

**Esfuerzo**: ~3h

**Criterio de completado**:
- Todos los botones importantes tienen focus ring visible al tabbing con Tab
- `window.prompt` eliminado del codigo
- Lighthouse accessibility score estimado >90 (no se puede verificar sin navegador, checklist manual)
- Tests verdes

---

## Fase 4 — Iconos unicos + tipografia escala

**Objetivo**: remediar confusiones visuales baratas y migrar la tipografia al sistema de escala.

**Dependencias**: Fase 1 (tokens de tipografia).

**Pasos**:

1. **Anadir iconos unicos** a `src/components/icons.tsx`:
   - `Book` o `FileText` para Workbench (hoy usa Settings — colision con Activity)
   - `Zap` o `Sparkles` para Quick Synth (hoy usa Waveform)
   - `Mic2` para Voices (hoy usa User — ambiguo)
   - `Sliders` para Audio Tools (hoy usa Mic — confundible con input)
   - `Activity` o `Clock` para Activity (hoy usa Settings — colision con Workbench)

2. **Actualizar el nav** en `App.tsx` con los nuevos iconos.

3. **Migrar tipografia** tab por tab:
   - Reemplazar `fontSize: 13` por `typography.size.sm`
   - Reemplazar `fontSize: 16` por `typography.size.lg`
   - etc.
   - Aprovechar para normalizar `fontWeight` (unificar casos donde 500/600/700 se usan para el mismo rol visual)

4. **Consolidar labels uppercase** a un unico estilo o componente `<Label>`:
   ```ts
   const uppercaseLabelStyle = {
     fontSize: typography.size.xs,
     fontWeight: typography.weight.semibold,
     textTransform: "uppercase",
     letterSpacing: typography.tracking.widest,
     color: colors.textDim,
   };
   ```
   Sacarlo a `src/theme/text.ts` o a un componente.

**Riesgo**: Bajo. Cambios visuales pequenos y aislados.

**Esfuerzo**: ~2h

**Criterio de completado**:
- Cada tab del nav tiene icono distinto
- Zero usos de `fontSize: <number>` fuera de `typography.size` (verificable con grep)
- App visualmente igual pero consistente

---

## Fase 5 — Workbench rework (el gran win de UX)

**Objetivo**: arreglar los problemas del tab por defecto que un usuario nuevo encuentra al abrir la app.

**Dependencias**: Fases 2, 3, 4.

**Pasos**:

1. **Empty state del Workbench sin proyecto seleccionado**:
   - Crear componente `<EmptyState>` reutilizable con: icono grande, titulo, subtitulo, CTA
   - Usar en el Workbench cuando `!selected`:
     - Icono: libro o carpeta grande
     - Titulo: "Crea tu primer proyecto"
     - Subtitulo: "Los proyectos contienen tu historia organizada por capitulos"
     - CTA primaria: boton "Nuevo proyecto" en el centro
     - Opcional: lista "Como funciona el Workbench" con 3 pasos

2. **Empty state del proyecto sin capitulos**:
   - Cuando hay proyecto seleccionado pero `chapters.length === 0`, no mostrar area vacia con los 3 botones arriba
   - Mostrar hero: textarea grande centrado con placeholder "Pega aqui tu historia completa y pulsa Split para dividirla en capitulos"
   - Boton Split destacado debajo
   - Link secundario "O anadir un capitulo manual"

3. **ChapterCard redesign**:
   - Los 4 botones (Preview / Chunk Map / Cast / Ambient) pasan al **header** del capitulo al lado del titulo
   - Se convierten en un toolbar homogeneo de iconos+label (todos el mismo color base, solo cambia el icono)
   - Estado activo indicado por un highlight sutil debajo del boton (estilo mini-tab)
   - Contador de chars + duracion estimada tambien al header, no escondido al fondo

4. **Breadcrumb** en el Workbench:
   - Crear componente `<Breadcrumb>` reutilizable
   - Cuando hay proyecto: `Proyecto > Nombre del proyecto`
   - Cuando hay capitulo con panel abierto: `Proyecto > Nombre > Cap 3 > Chunk Map`
   - Ayuda a la orientacion

5. **Project name inline edit con affordance**:
   - Hover en el nombre -> border sutil + cursor text
   - Pencil icon pequeno visible en hover
   - Actualmente parece texto normal, el usuario no sabe que puede editar

6. **Sidebar compacta**:
   - Reducir padding de items
   - "Last modified" relativo ("hace 2h", "ayer") en vez de fecha corta
   - Boton de borrar visible solo en hover del item (no siempre visible)
   - Esto reduce el riesgo de delete accidental

**Riesgo**: Medio-alto. Es la mayor reorganizacion visual. Hay que testear el flujo completo de crear proyecto -> pegar texto -> capitulos -> sintetizar para que nada se rompa.

**Esfuerzo**: ~4-5h

**Criterio de completado**:
- Un usuario nuevo que abra la app en Workbench entiende que hacer en <5 segundos
- Los 4 botones del capitulo estan arriba y son coherentes visualmente
- El flujo de pegar historia -> split -> sintetizar se puede completar sin pensar
- Breadcrumb visible cuando aplica
- Tests verdes tras adaptar los del WorkbenchTab

---

## Fase 6 — Micro-interacciones y feedback

**Objetivo**: hacer la app "sentirse" fluida sin anadir features.

**Dependencias**: Fase 5 (primero reorganizamos, luego animamos).

**Pasos**:

1. **Transiciones consistentes**:
   - Usar `transitions.fast` (150ms) en todos los cambios de estado interactivos
   - Usar `transitions.base` (250ms) en layouts y paneles desplegables

2. **Skeleton loaders** en las cargas:
   - Crear componente `<Skeleton width height />` con shimmer animation
   - Usar en:
     - Workbench al cargar lista de proyectos
     - Activity al cargar el feed
     - Voices al cargar perfiles
     - ChunkMap al cargar chunks
     - Compare al cargar profiles
   - Eliminar los textos "Loading..." planos

3. **Toast mejorado**:
   - Stack de toasts (varios pueden coexistir)
   - Boton x de dismiss manual
   - Icono segun tipo: success / error / info / warning
   - Auto-dismiss con barra de progreso visible
   - Mantener el hook `useToast` actual, cambiar solo el componente

4. **ErrorBoundary mejorado**:
   - Mensaje amigable arriba: "Algo ha fallado. Puedes intentarlo de nuevo o seguir trabajando en otra pestana."
   - Detalles tecnicos plegables (stack trace oculto por defecto)
   - Boton "Volver a intentar" (reset del boundary)
   - Boton "Ir al inicio" (reload o navegar a Workbench)

5. **Drag-over visual**:
   - Drop zone de VoicesTab: mostrar outline + texto "Suelta aqui" desde el principio, no solo cuando detecta dragover

6. **Loading state en botones de accion**:
   - Button con `loading={true}` muestra spinner inline
   - Usar en Generate, Synthesize, Convert, Process, Cast, Mix

7. **prefers-reduced-motion**:
   - Anadir media query que desactiva todas las transitions y shimmer animations
   - Respetar preferencia del sistema

**Riesgo**: Bajo. Son mejoras de pulido que no cambian funcionalidad.

**Esfuerzo**: ~2-3h

**Criterio de completado**:
- Ninguna transicion es instantanea donde deberia haber feedback visual
- Al cargar cualquier lista, skeleton visible (no blank)
- Toast permite multiples mensajes y se pueden cerrar manualmente
- ErrorBoundary muestra mensaje amigable, detalles tecnicos en plegable

---

## Fase 7 — Responsive base

**Objetivo**: que la app al menos no se rompa en pantallas <1200px. No hacemos mobile-first completo, solo evitamos que layouts fixed exploten.

**Dependencias**: Fase 5 (Workbench reorganizado).

**Pasos**:

1. **Media queries basicas** usando los breakpoints del token:
   - `@media (max-width: 1024px)`: sidebars fixed (250, 340, 380) pasan a `minmax(200px, 1fr)` o se colapsan a iconos
   - `@media (max-width: 768px)`: grids de 2 columnas pasan a 1 columna

2. **Sidebars plegables en tablet**:
   - Workbench: el sidebar de proyectos se puede colapsar con un boton hamburguesa
   - SynthTab: igual con el sidebar de voces y settings
   - LabTab: igual con el sidebar de presets

3. **Tabs nav responsive**:
   - En pantallas pequenas, el nav se convierte en scroll horizontal
   - Los labels se ocultan y solo quedan los iconos (por eso importaba la Fase 4 de iconos unicos)
   - Alternativa: menu hamburguesa

4. **Textarea del Synth en mobile**:
   - De 2 columnas (textarea + sidebar) a stack vertical
   - Sidebar pasa a ir debajo del textarea, no al lado

5. **Compare tab**:
   - De 2 columnas (A y B) a 1 columna stack en <768px

**Riesgo**: Medio. Primera vez que la app tiene responsive, puede haber sorpresas en layouts que asumian ancho minimo.

**Esfuerzo**: ~3-4h

**Criterio de completado**:
- A 1024px: la app sigue usable sin scroll horizontal
- A 768px: la app se reorganiza en stack vertical, sidebars colapsables
- A <768px: no pretendemos que sea bonita, pero no debe romperse visualmente

---

## Roadmap visual

```
Fase 1 (tokens)              45 min    Foundation
  |
  +-> Fase 2 (Button/Card)   1.5h      Primitives
       |
       +-> Fase 3 (a11y)     3h        Keyboard + WCAG + migrations
       |
       +-> Fase 4 (icons+typo) 2h      Visual consistency
            |
            +-> Fase 5 (Workbench) 4-5h   Big UX win
                 |
                 +-> Fase 6 (micro)     2-3h   Polish
                 |
                 +-> Fase 7 (responsive) 3-4h  Device support

Total: ~20-25h
```

---

## Resumen de archivos afectados

| Fase | Archivos nuevos | Archivos modificados |
|------|----------------|---------------------|
| 1 | — | `src/theme/tokens.ts` |
| 2 | `Button.tsx`, `Card.tsx`, `IconButton.tsx` + tests | — |
| 3 | `PromptDialog.tsx` | ~15 archivos (migracion de botones), `LabTab.tsx` (prompt), `App.tsx` (aria-current) |
| 4 | — | `icons.tsx`, `App.tsx`, todos los features tab por tab, opcionalmente `theme/text.ts` |
| 5 | `EmptyState.tsx`, `Breadcrumb.tsx` | `WorkbenchTab.tsx` (gran rewrite), `ChapterCard` (dentro de Workbench) |
| 6 | `Skeleton.tsx` | `Toast.tsx`, `ErrorBoundary.tsx`, varios features |
| 7 | — | `App.tsx`, sidebars de Workbench/Synth/Lab/Compare |

---

## Verificaciones por fase

Cada fase debe mantener:
- `npm run typecheck` verde
- `npm test -- --run` (FE tests) 27/27 verde
- `python -m pytest -q` (BE tests) 115/115 verde — el backend no debe tocarse nunca

Fases 2, 3, 5 requieren nuevos tests unitarios para los componentes nuevos (Button, IconButton, Card, PromptDialog, EmptyState, Breadcrumb, Skeleton).

---

## Qué NO entra en este plan

Descartes deliberados para evitar scope creep:

- Rediseno completo del color scheme (el actual es consistente tematicamente)
- Dark mode toggle (ya es dark, no hay light mode)
- Animaciones complejas (respetamos `prefers-reduced-motion`)
- Mobile-first (solo mantenemos la app usable en tablet, no redisenamos para phone)
- Storybook u otra doc del design system (util pero alarga el scope)
- Migracion a CSS Modules, Tailwind, styled-components o cualquier otra libreria de estilos (mantenemos inline styles con tokens — decision del CLAUDE.md)
- Internacionalizacion adicional mas alla de ES/EN (aunque se podrian sacar hardcodes que encontre)
- Refactor del sistema de testing (seguimos con vitest + happy-dom + MSW)

---

## Notas de implementacion

### Sobre inline styles + tokens

El proyecto usa inline styles con objetos JS importados de `theme/tokens.ts`. Esta decision esta documentada en CLAUDE.md. No la cambiamos, solo la usamos mejor:
- Todos los valores visuales vienen de tokens
- Componentes compartidos exponen props de variante, no estilos crudos
- Estilos complejos se extraen a constantes `const buttonStyle: React.CSSProperties = {...}`

### Sobre tests visuales

No tenemos ni Storybook ni snapshot tests visuales. La verificacion de la fase 5 (Workbench rework) depende de que tu abras el navegador y confirmes. Yo puedo verificar con el manual-test-plan.md que ya existe.

### Sobre el commit strategy

Cada fase = al menos un commit, con mensaje del tipo `feat(fe): phase N - descripcion`. Fases grandes (3, 5, 6) pueden tener 2-3 commits internos. Al final del plan, push a main.