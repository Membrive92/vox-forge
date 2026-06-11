# SETUP_PROVISIONING.md

Objetivo: dejar `vendor/ComfyUI` operativo y con todos los modelos en disco con
un solo script (`scripts/setup.ps1`), idempotente (re-ejecutable sin re-descargar
lo ya presente). Descarga total: ~55 GB. Tiempo dominado por la red.

## 1. Prechecks (el script aborta o avisa)

| Check | Umbral | Acción si falla |
|---|---|---|
| GPU | `nvidia-smi` presente, 12 GB | abortar |
| RAM de sistema | ≥ 32 GB | **avisar** (con 16 GB el offload del umt5 + caché de expertos provoca swapping a disco y multiplica tiempos) |
| Disco libre | ≥ 80 GB | abortar |
| Python | 3.11 o 3.12 en PATH (`py -3.12`) | abortar |
| Driver NVIDIA | razonablemente reciente (CUDA 12.x) | avisar |

## 2. ComfyUI vía comfy-cli (venv aislado)

```powershell
py -3.12 -m venv vendor\comfy-bootstrap
vendor\comfy-bootstrap\Scripts\python.exe -m pip install comfy-cli

# Instala ComfyUI en vendor\ComfyUI. comfy-cli resuelve dependencias en un
# lockfile y selecciona automáticamente el wheel de PyTorch CUDA para la GPU.
vendor\comfy-bootstrap\Scripts\comfy.exe --workspace vendor\ComfyUI install
```

Tras la instalación, registrar el commit en la config:

```powershell
git -C vendor\ComfyUI rev-parse HEAD   # → [engine].comfyui_pin en pipeline.toml
```

Localizar el intérprete del workspace (lo usa `ComfyEngine` para lanzar el
subproceso) y registrarlo en `[engine].python_exe`. Según cómo instale comfy-cli
en esta máquina puede ser un venv dentro del workspace o el entorno activo en la
instalación; el script debe detectarlo (buscar `python.exe` bajo `vendor\ComfyUI`)
y fallar con mensaje claro si no lo encuentra, no adivinar.

## 3. Custom nodes

Imprescindible: **ComfyUI-GGUF** (city96), que aporta los loaders
`UnetLoaderGGUF` / `CLIPLoaderGGUF`.

```powershell
vendor\comfy-bootstrap\Scripts\comfy.exe --workspace vendor\ComfyUI node install comfyui-gguf
```

Fallback si el registro falla:

```powershell
git clone https://github.com/city96/ComfyUI-GGUF vendor\ComfyUI\custom_nodes\ComfyUI-GGUF
<python_del_workspace> -m pip install -r vendor\ComfyUI\custom_nodes\ComfyUI-GGUF\requirements.txt
```

Opcionales (solo si se activa la fase de postproceso, ADR-004):
`ComfyUI-Frame-Interpolation` (RIFE) y `ComfyUI-VideoHelperSuite`. No instalarlos
en v1: cada nodo extra es superficie de rotura.

La verificación real de nodos no es "el clone terminó": es que aparezcan en
`GET /object_info` con ComfyUI arrancado. Eso lo hace `python -m pipeline validate`.

## 4. Modelos — tabla de descargas

Comando patrón (uno por fila):

```powershell
vendor\comfy-bootstrap\Scripts\comfy.exe --workspace vendor\ComfyUI model download `
  --url <URL> --relative-path models/<carpeta>
```

### Vídeo (Wan 2.2 I2V A14B)

| Fichero | Carpeta destino | Tamaño | URL |
|---|---|---|---|
| Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf | `models/unet` | 10,8 GB | https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF/resolve/main/HighNoise/Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf |
| Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf | `models/unet` | 10,8 GB | https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF/resolve/main/LowNoise/Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf |
| umt5_xxl_fp8_e4m3fn_scaled.safetensors | `models/text_encoders` | ~6 GB | https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors |
| wan_2.1_vae.safetensors | `models/vae` | ~250 MB | https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors |
| high_noise_model.safetensors → renombrar a `wan22_i2v_lightning4_high.safetensors` | `models/loras` | ~0,6 GB | https://huggingface.co/lightx2v/Wan2.2-Lightning/resolve/main/Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1/high_noise_model.safetensors |
| low_noise_model.safetensors → renombrar a `wan22_i2v_lightning4_low.safetensors` | `models/loras` | ~0,6 GB | https://huggingface.co/lightx2v/Wan2.2-Lightning/resolve/main/Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1/low_noise_model.safetensors |

Notas: ComfyUI-GGUF documenta `models/unet` como ruta de sus loaders. El repo
lightx2v puede publicar versiones Seko posteriores a V1; usar la más reciente
**para I2V** que exista en el repo y registrar cuál en el sidecar (el renombrado
local fija el nombre que referencia el workflow). Fallbacks de cuantización
(ADR-003): sustituir `Q5_K_M` por `Q4_K_M` (9,65 GB) o `Q4_K_S` (8,75 GB) en las
dos primeras URLs.

### Imagen (Z-Image-Turbo)

| Fichero | Carpeta destino | Tamaño | URL |
|---|---|---|---|
| z_image_turbo_bf16.safetensors | `models/diffusion_models` | ~12,3 GB | https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors |
| qwen_3_4b.safetensors | `models/text_encoders` | ~8 GB | https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors |
| ae.safetensors | `models/vae` | ~335 MB | https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors |

> **Nota (2026-06)**: Comfy-Org retiró el `z_image_turbo_fp8.safetensors` (~6 GB)
> que pinaba la versión original de este documento; el repo ahora ofrece bf16 y
> nvfp4 (este último solo nativo en Blackwell). Se baja el **bf16 oficial** y el
> workflow lo carga con `weight_dtype: fp8_e4m3fn` → mismo consumo de VRAM en
> runtime que el fp8 retirado, misma fuente oficial. Se descartó un fp8 de
> terceros por trazabilidad.

El script debe **verificar nombre exacto y tamaño tras descargar** (los repos de
Comfy-Org ocasionalmente reorganizan `split_files/`; si una URL da 404, listar el
repo con la API de HF y localizar el fichero por nombre antes de rendirse).

## 5. Export de workflows (paso humano, una sola vez)

Arrancar la GUI: `vendor\comfy-bootstrap\Scripts\comfy.exe --workspace vendor\ComfyUI launch`

**Vídeo** — `workflows/wan22_i2v_q5.api.json`:
1. Workflow → Browse Templates → Video → plantilla **Wan 2.2 14B I2V** (incluye
   la variante Lightning; mantener activa la rama acelerada).
2. Sustituir los loaders de difusión por **UnetLoaderGGUF** ×2 apuntando a los
   Q5_K_M (high y low). Encoder: umt5 fp8. LoRAs: los dos ficheros renombrados,
   cada uno en su rama (high → experto high-noise, low → low-noise).
3. Fijar 832×480, length 81, fps 16. No tocar sampler/scheduler/shift ni el
   reparto de pasos del template (4 totales, CFG 1.0): son fuente de verdad.
4. Renombrar títulos de nodos según la convención de SPEC_COMFY_ENGINE §7.
5. Activar "Dev mode" en ajustes si hace falta y **Save (API Format)**.

**Imagen** — `workflows/zimage_t2i_fp8.api.json`:
1. Cargar la plantilla oficial: https://raw.githubusercontent.com/Comfy-Org/workflow_templates/refs/heads/main/templates/image_z_image_turbo.json
   (o Browse Templates → Image → Z-Image Turbo).
2. Seleccionar `z_image_turbo_bf16.safetensors` en el nodo "Load Diffusion
   Model" y fijar su **`weight_dtype: fp8_e4m3fn`** (clave: es lo que mantiene
   el modelo en ~6 GB de VRAM; en `default` ocuparía ~12 GB y no cabe junto al
   encoder). Encoder `qwen_3_4b`, VAE `ae`. 8 pasos, CFG en rango 1,5–2,0
   (valores >4 degradan en modelos destilados).
3. Tamaño 1248×720. Renombrar títulos. Save (API Format).

Criterio de hecho: ambos JSON commiteados y la GUI los recarga sin nodos en rojo.

## 6. Smoke test manual + benchmark

Con la GUI aún abierta: generar 1 imagen y 1 clip (bajar length a 33 frames para
la prueba). Registrar en `docs/BENCHMARK.md`: tiempo de cada uno, pico de VRAM
(`nvidia-smi -l 1` en otra terminal), OOM sí/no, y la decisión Q5/Q4 resultante.
Este dato es el gate hacia la Fase 2 (ver IMPLEMENTATION_PLAN).

Condiciones del benchmark: monitor conectado a la 4070 Super implica 0,5–1 GB de
VRAM ya ocupada por Windows/navegador; cerrar Chrome durante las medidas y
anotar la VRAM libre inicial.

## 7. Esqueleto de `scripts/setup.ps1`

```powershell
# setup.ps1 — provisión idempotente. Implementar según este orden:
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_checks.ps1"      # prechecks de §1 (funciones Assert-Gpu, etc.)

Assert-Gpu; Warn-IfLowRam; Assert-DiskFree -Gb 80; Assert-Python

if (-not (Test-Path "vendor\comfy-bootstrap")) { py -3.12 -m venv vendor\comfy-bootstrap }
& vendor\comfy-bootstrap\Scripts\python.exe -m pip install --upgrade comfy-cli

if (-not (Test-Path "vendor\ComfyUI\main.py")) {
  & vendor\comfy-bootstrap\Scripts\comfy.exe --workspace vendor\ComfyUI install
}
& vendor\comfy-bootstrap\Scripts\comfy.exe --workspace vendor\ComfyUI node install comfyui-gguf

# Descargas de §4: bucle sobre una tabla (url, relpath, nombre_final, bytes_min).
# Saltar si el fichero existe con tamaño plausible; renombrar las LoRAs.

git -C vendor\ComfyUI rev-parse HEAD | Out-File -Encoding ascii vendor\comfyui.pin
Write-Host "Provisión completa. Siguiente paso humano: SETUP_PROVISIONING §5 (export de workflows)."
```

## 8. Política de actualización

`vendor/ComfyUI` y los custom nodes solo se actualizan por decisión explícita:
actualizar → re-pasar smoke test → actualizar `comfyui_pin` en config y
`vendor/comfyui.pin` → commit con mensaje `chore: bump ComfyUI <hash>`. Si un
workflow deja de cargar tras un bump, la respuesta correcta es re-exportarlo
desde la GUI (paso §5), no parchear el JSON a mano.
