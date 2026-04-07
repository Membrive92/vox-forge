# Arquitectura del Frontend

## Stack

- **React 18** con JSX
- **TypeScript** en modo strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, cero `any`)
- **Vite** como bundler y dev server (con proxy `/api` → backend)
- **Estilos inline** con design tokens centralizados (pendiente migrar a CSS Modules o Tailwind)

## Estructura del proyecto

```
src/
├── App.tsx                  → Componente raiz: estado global, tabs, routing
├── main.tsx                 → Entry point: StrictMode + createRoot
│
├── api/                     → Capa de comunicacion con el backend
│   ├── client.ts            → fetch wrapper, ApiError, getJson/postJson
│   ├── types.ts             → DTOs del backend (snake_case)
│   ├── profiles.ts          → CRUD de perfiles (normaliza a camelCase)
│   └── synthesis.ts         → Endpoint de sintesis
│
├── types/
│   └── domain.ts            → Tipos del dominio (Profile, Voice, SynthesisParams)
│
├── constants/
│   └── voices.ts            → Catalogo de voces + formatos de audio
│
├── i18n/
│   ├── es.ts                → Traducciones en espanol (fuente de verdad)
│   ├── en.ts                → Traducciones en ingles (derivado de es.ts)
│   └── index.ts             → getTranslations(lang)
│
├── theme/
│   └── tokens.ts            → Design tokens: colors, fonts, radii
│
├── components/              → Componentes reutilizables sin logica de negocio
│   ├── Slider.tsx           → Range input accesible con thumb visual
│   ├── WaveformVisualizer.tsx → Canvas animado (DPR-aware)
│   ├── Toast.tsx            → Notificacion con aria-live
│   └── icons.tsx            → 15 SVGs inline
│
├── hooks/                   → Logica extraida en hooks reutilizables
│   ├── useToast.ts          → Timer + show/hide
│   ├── useProfiles.ts       → Carga inicial + CRUD remoto
│   ├── useAudioPlayer.ts   → Blob URL + play/pause/stop
│   ├── useSynthesis.ts      → Progreso animado + llamada API + motor
│   ├── useVoicePreview.ts   → Preview en vivo de voces
│   ├── useSamplePlayer.ts  → Reproduccion de muestras del backend
│   └── readAudioDuration.ts → Lee duracion de archivo local
│
└── features/                → Features organizadas por tab
    ├── state.ts             → Interfaces de estado compartido
    ├── synth/SynthTab.tsx   → Tab de sintesis
    ├── voices/VoicesTab.tsx → Tab de voces y creacion de perfiles
    └── profiles/ProfilesTab.tsx → Tab de perfiles guardados
```

## Patron de estado

### Estado global en App.tsx

`App.tsx` es el unico componente con `useState`. Gestiona:

```typescript
// Sintesis
lang, selectedVoice, format, speed, pitch, volume, activeProfileId

// Perfiles (draft para creacion/edicion)
newProfileName, uploadedFile, editingProfile

// UI
tab, dragOver
```

Este estado se agrupa en dos interfaces y se pasa como props:

```typescript
SynthSettings {
  lang, selectedVoice, format, speed, pitch, volume,
  activeProfileId,  // null = Edge-TTS, string = perfil clonado
  + setters para cada campo
}

ProfileDraft {
  name, uploadedFile, editingId,
  + setters
}
```

### Hooks como logica

Los hooks encapsulan toda la logica compleja. Los componentes solo renderizan:

```
App.tsx
  ├── useToast()        → toast.show("mensaje"), toast.visible
  ├── useProfiles()     → profiles[], create(), update(), remove()
  ├── useVoicePreview() → previewingId, toggle(voiceId, lang)
  └── useSamplePlayer() → playingFilename, toggle(filename)

SynthTab
  ├── useSynthesis()    → isGenerating, progress, run(), lastEngine
  └── useAudioPlayer()  → url, duration, isPlaying, load(), toggle(), stop()
```

## Capa API (src/api/)

### Principios

1. **Un unico punto de traduccion**: snake_case → camelCase ocurre solo en `profiles.ts` (funcion `toProfile`)
2. **Errores tipados**: `ApiError extends Error { status, code }` — nunca strings sueltos
3. **fetch centralizado**: `getJson<T>`, `postJson<T>`, `patchJson<T>`, `postForm<T>`, `deleteResource`, `postJsonForAudio`
4. **No `any`**: todas las respuestas estan tipadas

### Flujo de una llamada API

```
Componente llama a hook
  → Hook llama a api/profiles.ts o api/synthesis.ts
    → Funcion llama a client.ts (postJson, etc.)
      → fetch() con URL = API_BASE + path
        → Si error: parseErrorBody → throw ApiError
        → Si OK: parse JSON o blob
    → Funcion normaliza DTO → tipo de dominio
  → Hook actualiza estado local
Componente se re-renderiza
```

## Flujo de datos entre componentes

```
App.tsx (estado global)
  │
  ├─→ SynthTab
  │   Props: t, text, setText, settings, onToast
  │   Responsabilidad: editor de texto, player, controles, generar
  │
  ├─→ VoicesTab
  │   Props: t, settings, draft, dragOver, onSaveProfile, voicePreview
  │   Responsabilidad: upload muestras, crear perfiles, browser de voces
  │
  └─→ ProfilesTab
      Props: t, profiles, onUse, onEdit, onDelete, samplePlayer, voicePreview
      Responsabilidad: lista de perfiles, acciones, preview
```

No hay Context ni Redux. El estado fluye via props desde App.tsx. Para el tamano actual del proyecto, esto es mas simple y depurable que un state manager global.
