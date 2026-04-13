# VoxForge — Voice Synthesis Engine

VoxForge is a local-first audiobook production workbench for narrating fantasy stories in Spanish. It combines Microsoft's neural voices (Edge-TTS) for instant synthesis with XTTS v2 for cloning your own voice from a short sample, plus OpenVoice V2 for audio-to-audio voice conversion. Designed for texts up to 500,000 characters with automatic segmentation, natural pauses, and per-chunk regeneration.

## Features

### Synthesis
- **Dual engine**: Edge-TTS (12 built-in neural voices) for instant generation, XTTS v2 for voice cloning from a 6-30s sample
- **Long text support**: automatic chunking with sentence-aware splitting and natural pauses (200ms comma / 500ms sentence / 900ms paragraph)
- **Real-time progress**: per-chunk tracking via polling — shows `cloning 7/23` instead of a fake progress bar
- **Crash-safe resume**: interrupted jobs persist to disk and can be resumed from the last completed chunk
- **Spanish text normalization**: abbreviations (Dr. -> Doctor), numbers to words, ALL-CAPS handling, siglas (ONU -> O ene u), roman numerals
- **Pronunciation dictionary**: custom word -> phonetic replacement rules for fantasy names the TTS mispronounces
- **SSML-lite markup**: `[pause 2s]`, `[emph]`, `[whisper]`, `[rate 0.9]`, `[loud]`, `[soft]` tags in text
- **ID3 metadata embedding**: title, artist, album, track number embedded in MP3/OGG/FLAC output via mutagen
- **Configurable filenames**: pattern with tokens `{story}_{track}_{date}.{fmt}`

### Workbench (Project Mode)
- **Projects + chapters**: SQLite-backed storage for stories with chapter management
- **Chapter splitting**: split full text by `# headings` or `---` separators
- **Chunk map + per-chunk regen**: see every chunk of a chapter, regenerate any single chunk without re-running the whole chapter
- **Batch export**: synthesize all chapters of a project into a numbered ZIP with ID3 tags
- **Character casting**: `[Narrator]` / `[Kael]` markup routes each character's lines to a different voice profile
- **Generation history**: every synthesis run is recorded with its chunks and takes in the database

### Voice Tools
- **Voice conversion** (OpenVoice V2): change the timbre of an existing recording to another voice
- **Voice Lab**: 8-parameter DSP suite (noise reduction, pitch, formants, bass, warmth, compression, reverb, speed) with 12 built-in presets + saveable custom presets
- **A/B comparison**: same text, two profiles side by side
- **Quick preview**: generate first 300 chars against all profiles at once to audition voices
- **Sample quality analyzer**: SNR, clipping, silence ratio, duration check with quality rating
- **Cross-lingual cloning** (experimental): generate text in one language using a voice sample from another

### Monitoring
- **Structured logging**: rotating text + JSON Lines logs with request ID correlation end-to-end
- **Access log**: every HTTP request logged with method, path, status, duration
- **Logs tab**: server/client sub-tabs with request-ID filtering, level filtering, auto-refresh (5s)
- **Error badge**: red count on the Logs tab when errors occur in the last hour
- **Stats dashboard**: requests, syntheses, errors, latency, top endpoints, engines used
- **Frontend logger**: ring buffer persisted in sessionStorage (survives reload), global error + unhandled rejection capture
- **ErrorBoundary**: catches React render crashes with recovery UI

### UX
- **Autosave**: draft text persisted to localStorage with 1s debounce
- **Duration estimate**: `~ 4m 20s of audio` next to character count
- **Keyboard shortcuts**: Ctrl+Enter (generate), Ctrl+S (download), Space (play/pause)
- **Interactive player**: scrubber, +/-10s, playback rates 0.75x-2x, current/total time
- **Bilingual UI**: Spanish and English with typed i18n (compile error if a key is missing)

## System Architecture

```
Frontend (React + TypeScript)         Backend (FastAPI + Python)
http://localhost:5173                 http://localhost:8000
       |                                     |
  Vite proxy /api/* ─────────────────> FastAPI routers
       |                                     |
  5 tabs (workflow-oriented):       ┌────────┼──────────┐
  ┌─────────────────────────┐       │  Services          │
  │ Workbench (default)     │       │  ├─ TTSEngine      │
  │  ├─ Projects + chapters │       │  ├─ CloneEngine    │
  │  ├─ Quick Preview       │       │  ├─ ConvertEngine  │
  │  ├─ Chunk Map + regen   │       │  ├─ VoiceLabEngine │
  │  ├─ Character Casting   │       │  ├─ ProjectManager │
  │  └─ Ambient Mixer       │       │  ├─ ProfileManager │
  ├─────────────────────────┤       │  ├─ Pronunciation  │
  │ Quick Synth             │       │  ├─ Ambience       │
  │  ├─ Standard mode       │       │  └─ JobStore       │
  │  └─ Cross-lingual mode  │       │                    │
  ├─────────────────────────┤       │  Persistence       │
  │ Voices                  │       │  ├─ SQLite (projects)
  │  ├─ System voices       │       │  ├─ JSON (profiles)
  │  ├─ My profiles         │       │  ├─ JSON (pronunciations)
  │  └─ Compare A/B         │       │  ├─ JSON (ambience meta)
  ├─────────────────────────┤       │  └─ Rotating logs  │
  │ Audio Tools             │       └────────────────────┘
  │  ├─ Change Voice        │                |
  │  └─ Effects             │   ┌────────────┼────────────┐
  ├─────────────────────────┤   │            │            │
  │ Activity                │ Edge-TTS    XTTS v2    OpenVoice V2
  │  ├─ Recent generations  │ (cloud)   (GPU local)  (GPU local)
  │  ├─ Errors / disk       │
  │  ├─ Settings            │
  │  └─ Developer logs      │
  └─────────────────────────┘
```

## Requirements

### System
- Python 3.10+ (tested on 3.13)
- Node.js 18+ (tested on 22)
- ffmpeg (required for audio processing)
- NVIDIA GPU with 4GB+ VRAM (for voice cloning and conversion only; Edge-TTS works without GPU)

### Installation

```bash
# 1. Backend core
pip install fastapi uvicorn edge-tts pydub aiofiles python-multipart pydantic-settings aiosqlite mutagen

# Python 3.13+ needs audioop shim
pip install audioop-lts

# 2. ffmpeg
python scripts/setup_ffmpeg.py    # Auto-downloads on Windows

# 3. Voice cloning (optional — requires NVIDIA GPU with CUDA)
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install coqui-tts
pip install "transformers>=4.43,<5"

# 4. Voice conversion (optional — requires NVIDIA GPU)
pip install openvoice --no-deps

# 5. Voice Lab DSP (optional)
pip install pedalboard praat-parselmouth librosa noisereduce

# 6. Frontend
npm install
```

### Running

```bash
# Terminal 1: backend
python -m uvicorn backend:app --reload --port 8000

# Terminal 2: frontend
npm run dev
```

Open **http://localhost:5173**. The frontend proxies `/api/*` to the backend.

### Tests

```bash
# Backend: 86 tests
python -m pytest -xvs

# Frontend: 26 tests
npm test

# TypeScript strict check
npm run typecheck

# All together
python -m pytest -q && npm test -- --run && npm run typecheck
```

## API Overview

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/synthesize` | Text to audio (auto-routes Edge-TTS or XTTS v2) |
| GET | `/api/synthesize/progress/{job_id}` | Real-time chunk progress |
| GET | `/api/synthesize/incomplete` | List crashed/interrupted jobs |
| POST | `/api/synthesize/resume/{job_id}` | Resume an interrupted job |
| GET | `/api/voices` | Voice catalog |
| POST | `/api/voices/upload-sample` | Upload voice sample |
| GET/POST/PATCH/DELETE | `/api/profiles[/{id}]` | Profile CRUD |
| GET/POST/PATCH/DELETE | `/api/projects[/{id}]` | Project CRUD |
| GET/POST/PATCH/DELETE | `/api/projects/{id}/chapters` | Chapter CRUD |
| POST | `/api/projects/{id}/split` | Split text into chapters |
| POST | `/api/chapters/{id}/synthesize` | Synthesize a chapter with chunk tracking |
| GET | `/api/chapters/{id}/chunks` | Chunk map for latest generation |
| POST | `/api/chapters/{id}/regenerate-chunk/{n}` | Regenerate single chunk |
| POST | `/api/export/{project_id}` | Batch export project as ZIP |
| POST | `/api/convert` | Voice conversion (audio-to-audio) |
| POST | `/api/voice-lab/process` | Apply DSP effects |
| GET | `/api/voice-lab/presets` | Built-in DSP presets |
| POST | `/api/character-synth/synthesize` | Character-cast synthesis |
| POST | `/api/analyze/sample` | Voice sample quality analysis |
| GET/POST/DELETE | `/api/pronunciations` | Pronunciation dictionary CRUD |
| POST | `/api/preprocess` | Text normalization |
| GET | `/api/logs/recent` | Tail log entries (filterable) |
| GET | `/api/logs/error-count` | Error count for badge |
| GET | `/api/stats` | Usage statistics |
| GET | `/api/health` | Service status |

## Environment Variables

```env
VOXFORGE_CORS_ORIGINS=["http://localhost:5173"]
VOXFORGE_MAX_TEXT_LENGTH=500000
VOXFORGE_CHUNK_MAX_CHARS=3000
VOXFORGE_CLEANUP_MAX_AGE_HOURS=24
VOXFORGE_LOG_LEVEL=INFO
VITE_API_BASE=/api
```

## Data Storage

```
data/
├── voices/           # Voice sample audio files
├── profiles.json     # Voice profiles (atomic writes + asyncio.Lock)
├── pronunciations.json  # Pronunciation overrides
├── output/           # Generated audio (auto-cleaned after 24h)
├── temp/             # Processing intermediaries
├── jobs/             # Crash-safe job records + chunk files
├── logs/
│   ├── app.log       # Text log (INFO+, 10MB x 5 rotation)
│   ├── app.jsonl     # JSON Lines log (structured, 10MB x 5)
│   └── errors.log    # Errors only (WARNING+)
└── voxforge.db       # SQLite: projects, chapters, generations, takes
```
