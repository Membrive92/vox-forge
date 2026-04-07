# Gestion de Perfiles — Frontend

## Flujos de usuario

### Crear perfil con muestra de voz

```
Tab Voces
    │
    ├─ 1. Arrastra o selecciona archivo de audio
    │     └─ handleFile(file)
    │        ├─ Valida extension (.wav, .mp3, .ogg, .flac)
    │        ├─ Lee duracion con <audio> temporal (readAudioDuration)
    │        └─ setUploadedFile({ file, name, sizeKb, duration })
    │
    ├─ 2. Aparece tarjeta con info del archivo:
    │     "voice.wav  280.3KB · 28.5s  ✓"
    │
    ├─ 3. Escribe nombre del perfil
    │     └─ draft.setName("Mi voz de narrador")
    │
    ├─ 4. Ajusta sliders (speed, pitch, volume)
    │
    └─ 5. Pulsa "Guardar perfil"
          └─ onSaveProfile()
             │
             ├─ api.createProfile({
             │    name, voiceId, language, speed, pitch, volume,
             │    sampleFile: uploadedFile.file  ← el File object real
             │  })
             │
             ├─ Frontend construye FormData:
             │    fd.append("name", "Mi voz de narrador")
             │    fd.append("voice_id", "es-ES-AlvaroNeural")
             │    fd.append("speed", "100")
             │    fd.append("sample", file)  ← archivo binario
             │
             ├─ POST /api/profiles (multipart/form-data)
             │
             ├─ Respuesta: ProfileDTO (snake_case)
             │  └─ toProfile() normaliza a camelCase
             │
             ├─ setProfiles(prev => [...prev, created])
             ├─ setNewProfileName("")
             ├─ setUploadedFile(null)
             └─ toast("Perfil guardado correctamente")
```

### Usar perfil (activar clonacion)

```
Tab Perfiles
    │
    └─ Pulsa "Usar" en tarjeta de perfil
       └─ handleUseProfile(profile)
          │
          ├─ setSelectedVoice(profile.voiceId)
          ├─ setSpeed(profile.speed)
          ├─ setPitch(profile.pitch)
          ├─ setVolume(profile.volume)
          ├─ setLang(profile.lang)
          ├─ setActiveProfileId(profile.id)  ← ACTIVA CLONACION
          └─ setTab("synth")                 ← Cambia a tab de sintesis
```

Al llegar al tab de sintesis, el usuario ve:
- Banner naranja "Voz clonada (XTTS v2)" con boton "Cancelar"
- Los sliders cargados con los valores del perfil
- Al generar, `profileId` se envia al backend → ruta a XTTS v2

### Desactivar clonacion

Dos formas:
1. Pulsar "Cancelar" en el banner naranja → `setActiveProfileId(null)`
2. Seleccionar una voz del catalogo manualmente → `setActiveProfileId(null)`

Ambas limpian el `activeProfileId`, y la siguiente generacion usa Edge-TTS.

### Editar perfil

```
Tab Perfiles → Pulsa icono de edicion
    │
    └─ handleEditProfile(profile)
       ├─ setEditingProfile(profile.id)
       ├─ setNewProfileName(profile.name)
       ├─ Carga speed, pitch, volume, selectedVoice
       └─ setTab("voices")  ← Cambia al tab de voces
          │
          └─ El formulario muestra "Confirmar" en vez de "Guardar perfil"
             └─ Al confirmar: api.updateProfile(id, { name, voiceId, ... })
                └─ PATCH /api/profiles/{id}
```

### Eliminar perfil

```
Tab Perfiles → Pulsa icono de papelera
    │
    └─ handleDeleteProfile(id)
       ├─ api.deleteProfile(id)
       │  └─ DELETE /api/profiles/{id}
       │     └─ Backend elimina perfil + archivo de muestra
       └─ setProfiles(prev => prev.filter(p => p.id !== id))
```

## Hook useProfiles

```typescript
useProfiles() → {
  profiles: Profile[],    // Lista reactiva
  error: string | null,   // Error de carga inicial
  create(input),          // POST + actualiza lista
  update(id, input),      // PATCH + actualiza lista
  remove(id),             // DELETE + actualiza lista
}
```

### Carga inicial

```typescript
useEffect(() => {
  listProfiles()
    .then(setProfiles)
    .catch(e => setError(e.message));
}, []);  // Solo al montar
```

### Actualizacion optimista

Las operaciones CRUD actualizan el estado local inmediatamente despues de que la API responde OK. No hay optimistic update antes de la respuesta (para evitar inconsistencias si falla).

## Upload de archivos

### Lectura de duracion local

Antes de subir, el frontend lee la duracion del archivo con un `<audio>` temporal:

```typescript
async function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
      URL.revokeObjectURL(audio.src);
    };
    audio.src = URL.createObjectURL(file);
  });
}
```

Esto funciona sin ffmpeg — el navegador puede leer metadata de WAV y MP3 nativamente.

### Drag & drop

La zona de upload soporta tanto clic como arrastrar:

```
onDragOver → setDragOver(true) + e.preventDefault()
onDragLeave → setDragOver(false)
onDrop → setDragOver(false) + handleFile(file)
onClick → fileInputRef.click()
```

La zona tiene `role="button"` y `tabIndex={0}` para accesibilidad.

## Tarjeta de perfil

Cada perfil se renderiza como una tarjeta con:

```
┌──────────────────────────────────────────────┐
│  Mi voz de narrador              CON MUESTRA │
│  Alvaro · España · ES                        │
│                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐                 │
│  │Speed │ │Pitch │ │Volume│                  │
│  │ 100% │ │  0st │ │  80% │                  │
│  └──────┘ └──────┘ └──────┘                  │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │ ▶ voice.wav  280.3KB · 28.5s        │    │
│  └──────────────────────────────────────┘    │
│                                              │
│  [🔊 Vista previa Alvaro]                   │
│                                              │
│  [    Usar    ] [📝] [🗑]                   │
└──────────────────────────────────────────────┘
```

- **Badge**: "CON MUESTRA" (verde) si tiene sample, "PRESET" (gris) si no
- **Boton play**: reproduce la muestra desde el backend (`useSamplePlayer`)
- **Vista previa**: sintetiza frase demo con la voz base (`useVoicePreview`)
- **Usar**: activa el perfil para sintesis
- **Editar**: carga en el formulario del tab Voces
- **Eliminar**: borra perfil + muestra del servidor
