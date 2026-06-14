# BENCHMARK.md — Gate entre Fase 1 y Fase 2

Condiciones: ver SETUP_PROVISIONING §6 e IMPLEMENTATION_PLAN §GATE.

## Imagen (Z-Image-Turbo) — MEDIDO 2026-06-14 ✅

Hardware: RTX 4070 Super 12 GB. Workflow: `workflows/zimage_t2i_fp8.api.json`
(autorado del subgrafo oficial; `weight_dtype=fp8_e4m3fn`, 8 pasos,
`res_multistep`/`simple`, CFG 1, ModelSamplingAuraFlow shift 3).

| Medida | Valor | Condiciones |
|---|---|---|
| Imagen 1248×720, 8 pasos (primera, con carga de modelo) | **21.8 s** | VRAM libre inicial ~9.5 GB |
| Imagen 1248×720, 8 pasos (en caliente, modelo cargado) | **13.3 s** | — |
| Pico VRAM durante generación | **~9.1 GB usados** (cabe en 12 GB) | sin offload forzado |
| OOM observado | **no** | — |
| Salida verificada | PNG real 1248×720 RGB, ~1.2 MB | vía provider `comfyui` de la app, de punta a punta |

**Decisión imagen**: `z_image_turbo_bf16.safetensors` + cast `fp8_e4m3fn` en el
loader. Funciona y entra holgado; no hace falta bajar nada.

## Vídeo (Wan 2.2 I2V) — PENDIENTE

| Medida | Valor | Condiciones |
|---|---|---|
| Clip 832×480×81f, Q5_K_M + Lightning | ___ s | pico VRAM: ___ |
| OOM observado | sí/no | en qué paso |
| Decisión de cuantización | Q5_K_M / Q4_K_M / Q4_K_S | |

Notas:

- El workflow de vídeo (`wan22_i2v_q5.api.json`) aún no existe — el grafo I2V de
  Wan 2.2 (dos expertos GGUF + LoRAs Lightning) es mucho más intrincado de
  autorar a mano; mejor exportarlo desde la GUI (SETUP §5) o intentarlo aparte.
- Si el clip Q5 da OOM estable → bajar a Q4_K_M (SETUP §4), re-exportar el
  workflow apuntando a los nuevos ficheros, actualizar `[models].video_quant`
  y repetir.
