# Teoria de los Modelos de Sintesis de Voz

## Que es TTS (Text-to-Speech)

TTS es la tecnologia que convierte texto escrito en audio hablado. Ha evolucionado en tres generaciones:

### Primera generacion: sintesis concatenativa (1990s-2000s)

```
Texto → Analisis linguistico → Seleccion de fonemas → Concatenar grabaciones
```

- Se grababan miles de fragmentos de voz humana (difonos, trifonos)
- El sistema seleccionaba y pegaba fragmentos para formar palabras
- **Calidad**: robotica, con saltos audibles entre fragmentos
- **Ejemplo**: las voces antiguas de GPS y centralitas telefonicas

### Segunda generacion: sintesis parametrica (2010s)

```
Texto → Modelo acustico → Vocoder → Audio
```

- Modelos estadisticos (HMM) generaban parametros acusticos
- Un vocoder (WaveNet, Griffin-Lim) convertia parametros en audio
- **Calidad**: mas fluida pero aun artificial
- **Ejemplo**: primeras versiones de Siri, Google TTS

### Tercera generacion: sintesis neuronal (2018-presente)

```
Texto → Red neuronal end-to-end → Audio
```

- Redes neuronales profundas generan audio directamente desde texto
- Calidad casi indistinguible de voz humana
- **Ejemplo**: Edge-TTS (Microsoft), XTTS v2 (Coqui), ElevenLabs

VoxForge usa esta tercera generacion.

---

## Edge-TTS: Voces Neuronales de Microsoft

### Que es

Edge-TTS es el motor de voz de Microsoft Edge/Azure, expuesto gratuitamente via una API no oficial. Las voces son redes neuronales entrenadas por Microsoft con miles de horas de grabacion profesional.

### Arquitectura interna (simplificada)

```
Texto en espanol
    │
    ▼
┌──────────────────┐
│ Analisis de texto │
│ - Normalizacion   │  "100" → "cien"
│ - G2P (Grapheme   │  "hola" → /o.la/
│   to Phoneme)     │
│ - Prosodia        │  Entonacion, pausas, enfasis
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Modelo acustico   │
│ (Transformer)     │  Genera espectrograma mel
│                   │  (representacion visual del sonido)
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Vocoder neuronal  │
│ (HiFi-GAN)       │  Convierte espectrograma → forma de onda
└────────┬─────────┘
         │
         ▼
Audio MP3
```

### Parametros ajustables

- **Rate (velocidad)**: porcentaje relativo. "+20%" = 20% mas rapido
- **Pitch (tono)**: offset en Hz. "+48Hz" = voz mas aguda
- **Volume (volumen)**: porcentaje relativo. "-20%" = 20% mas bajo

Estos parametros se aplican a nivel del modelo, no como post-procesamiento. La voz se genera directamente con la velocidad/tono pedido, lo que suena mas natural que hacer time-stretch despues.

### Limitaciones

- Requiere conexion a internet (los modelos estan en la nube de Microsoft)
- Solo voces predefinidas — no puedes crear voces nuevas
- No hay clonacion de voz
- El servicio es gratuito pero no tiene SLA ni garantias

---

## XTTS v2: Clonacion de Voz

### Que es clonacion de voz

La clonacion de voz es la capacidad de generar audio que suena como una persona especifica, usando solo una muestra corta de su voz como referencia. A diferencia de Edge-TTS donde eliges entre voces predefinidas, con clonacion la "voz" se extrae de un audio que tu proporcionas.

### Arquitectura de XTTS v2

XTTS v2 (Cross-lingual TTS v2) es un modelo de clonacion de voz desarrollado por Coqui AI. Su arquitectura se basa en un modelo GPT (similar a los modelos de lenguaje como ChatGPT, pero para audio):

```
Muestra de voz (30s WAV)
    │
    ▼
┌──────────────────────┐
│  Speaker Encoder      │
│                       │
│  Analiza la muestra   │
│  y extrae un vector   │
│  de 512 dimensiones   │
│  que codifica:        │
│  - Timbre             │
│  - Tono base          │
│  - Ritmo de habla     │
│  - Caracteristicas    │
│    espectrales        │
│                       │
│  Output: speaker      │
│  embedding [512]      │
└──────────┬───────────┘
           │
           │    Texto a sintetizar
           │         │
           ▼         ▼
┌──────────────────────────┐
│  GPT Autorregresivo       │
│                           │
│  Genera tokens de audio   │
│  uno a uno, condicionado  │
│  a:                       │
│  1. El speaker embedding  │
│     (como debe sonar)     │
│  2. El texto tokenizado   │
│     (que debe decir)      │
│  3. El idioma             │
│     (como pronunciar)     │
│                           │
│  Cada token representa    │
│  ~10ms de audio           │
│                           │
│  Output: secuencia de     │
│  tokens de audio          │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────┐
│  Decoder (HiFi-GAN)  │
│                       │
│  Convierte tokens     │
│  discretos en forma   │
│  de onda continua     │
│                       │
│  Output: WAV 24kHz    │
└──────────┬───────────┘
           │
           ▼
     Audio con tu voz
```

### El Speaker Embedding explicado

El speaker embedding es el concepto clave de la clonacion. Es un vector numerico de 512 valores que captura la "esencia" de una voz:

```
Tu muestra de voz (30 segundos)
         │
         ▼
Speaker Encoder (red neuronal convolucional)
         │
         ▼
[0.234, -0.891, 0.567, ..., 0.123]  ← 512 numeros
         │
    Este vector codifica:
    │
    ├─ Timbre: la "textura" de tu voz (rasposa, suave, nasalizada)
    ├─ Frecuencia fundamental: si tu voz es grave o aguda
    ├─ Formantes: resonancias que dan caracter a cada vocal
    ├─ Prosodia: patron ritmico, velocidad natural
    └─ Caracteristicas espectrales: distribucion de energia en frecuencias
```

Dos personas diferentes producen embeddings diferentes. La misma persona diciendo cosas distintas produce embeddings muy similares. Esto es lo que permite "capturar" una voz con solo 30 segundos.

### Por que 6-30 segundos

| Duracion | Calidad | Razon |
|----------|---------|-------|
| < 3s | Mala | Muy pocos fonemas, embedding ruidoso |
| 3-6s | Aceptable | Captura timbre pero pierde matices |
| 6-15s | Buena | Suficientes fonemas para un embedding estable |
| 15-30s | Optima | Embedding robusto, captura prosodia |
| > 30s | Igual que 30s | Rendimiento decreciente, mas VRAM sin ganancia |

El speaker encoder promedia las caracteristicas a lo largo de toda la muestra. Con 30 segundos tiene suficiente variedad fonetica para capturar tu voz completamente.

### Proceso autorregresivo

"Autorregresivo" significa que el modelo genera un token a la vez, y cada token depende de los anteriores:

```
Paso 1: Genera token_1 basado en [embedding + texto + idioma]
Paso 2: Genera token_2 basado en [embedding + texto + idioma + token_1]
Paso 3: Genera token_3 basado en [embedding + texto + idioma + token_1 + token_2]
...
Paso N: Genera token_N basado en [todo lo anterior]
```

Esto es lo que le da naturalidad — cada instante de audio "sabe" lo que vino antes y puede mantener coherencia en entonacion, ritmo y pausas.

Tambien es lo que lo hace mas lento que Edge-TTS: no puede paralelizar la generacion. Cada token debe esperar al anterior.

### Multilingue

XTTS v2 soporta multiples idiomas con el mismo modelo:

```
Misma muestra de voz + texto en espanol → audio en espanol con tu voz
Misma muestra de voz + texto en ingles  → audio en ingles con tu voz
```

El modelo separa la identidad de la voz (embedding) del idioma (tokens de texto). Tu "huella vocal" se aplica independientemente del idioma.

### Ejecucion en GPU

```
CPU                          GPU (CUDA)
────                         ──────────
Carga modelo (1.8GB)    →    Pesos en VRAM
Lee muestra WAV         →    Speaker encoder
Tokeniza texto          →    GPT autorregresivo
                        →    Decoder HiFi-GAN
                        ←    Forma de onda
Escribe WAV a disco
```

La GPU acelera la generacion ~10-50x respecto a CPU. En una RTX 4070 SUPER:
- El modelo ocupa ~2-4GB de los 12GB de VRAM
- Genera ~3-5 segundos por chunk de 500 caracteres
- Ratio real: genera audio mas rapido de lo que tarda en reproducirse

---

## Comparacion: Edge-TTS vs XTTS v2

| Aspecto | Edge-TTS | XTTS v2 |
|---------|----------|---------|
| **Tipo** | Voces predefinidas | Clonacion de voz |
| **Calidad** | Excelente (entrenado con miles de horas) | Muy buena (depende de la muestra) |
| **Naturalidad** | Muy natural, prosodia perfecta | Natural pero con artefactos ocasionales |
| **Velocidad** | ~1s por parrafo | ~3-5s por parrafo |
| **Requisitos** | Internet | GPU NVIDIA + 4GB VRAM |
| **Privacidad** | Audio pasa por Microsoft | Todo local |
| **Personalizacion** | Solo voces predefinidas | Cualquier voz con 30s de muestra |
| **Idiomas** | 100+ idiomas, 400+ voces | 17 idiomas (ES, EN incluidos) |
| **Coste** | Gratuito | Gratuito (modelo open-source) |
| **Parametros** | Speed, pitch, volume | Solo texto + muestra |
| **Modelo** | En la nube (~desconocido) | Local (1.8GB, GPT-based) |

### Cuando usar cada uno

- **Edge-TTS**: prototipos rapidos, previews, contenido donde no importa la voz especifica, cuando no tienes GPU
- **XTTS v2**: narracion personalizada, audiolibros con tu voz, contenido donde la identidad vocal importa

---

## Futuras direcciones

### Modelos mas recientes

- **Fish Speech**: mas ligero que XTTS, mejor calidad en algunos benchmarks, soporte multilingue
- **OpenVoice v2**: clonacion de "estilo" (no identidad completa), mas rapido
- **Bark**: buena calidad pero sin clonacion real desde muestra

### Mejoras posibles en VoxForge

- **Multiples muestras por perfil**: promediar embeddings de varias grabaciones para un perfil mas estable
- **Analizador de calidad**: detectar ruido, eco, o duracion insuficiente antes de clonar
- **Ajuste de prosodia**: controlar velocidad y entonacion de la voz clonada (actualmente XTTS v2 no lo soporta directamente)
- **Fine-tuning**: entrenar el modelo con mas datos de una voz especifica para mejorar la calidad (requiere GPU potente y horas de audio)
