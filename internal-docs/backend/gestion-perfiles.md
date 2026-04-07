# Gestion de Perfiles

## Que es un perfil

Un perfil de voz es una configuracion guardada que combina:

- **Nombre** identificativo ("Mi voz de narrador")
- **Voz base** de Edge-TTS (ej: es-ES-AlvaroNeural)
- **Parametros**: velocidad, tono, volumen
- **Muestra de voz** (opcional): archivo de audio para clonacion

## Modelo de datos

```python
class VoiceProfile:
    id: str               # UUID truncado a 8 chars (ej: "04d5d9fe")
    name: str             # Nombre visible (1-100 chars)
    voice_id: str         # ID de voz Edge-TTS (para fallback)
    language: str         # "es" o "en"
    speed: int            # 50-200 (100 = normal)
    pitch: int            # -10 a +10 semitonos
    volume: int           # 0-100
    sample_filename: str? # Nombre del archivo en data/voices/ (null si no hay)
    sample_duration: float? # Duracion de la muestra en segundos
    created_at: str       # ISO 8601
    updated_at: str       # ISO 8601
```

## Persistencia

Los perfiles se almacenan en `data/profiles/profiles.json`:

```json
{
  "04d5d9fe": {
    "id": "04d5d9fe",
    "name": "Mi voz",
    "voice_id": "es-ES-AlvaroNeural",
    "language": "es",
    "speed": 100,
    "pitch": 0,
    "volume": 80,
    "sample_filename": "abc123.wav",
    "sample_duration": 28.5,
    "created_at": "2026-04-06T13:29:18.611275",
    "updated_at": "2026-04-06T13:29:18.611293"
  }
}
```

### Escritura atomica

Para evitar corrupcion si el proceso se interrumpe:

```
1. Serializa los datos a JSON
2. Escribe a profiles.json.tmp
3. os.replace(profiles.json.tmp, profiles.json)
   └─ Operacion atomica del sistema operativo
```

### Concurrencia

`asyncio.Lock` protege todas las operaciones de escritura:

```python
async def create(self, profile):
    async with self._lock:        # Solo un writer a la vez
        self._profiles[id] = profile
        self._write_atomic()      # Escritura atomica
```

## Flujos CRUD

### Crear perfil (POST /api/profiles)

```
1. Recibe FormData: name, voice_id, language, speed, pitch, volume, sample?
2. Si hay sample:
   a. Valida content_type (wav, mp3, ogg, flac)
   b. Genera nombre unico: {uuid[:8]}.{ext}
   c. Guarda en data/voices/
   d. Si ffmpeg disponible: lee duracion con pydub
   e. Si no: sample_duration = None
3. Crea VoiceProfile con ID unico
4. ProfileManager.create() — con lock + escritura atomica
5. Devuelve el perfil creado
```

### Actualizar perfil (PATCH /api/profiles/{id})

```
1. Recibe JSON: { name?, voice_id?, language?, speed?, pitch?, volume? }
2. Solo los campos enviados se actualizan (exclude_none=True)
3. updated_at se actualiza automaticamente
4. No permite cambiar sample_filename via PATCH
   (usar POST /api/voices/upload-sample con profile_id)
```

### Eliminar perfil (DELETE /api/profiles/{id})

```
1. Busca el perfil
2. Si tiene sample_filename:
   └─ Elimina el archivo de data/voices/
3. Elimina del diccionario
4. Escritura atomica
5. Devuelve { status: "deleted", id: "..." }
```

### Adjuntar muestra (POST /api/voices/upload-sample)

```
1. Recibe multipart: sample (archivo), profile_id? (opcional)
2. Guarda el archivo en data/voices/
3. Si ffmpeg disponible: analiza duracion, channels, sample_rate, bit_depth
4. Si profile_id proporcionado:
   a. ProfileManager.attach_sample(profile_id, filename, duration)
   b. Si el perfil tenia muestra anterior → la elimina del disco
5. Devuelve metadata del audio subido
```

## Relacion perfil ↔ motor de sintesis

```
Perfil sin muestra → Edge-TTS (usa voice_id + speed/pitch/volume)
Perfil con muestra → XTTS v2 (usa sample_filename, ignora voice_id)
```

El `voice_id` se mantiene en perfiles con muestra como fallback: si el archivo de muestra se borra del disco, el sistema cae a Edge-TTS con esa voz automaticamente.
