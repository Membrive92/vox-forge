# VoxForge — Voice Synthesis Engine

VoxForge is a local-first audiobook production workbench for narrating fantasy stories in Spanish. It combines Microsoft's neural voices (Edge-TTS) for instant synthesis with XTTS v2 for cloning your own voice from a short sample, plus OpenVoice V2 for audio-to-audio voice conversion. Designed for texts up to 500,000 characters with automatic segmentation, natural pauses, and per-chunk regeneration.

**Local-first, with one exception**: Edge-TTS synthesizes audio on Microsoft's cloud servers (text is sent over the network). Everything else — voice cloning (XTTS v2), conversion (OpenVoice V2), transcription (faster-whisper), DSP, and video rendering — runs entirely on your machine.

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
- **Human audio ingestion**: upload an audio file as a chapter take, or record one in-app (MediaRecorder with pause/resume, timer, level meter) — uploads and recordings flow through Studio and export like any synthesis
- **Multi-take selector**: when a chapter has several generations (synthesis, upload, recording), pick which one is active for Studio and export

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

### Studio (post-production)
- **Audio editor** (Phase A POC): load a synthesized chapter, select a region on the waveform, queue trim / delete / fade-in / fade-out / normalize operations, apply the batch, preview and download
- **wavesurfer.js** integration with the regions plugin: drag to select, resize by edges
- **Stateless pipeline**: operations live in client state, backend is pure (batch in → edited audio out). Output persists in `data/studio/`
- **Mastering operations**: LUFS loudness normalization (ffmpeg `loudnorm`, audiobook targets -18/-16/-14), noise reduction (noisereduce) and single-knob compression, queueable like any other edit op
- **Video render**: cover image with Ken Burns pan/zoom or multi-image slideshow with crossfades, optional waveform overlay → MP4 via ffmpeg
- **Auto-subtitles**: speech-to-text via `faster-whisper` produces an SRT, burned-in or soft-muxed into the rendered video
- **Scene image generation**: `POST /api/studio/generate-image` with two providers — `placeholder` (default, offline text-on-gradient preview) and `comfyui` (real images via a local ComfyUI instance running the Apache 2.0 Z-Image-Turbo stack; see [ComfyUI image generation](#comfyui-image-generation-optional)). Before each diffusion job the backend unloads its own GPU models (`POST /api/engines/unload` policy) so both fit on one card
- **Planned**: generative video clips as B-roll (`img_generation_module`, gated by its benchmark)

### UX
- **Autosave**: draft text persisted to localStorage with 1s debounce
- **Duration estimate**: `~ 4m 20s of audio` next to character count
- **Keyboard shortcuts**: Ctrl+Enter (generate), Ctrl+S (download), Space (play/pause)
- **Interactive player**: scrubber, +/-10s, playback rates 0.75x-2x, current/total time
- **Bilingual UI**: Spanish and English with typed i18n (compile error if a key is missing)
- **Design system**: unified Button / IconButton / Card / Skeleton / EmptyState primitives, WCAG-AA contrast, `:focus-visible` rings, responsive utility classes, toast stack

## System Architecture

```
Frontend (React + TypeScript)         Backend (FastAPI + Python)
http://localhost:5173                 http://localhost:8000
       |                                     |
  Vite proxy /api/* ─────────────────> FastAPI routers
       |                                     |
  6 tabs (workflow-oriented):       ┌────────┼──────────┐
  ┌─────────────────────────┐       │  Services          │
  │ Workbench (default)     │       │  ├─ TTSEngine      │
  │  ├─ Projects + chapters │       │  ├─ CloneEngine    │
  │  ├─ Quick Preview       │       │  ├─ ConvertEngine  │
  │  ├─ Chunk Map + regen   │       │  ├─ VoiceLabEngine │
  │  ├─ Character Casting   │       │  ├─ AudioEditor    │
  │  └─ Ambient Mixer       │       │  ├─ ProjectManager │
  ├─────────────────────────┤       │  ├─ ProfileManager │
  │ Quick Synth             │       │  ├─ Pronunciation  │
  │  ├─ Standard mode       │       │  ├─ Ambience       │
  │  └─ Cross-lingual mode  │       │  └─ JobStore       │
  ├─────────────────────────┤       │                    │
  │ Voices                  │       │  Persistence       │
  │  ├─ System voices       │       │  ├─ SQLite (projects)
  │  ├─ My profiles         │       │  ├─ JSON (profiles)
  │  └─ Compare A/B         │       │  ├─ JSON (pronunciations)
  ├─────────────────────────┤       │  ├─ JSON (ambience meta)
  │ Audio Tools             │       │  └─ Rotating logs  │
  │  ├─ Change Voice        │       └────────────────────┘
  │  └─ Effects             │                |
  ├─────────────────────────┤   ┌────────────┼────────────┐
  │ Studio                  │   │            │            │
  │  ├─ Source picker       │ Edge-TTS    XTTS v2    OpenVoice V2
  │  ├─ Waveform + regions  │ (cloud)   (GPU local)  (GPU local)
  │  └─ Op queue + apply    │
  ├─────────────────────────┤
  │ Activity                │
  │  ├─ Recent generations  │
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
# 1. Backend — full install (Edge-TTS + XTTS v2 + OpenVoice + DSP)
pip install -r requirements.txt

# For a lean install without GPU engines (tests + Studio audio editor only):
# pip install -r requirements-ci.txt

# 2. ffmpeg (Windows only — Linux/macOS: install via package manager)
python scripts/setup_ffmpeg.py

# 3. OpenVoice V2 is not on PyPI — install from source if you want voice conversion
pip install git+https://github.com/myshell-ai/OpenVoice.git --no-deps

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

Open **http://localhost:5173**. The frontend proxies `/api/*` to the backend.

### ComfyUI image generation (optional)

Scene images can be generated locally through ComfyUI instead of the
built-in placeholder. VoxForge does **not** run diffusion itself — it
talks HTTP to the same ComfyUI instance/workspace that
`img_generation_module` provisions (Z-Image-Turbo, Apache 2.0):

```bash
# 1. Provision + start the engine (see img_generation_module/docs/SETUP_PROVISIONING.md)
cd img_generation_module
python -m pipeline engine up       # ComfyUI on 127.0.0.1:8188

# 2. One-time human step: export the t2i workflow from the GUI in API format
#    to img_generation_module/workflows/zimage_t2i_fp8.api.json with the
#    reserved node titles (PROMPT_POSITIVE/PROMPT_NEGATIVE/SEED/SIZE/SAVE).
#    Details: SETUP_PROVISIONING.md §5.

# 3. Point VoxForge at it (.env)
VOXFORGE_IMAGE_PROVIDER=comfyui
```

The generation dialog shows the provider status (`GET
/api/studio/image-provider/status`) and every failure carries the exact
fix in its message. Before submitting a job, the backend unloads XTTS +
OpenVoice and empties the CUDA cache so the diffusion model fits on the
shared GPU; the TTS models lazy-reload on the next synthesis.

### Tests

```bash
# Backend: 334 tests
python -m pytest -xvs

# Frontend: 78 tests
npm test

# TypeScript strict check
npm run typecheck

# All together
python -m pytest -q && npm test -- --run && npm run typecheck
```

### Regenerating API types

The frontend's `src/api/generated.ts` is derived from the backend's
OpenAPI schema. Regenerate whenever a Pydantic model changes:

```bash
npm run openapi   # export schema + regenerate TS types
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
| GET | `/api/studio/sources` | List chapters editable in Studio |
| POST | `/api/studio/edit` | Apply a batch of edit operations |
| GET | `/api/studio/audio?path=...` | Serve an audio file (path-traversal protected) |
| POST | `/api/studio/generate-image` | Scene image from a prompt (placeholder or ComfyUI) |
| GET | `/api/studio/image-provider/status` | Image provider health check |
| POST | `/api/engines/unload` | Free GPU VRAM for external processes (ComfyUI) |
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
VOXFORGE_IMAGE_PROVIDER=placeholder   # or "comfyui"
VOXFORGE_COMFYUI_URL=http://127.0.0.1:8188
VOXFORGE_COMFYUI_TIMEOUT_S=120
VOXFORGE_COMFYUI_WORKFLOW_PATH=img_generation_module/workflows/zimage_t2i_fp8.api.json
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
├── studio/           # Studio audio edits (persists until manually removed)
├── ambience/         # Ambient track library
├── jobs/             # Crash-safe job records + chunk files
├── logs/
│   ├── app.log       # Text log (INFO+, 10MB x 5 rotation)
│   ├── app.jsonl     # JSON Lines log (structured, 10MB x 5)
│   └── errors.log    # Errors only (WARNING+)
└── voxforge.db       # SQLite: projects, chapters, generations, takes
```
