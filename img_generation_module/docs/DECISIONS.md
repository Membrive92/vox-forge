# DECISIONS.md — Registro de decisiones (ADR)

Fecha de validez: **junio 2026**. El ecosistema de modelos locales cambia en
ciclos de 3–6 meses; cualquier ADR puede revisarse, pero la revisión es un acto
explícito (nueva ADR que supersede), nunca un refactor silencioso.

---

## ADR-001 — Motor de inferencia: ComfyUI embebido como subproceso

**Estado**: aceptada.

**Decisión**: toda la inferencia de visión (T2I y I2V) se ejecuta en una
instancia local de ComfyUI, lanzada y supervisada por la app como subproceso,
controlada por su API HTTP/WebSocket. La app no importa torch para visión.

**Alternativas evaluadas y rechazadas**:

1. *diffusers in-process*. Para imagen sería suficiente; para vídeo en 12 GB
   exige reproducir a mano la capa de optimización: carga GGUF del transformer,
   offload por bloques y cableado de las dos LoRAs Lightning sobre los dos
   expertos del MoE. Ese soporte está sin resolver en los pipelines oficiales
   (issue abierto: https://github.com/huggingface/diffusers/issues/12146).
   Coste estimado: semanas de integración propia para igualar lo que ComfyUI
   da empaquetado el día uno.
2. *LightX2V como framework pip-instalable* (https://github.com/ModelTC/LightX2V).
   Trae cuantización y offload integrados y es del mismo equipo que las LoRAs
   Lightning. Rechazado para v1 por API joven, documentación escasa y comunidad
   pequeña: riesgo de mantenimiento en el corazón de la app. Candidato natural
   si en el futuro se quiere eliminar el subproceso.

**Por qué ComfyUI gana en este contexto**: gestión de memoria con offload
automático apta para GPUs pequeñas, workflows oficiales día-cero para los
modelos elegidos, y el ecosistema GGUF/Lightning vive ahí. El precio aceptado:
un subproceso con ~40 líneas de ciclo de vida y grafos JSON como artefactos.

**Consecuencias**: versión de ComfyUI pineada; los workflows son ficheros
versionados; el código solo los parametriza (ADR-005).

---

## ADR-002 — Selección de modelos y licencias

**Estado**: aceptada.

**Decisión**:

- Imagen: **Z-Image-Turbo** (Tongyi/Alibaba, 6B, S3-DiT, destilado a 8 pasos).
  Licencia Apache 2.0. https://huggingface.co/Tongyi-MAI/Z-Image-Turbo
- Vídeo: **Wan 2.2 I2V A14B** (Alibaba, MoE de dos expertos ~14B, 27B totales /
  14B activos por paso). Licencia Apache 2.0.
  https://huggingface.co/Wan-AI/Wan2.2-I2V-A14B

**Criterio de licencia (bloqueante)**: el autor reside en España y el canal
puede monetizarse. Solo se admiten modelos cuyo uso comercial en la UE sea
inequívoco. Apache 2.0 lo es.

**Rechazados**:

- *HunyuanVideo / HunyuanImage (Tencent)*: su licencia define el Territorio como
  todo el mundo **excluyendo la Unión Europea**, Reino Unido y Corea del Sur, y
  prohíbe usar los modelos y sus outputs fuera de él.
  Fuente: https://github.com/Tencent/HunyuanVideo/blob/main/LICENSE.txt
  Prohibido introducirlos en este repo aunque un tutorial los recomiende.
- *FLUX.2 dev / klein (Black Forest Labs)*: licencia no comercial; el despliegue
  comercial requiere licencia aparte de BFL. Ambigüedad innecesaria habiendo
  alternativa Apache de calidad comparable.
- *LTX-2.3 (Lightricks)*: técnicamente atractivo (audio+vídeo nativo), pero
  licencia dual comunidad/comercial y 32 GB de VRAM como mínimo oficial; las
  variantes GGUF en 12 GB quedan por detrás de Wan A14B en este caso de uso.
- *Wan 2.7*: anunciado como cabeza de la línea open de Alibaba, pero a fecha de
  este documento la disponibilidad de pesos locales no estaba verificada en los
  repos oficiales (Wan-Video en GitHub exponía 2.1 y 2.2). Revisar
  https://huggingface.co/Wan-AI antes de cualquier upgrade; si publican pesos
  Apache 2.0 con soporte ComfyUI, es el candidato de sustitución directa.
- *Qwen-Image* (Apache 2.0, 20B): excelente, pero ~24 GB de presupuesto; fuera
  del hardware objetivo.

---

## ADR-003 — Cuantización y reparto de memoria en 12 GB

**Estado**: aceptada; sujeta al gate de benchmark (IMPLEMENTATION_PLAN).

**Decisión** (vídeo):

- Transformers GGUF **Q5_K_M** para ambos expertos (10,8 GB por fichero;
  ComfyUI los carga secuencialmente, no a la vez).
  Repo: https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF
- Text encoder `umt5_xxl_fp8_e4m3fn_scaled` con offload a CPU (lo gestiona
  ComfyUI). Es lo que mantiene el consumo a 480p en el margen de 12 GB.
- LoRAs Lightning I2V 4-step (rank 64, high + low noise) de
  https://huggingface.co/lightx2v/Wan2.2-Lightning — Apache 2.0. CFG 1.0,
  4 pasos totales repartidos entre expertos según el template oficial.

**Escalera de fallback si el benchmark da OOM a 832×480×81f**:
`Q5_K_M (10,8 GB) → Q4_K_M (9,65 GB) → Q4_K_S (8,75 GB)`. El nivel activo es un
valor de configuración (`[models].video_quant`), no una constante en código.

**Decisión** (imagen): `z_image_turbo_fp8.safetensors`. El BF16 ocupa ~12 GB él
solo (inviable junto al encoder en esta tarjeta) y la 4070 Super es Ada: ejecuta
FP8 e4m3fn de forma nativa. Encoder `qwen_3_4b.safetensors` (~7 GB) con offload
gestionado por ComfyUI.

> **Addendum (2026-06, provisión)**: Comfy-Org retiró el fichero fp8
> pre-cuantizado de su repo. Misma decisión de runtime por otra vía: se descarga
> el `z_image_turbo_bf16.safetensors` oficial y el loader lo carga con
> `weight_dtype: fp8_e4m3fn` (cast en carga; idéntico consumo de VRAM, ~6 GB).
> El "BF16 inviable" del párrafo anterior se refiere a ejecutarlo EN bf16 — eso
> sigue siendo cierto y por eso el cast a fp8 en el loader es obligatorio.

**Trade-off asumido y por qué es aceptable aquí**: Lightning puede reducir el
dinamismo del movimiento y produce artefactos con movimiento extremo (p. ej.
vehículos invirtiendo dirección, según su propio README). La estética del
proyecto es plano fijo, niebla lenta, movimiento sutil: el peor caso de
Lightning no aparece en este contenido. Para una toma concreta que exija más
fidelidad de movimiento existe la vía de escape: workflow sin LoRA a 20+ pasos
(variante documentada, no la ruta por defecto).

---

## ADR-004 — Resolución y postproceso

**Estado**: aceptada.

- Imagen: **1248×720** (AR 1,733, ~0,9 MP, divisible por 16). Cerca del punto
  dulce de entrenamiento de Z-Image (~1024²); resoluciones 2K directas
  introducen distorsión según la guía oficial del workflow.
- Vídeo nativo: **832×480 × 81 frames @ 16 fps** (~5 s). Misma AR que el still:
  el I2V reescala el primer frame sin recorte.
- 720p nativo descartado en esta GPU: el A14B FP8 a 720p consume 14–16 GB.
- Postproceso (upscale ×2 → 1664×960 + interpolación RIFE 16→32 fps): **fuera
  del grafo principal en v1**. Se entrega como fase opcional (workflow separado,
  flag `[post].enabled`), porque añade nodos, VRAM y puntos de fallo al camino
  crítico. Mientras tanto, el escalado puede hacerse en DaVinci. Razonamiento:
  el contenido brumoso de baja frecuencia espacial tolera bien el upscale.

---

## ADR-005 — Parametrización de workflows por título de nodo

**Estado**: aceptada.

Los JSON en formato API usan IDs numéricos que cambian entre re-exportaciones de
la GUI. El código localiza nodos por `_meta.title` con títulos reservados
(convención en SPEC_COMFY_ENGINE §7) y solo escribe los campos permitidos
(prompt, seed, imagen, tamaño, frames). Cualquier otro parámetro del grafo
(sampler, scheduler, shift, reparto de pasos entre expertos) es **fuente de
verdad del JSON**: se cambia en la GUI, se re-exporta y se commitea. El sidecar
de cada asset registra el SHA-256 del workflow usado.

---

## ADR-006 — Ejecución serial e idempotencia

**Estado**: aceptada.

- Un job de GPU a la vez. En 12 GB la "paralelización" es ficción: dos jobs
  concurrentes producen OOM o thrashing de offload. El throughput real viene de
  no recargar modelos entre items: por eso las fases agrupan (todas las
  imágenes del episodio, después todos los clips), de modo que ComfyUI mantenga
  cacheados los pesos de cada modalidad.
- Idempotencia por `params_hash` (SHA-256 del spec canónico + SHA del workflow):
  re-ejecutar un episodio solo regenera lo que cambió. `--force` invalida.
- Reproducibilidad: seed siempre explícita y persistida. Si el manifest no la
  fija, se deriva de forma determinista de (episodio, escena). Nota honesta: el
  determinismo bit-a-bit no está garantizado entre versiones de driver/torch; lo
  que se garantiza es la trazabilidad completa de parámetros.
