# Configuración de voz — narración con voz clonada (registro)

Este documento deja por escrito la configuración de voz que **funciona** para
narrar un capítulo con una voz clonada, con buena calidad y **acento de España**.
Es el resultado de una sesión larga de pruebas; aquí está lo que quedó montado y
cómo reproducirlo.

---

## 1. La vía que funciona: XTTS (texto → voz clonada)

Hay dos formas de "ponerle otra voz" a un capítulo. La que da buen resultado es la
primera:

| Vía | Qué hace | Calidad | Prosodia |
|---|---|---|---|
| **XTTS (recomendada)** | escribes el **texto** y lo lee tu voz clonada | **limpia, coherente** | la pone el modelo |
| OpenVoice ("Aplicar voz") | re-vozea **tu grabación** (audio→audio) | metálica/robótica (techo del modelo) | conserva la tuya |

**Conclusión de las pruebas:** OpenVoice toca techo (suena robótico). **XTTS es la
vía buena.** Se pierde tu entonación exacta (la decide el modelo), pero suena
mucho más natural.

---

## 2. Configuración exacta que quedó montada

### Perfil de voz: **`Prueba edot`**
- `voice_id`: `es-ES-AlvaroNeural` · idioma `es`
- **sample**: una grabación de voz **humana real** (mp3). *Importante: una voz
  humana real da mejor resultado que las voces del catálogo (que son sintéticas
  → más robóticas).*
- **`castilian_anchor` = ACTIVADO** ← la clave del acento.

> Para activarlo en un perfil: `PATCH /api/profiles/{id}` con
> `{"castilian_anchor": true}` (o el toggle del perfil en la UI).

### Voz de referencia del ancla: **`data/voices/reference/aa_castellano_edge.mp3`**
- Clip **castellano, limpio y de ritmo medido**, generado con Edge-TTS
  (`es-ES-AlvaroNeural`, `rate=-5%`, ~12 s).
- El ancla **antepone ~8 s de esta referencia** al condicionar XTTS → mantiene el
  acento de España **sin** la prisa.
- La app coge **el primer fichero por orden alfabético** de
  `data/voices/reference/`; por eso el nombre empieza por `aa_` (gana a cualquier
  otro como `recorte_...`).

> ⚠️ **Si la referencia está hablada rápido, la narración sale acelerada.** Usa
> una referencia de **ritmo pausado** (como esta de Edge-TTS).

---

## 3. Cómo usarlo (paso a paso)

1. **Workbench** → tu proyecto → despliega el capítulo.
2. **Voz del capítulo** = `Prueba edot` (perfil con `castilian_anchor` ON).
3. **Texto**: pega tu **guion** en el cuadro (o usa **"Transcribir"** para sacarlo
   de una grabación y **corrige los nombres propios**). Cuida la puntuación: XTTS
   la usa para las pausas.
4. **"Sintetizar capítulo"** → XTTS lee el texto en la voz clonada (≈1 min).
5. Si un trozo suena raro: **"Regen"** solo en ese chunk del mapa.

→ Cada síntesis con este perfil sale ya con **acento de España + ritmo normal**.
La config **persiste** tras reiniciar.

---

## 4. Montar el mismo acento para OTRA voz

1. Crea el perfil con un **sample de voz humana real** (cuanto más limpio y largo,
   mejor; ideal WAV o mp3 >128 kbps, 20-30 s de voz real).
2. Actívale **`castilian_anchor`**.
3. La **referencia es compartida** (`aa_castellano_edge.mp3`) — no hay que crear
   una por voz.

---

## 5. Palancas si algo no cuadra

| Problema | Palanca |
|---|---|
| **Acento** se va a latino (seseo) | activar `castilian_anchor`; si aún se escapa, bajar `VOXFORGE_XTTS_TEMPERATURE` (menos deriva) |
| **Ritmo** demasiado rápido | usar una **referencia de ancla más pausada**, o bajar la **velocidad** del capítulo |
| **Robótico / no se parece** | el **sample** manda: usa voz humana real, limpia, ≥20 s. (Las voces de catálogo son sintéticas → más robóticas) |
| Palabras mal (nombres, latín) | corrige el **texto** — XTTS lee literal lo que pongas |

Los parámetros del muestreo XTTS se tocan por **variables de entorno** sin tocar
código: `VOXFORGE_XTTS_TEMPERATURE`, `VOXFORGE_XTTS_TOP_P`, etc.

---

## 6. Notas de diseño (por qué esta config)

- **Voz humana real > catálogo**: el catálogo (Edge-TTS) es sintético; clonarlo da
  un timbre ya "de robot". Una voz humana real, aunque sea mp3 comprimido, sale
  más natural.
- **El `castilian_anchor`** es la palanca específica contra el drift de acento de
  XTTS (tiende al español latino).
- **La referencia del ancla marca el ritmo**: una referencia rápida acelera la
  narración. Por eso se usa una medida.
- **No encadenar conversiones**: "Aplicar voz" parte siempre de la grabación
  **original** (corregido en código); aplicarlo sobre una conversión previa
  acumula artefactos y destruye el audio.

---

## 7. Ficheros y rutas clave

- Perfiles: `data/profiles/profiles.json` (flag `castilian_anchor` por perfil).
- Referencia del ancla: `data/voices/reference/aa_castellano_edge.mp3`.
- Samples de los perfiles: `data/voices/`.
- Motor de clonado XTTS: `backend/services/clone_engine.py`.
- Ancla castellana: `backend/services/castilian_warmup.py`
  (`get_reference_voice`, `build_anchored_speaker_wav`).
