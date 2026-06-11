# BENCHMARK.md — Gate entre Fase 1 y Fase 2 (lo rellena el humano)

Condiciones: cerrar Chrome durante las medidas, anotar la VRAM libre inicial
(`nvidia-smi -l 1` en otra terminal). Ver SETUP_PROVISIONING §6 e
IMPLEMENTATION_PLAN §GATE.

| Medida | Valor | Condiciones |
|---|---|---|
| Imagen 1248×720, 8 pasos | ___ s | VRAM libre inicial: ___ |
| Clip 832×480×81f, Q5_K_M + Lightning | ___ s | pico VRAM: ___ |
| OOM observado | sí/no | en qué paso |
| Decisión de cuantización | Q5_K_M / Q4_K_M / Q4_K_S | |

Notas:

- Expectativas orientativas (no contractuales): imagen en segundos de un dígito
  alto; clip en 2–6 min.
- Si el clip Q5 da OOM estable → bajar a Q4_K_M (SETUP §4), re-exportar el
  workflow apuntando a los nuevos ficheros, actualizar `[models].video_quant`
  y repetir. La decisión queda escrita aquí; el código no la adivina.
