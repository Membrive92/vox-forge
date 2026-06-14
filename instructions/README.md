# Cómo levantar VoxForge

Arranca los dos servicios de la app: **backend** (FastAPI, puerto 8000) y
**frontend** (Vite, puerto 3000).

## Lo más rápido

- **Doble clic en `levantar-app.bat`** → abre dos ventanas (backend y frontend)
  y la app queda en **http://localhost:3000**.

O desde una terminal en la raíz del repo:

```powershell
powershell -ExecutionPolicy Bypass -File instructions\levantar-app.ps1
```

El script comprueba prerequisitos, hace `npm install` la primera vez si falta
`node_modules`, y lanza cada servicio en su propia ventana.

## Requisitos previos (una sola vez)

- **Python 3.11+** con las dependencias instaladas: `pip install -r requirements.txt`
- **Node.js / npm** (el script hace `npm install` si hace falta)
- **ffmpeg** en el PATH (síntesis de audio y render de vídeo lo necesitan)

## URLs

| Servicio | URL |
|---|---|
| App (lo que usas) | http://localhost:3000 |
| API / health      | http://127.0.0.1:8000/api/health |

## Parar la app

Cierra las dos ventanas que abrió el script (o `Ctrl+C` en cada una).

## Comandos manuales (por si los prefieres a mano)

```powershell
# Backend (en una terminal)
python -m uvicorn backend:app --reload --port 8000

# Frontend (en otra terminal)
npm run dev
```

## Configuración de voz (narración clonada)

Cómo dejar una narración con voz clonada, buena calidad y **acento de España**
(perfil + `castilian_anchor` + referencia castellana medida): ver
[`configuracion-voz.md`](configuracion-voz.md).

## Imágenes REALES con ComfyUI (Z-Image-Turbo)

Por defecto la generación de imágenes usa un **proveedor placeholder** (imagen
de texto-sobre-gradiente, sin GPU). El **workflow de imagen ya está incluido y
verificado** (`img_generation_module/workflows/zimage_t2i_fp8.api.json`,
1248×720, ~13-22 s en una RTX 4070 Super), así que para imágenes reales basta
arrancar ComfyUI y apuntar el backend a él:

```powershell
# 1) Arrancar ComfyUI embebido (ventana aparte; deja la GPU libre antes)
cd img_generation_module
python -m pipeline engine up        # ComfyUI en http://127.0.0.1:8188
cd ..

# 2) Arrancar el backend apuntando al proveedor real:
$env:VOXFORGE_IMAGE_PROVIDER = "comfyui"
python -m uvicorn backend:app --reload --port 8000
```

Sin ComfyUI (o sin la variable), el provider es `placeholder` y el composer lo
avisa; las imágenes salen como marcador.

> **Vídeo** (clips animados, Wan 2.2 I2V): aún NO disponible — su workflow
> (`wan22_i2v_q5.api.json`) no está hecho. Ver
> `internal-docs/video-gen-viability.md`.
