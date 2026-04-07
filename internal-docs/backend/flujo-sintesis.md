# Flujo de Sintesis — Edge-TTS

## Resumen

El flujo de sintesis con Edge-TTS es el camino por defecto cuando no hay clonacion de voz. Convierte texto a audio usando las voces neuronales de Microsoft a traves de su servicio gratuito.

## Diagrama de flujo completo

```
POST /api/synthesize
│
│  Body: { text, voice_id, output_format, speed, pitch, volume, profile_id? }
│
├─→ Router: synthesis.py
│   │
│   ├─ Valida SynthesisRequest (Pydantic)
│   │  - text: 1-500.000 chars
│   │  - speed: 50-200
│   │  - pitch: -10 a +10
│   │  - volume: 0-100
│   │  - output_format: mp3|wav|ogg|flac
│   │
│   └─→ TTSEngine.synthesize(request)
│       │
│       ├─ Valida output_format contra AUDIO_FORMATS
│       │
│       ├─ Resuelve perfil (si profile_id)
│       │  └─ Sobreescribe voice_id, speed, pitch, volume
│       │  └─ Comprueba si tiene sample_filename + archivo en disco
│       │     └─ SI → redirige a _synthesize_cloned() (ver flujo-clonacion.md)
│       │     └─ NO → continua con Edge-TTS
│       │
│       ├─ Valida voice_id contra catalogo curado (all_voice_ids())
│       │
│       ├─ split_into_chunks(text, max_chars=3000)
│       │  (ver chunking.md para detalles)
│       │
│       ├─ Para cada chunk:
│       │  │
│       │  ├─ Crea edge_tts.Communicate(text, voice, rate, pitch, volume)
│       │  │  - rate: "+20%" (speed 120 → delta +20)
│       │  │  - pitch: "+48Hz" (pitch 3 → 3*16=48)
│       │  │  - volume: "-20%" (volume 80 → delta -20)
│       │  │
│       │  ├─ await communicate.save(temp_chunk.mp3)
│       │  │  (llamada async a los servidores de Microsoft)
│       │  │
│       │  └─ Log: "Chunk 1/5 synthesized: 45231 bytes"
│       │
│       ├─ Concatenacion:
│       │  │
│       │  ├─ Si 1 chunk + formato MP3:
│       │  │  └─ Mueve el archivo directamente (sin ffmpeg)
│       │  │
│       │  └─ Si multiples chunks o formato != MP3:
│       │     ├─ AudioSegment.from_mp3() para cada chunk
│       │     ├─ Inserta 400ms de silencio entre chunks
│       │     └─ combined.export(output, format, codec, parameters)
│       │
│       └─ return SynthesisResult(path, chunks, engine="edge-tts")
│
├─→ Router: calcula duracion del audio con AudioSegment
│   (si falla, estima desde tamano del archivo)
│
├─→ BackgroundTasks: cleanup_old_files()
│
└─→ FileResponse con headers:
    X-Audio-Duration, X-Audio-Size, X-Audio-Chunks,
    X-Audio-Engine: edge-tts, X-Text-Length
```

## Traduccion de parametros a Edge-TTS

Edge-TTS espera strings con formato especifico:

| Parametro | Entrada | Calculo | Resultado Edge-TTS |
|-----------|---------|---------|-------------------|
| speed=120 | 120 | 120-100=+20 | "+20%" |
| speed=80 | 80 | 80-100=-20 | "-20%" |
| pitch=3 | 3 | 3*16=48 | "+48Hz" |
| pitch=-2 | -2 | -2*16=-32 | "-32Hz" |
| volume=80 | 80 | 80-100=-20 | "-20%" |

La aproximacion de pitch (1 semitono ≈ 16Hz) es una simplificacion. El pitch real depende de la frecuencia fundamental de cada voz.

## Voces disponibles

12 voces curadas (6 ES + 6 EN), definidas en `catalogs.py`:

```
ES: Alvaro(M,España), Elvira(F,España), Dalia(F,Mexico),
    Jorge(M,Mexico), Elena(F,Argentina), Gonzalo(M,Colombia)

EN: Guy(M,US), Jenny(F,US), Ryan(M,UK),
    Sonia(F,UK), Natasha(F,AU), William(M,AU)
```

Se puede descubrir el catalogo completo de ~400 voces via `GET /api/voices/all`.

## Optimizacion: caso 1 chunk + MP3

Cuando el texto es corto (< 3000 chars) y el formato es MP3:
- Edge-TTS genera un MP3 directamente
- El archivo se mueve (`Path.replace`) al directorio de output
- **No se usa pydub ni ffmpeg**
- Es el caso mas rapido (~1-2 segundos)

## Limpieza de archivos

Despues de cada sintesis, se programa una tarea de fondo que:
1. Recorre `data/output/` y `data/temp/`
2. Elimina archivos con mas de 24 horas de antiguedad
3. Log: "Cleanup: 3 old files deleted"

La configuracion es via `VOXFORGE_CLEANUP_MAX_AGE_HOURS`.
