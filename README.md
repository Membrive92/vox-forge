# VoxForge — Voice Synthesis Engine

VoxForge is a web application for converting text to high-quality audio with voice cloning support. It combines Microsoft's neural voices (Edge-TTS) for instant synthesis with XTTS v2 for cloning your own voice from a 30-second sample. Designed for narrating stories, audiobooks, and long-form content, it supports texts up to 500,000 characters with automatic segmentation and natural pauses.

## Features

- **Dual engine synthesis**: Edge-TTS (Microsoft neural voices) for instant generation, XTTS v2 for voice cloning
- **Voice cloning**: upload a 6-30 second audio sample of any voice, then generate text narrated in that voice
- **12 built-in voices**: 6 Spanish (Spain, Mexico, Argentina, Colombia) + 6 English (US, UK, AU)
- **Long text support**: automatic chunking by paragraphs and sentences, with natural pauses between segments
- **Multiple formats**: MP3, WAV, OGG, FLAC output
- **Voice profiles**: save voice + speed + pitch + volume + sample combinations for reuse
- **Live preview**: listen to a demo of any voice before generating
- **Bilingual UI**: full interface in Spanish and English

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
               +-----------------+-----------------+
               |                 |                 |
        +------+------+  +------+------+  +-------+-----+
        |  TTSEngine  |  |   Profile   |  |   Voices    |
        | (dual mode) |  |   Manager   |  |   Catalog   |
        +------+------+  +------+------+  +-------------+
               |                 |
     +---------+---------+      |
     |                   |      |
+----+-----+  +----+-----+ +---+------+
| Edge-TTS |  | XTTS v2  | |  JSON    |
| (system  |  | (voice   | |  Store   |
|  voices) |  | cloning) | +----------+
+----------+  +----+-----+
                   |
              +----+-----+
              |   CUDA   |
              |   GPU    |
              +----------+
```

### Dual Engine Routing

When you generate audio, the engine is selected automatically:

```
Request with profile_id
        |
   Profile has voice sample on disk?
        |               |
       YES              NO
        |               |
   XTTS v2           Edge-TTS
   (your voice)      (Microsoft voice)
        |               |
   Chunking          Chunking
   (500ms pause)     (400ms pause)
        |               |
   GPU synthesis     Cloud synthesis
        |               |
        +-------+-------+
                |
          Single audio file
```

## Voice Cloning

### How it works

1. **Record a sample**: 6-30 seconds of clean speech (no background noise, single speaker)
2. **Create a profile**: upload the sample in the Voices tab, name it, and save
3. **Use the profile**: click "Use" on the profile card, which activates clone mode
4. **Generate audio**: write text and generate — XTTS v2 synthesizes it in your voice

### Sample requirements

| Property | Requirement |
|----------|-------------|
| Format | WAV preferred (MP3 also works) |
| Duration | 6-30 seconds (optimal ~15s) |
| Quality | Clean speech, minimal background noise |
| Speaker | Single speaker only |
| Content | Natural speech with varied intonation |

### Performance (RTX 4070 SUPER 12GB)

| Text length | Chunks | Generation time | Audio output |
|-------------|--------|-----------------|--------------|
| 1 paragraph (~500 chars) | 1 | ~3-5 seconds | ~30s audio |
| Short story (~5000 chars) | 2-3 | ~15-20 seconds | ~5min audio |
| Full story (~70,000 chars) | ~25 | ~1-3 minutes | ~15-20min audio |

The XTTS v2 model (~1.8GB) downloads automatically on first use and is cached in `%APPDATA%\Local\tts\`. Subsequent launches load from cache in ~5-10 seconds.

### Technical details

- **Model**: XTTS v2 (Coqui TTS fork by Idiap) — GPT-based autoregressive voice synthesis
- **Backend service**: `CloneEngine` with lazy model loading (loads on first clone request, not at startup)
- **Processing**: synthesis runs on GPU via `asyncio.to_thread` to avoid blocking the event loop
- **Languages**: Spanish and English supported natively by the model

## Backend Architecture (Python)

```
backend/
├── __init__.py              # Exposes `app` for uvicorn
├── main.py                  # create_app(): FastAPI + CORS + routers
├── config.py                # Settings via pydantic-settings (VOXFORGE_*)
├── checks.py                # Startup checks (ffmpeg detection)
├── paths.py                 # Runtime directories (data/voices, output, temp)
├── catalogs.py              # Curated voices + audio formats (TypedDict)
├── schemas.py               # Pydantic models (request, persistence, response)
├── exceptions.py            # Domain exceptions + global HTTP handler
├── dependencies.py          # Injectable singletons via Depends()
├── utils.py                 # Temporary file cleanup
├── services/
│   ├── tts_engine.py        # Dual engine: Edge-TTS + XTTS v2 routing
│   ├── clone_engine.py      # XTTS v2 voice cloning with lazy GPU loading
│   └── profile_manager.py   # CRUD with asyncio.Lock + atomic writes
└── routers/
    ├── synthesis.py          # POST /api/synthesize
    ├── voices.py             # GET /api/voices, upload/serve samples
    ├── profiles.py           # CRUD /api/profiles
    └── health.py             # GET /api/health
```

### Key Decisions

- **Dual engine routing**: `TTSEngine.synthesize()` checks if the profile has a voice sample file on disk. If yes, routes to `CloneEngine` (XTTS v2 on GPU). If no, routes to Edge-TTS (Microsoft cloud).
- **Lazy model loading**: `CloneEngine` doesn't load the 1.8GB model at startup. It loads on first clone request and stays resident in GPU memory.
- **Layered architecture**: routers (HTTP) -> services (logic) -> domain exceptions. Routers never touch disk directly.
- **Domain exceptions**: `ProfileNotFound`, `UnsupportedVoiceError`, `SynthesisError` are translated to HTTP responses in a global handler.
- **Concurrency**: `ProfileManager` uses `asyncio.Lock` and atomic writes (`tmp` + `os.replace`) to prevent JSON corruption.
- **Chunking**: long texts are split by paragraphs, then by sentences if a paragraph exceeds 3000 chars. Chunks are synthesized separately and concatenated.
- **Startup checks**: `checks.py` verifies ffmpeg availability at boot, auto-detects local install in `tools/ffmpeg/`.

### API

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/synthesize` | Text to audio (auto-routes to Edge-TTS or XTTS v2) |
| GET | `/api/voices` | Curated voice catalog |
| GET | `/api/voices/all` | All Edge-TTS voices |
| POST | `/api/voices/upload-sample` | Upload audio sample |
| GET | `/api/voices/samples/{filename}` | Serve sample |
| GET | `/api/profiles` | List profiles |
| GET | `/api/profiles/{id}` | Get profile |
| POST | `/api/profiles` | Create profile (multipart, with optional sample) |
| PATCH | `/api/profiles/{id}` | Update profile |
| DELETE | `/api/profiles/{id}` | Delete profile |
| GET | `/api/health` | Service status |

### Synthesis Response Headers

| Header | Example | Description |
|--------|---------|-------------|
| `X-Audio-Duration` | `125.3` | Audio duration in seconds |
| `X-Audio-Size` | `2048576` | File size in bytes |
| `X-Audio-Chunks` | `25` | Number of text segments processed |
| `X-Audio-Engine` | `xtts-v2` | Engine used (`edge-tts` or `xtts-v2`) |
| `X-Text-Length` | `70000` | Input text length in characters |

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
│   └── domain.ts              # Domain types (Profile, Voice, SynthesisParams)
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
│   ├── useSynthesis.ts        # Progress + API call + engine tracking
│   ├── useVoicePreview.ts     # Live voice demo
│   ├── useSamplePlayer.ts     # Play samples from backend
│   └── readAudioDuration.ts   # Local file metadata reader
└── features/
    ├── state.ts               # Shared interfaces (SynthSettings with activeProfileId)
    ├── synth/SynthTab.tsx     # Editor + player + controls + clone indicator
    ├── voices/VoicesTab.tsx   # Upload + voice browser + profile form
    └── profiles/ProfilesTab.tsx # Profile cards with actions
```

### Key Decisions

- **Strict TypeScript**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, zero `any`.
- **Active profile tracking**: `activeProfileId` in state triggers clone mode. Selecting a system voice clears it. Orange banner indicates clone mode is active.
- **Engine badge**: after generation, a "CLONED" (orange) or "EDGE-TTS" (blue) badge shows which engine was used.
- **Single normalization layer**: `snake_case` to `camelCase` translation lives exclusively in `api/profiles.ts`.
- **Typed i18n**: adding a key in `es.ts` forces adding it in `en.ts` (compile error if missing).
- **Hooks as logic**: each concern (audio, profiles, synthesis, toast) is an independent hook.
- **Accessibility**: `aria-label` on icon-only buttons, `role="status"` on toast, `role="button"` on drop zone.

## Tests

```bash
# Backend: 69 tests, 95% coverage
pytest

# Frontend: 26 tests
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
| test_synthesis | 7 | Audio, formats, profiles, engine header |
| test_uploads | 7 | Upload, attach, replace, serve, cleanup |
| test_services | 12 | ProfileManager, TTSEngine helpers |
| test_chunking | 10 | Paragraph/sentence split, integration |
| test_clone_engine | 21 | CloneEngine unit, dual routing, API integration |

### Frontend (vitest + MSW)

| Suite | Tests | Covers |
|-------|-------|--------|
| useToast | 3 | Timer, replacement |
| useProfiles | 4 | CRUD against MSW |
| Slider | 3 | Render, a11y, onChange |
| Toast | 3 | Render, role, visibility |
| i18n | 3 | ES/EN key parity |
| App e2e | 10 | Navigation, synthesis, profiles, language, engine badge |

## Requirements

### System
- Python 3.10+
- Node.js 18+
- ffmpeg (required for audio processing)
- NVIDIA GPU with 4GB+ VRAM (required for voice cloning only; Edge-TTS works without GPU)

### Installation

```bash
# 1. Backend dependencies
pip install fastapi uvicorn edge-tts pydub aiofiles python-multipart pydantic-settings

# If using Python 3.13+
pip install audioop-lts

# 2. ffmpeg (required for audio concatenation and format conversion)
python scripts/setup_ffmpeg.py    # Auto-downloads on Windows, no admin needed

# Or install manually:
#   Windows (admin): choco install ffmpeg
#   macOS:           brew install ffmpeg
#   Linux:           sudo apt install ffmpeg

# 3. Voice cloning (optional — requires NVIDIA GPU with CUDA)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install coqui-tts
pip install "transformers>=4.43,<5"
# The XTTS v2 model (1.8GB) downloads automatically on first use

# 4. Frontend
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
- Instant generation via cloud

### Why XTTS v2 for voice cloning
- Best open-source quality for few-shot voice cloning
- Native Spanish and English support
- Only needs 6-30 seconds of reference audio
- Runs locally on GPU — no data sent to external services
- Free and open-source (Coqui CPML license for non-commercial use)

### Why dual engine instead of one
- Edge-TTS is faster and doesn't need GPU — ideal for quick previews and system voices
- XTTS v2 produces personalized output but is slower and needs GPU
- The routing is automatic: profiles with voice samples use XTTS v2, everything else uses Edge-TTS
- Users can switch between engines by simply using or not using a cloned profile

### Why chunking instead of streaming
- Neither Edge-TTS nor XTTS v2 reliably supports partial streaming for long audio
- Chunking uses paragraphs as natural narration units
- Pauses between segments (400ms Edge-TTS, 500ms XTTS) improve story narration
- The final output is a single downloadable file (practical for audiobooks)

### Format handling
- Edge-TTS generates native MP3; XTTS v2 generates native WAV
- pydub + ffmpeg convert and concatenate to the requested format
- ffmpeg is auto-installed via `scripts/setup_ffmpeg.py` (no admin needed on Windows)

## Roadmap

- [ ] WebSocket streaming for progressive playback
- [ ] Job queue (Celery/Redis) for concurrent synthesis
- [ ] SSML support (Speech Synthesis Markup Language)
- [ ] Batch processing for full documents
- [ ] Migration from JSON to SQLite
- [ ] CI/CD with lint + typecheck + tests
- [ ] Voice sample quality analyzer (SNR, duration check)
- [ ] Multiple reference samples per profile for better cloning
