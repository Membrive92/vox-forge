# Documentacion Interna — VoxForge

Documentacion tecnica interna del proyecto. Explica la arquitectura, los flujos de logica y la teoria detras de los modelos de voz.

## Indice

### Arquitectura General
- [Arquitectura del sistema](arquitectura-general.md) — Vision global, componentes, contratos y flujo de datos

### Backend
- [Arquitectura del backend](backend/arquitectura.md) — Estructura del paquete, capas, dependencias
- [Flujo de sintesis](backend/flujo-sintesis.md) — Desde la request HTTP hasta el archivo de audio
- [Flujo de clonacion](backend/flujo-clonacion.md) — Motor XTTS v2, carga del modelo, generacion
- [Gestion de perfiles](backend/gestion-perfiles.md) — CRUD, persistencia JSON, concurrencia
- [Chunking de texto](backend/chunking.md) — Division de texto largo, concatenacion, pausas
- [Voice conversion](backend/voice-conversion.md) — Futura implementacion de conversion audio→audio con OpenVoice v2

### Frontend
- [Arquitectura del frontend](frontend/arquitectura.md) — Estructura TSX, estado, hooks, features
- [Flujo de sintesis](frontend/flujo-sintesis.md) — Desde el textarea hasta el player de audio
- [Gestion de perfiles](frontend/gestion-perfiles.md) — CRUD, upload de muestras, activacion de perfil
- [Sistema de i18n](frontend/i18n.md) — Traducciones tipadas, paridad ES/EN

### Teoria
- [Modelos de sintesis de voz](teoria-modelos-voz.md) — TTS neuronal, clonacion, Edge-TTS vs XTTS v2
