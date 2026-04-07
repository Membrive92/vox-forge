# Voice Conversion — Futura implementacion

## Que es

Voice conversion (VC) es la transformacion de un audio existente para que suene como si lo hubiera dicho otra persona. A diferencia del TTS (texto → audio), VC trabaja directamente con audio de entrada (audio → audio).

```
Audio original (tu voz leyendo un relato)
  + Muestra de voz objetivo (voz de otra persona)
  = Mismo relato, misma entonacion, pero con la voz objetivo
```

## Caso de uso en VoxForge

1. **Post-produccion**: grabar un relato con tu voz natural y despues aplicar una voz diferente
2. **Correccion**: si un fragmento generado por XTTS v2 tiene artefactos, regrabarlo con tu voz y convertirlo
3. **Doblaje**: aplicar tu voz clonada sobre una grabacion existente en otro idioma
4. **Experimentacion**: probar como suena un mismo audio con diferentes voces

## Motor recomendado: OpenVoice v2

### Por que OpenVoice v2

| Criterio | OpenVoice v2 | Alternativas |
|----------|-------------|--------------|
| Tarea principal | Voice conversion (audio→audio) | RVC, So-VITS (mas complejos) |
| Tamano del modelo | ~1GB | RVC ~500MB, So-VITS ~1.5GB |
| Calidad | Muy buena para cambio de timbre | RVC es ligeramente mejor pero requiere entrenamiento |
| Instalacion | `pip install openvoice` | RVC requiere setup manual |
| GPU necesaria | Si, pero mas ligero que XTTS | Similar |
| Preserva entonacion | Si — solo cambia el timbre | Depende del modelo |
| Idiomas | Multilingue | Depende del modelo entrenado |
| Licencia | MIT (libre) | Varia |

### Como funciona OpenVoice v2

```
Audio de entrada
    │
    ▼
┌──────────────────────┐
│  Extractor de         │
│  contenido            │
│                       │
│  Separa:              │
│  - Contenido fonetico │  (que se dice)
│  - Prosodia           │  (como se dice: ritmo, entonacion)
│  - Timbre             │  (quien lo dice)
└──────────┬───────────┘
           │
           │  Se descarta el timbre original
           │  Se inyecta el timbre de la voz objetivo
           │
           ▼
┌──────────────────────┐
│  Tone Color           │
│  Converter            │
│                       │
│  Resintetiza el audio │
│  manteniendo:         │
│  - Mismo contenido    │
│  - Misma prosodia     │
│  Pero con:            │
│  - Timbre de la voz   │
│    objetivo           │
└──────────┬───────────┘
           │
           ▼
Audio convertido
(mismo contenido + entonacion, diferente voz)
```

### Diferencia clave con XTTS v2

```
XTTS v2 (TTS):     Texto    + Voz objetivo → Audio con voz objetivo
OpenVoice v2 (VC):  Audio    + Voz objetivo → Audio con voz objetivo

XTTS genera prosodia nueva (el modelo decide la entonacion)
OpenVoice preserva la prosodia original (tu entonacion se mantiene)
```

## Diseno tecnico propuesto

### Nuevo endpoint

```
POST /api/convert
Content-Type: multipart/form-data

Parametros:
  - audio: archivo de audio a convertir (WAV, MP3)
  - profile_id: ID del perfil con la voz objetivo
  - output_format: mp3 | wav | ogg | flac (default: mp3)
```

### Respuesta

```
200 OK
Content-Type: audio/mp3
X-Audio-Duration: 125.3
X-Audio-Size: 2048576
X-Audio-Engine: openvoice-v2
X-Original-Duration: 124.8
```

### Nuevo servicio: ConvertEngine

```python
# backend/services/convert_engine.py

class ConvertEngine:
    """Voice conversion engine using OpenVoice v2.
    
    Lazy-loads the model on first use (same pattern as CloneEngine).
    """
    
    def __init__(self):
        self._model = None
        self._tone_color_converter = None
    
    def load_model(self):
        """Load OpenVoice v2 model into GPU."""
        from openvoice import se_extractor, tone_color_converter
        # ...
    
    async def convert(
        self,
        audio_path: Path,
        speaker_wav: Path,
        output_format: str,
    ) -> Path:
        """Convert audio to sound like the reference speaker."""
        # 1. Extract speaker embedding from reference
        # 2. Apply tone color conversion to input audio
        # 3. Export to requested format
        pass
```

### Estructura de archivos

```
backend/services/
├── tts_engine.py        → Motor dual Edge-TTS + XTTS v2 (existente)
├── clone_engine.py      → Clonacion XTTS v2 (existente)
└── convert_engine.py    → Conversion OpenVoice v2 (nuevo)

backend/routers/
├── synthesis.py         → POST /api/synthesize (existente)
└── conversion.py        → POST /api/convert (nuevo)
```

### Flujo en el frontend

```
Nueva seccion en tab Voces o nuevo tab "Convertir":

1. Sube un archivo de audio (el que quieres convertir)
2. Selecciona un perfil con muestra de voz (el objetivo)
3. Pulsa "Convertir"
4. Espera (depende de la duracion del audio)
5. Reproduce y descarga el resultado
```

### Consideraciones

- **Duracion del audio**: OpenVoice procesa el audio completo de una vez. Para audios muy largos (>5min), habria que implementar chunking similar al de XTTS.
- **Calidad del audio de entrada**: ruido de fondo, musica o multiples hablantes degradan el resultado.
- **VRAM**: OpenVoice es mas ligero que XTTS. Ambos pueden coexistir en una 4070 SUPER de 12GB.
- **Latencia**: la conversion es mas rapida que la generacion TTS (no hay decodificacion autoregresiva). Un audio de 5 minutos se convierte en ~30 segundos.

## Instalacion (cuando se implemente)

```bash
pip install openvoice
# El modelo (~1GB) se descarga automaticamente en la primera ejecucion
```

## Posible extension: pipeline combinado

```
Texto → XTTS v2 (genera con voz clonada) → OpenVoice (refina el timbre)
```

Esto podria mejorar la calidad final: XTTS genera el contenido con la prosodia correcta, y OpenVoice refina el timbre para que suene mas como la muestra original. Es un pipeline de dos pasos pero podria producir resultados superiores a cualquiera de los dos por separado.

## Prioridad

Esta funcionalidad es independiente del flujo TTS actual. Se puede implementar en paralelo sin afectar nada existente. Requiere:

1. Instalar `openvoice`
2. Crear `ConvertEngine` (patron identico a `CloneEngine`)
3. Crear router `conversion.py`
4. Anadir UI en el frontend (nuevo tab o seccion)
5. Tests

Estimacion: implementacion similar en complejidad a la integracion de XTTS v2.
