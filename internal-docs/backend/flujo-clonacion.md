# Flujo de Clonacion — XTTS v2

## Resumen

El flujo de clonacion se activa automaticamente cuando el perfil seleccionado tiene una muestra de voz (`sample_filename`) y el archivo existe en disco. Usa el modelo XTTS v2 ejecutandose en la GPU para generar audio que imita la voz de la muestra.

## Diagrama de flujo completo

```
TTSEngine.synthesize(request)
│
├─ Perfil tiene sample_filename + archivo existe en disco
│
└─→ _synthesize_cloned(request, sample_path, language)
    │
    ├─ Log: "Using XTTS v2 cloning with sample: abc123.mp3"
    │
    ├─→ _get_clone_engine()
    │   └─ Lazy init: crea CloneEngine() si no existe
    │
    ├─ split_into_chunks(text) — misma logica que Edge-TTS
    │
    └─→ CloneEngine.synthesize_long(chunks, speaker_wav, language, format)
        │
        ├─ Para cada chunk:
        │  │
        │  └─→ synthesize_chunk(text, speaker_wav, language)
        │      │
        │      ├─ Verifica CUDA disponible
        │      │  └─ Si no → SynthesisError("CUDA is not available")
        │      │
        │      ├─ load_model() — lazy, solo la primera vez
        │      │  │
        │      │  ├─ Primera ejecucion EVER:
        │      │  │  ├─ Descarga modelo de HuggingFace (~1.8GB)
        │      │  │  ├─ Cache en %APPDATA%/Local/tts/
        │      │  │  └─ Tarda 2-5 minutos segun conexion
        │      │  │
        │      │  ├─ Ejecuciones posteriores:
        │      │  │  ├─ Carga desde cache del SSD
        │      │  │  └─ Tarda 5-10 segundos
        │      │  │
        │      │  └─ Log: "XTTS v2 model loaded successfully on cuda"
        │      │
        │      ├─ Traduce language: "es" → "es", "en" → "en"
        │      │
        │      ├─ asyncio.to_thread(model.tts_to_file, ...)
        │      │  │
        │      │  │  Dentro del modelo (en GPU):
        │      │  │  1. Lee speaker_wav (tu muestra de 30s)
        │      │  │  2. Extrae speaker embedding (huella vocal)
        │      │  │  3. Tokeniza el texto en el idioma pedido
        │      │  │  4. GPT autorregresivo genera tokens de audio
        │      │  │     condicionados al embedding + texto
        │      │  │  5. Decoder convierte tokens → forma de onda
        │      │  │  6. Escribe WAV a disco
        │      │  │
        │      │  └─ Produce archivo WAV (16-bit, 24kHz)
        │      │
        │      └─ Log: "Clone chunk synthesized: 245760 bytes"
        │
        ├─ Concatenacion:
        │  ├─ Si 1 chunk:
        │  │  └─ AudioSegment.from_wav(chunk)
        │  │
        │  └─ Si multiples chunks:
        │     ├─ AudioSegment.from_wav() para cada uno
        │     ├─ 500ms de silencio entre chunks (mas que Edge-TTS)
        │     └─ Concatena todo
        │
        ├─ Export al formato pedido (mp3, wav, ogg, flac)
        │
        ├─ Limpia archivos temporales (WAV de cada chunk)
        │
        └─ return (output_path, chunk_count)

→ TTSEngine envuelve en SynthesisResult(engine="xtts-v2")
```

## Carga del modelo (lazy loading)

El modelo XTTS v2 NO se carga al arrancar el backend. Se carga la primera vez que se necesita:

```
1. Backend arranca
   └─ TTSEngine creado, _clone_engine = None

2. Primera request con perfil clonado
   └─ _get_clone_engine() → crea CloneEngine()
      └─ CloneEngine.__init__() → _model = None

3. CloneEngine.synthesize_chunk()
   └─ load_model()
      └─ TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cuda")
         └─ Descarga modelo (1ª vez) o carga desde cache
         └─ _model = modelo cargado en GPU

4. Siguientes requests
   └─ _model ya existe → no recarga
```

Ventajas:
- El backend arranca rapido (~1 segundo)
- Los usuarios que no usan clonacion nunca cargan el modelo
- El modelo se mantiene en GPU entre requests (no hay recarga)

## Diferencias con Edge-TTS

| Aspecto | Edge-TTS | XTTS v2 |
|---------|----------|---------|
| Ejecucion | Cloud (Microsoft) | Local (GPU) |
| Formato nativo | MP3 | WAV |
| Pausa entre chunks | 400ms | 500ms |
| Velocidad por chunk | ~1s | ~3-5s |
| Parametros | speed, pitch, volume | solo texto + muestra |
| Voces | 12 curadas + ~400 disponibles | la voz de tu muestra |
| Requiere | Internet | GPU NVIDIA + CUDA |

## Manejo de errores

```
SynthesisError("CUDA is not available")
  → Cuando no hay GPU NVIDIA o CUDA no esta instalado

SynthesisError("Voice cloning error: ...")
  → Cuando el modelo falla (muestra corrupta, OOM, etc.)
  → Los archivos temporales se limpian en el bloque finally
```

## Uso de VRAM

- Modelo XTTS v2 cargado: ~2-4GB VRAM
- Durante sintesis: pico de ~4-6GB
- RTX 4070 SUPER (12GB): margen amplio, sin problemas

## Descarga del modelo (unload)

`CloneEngine.unload_model()` existe pero no se usa automaticamente. Podria usarse para:
- Liberar VRAM cuando no se necesite clonacion
- Endpoint futuro para gestionar recursos GPU
- Apagado limpio del servidor
