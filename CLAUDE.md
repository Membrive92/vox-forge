# VoxForge — Development Guide

Voice synthesis engine. Python backend (FastAPI + Edge-TTS), React frontend.

## Current Architecture

```
backend/              -> Modular FastAPI package (routers, services, schemas)
src/                  -> React + TypeScript SPA (components, hooks, features)
data/                 -> Runtime storage (voices, profiles, output, temp)
```

HTTP contract: backend exposes snake_case (`voice_id`, `sample_filename`), frontend works in camelCase. Normalization lives in `api/profiles.ts` — keep this as the single translation point.

## Commands

```bash
# Backend
python -m uvicorn backend:app --reload --port 8000

# Backend tests
pytest -xvs

# Frontend
npm run dev
npm run typecheck
npm test
```

---

## Cross-cutting Principles

1. **Clarity over cleverness**. Explicit code > premature abstractions. Three similar lines are better than a wrong abstraction.
2. **Fail fast and loud** at system boundaries (user input, external API). Trust internal code.
3. **One responsibility per module/function**. If the name needs "and", split it.
4. **No dead code**: no commented-out code, unused imports, `_unused` variables as historical memory. `git` is the memory.
5. **Don't duplicate contracts**: an endpoint's schema lives in one place (Pydantic) and derives toward the client.

---

## Python — Backend

### Target Structure

```
backend/
├── __init__.py
├── main.py              # FastAPI app, middlewares, routers
├── config.py            # Settings via pydantic-settings (BaseSettings)
├── schemas.py           # Pydantic models (request, persistence, response)
├── catalogs.py          # Curated voices + audio formats (TypedDict)
├── exceptions.py        # Domain exceptions + global HTTP handler
├── dependencies.py      # Injectable singletons via Depends()
├── paths.py             # BASE_DIR, DATA_DIR, etc.
├── utils.py             # Cleanup
├── services/
│   ├── tts_engine.py    # TTSEngine with chunking
│   └── profile_manager.py
└── routers/
    ├── synthesis.py
    ├── profiles.py
    ├── voices.py
    └── health.py
```

Goal: no file > 200 lines, each router < 100 lines.

### Typing

- **Mandatory type hints** on all public functions. Use `from __future__ import annotations` in new files.
- Prefer modern types: `list[str]`, `dict[str, int]`, `X | None` (Python 3.10+).
- `Optional` only if it makes intent clearer than `| None`.
- Annotate module-scope variables if their type isn't obvious.
- Use `TypedDict` / `Protocol` for internal contracts, not `dict[str, Any]`.

### Validation and Models

- **One Pydantic model per payload**. Don't reuse `SynthesisRequest` for things that aren't exactly that.
- Range validations with `Field(ge=, le=)`, not manual `if` checks.
- Custom validators with `@field_validator` (Pydantic v2).
- Explicit response models: use `response_model=` on every endpoint. Never return raw `dict` from a public endpoint.
- Separate input models (`XxxCreate`, `XxxUpdate`) from persistence models (`Xxx`) and response models (`XxxResponse`).

### Configuration

Use `Settings` with `pydantic-settings`:

```python
class Settings(BaseSettings):
    base_dir: Path = Path(__file__).parent
    cors_origins: list[str] = ["http://localhost:3000"]
    max_text_length: int = 500_000
    cleanup_max_age_hours: int = 24
    model_config = SettingsConfigDict(env_file=".env", env_prefix="VOXFORGE_")
```

No `allow_origins=["*"]` in production.

### Errors

- Raise `HTTPException` only in the router layer. Services raise their own domain exceptions (`ProfileNotFound`, `UnsupportedVoiceError`).
- Translate domain exceptions -> HTTP in a global `exception_handler`.
- Never silent `except Exception:` without log + re-raise or specific response.
- No `print`. Use the module's `logger` with correct levels (`debug`/`info`/`warning`/`error`).

### Async and I/O

- `async def` endpoints only if they do real async I/O. If the function is CPU-bound (pydub/ffmpeg), use plain `def` — FastAPI runs it in a threadpool.
- Blocking disk operations (`Path.read_text`, `write_bytes`) in `async` handlers should go to `asyncio.to_thread` if the file may be large. Acceptable for small configs.
- `edge-tts` is natively async -> keep it.

### Persistence

- The JSON store (`profiles.json`) is acceptable for MVP, but:
  - **Concurrent access is not safe**. Use `asyncio.Lock` around `_save()` or migrate to SQLite with `aiosqlite`.
  - `_save()` is not atomic. Write to `*.tmp` then `os.replace()`.
- Don't access `_private` members from outside the class (already fixed with `attach_sample`).

### Testing

- Use `pytest` + `httpx.AsyncClient` with `ASGITransport` for endpoint tests.
- Fixtures for temporary `data/` directories (`tmp_path`).
- Each endpoint: one happy path test + one validation test + one error test.
- Mock `edge_tts.Communicate` with a fake that writes minimal valid mp3 bytes.

### Style

- **Formatter**: `ruff format` (not black, not isort).
- **Linter**: `ruff check` with at least rule set `E,F,I,UP,B,SIM,RUF`.
- **Type-check**: `mypy --strict` or `pyright` in strict mode.
- Docstrings: Google or NumPy style, only on public functions and classes. No obvious docstrings (`"""Return self.x."""`).
- Comments only where the *why* isn't evident. The *what* is in the code.

---

## TypeScript / React — Frontend

### Structure

```
src/
├── App.tsx
├── api/
│   ├── client.ts          # fetch wrapper, API_BASE
│   ├── types.ts           # API contract types (generated or handwritten)
│   └── profiles.ts, synthesis.ts
├── components/
│   ├── Slider.tsx
│   ├── WaveformVisualizer.tsx
│   ├── Toast.tsx
│   └── icons.tsx
├── features/
│   ├── synth/SynthTab.tsx
│   ├── voices/VoicesTab.tsx
│   └── profiles/ProfilesTab.tsx
├── hooks/
│   ├── useProfiles.ts
│   ├── useSynthesis.ts
│   ├── useAudioPlayer.ts
│   ├── useVoicePreview.ts
│   └── useSamplePlayer.ts
├── i18n/
│   ├── es.ts, en.ts, index.ts
├── constants/voices.ts
├── theme/tokens.ts
└── types/domain.ts
```

Rule: no component > 150 lines, no file > 250.

### Typing

- `tsconfig.json` with `"strict": true`, `"noUncheckedIndexedAccess": true`, `"exactOptionalPropertyTypes": true`.
- **No `any`**. If you need to escape, use `unknown` + narrowing.
- No `as Foo` except at boundaries (parsing external JSON). In those cases, validate with a parser (`zod`) first.
- Props typed with explicit `interface` per component. No inline except for 1-2 trivial props.
- Don't use `React.FC`. Normal signature: `function Component(props: Props) { ... }`.
- API contract types in `api/types.ts` — ideally generated from FastAPI's OpenAPI schema (`openapi-typescript`).

### State and Effects

- `useState` only for local UI state. Remote state -> dedicated hook (`useProfiles`) or `@tanstack/react-query` when the project grows.
- `useEffect` with **complete and correct** deps array. If you need to silence the linter, there's a latent bug.
- Mandatory cleanup functions in effects that create resources (timers, blob URLs, subscriptions). Already applied with `URL.revokeObjectURL`.
- `useCallback`/`useMemo` only when there's a real performance issue or hook dependency chain. Not by default.

### Styles

Current code uses massive inline styles. This **gets refactored**:

- Migrate to CSS Modules, vanilla-extract, Tailwind, or styled-components — pick **one** and don't mix.
- Design tokens (colors, spacing, radii) in a single file (`theme/tokens.ts`). Colors like `#3b82f6` are already tokenized.
- No repeated magic values. If a color appears 2+ times -> token.

### API Client

- A single `fetchJson<T>` with centralized error handling, not loose `fetch` in each handler.
- Type responses explicitly. Don't return `Promise<any>`.
- snake_case -> camelCase normalization in **one layer** (`api/`), never in components.
- Errors as typed exceptions (`ApiError extends Error { status, detail }`), not strings.

### i18n

- Extract `i18n` to per-language files. Type: `type TranslationKey = keyof typeof es`.
- `getTranslations(lang)` returns typed `t`.
- Adding a key in `es.ts` forces adding it in `en.ts` (compile error if missing).

### Accessibility

- All icon-only `<button>` elements need `aria-label`.
- Custom sliders have `<input type="range">` correctly, visual thumbs don't capture events (`pointerEvents: "none"`).
- `dragOver` zone needs `role="button"`, `tabIndex={0}` and keyboard handler.
- Toast needs `role="status"` + `aria-live="polite"`.

### Testing

- `vitest` + `@testing-library/react`.
- Per-component tests: render + key interactions. No implementation tests (don't inspect internal state).
- MSW (`msw`) to mock the API in tests.

### Style Guide

- **Formatter**: Prettier.
- **Linter**: ESLint with `@typescript-eslint/strict`, `react-hooks`, `jsx-a11y`.
- Sorted imports (built-in -> external -> internal -> relative).
- Names: `PascalCase` components, `camelCase` functions/variables, `UPPER_SNAKE` module constants.

---

## Common Conventions

### Git

- Commits in imperative, in English. Suggested format: `type: description` (`fix: uuid subscript in sample upload`).
- One commit = one logical change. Don't mix refactor + feature + bug fix.
- Never `--no-verify`.

### Documentation

- This `CLAUDE.md` documents **how we work**.
- `README.md` documents **what it is and how to run it**.
- Don't create additional `.md` files unless necessary (ADRs for non-obvious decisions).

### Secrets

- Never hardcode production URLs, API keys, or credentials.
- `.env` in `.gitignore`. `.env.example` gets committed.

---

## Refactor Plan (order)

1. ~~**Backend**: extract `Settings` + modularize into `backend/` package with routers.~~ Done.
2. ~~**Backend**: add `response_model` to all endpoints and global exception handler.~~ Done.
3. ~~**Backend**: lock in `ProfileManager` + atomic writes.~~ Done.
4. ~~**Backend**: minimal pytest suite (happy path for each endpoint).~~ Done (48 tests, 96% coverage).
5. ~~**Frontend**: strict TS setup + migrate single file to TSX.~~ Done.
6. ~~**Frontend**: split into `components/`, `features/`, `hooks/`, `api/`.~~ Done.
7. **Frontend**: extract inline styles to unified system (CSS Modules or Tailwind).
8. **Frontend**: generate types from backend's OpenAPI schema.
9. **Both**: CI with lint + typecheck + tests before merge.

Each step: a small, green, reviewable PR.
