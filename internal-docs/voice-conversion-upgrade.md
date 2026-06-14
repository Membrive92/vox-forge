# Estudio de viabilidad — mejorar la conversión de voz (más allá de OpenVoice V2)

**Estado:** estudio / decisión pendiente. No implementado.
**Contexto:** la feature "Aplicar voz" (re-vozear una narración propia con el timbre
de un perfil o voz del catálogo, **conservando la prosodia del usuario**) usa
**OpenVoice V2**. El usuario reporta resultado **metálico** y que **no se parece**
del todo a la voz objetivo. Ya se aplicaron mejoras baratas (denoise de la fuente,
exponer `tau`, DSP de salida). Este documento evalúa el salto de calidad real:
sustituir/añadir un modelo de conversión moderno.

## 1. Por qué OpenVoice V2 toca techo

- Es un conversor de **tone-color** de 2023 a **22050 Hz** (los agudos se apagan →
  matiz "metálico"/telefónico).
- Extrae **un solo embedding** del sample objetivo: si el sample es corto/ruidoso,
  el "parecido" se resiente. Es su límite de diseño, no un bug.
- El watermark (causa del artefacto robótico) ya está **desactivado** en el código.

Conclusión: con un sample objetivo limpio y largo se mejora bastante, pero **el
techo de naturalidad/fidelidad es del modelo**. Para subirlo de verdad hay que
cambiar de motor.

## 2. Requisitos duros (heredados del proyecto)

- **Local**, sin nube, sin red en runtime.
- **GPU objetivo: RTX 4070 Super, 12 GB.** Comparte tarjeta con TTS/ComfyUI (un
  trabajo de GPU a la vez).
- **Licencia que permita uso comercial en la UE** (el resto del stack es Apache/MIT;
  evitar GPL en lo que se *distribuya*, aunque self-hosted suele ser viable).
- **Conservar la prosodia del usuario** (es el motivo de la feature) → tiene que ser
  **voice conversion** audio→audio, no TTS.

## 3. Candidatos

> ⚠️ Las licencias y los números exactos **hay que verificarlos en el repo oficial
> antes de decidir** — el ecosistema cambia rápido. Lo de abajo es el mapa para
> arrancar la evaluación, no una fuente legal.

| Modelo | Tipo | Calidad vs OpenVoice | Entreno por voz | Licencia (verificar) | 4070 12 GB |
|---|---|---|---|---|---|
| **OpenVoice V2** (actual) | zero-shot | base | No | MIT | sobra |
| **RVC** (Retrieval-based VC) | entrenado por voz | **muy superior** | **Sí** (~5-30 min/voz) | MIT | sobra; entreno cómodo |
| **seed-vc** | zero-shot | superior | No | verificar (¿GPL?) | sobra |
| **FreeVC** | zero-shot | algo superior | No | MIT | sobra |
| **CosyVoice 2** (Alibaba) | zero-shot (TTS+VC) | superior | No | Apache-2.0 (verificar) | cabe |
| **kNN-VC** | zero-shot (k-NN sobre WavLM) | variable, muy natural con ref larga | No | MIT (verificar) | sobra |

### Las dos familias

- **Zero-shot** (OpenVoice, seed-vc, FreeVC, kNN-VC, CosyVoice): das un **sample**
  del objetivo y convierte. Cero fricción, encaja 1:1 con el flujo actual (cambiar
  el provider del `convert_engine`). Calidad: de "algo mejor" a "bastante mejor".
- **Entrenado por voz** (**RVC**): entrenas un **modelo por voz** con los samples
  del perfil (minutos en la 4070). Es **la mejor calidad** y la más usada por la
  comunidad para "ponerle a mi narración la voz X", pero añade un **paso de
  entrenamiento** por voz (one-time) y gestión de checkpoints.

## 4. Recomendación

Dos caminos según cuánto quieras invertir:

1. **Salto grande, algo más de fontanería → RVC.**
   Entrenas un modelo RVC por cada voz objetivo (tus perfiles `ochate`,
   `permenides 90`, etc.) una sola vez. Resultado: timbre **mucho** más fiel y
   natural, conservando tu prosodia. Encaje: nuevo "provider" de conversión +
   un paso de "entrenar voz" en la pestaña Voces. MIT.
   *Es lo que recomiendo si la calidad es la prioridad.*

2. **Salto medio, drop-in zero-shot → seed-vc o FreeVC.**
   Sustituyes OpenVoice por uno de estos detrás de la misma feature "Aplicar voz"
   (mismo flujo: sample objetivo → convierte). Sin entrenar nada. Mejora notable
   sobre OpenVoice con cero cambios de UX. Verificar licencia (FreeVC MIT es la
   apuesta segura; seed-vc confirmar).

## 5. Encaje en la app

La arquitectura ya lo pone fácil:
- `backend/services/convert_engine.py` es un motor con interfaz clara
  (`convert(source, target_sample, ...)`). Se puede añadir un **provider
  alternativo** (patrón ya usado en imágenes: `PlaceholderProvider` vs
  `ComfyUIProvider`) seleccionable por env (`VOXFORGE_VC_ENGINE=openvoice|rvc|...`).
- El endpoint `/convert` y `/chapters/{id}/apply-voice` **no cambian de contrato**
  para el caso zero-shot.
- Para **RVC** hace falta además: descarga de base models, un paso de **entreno por
  voz** (CLI/endpoint) y guardar el checkpoint junto al perfil.

## 6. Gate (antes de comprometerse)

Igual que con imagen/vídeo: **un benchmark real en la 4070** antes de integrar.
1. Instalar el candidato en un entorno aparte (no tocar el runtime actual).
2. Convertir el **mismo clip** de narración con: OpenVoice (actual) vs candidato.
3. Medir: **calidad percibida** (A/B a ciegas), tiempo/clip, pico VRAM, y que la
   **prosodia** se conserve.
4. Verificar **licencia** del candidato para uso comercial UE.
5. Decidir: zero-shot drop-in (seed-vc/FreeVC) o RVC (entrenado).

## 7. Esfuerzo estimado

- **Zero-shot drop-in** (FreeVC/seed-vc): medio. Nuevo provider + dependencia +
  descarga de modelo + benchmark. UX igual.
- **RVC**: medio-alto. Provider + flujo de entreno por voz + gestión de checkpoints
  + UI de "entrenar voz". Pero es el techo de calidad.

## 8. Mientras tanto (sin tocar arquitectura)

Lo ya hecho en la "Parte A" (denoise de fuente, `tau`, DSP) + **un sample objetivo
limpio de 20-30s en WAV** exprime OpenVoice todo lo posible. Si con eso te vale,
genial; si no, este documento es el plan del salto.
