# VoxForge — Guía de Desarrollo

Motor de síntesis de voz. Backend Python (FastAPI + Edge-TTS), frontend React.

## Arquitectura actual

```
backend.py            → API FastAPI monolítica (619 líneas, a modularizar)
voxforge-tts-app.jsx  → SPA React de un solo componente (a migrar a TS + módulos)
data/                 → Almacenamiento runtime (voices, profiles, output, temp)
```

Contrato HTTP: backend expone snake_case (`voice_id`, `sample_filename`), frontend trabaja en camelCase. La normalización vive en `normalizeProfile()` del cliente API — mantener ese único punto de traducción.

## Comandos

```bash
# Backend
uvicorn backend:app --reload --port 8000

# Tests backend (a crear)
pytest -xvs

# Frontend (dentro del proyecto React)
npm start
npm run lint
npm run typecheck
```

---

## Principios transversales

1. **Claridad sobre cleverness**. Código explícito > abstracciones prematuras. Tres líneas similares son mejor que una abstracción equivocada.
2. **Fallar rápido y fuerte** en los límites del sistema (entrada de usuario, API externa). Confiar en código interno.
3. **Una responsabilidad por módulo/función**. Si el nombre necesita "and", divídelo.
4. **Sin muertos**: no dejar código comentado, imports sin uso, variables `_unused` como memoria histórica. `git` es la memoria.
5. **No duplicar contratos**: el schema de un endpoint vive en un solo sitio (Pydantic) y se deriva hacia el cliente.

---

## Python — Backend

### Estructura objetivo (refactor de `backend.py`)

```
backend/
├── __init__.py
├── main.py              # app FastAPI, middlewares, routers
├── config.py            # settings via pydantic-settings (BaseSettings)
├── models/
│   ├── synthesis.py     # SynthesisRequest
│   └── profile.py       # VoiceProfile, ProfileUpdate
├── services/
│   ├── tts_engine.py    # TTSEngine
│   └── profile_manager.py
├── routers/
│   ├── synthesis.py
│   ├── profiles.py
│   └── voices.py
├── core/
│   ├── paths.py         # BASE_DIR, DATA_DIR, etc.
│   ├── voices_catalog.py
│   └── audio_formats.py
└── utils/
    └── cleanup.py
```

Objetivo: ningún archivo > 200 líneas, cada router < 100 líneas.

### Tipado

- **Type hints obligatorios** en toda función pública. Usar `from __future__ import annotations` en archivos nuevos.
- Preferir tipos modernos: `list[str]`, `dict[str, int]`, `X | None` (Python 3.10+).
- `Optional` solo si hace el intent más claro que `| None`.
- Anotar también variables en scope de módulo si su tipo no es obvio.
- Usar `TypedDict` / `Protocol` para contratos internos, no `dict[str, Any]`.

### Validación y modelos

- **Un modelo Pydantic por payload**. No reutilizar `SynthesisRequest` para cosas que no sean exactamente eso.
- Validaciones de rango con `Field(ge=, le=)`, no con `if` manual.
- Validadores personalizados con `@field_validator` (Pydantic v2).
- Modelos de respuesta explícitos: usar `response_model=` en cada endpoint. Nunca devolver `dict` crudo de un endpoint público.
- Separar modelos de entrada (`XxxCreate`, `XxxUpdate`) de modelos de persistencia (`Xxx`) y de respuesta (`XxxResponse`).

### Configuración

Sustituir constantes en el módulo por `Settings` con `pydantic-settings`:

```python
class Settings(BaseSettings):
    base_dir: Path = Path(__file__).parent
    cors_origins: list[str] = ["http://localhost:3000"]
    max_text_length: int = 50_000
    cleanup_max_age_hours: int = 24
    model_config = SettingsConfigDict(env_file=".env", env_prefix="VOXFORGE_")
```

Nada de `allow_origins=["*"]` en producción.

### Errores

- Lanzar `HTTPException` solo en la capa de routers. Los servicios lanzan excepciones de dominio propias (`ProfileNotFound`, `UnsupportedVoiceError`).
- Traducir excepciones de dominio → HTTP en un `exception_handler` global.
- Nunca `except Exception:` silencioso sin log + re-raise o respuesta específica.
- Nada de `print`. Usar el `logger` del módulo con niveles correctos (`debug`/`info`/`warning`/`error`).

### Async y I/O

- Endpoints `async def` solo si hacen I/O async de verdad. Si la función es CPU-bound (pydub/ffmpeg), usar `def` normal — FastAPI la ejecuta en un threadpool.
- Operaciones de disco bloqueantes (`Path.read_text`, `write_bytes`) en handlers `async` deben ir a `asyncio.to_thread` si el archivo puede ser grande. Aceptable para configs pequeñas.
- `edge-tts` es async nativo → mantener.

### Persistencia

- El JSON store (`profiles.json`) es aceptable para MVP, pero:
  - **Acceso concurrente no es seguro**. Añadir `asyncio.Lock` alrededor de `_save()` o migrar a SQLite con `aiosqlite`.
  - El `_save()` actual no es atómico. Escribir a `*.tmp` y `os.replace()`.
- No acceder a miembros `_privados` desde fuera de la clase (ya corregido con `attach_sample`). Romper esta regla pide tests que no tenemos.

### Testing

- Usar `pytest` + `httpx.AsyncClient` con `ASGITransport` para tests de endpoints.
- Fixtures para directorios `data/` temporales (`tmp_path`).
- Cada endpoint: un test de happy path + un test de validación + un test de error.
- Mock de `edge_tts.Communicate` con un fake que escribe un mp3 mínimo válido.

### Estilo

- **Formatter**: `ruff format` (no black, no isort).
- **Linter**: `ruff check` con regla set al menos `E,F,I,UP,B,SIM,RUF`.
- **Type-check**: `mypy --strict` o `pyright` en modo strict.
- Docstrings: estilo Google o NumPy, solo en funciones públicas y clases. No docstring obvio (`"""Devuelve self.x."""`).
- Comentarios solo donde el *por qué* no es evidente. El *qué* lo dice el código.

---

## TypeScript / React — Frontend

### Migración JSX → TSX

Objetivo inmediato: convertir `voxforge-tts-app.jsx` a TypeScript y trocearlo.

```
src/
├── App.tsx
├── api/
│   ├── client.ts          # fetch wrapper, API_BASE
│   ├── types.ts           # tipos del contrato API (generados o escritos)
│   └── profiles.ts, synthesis.ts, voices.ts
├── components/
│   ├── Slider.tsx
│   ├── WaveformVisualizer.tsx
│   ├── AudioPlayer.tsx
│   └── icons/index.tsx
├── features/
│   ├── synth/SynthTab.tsx
│   ├── voices/VoicesTab.tsx
│   └── profiles/ProfilesTab.tsx
├── hooks/
│   ├── useProfiles.ts
│   └── useSynthesis.ts
├── i18n/
│   ├── es.ts
│   ├── en.ts
│   └── index.ts
├── constants/voices.ts
└── types/domain.ts
```

Regla: ningún componente > 150 líneas, ningún archivo > 250.

### Tipado

- `tsconfig.json` con `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.
- **Prohibido** `any`. Si hace falta escapar, usar `unknown` + narrowing.
- Prohibido `as Foo` salvo en los bordes (parseo de JSON externo). En esos casos, validar con un parser (`zod`) antes.
- Props tipadas con `interface` explícita por componente. No inline salvo 1-2 props triviales.
- No usar `React.FC`. Firma normal: `function Component(props: Props) { … }`.
- Tipos del contrato API en `api/types.ts` — idealmente generados desde el OpenAPI de FastAPI (`openapi-typescript`).

### Estado y efectos

- `useState` solo para estado local de UI. Estado remoto → hook dedicado (`useProfiles`) o `@tanstack/react-query` cuando el proyecto crezca.
- `useEffect` con array de deps **completo y correcto**. Si hay que silenciar el linter, hay un bug latente.
- Cleanup functions obligatorias en efectos que crean recursos (timers, blob URLs, subscriptions). Ya aplicado con `URL.revokeObjectURL`.
- `useCallback`/`useMemo` solo cuando hay problema real de performance o dependencias de otros hooks. No por defecto.

### Estilos

El código actual usa estilos inline masivos. Esto **se refactoriza**:

- Migrar a CSS Modules, vanilla-extract, Tailwind, o styled-components — elegir **uno** y no mezclar.
- Design tokens (colores, spacing, radii) en un único archivo (`theme.ts` o `tokens.css`). Ahora mismo `#3b82f6` aparece ~30 veces.
- Nada de valores mágicos repetidos. Si un color aparece 2+ veces → token.

### API client

- Un solo `fetchJson<T>` con manejo de errores centralizado, no `fetch` suelto en cada handler.
- Tipar respuestas explícitamente. No devolver `Promise<any>`.
- Normalización snake_case → camelCase en **una sola capa** (`api/`), nunca en componentes.
- Errores como excepciones con tipo (`ApiError extends Error { status, detail }`), no strings.

### i18n

- Extraer `i18n` a archivos por idioma. Tipo `type TranslationKey = keyof typeof es`.
- Hook `useT()` que devuelve `t` tipado.
- Al añadir una key en `es.ts`, TypeScript debe forzar añadirla en `en.ts`.

### Accesibilidad

El código actual tiene deudas a11y:
- Todos los `<button>` con icono-only necesitan `aria-label`.
- Los sliders custom tienen `<input type="range">` correctamente, pero los thumbs visuales no deben capturar eventos (ya hecho con `pointerEvents: "none"`).
- `dragOver` zone necesita `role="button"`, `tabIndex={0}` y handler de teclado.
- Toast necesita `role="status"` + `aria-live="polite"`.

### Testing

- `vitest` + `@testing-library/react`.
- Tests por componente: render + interacciones clave. No tests de implementación (no inspeccionar state interno).
- MSW (`msw`) para mockear la API en tests.

### Estilo

- **Formatter**: Prettier.
- **Linter**: ESLint con `@typescript-eslint/strict`, `react-hooks`, `jsx-a11y`.
- Imports ordenados (built-in → external → internal → relative).
- Nombres: `PascalCase` componentes, `camelCase` funciones/variables, `UPPER_SNAKE` constantes de módulo.

---

## Convenciones comunes

### Git

- Commits en imperativo, en inglés o español (elegir y ser consistente). Formato sugerido: `tipo: descripción` (`fix: uuid subscript in sample upload`).
- Un commit = un cambio lógico. No mezclar refactor + feature + bug fix.
- Nunca `--no-verify`.

### Documentación

- Este `CLAUDE.md` documenta el **cómo trabajamos**.
- `README.md` documenta el **qué es y cómo ejecutarlo**.
- No crear más `.md` salvo que sean necesarios (ADRs para decisiones no obvias).

### Secretos

- Nunca hardcodear URLs de producción, API keys, ni credenciales.
- `.env` en `.gitignore`. `.env.example` sí se commitea.

---

## Plan de refactor sugerido (orden)

1. **Backend**: extraer `Settings` + modularizar en paquete `backend/` con routers.
2. **Backend**: añadir `response_model` a todos los endpoints y handler global de excepciones.
3. **Backend**: lock en `ProfileManager` + escritura atómica.
4. **Backend**: suite mínima de tests pytest (happy path de cada endpoint).
5. **Frontend**: setup TS estricto + migrar archivo único a TSX.
6. **Frontend**: trocear en `components/`, `features/`, `hooks/`, `api/`.
7. **Frontend**: extraer estilos inline a sistema unificado (CSS Modules o Tailwind).
8. **Frontend**: generar tipos desde OpenAPI del backend.
9. **Ambos**: CI con lint + typecheck + tests antes de merge.

Cada paso: un PR pequeño, verde, reviewable.
