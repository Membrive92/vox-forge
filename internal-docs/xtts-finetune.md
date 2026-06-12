# Fine-tuning de XTTS v2 sobre la voz del autor (VOZ-11)

**Fecha**: 2026-06-12
**Estado**: receta preparada; el entrenamiento y la escucha son del autor (HUMANO).
**Relación con REMEDIATION_PLAN**: id `VOZ-11` (§F2b). Complementa, no sustituye,
al conditioning multi-muestra (VOZ-10): el fine-tuning especializa los *pesos*
del modelo en una voz; el conditioning sigue haciendo falta en inferencia.

---

## Por qué fine-tunear

El clonado zero-shot de XTTS v2 condiciona un modelo genérico con unos
segundos de muestra: el timbre se aproxima, pero la prosodia, el acento y los
tics de dicción son los del modelo base. Un fine-tuning con 20–60 minutos de
la voz objetivo ajusta el GPT interno a esa voz concreta: mejora estabilidad,
acento (castellano consistente sin warm-up) y naturalidad en narración larga.

## Requisitos verificados

| Recurso | Mínimo | Notas |
|---|---|---|
| GPU | **12 GB VRAM viable en Windows** (la RTX 4070S de este equipo entra) | batch pequeño + gradient accumulation |
| GPU alternativa | 8 GB VRAM con **≥24 GB de RAM** del sistema | vía *sysmem fallback* del driver NVIDIA (más lento) |
| Datos — mínimo absoluto | 2–3 min de voz limpia | resultados pobres pero audibles |
| Datos — recomendado | 5+ min | primer fine-tuning razonable |
| Datos — objetivo narración | **20–60 min** | el target de este proyecto |
| Tiempo de GPU | de ~30 min a varias horas | depende de datos y epochs; ver caveats |

Calidad de los datos manda sobre la cantidad: un solo micrófono, una sola
sala, sin música ni ruido, registros variados (narración neutra, diálogo,
énfasis). Clips de 6–12 s.

## Paso 1 — Preparar el dataset

Herramienta de este repo: [`tools/finetune/prepare_dataset.py`](../tools/finetune/prepare_dataset.py)
(standalone: corre en su PROPIO entorno, nunca en el runtime de VoxForge).

```powershell
python -m venv .venv-finetune
.venv-finetune\Scripts\activate
pip install faster-whisper pydub      # ffmpeg ya está en PATH (dependencia de VoxForge)

python tools\finetune\prepare_dataset.py D:\grabaciones D:\dataset --language es
```

Salida (formato ljspeech del trainer de Coqui):

```
D:\dataset\
├── metadata.csv          # clip_id|texto|texto
└── wavs\*.wav            # mono, 16-bit, 22050 Hz, 6–12 s
```

Revisar `metadata.csv` a mano antes de entrenar: corregir transcripciones
erróneas es la mejora más barata de todo el pipeline. Ojo: el trainer oficial
descarta clips de más de ~11.6 s (`max_wav_length=255995`); el script avisa si
los hay.

## Paso 2 — Entrenar (dos rutas)

### Ruta A (recomendada en Windows): pipeline de AllTalk

[AllTalk TTS](https://github.com/erew123/alltalk_tts) trae un fine-tuning de
XTTS con UI (Gradio) pensado para Windows: gestiona dataset, entrenamiento y
empaquetado del modelo final.

1. Instalar AllTalk en su propio entorno (instrucciones `atsetup` del repo).
2. Lanzar el módulo de fine-tuning (`finetune.py`) y apuntar al dataset del
   Paso 1 (también puede generar su propio dataset desde audio crudo, con
   Whisper; usar el nuestro da control sobre la curación).
3. Parámetros de arranque razonables para 12 GB: batch size 2,
   grad accumulation 16, 10 epochs, learning rate 5e-6. Subir epochs solo si
   el eval loss sigue bajando.
4. Al terminar, usar la opción de **compactar/exportar el modelo** : produce
   un directorio con `config.json`, `model.pth`, `vocab.json` (+ wavs de
   referencia).

### Ruta B: trainer oficial de Coqui

Con el fork mantenido ([idiap/coqui-ai-TTS](https://github.com/idiap/coqui-ai-TTS),
el paquete `coqui-tts` que ya usa VoxForge), receta
`recipes/ljspeech/xtts_v2/train_gpt_xtts.py`:

1. Entorno propio: `pip install coqui-tts` (con la misma versión de torch+CUDA
   que VoxForge).
2. Copiar la receta y ajustar `BaseDatasetConfig`:
   `formatter="ljspeech"`, `path="D:/dataset"`, `meta_file_train="metadata.csv"`,
   `language="es"`. `load_tts_samples(..., eval_split=True)` hace el split de
   eval automáticamente.
3. Para 12 GB: `batch_size=2`, `grad_accum_steps=16` (el producto efectivo
   ~32 es lo que la receta espera), `precision="fp16"`.
4. El mejor checkpoint queda como `best_model.pth` en el directorio de
   salida; renombrarlo/copiarlo a `model.pth` junto a `config.json` y
   `vocab.json` del run.

## Paso 3 — Cargar el checkpoint en VoxForge

Setting `xtts_checkpoint_dir` (en `backend/config.py`, default `None` =
modelo stock). Apuntar al directorio del Paso 2 vía `.env` o variable de
entorno y reiniciar el backend:

```dotenv
VOXFORGE_XTTS_CHECKPOINT_DIR=D:\modelos\xtts-autor-v1
```

El directorio debe contener al menos `config.json`, `model.pth` y
`vocab.json`. `CloneEngine.load_model` lo carga en lugar del modelo stock;
todo lo demás (perfiles, muestras de conditioning, re-ranking ASR de VOZ-08,
sampler de VOZ-09) funciona igual. Para volver al stock: quitar la variable y
reiniciar.

Validación rápida: sintetizar el mismo párrafo con y sin
`VOXFORGE_XTTS_CHECKPOINT_DIR` y comparar A/B (mismo perfil, mismos params).

## Caveats (leer antes de quemar GPU)

- **Horas de GPU**: cada experimento (datos nuevos, más epochs, otro LR) son
  decenas de minutos a horas en la 4070S. Iterar primero con 5–10 min de
  datos y 10 epochs antes de comprometer el dataset completo.
- **Licencia**: los pesos fine-tuneados **heredan la licencia CPML
  no-comercial** del checkpoint base de XTTS v2. Mismo régimen que ya aplica
  al uso del modelo stock en VoxForge, pero conviene tenerlo escrito: el
  resultado no se puede usar comercialmente ni redistribuir fuera de CPML.
  (La salida de una migración futura de motor — PROD-06 — no arrastraría
  esta herencia.)
- **Overfitting**: con <10 min de datos, demasiados epochs producen una voz
  que "lee" con monotonía calcada de las muestras. Vigilar eval loss y
  escuchar checkpoints intermedios.
- **El fine-tuning no arregla el techo estructural** del AR de 2023 (saltos,
  sensibilidad a la longitud): eso queda delegado al spike PROD-06.
