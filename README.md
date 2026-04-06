# VoxForge — Voice Synthesis Engine

VoxForge is a web application for converting text to high-quality audio using Microsoft's neural voices (Edge-TTS). Designed for narrating stories, audiobooks, and long-form content, it supports texts up to 500,000 characters with automatic segmentation, natural pauses between paragraphs, and transparent concatenation into a single audio file.

## Features

- **Voice synthesis**: converts text to audio with 12 neural voices (6 ES, 6 EN) in MP3, WAV, OGG, FLAC formats
- **Long text support**: automatic chunking by paragraphs and sentences with 400ms pauses between segments
- **Voice profiles**: save voice + speed + pitch + volume combinations for reuse
- **Live preview**: listen to a demo of any voice before generating
- **Audio samples**: upload reference clips associated with profiles
- **Bilingual**: full UI in Spanish and English

## System Architecture

```
                         http://localhost:3000
                                 |
                          +----- | -----+
                          |   Vite Dev  |
                          |   Server    |
                          |  (proxy)    |
                          +------+------+
                                 |
                            /api/*
                                 |
                          +------+------+
                          |   FastAPI   |
                          |  :8000      |
                          +------+------+
                                 |
                    +------------+------------+
                    |            |            |
              +-----+----+ +----+-----+ +----+-----+
              | TTSEngine | | Profile  | | Voices   |
              | (chunks)  | | Manager  | | Catalog  |
              +-----+----+ +----+-----+ +----------+
                    |            |
              +-----+----+ +----+-----+
              | Edge-TTS  | |  JSON    |
              | (Microsoft)| |  Store   |
              +-----------+ +----------+
```

## Backend Architecture (Python)

```
backend/
├── __init__.py              # Exposes `app` for uvicorn
├── main.py                  # create_app(): FastAPI + CORS + routers
├── config.py                # Settings via pydantic-settings (VOXFORGE_*)
├── paths.py                 # Runtime directories (data/voices, output, temp)
├── catalogs.py              # Curated voices + audio formats (TypedDict)
├── schemas.py               # Pydantic models (request, persistence, response)
├── exceptions.py            # Domain exceptions + global HTTP handler
├── dependencies.py          # Injectable singletons via Depends()
├── utils.py                 # Temporary file cleanup
├── services/
│   ├── tts_engine.py        # Synthesis with chunking + concatenation
│   └── profile_manager.py   # CRUD with asyncio.Lock + atomic writes
└── routers/
    ├── synthesis.py          # POST /api/synthesize
    ├── voices.py             # GET /api/voices, upload/serve samples
    ├── profiles.py           # CRUD /api/profiles
    └── health.py             # GET /api/health
```

### Key Decisions

- **Layered architecture**: routers (HTTP) -> services (logic) -> domain exceptions. Routers never touch disk directly.
- **Domain exceptions**: `ProfileNotFound`, `UnsupportedVoiceError`, `SynthesisError` are translated to HTTP responses in a global handler. Services don't know about FastAPI.
- **Concurrency**: `ProfileManager` uses `asyncio.Lock` and atomic writes (`tmp` + `os.replace`) to prevent JSON corruption.
- **Chunking**: long texts are split by paragraphs (double newline), then by sentences if a paragraph exceeds 3000 chars. Each chunk is synthesized separately and concatenated with 400ms pauses.
- **Configuration**: everything via `pydantic-settings` with `VOXFORGE_` prefix and `.env` support.

### API

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/synthesize` | Text to audio (automatic chunking) |
| GET | `/api/voices` | Curated voice catalog |
| GET | `/api/voices/all` | All Edge-TTS voices |
| POST | `/api/voices/upload-sample` | Upload audio sample |
| GET | `/api/voices/samples/{filename}` | Serve sample |
| GET | `/api/profiles` | List profiles |
| GET | `/api/profiles/{id}` | Get profile |
| POST | `/api/profiles` | Create profile (multipart) |
| PATCH | `/api/profiles/{id}` | Update profile |
| DELETE | `/api/profiles/{id}` | Delete profile |
| GET | `/api/health` | Service status |

## Frontend Architecture (TypeScript + React)

```
src/
├── App.tsx                    # Orchestrator: global state, tabs, header
├── main.tsx                   # Entry point (StrictMode)
├── api/
│   ├── client.ts              # Centralized fetch wrapper, ApiError
│   ├── types.ts               # Backend DTOs (snake_case)
│   ├── profiles.ts            # Profile CRUD (normalizes to camelCase)
│   └── synthesis.ts           # Synthesis endpoint
├── types/
│   └── domain.ts              # Domain types (Profile, Voice, etc.)
├── constants/
│   └── voices.ts              # Local voice catalog + formats
├── i18n/
│   ├── es.ts                  # ES translations (typed TranslationKey)
│   ├── en.ts                  # EN translations (Record<TranslationKey>)
│   └── index.ts               # getTranslations(lang)
├── theme/
│   └── tokens.ts              # Design tokens (colors, fonts, radii)
├── components/
│   ├── Slider.tsx             # Accessible range input
│   ├── WaveformVisualizer.tsx # DPR-aware animated canvas
│   ├── Toast.tsx              # Notification with aria-live
│   └── icons.tsx              # 15 inline SVGs, zero dependencies
├── hooks/
│   ├── useToast.ts            # Timer + notification state
│   ├── useProfiles.ts         # Load + remote CRUD
│   ├── useAudioPlayer.ts      # Blob URL + play/pause/stop
│   ├── useSynthesis.ts        # Progress + API call
│   ├── useVoicePreview.ts     # Live voice demo
│   ├── useSamplePlayer.ts     # Play samples from backend
│   └── readAudioDuration.ts   # Local file metadata reader
└── features/
    ├── state.ts               # Shared interfaces (SynthSettings)
    ├── synth/SynthTab.tsx     # Editor + player + controls
    ├── voices/VoicesTab.tsx   # Upload + voice browser + profile form
    └── profiles/ProfilesTab.tsx # Profile cards with actions
```

### Key Decisions

- **Strict TypeScript**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, zero `any`.
- **Single normalization layer**: `snake_case` (backend) to `camelCase` (frontend) translation lives exclusively in `api/profiles.ts`. Components never see snake_case.
- **Typed i18n**: `TranslationKey` is inferred from `es.ts`. Adding a key in Spanish forces adding it in English (compile error if missing).
- **Hooks as logic**: each concern (audio, profiles, synthesis, toast) is an independent hook. Components only render.
- **Design tokens**: ~30 hardcoded color usages replaced with `colors.primary`, `colors.text`, etc.
- **Accessibility**: `aria-label` on icon-only buttons, `role="status"` on toast, `role="button"` on drop zone, `aria-live="polite"`.

## Tests

```bash
# Backend: 48 tests, 96% coverage
pytest

# Frontend: 24 tests
npm test

# TypeScript: strict check
npm run typecheck

# All together
pytest -q && npm test && npm run typecheck
```

### Backend (pytest)

| Suite | Tests | Covers |
|-------|-------|--------|
| test_health | 1 | Full wiring smoke test |
| test_voices | 3 | Catalog, discovery, 404 |
| test_profiles | 8 | CRUD + validation + idempotent delete |
| test_synthesis | 7 | Audio, formats, profiles, errors |
| test_uploads | 7 | Upload, attach, replace, serve, cleanup |
| test_services | 12 | ProfileManager, TTSEngine helpers |
| test_chunking | 10 | Paragraph/sentence split, integration |

### Frontend (vitest + MSW)

| Suite | Tests | Covers |
|-------|-------|--------|
| useToast | 3 | Timer, replacement |
| useProfiles | 4 | CRUD against MSW |
| Slider | 3 | Render, a11y, onChange |
| Toast | 3 | Render, role, visibility |
| i18n | 3 | ES/EN key parity |
| App e2e | 8 | Navigation, synthesis, profiles, language |

## Requirements

### System
- Python 3.10+
- Node.js 18+
- ffmpeg (required for WAV/OGG/FLAC; MP3 works without it)

### Installation

```bash
# Backend
pip install fastapi uvicorn edge-tts pydub aiofiles python-multipart pydantic-settings

# If using Python 3.13+
pip install audioop-lts

# Frontend
npm install
```

### Running

```bash
# Terminal 1: backend
python -m uvicorn backend:app --reload --port 8000

# Terminal 2: frontend
npm run dev
```

Open **http://localhost:3000**. The frontend proxies `/api/*` to the backend.

### Environment Variables (optional)

```env
VOXFORGE_CORS_ORIGINS=["http://localhost:3000"]
VOXFORGE_MAX_TEXT_LENGTH=500000
VOXFORGE_CHUNK_MAX_CHARS=3000
VOXFORGE_CLEANUP_MAX_AGE_HOURS=24
VITE_API_BASE=/api
```

## Design Rationale

### Why Edge-TTS as the primary engine
- High-quality Microsoft neural voices, free of charge
- Native Spanish support (Spain, Mexico, Argentina, Colombia) and English (US, UK, AU)
- Adjustable parameters: speed, pitch, volume
- No GPU or local model required

### Why chunking instead of streaming
- Edge-TTS doesn't reliably support partial streaming for long audio
- Chunking uses paragraphs as natural narration units
- 400ms pauses between segments improve the listening experience for stories
- The final output is a single downloadable audio file (more practical for audiobooks)

### Format handling
- Edge-TTS generates native MP3
- pydub + ffmpeg convert on demand to WAV, OGG, FLAC
- MP3 works without ffmpeg installed

## Roadmap

- [ ] WebSocket streaming for progressive playback
- [ ] Job queue (Celery/Redis) for concurrent synthesis
- [ ] SSML support (Speech Synthesis Markup Language)
- [ ] Batch processing for full documents
- [ ] Migration from JSON to SQLite
- [ ] Secondary XTTS v2 engine for voice cloning (requires GPU)
- [ ] CI/CD with lint + typecheck + tests
