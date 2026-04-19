# VoxForge — Development Guide

Local-first audiobook production workbench. Python backend (FastAPI + Edge-TTS + XTTS v2 + OpenVoice V2), React frontend (TypeScript strict).

## Current Architecture

```
backend/              -> Modular FastAPI package (routers, services, schemas)
src/                  -> React + TypeScript SPA (components, hooks, features)
data/                 -> Runtime storage (voices, profiles, output, temp, logs, SQLite)
```

HTTP contract: backend exposes snake_case (`voice_id`, `sample_filename`), frontend works in camelCase. Normalization lives in `api/profiles.ts` — keep this as the single translation point.

## Commands

```bash
# Backend
python -m uvicorn backend:app --reload --port 8000

# Backend tests
python -m pytest -xvs

# Frontend
npm run dev
npm run typecheck
npm test

# Regenerate TS types from backend's OpenAPI schema
npm run openapi
```

## Dependencies files

- `requirements.txt` — full production install (torch, coqui-tts, etc.)
- `requirements-ci.txt` — lean set for CI / tests. Heavy ML packages
  (`torch`, `coqui-tts`, `openvoice`, `edge-tts`, `pydub`) are stubbed in
  `tests/conftest.py` so CI doesn't need them.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every PR:

- **Backend job**: installs `requirements-ci.txt`, runs `pytest`, then
  regenerates `schema/openapi.json` and fails if it drifted.
- **Frontend job**: `npm ci`, `npm run typecheck`, `npm test`, then
  regenerates `src/api/generated.ts` and fails if it drifted.

If CI fails on the schema/types check, run `npm run openapi` locally
and commit the result.

---

## Cross-cutting Principles

1. **Clarity over cleverness**. Explicit code > premature abstractions. Three similar lines are better than a wrong abstraction.
2. **Fail fast and loud** at system boundaries (user input, external API). Trust internal code.
3. **One responsibility per module/function**. If the name needs "and", split it.
4. **No dead code**: no commented-out code, unused imports, `_unused` variables as historical memory. `git` is the memory.
5. **Don't duplicate contracts**: an endpoint's schema lives in one place (Pydantic) and derives toward the client.

---

## Python — Backend

### Current Structure

```
backend/
├── __init__.py
├── main.py              # create_app(): FastAPI + lifespan + middlewares + routers
├── config.py            # Settings via pydantic-settings (BaseSettings)
├── database.py          # SQLite schema (projects, chapters, generations, takes)
├── schemas.py           # Pydantic models (request, persistence, response)
├── catalogs.py          # Curated voices + audio formats (TypedDict)
├── exceptions.py        # Domain exceptions + friendly messages + global HTTP handler
├── dependencies.py      # Injectable singletons via Depends()
├── paths.py             # BASE_DIR, DATA_DIR, etc.
├── logging_config.py    # Structured logging: text + JSONL + colored console
├── middleware.py         # RequestIdMiddleware + AccessLogMiddleware
├── gpu_lock.py          # Shared GPU semaphore (1 inference at a time)
├── cancellation.py      # CancellationToken for client disconnect detection
├── upload_utils.py      # validate_audio_upload, validate_document_upload, chunked reader
├── utils.py             # Temporary file cleanup
├── services/
│   ├── tts_engine.py        # Dual engine: Edge-TTS + XTTS v2 routing + chunking
│   ├── clone_engine.py      # XTTS v2 with candidates, scoring, retries, silence trim
│   ├── convert_engine.py    # OpenVoice V2 tone color converter
│   ├── voice_lab_engine.py  # DSP suite (pedalboard, parselmouth, librosa)
│   ├── audio_editor.py      # Stateless pydub batch editor (Studio module)
│   ├── profile_manager.py   # JSON CRUD with asyncio.Lock + atomic writes
│   ├── project_manager.py   # SQLite CRUD for projects/chapters/generations/takes
│   ├── text_normalizer.py   # Spanish normalization (abbreviations, numbers, siglas)
│   ├── pronunciation.py     # User pronunciation dictionary (whole-word overrides)
│   ├── character_parser.py  # [Character] markup parser for dialogue casting
│   ├── ssml_lite.py         # SSML-lite tag parser ([pause], [emph], [whisper])
│   ├── metadata.py          # ID3/Vorbis/FLAC tag embedding via mutagen
│   ├── progress.py          # In-memory job progress registry
│   └── job_store.py         # Crash-safe job persistence to disk
└── routers/
    ├── synthesis.py          # POST /api/synthesize + progress + resume
    ├── voices.py             # Catalog + sample upload/serve (path traversal protected)
    ├── profiles.py           # CRUD /api/profiles
    ├── projects.py           # CRUD /api/projects + chapters + split
    ├── chapter_synth.py      # Per-chapter synthesis + chunk map + regen
    ├── batch_export.py       # ZIP export of all chapters
    ├── character_synth.py    # Character-cast multi-voice synthesis
    ├── conversion.py         # Voice conversion (audio-to-audio)
    ├── voice_lab.py          # DSP processing + presets
    ├── studio.py             # Audio editor: sources / apply ops / serve audio
    ├── analyze.py            # Voice sample quality analysis
    ├── pronunciation.py      # Pronunciation dictionary CRUD
    ├── preprocess.py         # Text normalization + document upload
    ├── experimental.py       # Cross-lingual cloning
    ├── logs.py               # Log viewer + error count
    ├── stats.py              # Usage statistics
    └── health.py             # Service status
```

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

### Errors

- Services raise domain exceptions (`ProfileNotFound`, `SynthesisError`, etc.).
- `exceptions.py` has a `_USER_FRIENDLY_MESSAGES` map that translates codes to user-facing English text.
- Global handler returns `{"detail": friendly, "code": machine, "technical": original}`.
- Never silent `except Exception:` without log + re-raise or specific response.
- No `print`. Use the module's `logger`.

### Persistence

- **Profiles**: JSON file with `asyncio.Lock` + atomic writes (`tmp` + `os.replace`).
- **Projects/Chapters/Generations/Takes**: SQLite via `aiosqlite` (WAL mode, foreign keys).
- **Pronunciations**: JSON file with `asyncio.Lock` + atomic writes.
- **Logs**: rotating file handlers (text + JSONL), 10MB x 5 backups.
- **Jobs**: per-job JSON record + chunk directory in `data/jobs/`.

### Logging

- `logging_config.py` sets up 4 handlers: app.log (text), app.jsonl (JSON Lines), errors.log (WARNING+), stdout (colored).
- Every log record carries `request_id` via contextvar, set by `RequestIdMiddleware`.
- `AccessLogMiddleware` logs `METHOD /path -> STATUS (Nms)` for every request.
- JSONL format: `{"ts": "...", "level": "INFO", "logger": "backend.access", "msg": "...", "rid": "abc123", "exc": "..."}`.
- Seek-based tail in the logs endpoint reads only the last 512KB, not the full file.

### GPU Concurrency

- `gpu_lock.py` exports a shared `asyncio.Semaphore(1)`.
- `CloneEngine`, `ConvertEngine`, and experimental router all acquire this semaphore before GPU inference.
- `asyncio.wait_for(timeout=600s)` prevents hung requests.

### Testing

- `pytest` + `httpx.AsyncClient` with `ASGITransport`.
- 86 tests, 95%+ coverage.
- Stubs for edge_tts, pydub, torch, openvoice.
- Fixtures with `tmp_path` for isolated `data/` directories.

---

## TypeScript / React — Frontend

### Current Structure

```
src/
├── App.tsx                    # Orchestrator: tabs, global state, header, nav with error badge
├── main.tsx                   # Entry: ErrorBoundary + global error handlers + logger init
├── api/
│   ├── client.ts              # Centralized fetch with logging + X-Request-ID
│   ├── types.ts               # DTO aliases re-exporting from generated.ts
│   ├── generated.ts           # AUTO — run `npm run openapi` after schema edits
│   ├── profiles.ts            # Profile CRUD (normalizes to camelCase)
│   ├── synthesis.ts           # Synthesis + progress polling + resume + incomplete
│   ├── conversion.ts          # Voice conversion
│   ├── voiceLab.ts            # Lab processing + presets
│   ├── projects.ts            # Projects + chapters CRUD
│   ├── chapterSynth.ts        # Chapter synthesis + chunk map + regen
│   ├── studio.ts              # Studio sources + apply-edit + serve-audio URL
│   ├── pronunciation.ts       # Pronunciation dict CRUD
│   ├── logs.ts                # Server logs + error count + stats
│   └── preprocess.ts          # Text normalization
├── types/
│   └── domain.ts              # Domain types (Profile, Voice, SynthesisParams, ExportSettings)
├── logging/
│   └── logger.ts              # FE logger: ring buffer + sessionStorage + global handlers
├── components/
│   ├── Button.tsx             # Primitive: 6 variants, 3 sizes, loading state
│   ├── IconButton.tsx         # Circular variant; aria-label required
│   ├── Card.tsx               # Surface primitive with padding/glass/subtle
│   ├── Skeleton.tsx           # Shimmer placeholder
│   ├── EmptyState.tsx         # Hero empty-state block (icon + title + action)
│   ├── Breadcrumb.tsx         # Nav path breadcrumb
│   ├── PromptDialog.tsx       # Accessible window.prompt replacement
│   ├── Slider.tsx             # Accessible range input with info tooltip
│   ├── InteractivePlayer.tsx  # Scrubber, +/-10s, playback rates, time display
│   ├── WaveformEditor.tsx     # wavesurfer.js interactive waveform with regions
│   ├── WaveformVisualizer.tsx # DPR-aware animated canvas (decorative)
│   ├── ErrorBoundary.tsx      # Friendly crash UI (navigator.language → locale)
│   ├── AudioRecorder.tsx      # Microphone recording (MediaRecorder API)
│   ├── Toast.tsx              # Toast stack with per-type icons + progress bar
│   └── icons.tsx              # Inline SVGs
├── hooks/
│   ├── useProfiles.ts         # Load + remote CRUD
│   ├── useSynthesis.ts        # Progress polling + API call + engine tracking
│   ├── useAudioPlayer.ts      # Blob URL + play/pause/stop/seek/skip/rate
│   ├── useDraftPersistence.ts # Autosave text to localStorage
│   ├── useExportSettings.ts   # ID3 metadata + filename pattern (localStorage)
│   ├── useCustomLabPresets.ts # Save/load custom DSP presets (localStorage)
│   ├── useVoicePreview.ts     # Live voice demo
│   ├── useSamplePlayer.ts     # Play samples from backend
│   ├── useErrorBadge.ts       # Polls /logs/error-count for nav badge
│   └── useToast.ts            # Timer + notification state
├── features/
│   ├── tabs.ts                # Tab type + order + old-to-new mapping
│   ├── state.ts               # Shared SynthSettings + ProfileDraft interfaces
│   ├── projects/              # Workbench (default tab)
│   │   ├── WorkbenchTab.tsx   # Sidebar + chapter cards
│   │   ├── ChunkMap.tsx       # Per-chapter chunk list + regen
│   │   ├── CharacterCasting.tsx  # [Character] markup detector + cast UI
│   │   ├── QuickPreview.tsx   # First-300-chars audition
│   │   └── AmbienceMixer.tsx  # 2-track narration + ambient mix
│   ├── quick-synth/           # Quick TTS + cross-lingual mode
│   │   ├── QuickSynthTab.tsx  # Mode toggle wrapper
│   │   ├── SynthTab.tsx       # Standard TTS panel (editor, player, export)
│   │   └── ExperimentalTab.tsx # Cross-lingual cloning panel
│   ├── voices-unified/        # Voices, profiles, compare in one tab
│   │   ├── VoicesUnifiedTab.tsx  # Sections + quality analyzer wiring
│   │   ├── VoicesTab.tsx      # System voices grid + sample upload
│   │   ├── ProfilesTab.tsx    # Profile cards
│   │   └── CompareTab.tsx     # A/B + quick preview all profiles
│   ├── audio-tools/           # Voice conversion + DSP effects
│   │   ├── AudioToolsTab.tsx  # Mode toggle wrapper
│   │   ├── ConvertTab.tsx     # OpenVoice change-voice mode
│   │   └── LabTab.tsx         # DSP effects mode
│   ├── studio/                # Post-production audio editor (Phase A)
│   │   ├── StudioTab.tsx          # Layout: source picker + waveform + queue + result
│   │   ├── SourcePicker.tsx       # List of done chapter generations
│   │   ├── StudioWaveform.tsx     # wavesurfer.js + regions plugin (drag-to-select)
│   │   ├── EditOperationsPanel.tsx # Add ops, reorder, apply batch
│   │   └── useStudioSession.ts    # Client-side op queue + apply + download
│   └── activity/              # Activity dashboard + settings + dev logs
│       ├── ActivityTab.tsx    # Recent gens, errors, disk usage
│       ├── SettingsSection.tsx # Pronunciation + export defaults (collapsible)
│       ├── PronunciationTab.tsx # Pronunciation dictionary editor
│       └── LogsTab.tsx        # Developer logs (hidden behind toggle)
├── i18n/
│   ├── es.ts, en.ts, index.ts     # Typed translations
├── constants/voices.ts
├── theme/tokens.ts
└── types/domain.ts
```

### Tab structure

The 6 user-facing tabs are organized by workflow, not by underlying technology:

| Tab | Purpose |
|-----|---------|
| **Workbench** | Default. Project + chapter authoring with chunk map, character casting, ambient mix, batch export. |
| **Quick Synth** | One-shot TTS for quick tests. Toggle for cross-lingual cloning mode. |
| **Voices** | System voices, custom profiles, A/B comparison, sample quality analyzer — all in one place. |
| **Audio Tools** | Two modes: Change Voice (OpenVoice) and Effects (DSP chain). |
| **Studio** | Post-production audio editor: load a chapter generation, select a waveform region, queue trim / delete / fade / normalize operations, apply the batch and download. |
| **Activity** | Recent generations, errors, disk usage. Collapsible Settings (pronunciation + export defaults). Developer logs hidden behind a small toggle. |

### API Client

- `client.ts` wraps all `fetch` calls with:
  - Auto-generated `X-Request-ID` header (correlates with backend logs)
  - Structured logging of every request/response with timing
  - Typed `ApiError` with `status`, `code`, `requestId`
- `synthesis.ts` sends `X-Synthesis-Job-ID` for per-chunk progress tracking.

### Logging (Frontend)

- `logging/logger.ts`: ring buffer (500 entries), persisted to `sessionStorage` (survives reload).
- `installGlobalErrorHandlers()`: catches `window.error` + `unhandledrejection`.
- `ErrorBoundary`: catches React render errors, logs to buffer, shows recovery UI.
- User actions logged: synthesis start, file upload, voice conversion, lab processing.
- `useErrorBadge()`: polls `/api/logs/error-count` every 30s, shows count on Logs tab.

### State and Effects

- `useState` only for local UI state. Remote state -> dedicated hooks.
- `useEffect` with complete deps arrays. Cleanup functions for timers, blob URLs, subscriptions.
- `useCallback`/`useMemo` only when there's a real performance issue.

### Styles

Current code uses inline styles with design tokens from `theme/tokens.ts`. Future: migrate to CSS Modules or Tailwind.

### i18n

- Typed per-language files. `type TranslationKey = keyof typeof es`.
- Adding a key in `es.ts` forces adding it in `en.ts` (compile error if missing).

### Testing

- `vitest` + `@testing-library/react` + `happy-dom`.
- 26 tests covering components, hooks, i18n parity.
- MSW for API mocking.

---

## Common Conventions

### Git
- Commits in imperative, in English. Format: `type: description`.
- One commit = one logical change.
- Never `--no-verify`.

### Documentation
- `CLAUDE.md` = how we work. `README.md` = what it is and how to run it.
- `AUDIT_REPORT.md` = QA + product audit (historical reference).

### Secrets
- Never hardcode URLs, API keys, or credentials.
- `.env` in `.gitignore`. `.env.example` gets committed.

### Dependencies (Python)
Core: `fastapi`, `uvicorn`, `edge-tts`, `pydub`, `aiofiles`, `python-multipart`, `pydantic-settings`, `aiosqlite`, `mutagen`.
GPU: `torch`, `torchaudio`, `coqui-tts`, `transformers`, `openvoice`.
DSP: `pedalboard`, `praat-parselmouth`, `librosa`, `noisereduce`.
Python 3.13+: `audioop-lts`.

### Dependencies (Node)
Core: `react`, `react-dom`, `wavesurfer.js`.
Dev: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `happy-dom`, `msw`.

---

## Refactor Plan (order)

1. ~~Backend: extract Settings + modularize into backend/ package with routers.~~ Done.
2. ~~Backend: add response_model + global exception handler.~~ Done.
3. ~~Backend: lock in ProfileManager + atomic writes.~~ Done.
4. ~~Backend: minimal pytest suite.~~ Done (86 tests).
5. ~~Frontend: strict TS + migrate to TSX.~~ Done.
6. ~~Frontend: split into components/, features/, hooks/, api/.~~ Done.
7. **Frontend**: extract inline styles to unified system (CSS Modules or Tailwind).
8. ~~Frontend: generate types from backend's OpenAPI schema.~~ Done (`schema/openapi.json` + `src/api/generated.ts` via `npm run openapi`).
9. ~~Both: CI with typecheck + tests before merge.~~ Done (`.github/workflows/ci.yml`).

---

## Feature Implementation Status

### Tier 1 (Quick Wins) — All Done
Autosave, duration estimate, keyboard shortcuts, interactive player, ID3 metadata + filename pattern, custom Lab presets, real per-chunk progress, pronunciation dictionary, crash-safe resume.

### Tier 2 (Workbench) — All Done
SQLite migration, chapter manager, chunk map + per-chunk regen, A/B comparison, multi-voice preview, batch export, character casting, sample analyzer, multiple samples per profile, friendly error messages.

### Tier 3 (Transformative) — Partially Done
Done: wavesurfer.js editor component, SSML-lite parser.
Pending (exploratory): emotion conditioning, IPA phoneme dictionary, project templates, ambience tracks, F5-TTS/Zonos evaluation.
