# Flujo de Sintesis — Frontend

## Resumen

El flujo de sintesis en el frontend va desde que el usuario escribe texto hasta que escucha el audio generado. Involucra el hook `useSynthesis`, el API client, y el hook `useAudioPlayer`.

## Diagrama de flujo

```
Usuario escribe texto en textarea
        │
Usuario pulsa "Generar Audio"
        │
        ▼
SynthTab.handleGenerate()
        │
        ├─ ¿text.trim() vacio? → no hacer nada
        │
        ├─ Determinar steps de progreso:
        │  ¿text.length > 3000?
        │    SI → ["Sintetizando texto largo...", "Concatenando...", "Finalizando..."]
        │    NO → ["Procesando texto...", "Analizando voz...", "Aplicando efectos...", "Finalizando..."]
        │
        └─→ synthesis.run({
            params: {
              text, voiceId, format, speed, pitch, volume,
              profileId: settings.activeProfileId  ← CLAVE para clonacion
            },
            steps,
            onSuccess: (blob, duration, engine) => { ... },
            onError: (msg) => toast(msg)
          })

            │
            ▼
      useSynthesis.run()
            │
            ├─ setIsGenerating(true)
            ├─ setIsGenerated(false)
            ├─ Inicia animacion de progreso (setInterval cada 600ms)
            │  └─ Avanza por los steps, actualiza progress bar
            │
            ├─→ api.synthesize(params)
            │   │
            │   ├─ Construye SynthesisRequestDTO (camelCase → snake_case)
            │   │  { text, voice_id, output_format, speed, pitch, volume, profile_id }
            │   │
            │   ├─ postJsonForAudio("/synthesize", body)
            │   │  └─ fetch POST con Content-Type: application/json
            │   │
            │   ├─ Lee headers de respuesta:
            │   │  X-Audio-Duration → duration
            │   │  X-Audio-Size → sizeBytes
            │   │  X-Audio-Chunks → chunks
            │   │  X-Audio-Engine → engine ("edge-tts" | "xtts-v2")
            │   │
            │   └─ return { blob, duration, sizeBytes, chunks, textLength, engine }
            │
            ├─ clearInterval (para animacion)
            ├─ setProgress(100)
            ├─ setIsGenerating(false)
            ├─ setIsGenerated(true)
            ├─ setLastEngine(engine)
            │
            └─ onSuccess(blob, duration, engine)
                    │
                    ▼
            SynthTab.onSuccess callback
                    │
                    ├─ player.load(blob, duration)
                    │  │
                    │  ├─ Revoca URL anterior (URL.revokeObjectURL)
                    │  ├─ Crea nueva URL: URL.createObjectURL(blob)
                    │  └─ Actualiza estado: url, duration, isPlaying=false
                    │
                    └─ toast("Audio listo — Voz clonada (XTTS v2)")
                       o toast("Audio listo — Voz del sistema (Edge-TTS)")
```

## Componentes del player

Despues de generar, el audio se puede reproducir:

```
┌─────────────────────────────────────────────────┐
│  WaveformVisualizer (canvas animado)            │
│  - Barras azules: audio generado (idle)         │
│  - Barras naranjas: reproduciendo               │
│  - Barras grises: sin audio                     │
├─────────────────────────────────────────────────┤
│  <audio ref={audioRef} src={url} hidden />      │
│                                                  │
│  [▶ Play]  3.5s  [■ Stop]  [CLONED]  [⬇ .mp3] │
│                                                  │
│  ▶ Play/Pause: player.toggle()                  │
│  ■ Stop: player.stop() (pause + currentTime=0)  │
│  Badge: "CLONED" (naranja) o "EDGE-TTS" (azul)  │
│  Descargar: crea <a download> con blob URL      │
├─────────────────────────────────────────────────┤
│  Progress bar (solo durante generacion)          │
│  [Procesando texto...              45%]         │
└─────────────────────────────────────────────────┘
```

## Estado del player

```typescript
useAudioPlayer() → {
  audioRef,     // ref al <audio> element
  url,          // blob URL o null
  duration,     // segundos
  isPlaying,    // true/false (sincronizado con eventos del <audio>)
  load(blob, duration),  // revocar anterior + crear nueva URL
  toggle(),     // play/pause
  stop(),       // pause + seek to 0
}
```

El `isPlaying` se sincroniza via eventos del `<audio>`:
- `onPlay` → setIsPlaying(true)
- `onPause` → setIsPlaying(false)
- `onEnded` → setIsPlaying(false)

## Indicador de perfil clonado activo

Cuando `activeProfileId !== null`, se muestra un banner naranja encima del selector de voces:

```
┌────────────────────────────────────────┐
│  🔶 Voz clonada (XTTS v2)   [Cancelar]│
└────────────────────────────────────────┘
```

- Pulsar "Cancelar" → `setActiveProfileId(null)` → vuelve a Edge-TTS
- Seleccionar una voz del catalogo manualmente → tambien limpia `activeProfileId`

## Formato de duracion

Para audios largos (> 60s), la duracion se muestra en minutos:

```typescript
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}
// 45.3 → "45.3s"
// 125.7 → "2m 06s"
```

## Manejo de errores

```
Error de red/API → onError(message) → toast("Error: ...")
Texto vacio → no se llama a run()
Backend 500 → ApiError con status + detail → toast muestra el detail
```

El progress se resetea a 0 si hay error (no queda en estado intermedio).
