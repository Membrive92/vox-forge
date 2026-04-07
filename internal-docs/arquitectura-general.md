# Arquitectura General del Sistema

## Vision global

VoxForge es una aplicacion web de sintesis de voz con dos motores:

1. **Edge-TTS** — voces neuronales de Microsoft (cloud, gratuito, sin GPU)
2. **XTTS v2** — clonacion de voz (local, GPU NVIDIA, modelo de 1.8GB)

La aplicacion se divide en un backend Python (FastAPI) y un frontend React (TypeScript), comunicados via API REST con proxy de Vite en desarrollo.

## Diagrama de componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                        NAVEGADOR                                 │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    React App (TSX)                        │    │
│  │                                                          │    │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────┐              │    │
│  │  │ SynthTab │  │VoicesTab │  │ProfilesTab│              │    │
│  │  └────┬─────┘  └────┬─────┘  └─────┬─────┘              │    │
│  │       │              │              │                     │    │
│  │  ┌────┴──────────────┴──────────────┴─────┐              │    │
│  │  │           Hooks + API Client            │              │    │
│  │  │  useSynthesis, useProfiles, useToast    │              │    │
│  │  └────────────────┬───────────────────────┘              │    │
│  └───────────────────┼──────────────────────────────────────┘    │
│                      │ fetch /api/*                               │
└──────────────────────┼───────────────────────────────────────────┘
                       │
                 ┌─────┴─────┐
                 │ Vite Proxy │  (solo en desarrollo)
                 │  :3000     │
                 └─────┬─────┘
                       │
              ┌────────┴────────┐
              │    FastAPI      │
              │    :8000        │
              ├─────────────────┤
              │    Routers      │  ← HTTP, validacion, respuesta
              ├─────────────────┤
              │    Services     │  ← Logica de negocio
              │  ┌───────────┐  │
              │  │ TTSEngine  │  │  ← Routing dual
              │  │    │       │  │
              │  │  ┌─┴──┐   │  │
              │  │  │Edge│   │  │  ← Voces del sistema
              │  │  │TTS │   │  │
              │  │  └────┘   │  │
              │  │  ┌─────┐  │  │
              │  │  │Clone│  │  │  ← Clonacion GPU
              │  │  │Eng. │  │  │
              │  │  └─────┘  │  │
              │  └───────────┘  │
              │  ┌───────────┐  │
              │  │ Profile   │  │  ← CRUD + JSON
              │  │ Manager   │  │
              │  └───────────┘  │
              └────────┬────────┘
                       │
              ┌────────┴────────┐
              │  Sistema de     │
              │  archivos       │
              │                 │
              │  data/voices/   │  ← Muestras de voz
              │  data/profiles/ │  ← profiles.json
              │  data/output/   │  ← Audio generado
              │  data/temp/     │  ← Temporales
              └─────────────────┘
```

## Contrato HTTP

### Convencion de nombres

- **Backend**: snake_case en todos los campos JSON (`voice_id`, `sample_filename`, `output_format`)
- **Frontend**: camelCase en el dominio interno (`voiceId`, `sampleFilename`, `outputFormat`)
- **Traduccion**: ocurre en una unica capa (`src/api/profiles.ts` funcion `toProfile()`)

### Headers de respuesta de sintesis

```
X-Audio-Duration: 125.3       → Duracion en segundos
X-Audio-Size: 2048576          → Tamano en bytes
X-Audio-Chunks: 25             → Numero de segmentos procesados
X-Audio-Engine: xtts-v2        → Motor usado (edge-tts | xtts-v2)
X-Text-Length: 70000           → Longitud del texto de entrada
```

## Flujo de datos principal

```
1. Usuario escribe texto + selecciona perfil
                    │
2. Frontend envia POST /api/synthesize
   { text, voice_id, profile_id, output_format, speed, pitch, volume }
                    │
3. Backend resuelve el perfil
   ¿Tiene sample_filename? ¿El archivo existe en disco?
                    │
         ┌──────────┴──────────┐
         SI                     NO
         │                      │
4a. CloneEngine               4b. Edge-TTS
    - Carga modelo XTTS          - Llama a Microsoft
      en GPU (lazy)              - Genera MP3 nativo
    - Divide texto en chunks     - Divide en chunks
    - Genera WAV por chunk       - Genera MP3 por chunk
    - Concatena con pausas       - Concatena con pausas
         │                      │
         └──────────┬──────────┘
                    │
5. Convierte al formato pedido (pydub + ffmpeg)
                    │
6. Devuelve FileResponse + headers
                    │
7. Frontend recibe blob, crea URL, carga en <audio>
                    │
8. Usuario reproduce, descarga, o genera de nuevo
```

## Dependencias externas

| Dependencia | Proposito | Obligatoria |
|-------------|-----------|-------------|
| edge-tts | Voces neuronales Microsoft | Si (motor principal) |
| pydub | Manipulacion de audio | Si |
| ffmpeg | Conversion/concatenacion de audio | Si (auto-instalable) |
| coqui-tts | Clonacion de voz XTTS v2 | No (solo clonacion) |
| torch + CUDA | Ejecucion del modelo en GPU | No (solo clonacion) |
| pydantic-settings | Configuracion por entorno | Si |

## Almacenamiento

Todo el almacenamiento es local en el directorio `data/`:

- **`data/voices/`**: muestras de audio subidas por el usuario (formato original)
- **`data/profiles/profiles.json`**: base de datos de perfiles (JSON plano)
- **`data/output/`**: archivos de audio generados (se limpian automaticamente tras 24h)
- **`data/temp/`**: archivos temporales durante la sintesis (se limpian al terminar)
- **`tools/ffmpeg/`**: instalacion local de ffmpeg (auto-descargada)
- **`%APPDATA%/Local/tts/`**: cache del modelo XTTS v2 (1.8GB, descarga automatica)
