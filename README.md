# VoxForge — Motor de Síntesis de Voz

## Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (React)                  │
│  ┌─────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │Sintetizar│  │  Voces   │  │     Perfiles       │  │
│  │          │  │          │  │                    │  │
│  │• Editor  │  │• Upload  │  │• CRUD perfiles     │  │
│  │• Player  │  │• Preview │  │• Params guardados  │  │
│  │• Formats │  │• Params  │  │• Muestras de voz   │  │
│  └────┬─────┘  └────┬─────┘  └────────┬───────────┘  │
│       │             │                 │              │
└───────┼─────────────┼─────────────────┼──────────────┘
        │             │                 │
        ▼             ▼                 ▼
┌─────────────────────────────────────────────────────┐
│                 BACKEND (FastAPI)                     │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  TTSEngine   │  │ProfileManager│  │  Conversor  │  │
│  │              │  │              │  │  de formato │  │
│  │  Edge-TTS    │  │  JSON store  │  │  pydub +    │  │
│  │  (async)     │  │  CRUD ops    │  │  ffmpeg     │  │
│  └──────┬───────┘  └──────────────┘  └──────┬──────┘  │
│         │                                    │        │
│         ▼                                    ▼        │
│  ┌──────────────────────────────────────────────────┐ │
│  │              Sistema de archivos                  │ │
│  │  data/voices/   → muestras subidas                │ │
│  │  data/profiles/ → profiles.json                   │ │
│  │  data/output/   → audio generado                  │ │
│  │  data/temp/     → archivos temporales             │ │
│  └──────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Requisitos

### Sistema
- Python 3.10+
- Node.js 18+ (para el frontend)
- ffmpeg instalado en el sistema

### Instalación de ffmpeg
```bash
# Ubuntu/Debian
sudo apt update && sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows (con chocolatey)
choco install ffmpeg
```

### Dependencias Python
```bash
pip install fastapi uvicorn edge-tts pydub aiofiles python-multipart
```

### Dependencias Frontend
```bash
npx create-react-app voxforge-ui
cd voxforge-ui
npm install lucide-react
# Copiar voxforge-tts-app.jsx como componente principal
```

## Ejecución

### Backend
```bash
# Desarrollo
uvicorn backend:app --reload --host 0.0.0.0 --port 8000

# Producción
uvicorn backend:app --host 0.0.0.0 --port 8000 --workers 4
```

### Frontend
```bash
cd voxforge-ui
npm start
```

## API Reference

### POST /api/synthesize
Convierte texto a audio.

```json
{
  "text": "Hola, esto es una prueba de síntesis de voz.",
  "voice_id": "es-ES-AlvaroNeural",
  "output_format": "mp3",
  "speed": 100,
  "pitch": 0,
  "volume": 80
}
```

**Respuesta:** Archivo de audio en el formato solicitado.

### GET /api/voices
Lista las voces curadas por idioma.

### POST /api/profiles
Crea un perfil de voz personalizado (multipart/form-data).

### PATCH /api/profiles/{id}
Actualiza parcialmente un perfil existente.

### DELETE /api/profiles/{id}
Elimina un perfil y su muestra asociada.

### POST /api/voices/upload-sample
Sube una muestra de voz para análisis o clonación.

## Decisiones de Diseño

### ¿Por qué Edge-TTS como motor principal?
- Calidad de voz natural (voces neuronales de Microsoft)
- Gratuito y sin límites estrictos de uso
- Soporte nativo de español (múltiples acentos) e inglés
- Parámetros ajustables: velocidad, tono, volumen
- No requiere GPU ni modelo local pesado

### ¿Por qué no Coqui TTS / XTTS?
Coqui TTS permite clonación de voz real, pero:
- Requiere GPU con VRAM significativa (4GB+ para XTTS v2)
- Tiempos de inferencia largos en CPU (30s+ para frases cortas)
- El proyecto original fue abandonado en 2024
- La calidad de clonación depende mucho de la muestra

**Recomendación:** Integrar XTTS como motor secundario opcional
para usuarios con GPU. El sistema está diseñado para soportar
múltiples motores TTS sin cambios en la API.

### Gestión de formatos
pydub + ffmpeg permite conversión universal entre formatos.
Edge-TTS genera MP3 nativo, y se convierte bajo demanda a
WAV, OGG, o FLAC según la solicitud.

### Muestras de voz
Las muestras subidas se almacenan para:
1. Referencia del usuario (poder escuchar el objetivo)
2. Futura integración con motores de clonación
3. Análisis de características de audio (duración, calidad)

## Extensiones Futuras

- **Clonación de voz con XTTS v2:** Motor secundario para GPU
- **Cola de trabajos:** Celery/Redis para síntesis larga
- **Streaming de audio:** WebSocket para reproducción progresiva
- **SSML:** Soporte de Speech Synthesis Markup Language
- **Batch processing:** Convertir documentos completos
- **Base de datos:** Migrar de JSON a SQLite/PostgreSQL
