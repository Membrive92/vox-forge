# ComfyUI integration plan — generación de imágenes reales para escenas y portadas

**Fecha**: 2026-04-24
**Estado**: Planificado, pendiente de implementación
**Motivación**: Sprint 4 (B3) dejó el endpoint `POST /api/studio/generate-image` funcional pero con un único proveedor `PlaceholderProvider` que dibuja un gradiente con el prompt escrito encima. Sirvió para validar la UX y la canalización al slideshow; no sirve para un vídeo publicable en YouTube. Este documento describe cómo sustituir/añadir un proveedor real basado en un servidor **ComfyUI** local corriendo en la misma máquina (RTX 4070S 12 GB), sin romper el placeholder y sin acoplar VoxForge a un modelo concreto.

---

## Principio rector

**El backend no ejecuta difusión. Solo habla HTTP.** ComfyUI corre como proceso aparte (`python main.py --listen`) en `127.0.0.1:8188`. Esto garantiza:

- La VRAM del modelo de imagen **no compite** con la de XTTS/OpenVoice (cada servidor gestiona su ciclo de vida).
- Podemos cambiar de SDXL a FLUX a lo-que-venga sin tocar código Python — cambiamos el workflow JSON.
- Usuarios sin ComfyUI pueden seguir usando el `PlaceholderProvider`.
- La carga/descarga del modelo queda fuera de VoxForge (ComfyUI decide cuándo descargar a CPU).

El contrato del proveedor nuevo es el mismo que el actual ([image_gen.py:47](../backend/services/image_gen.py#L47)): `generate_async(prompt, aspect, seed) -> bytes`. Todo lo específico de ComfyUI (workflows, WebSocket, polling del histórico) queda encapsulado dentro del provider.

---

## Posición en la app

Los cambios tocan:

- **`backend/services/image_gen.py`** — nueva clase `ComfyUIProvider`.
- **`backend/config.py`** — settings nuevos (`image_provider`, `comfyui_url`, rutas a workflows).
- **`backend/data/comfyui_workflows/`** — carpeta nueva con plantillas JSON exportadas desde la UI de ComfyUI.
- **`backend/routers/studio.py`** — opcionalmente un param `style` en el request para elegir workflow.
- **`src/features/studio/VideoRenderPanel.tsx`** — selector de estilo en `ImageGenDialog` (si hay >1 workflow).
- **`src/features/activity/SettingsSection.tsx`** — indicador "ComfyUI online/offline" + campo opcional URL custom.

No toca: base de datos, tabla de renders, contrato del endpoint (salvo un campo opcional `style`).

---

## Contexto: qué hace ComfyUI

ComfyUI ([github.com/comfyanonymous/ComfyUI](https://github.com/comfyanonymous/ComfyUI)) es un servidor HTTP + WebSocket con un editor de workflows visuales encima. Para nosotros lo importante es su API:

| Endpoint | Uso |
|----------|-----|
| `POST /prompt` | Enviar un workflow JSON y recibir `{prompt_id}` |
| `GET /history/{prompt_id}` | Ver outputs generados (una vez completado) |
| `GET /view?filename=...` | Descargar una imagen generada |
| `WS /ws?clientId=...` | Progreso en tiempo real (`executing`, `progress`, `executed`) |

Un **workflow** es un grafo JSON de "nodos" (Load Checkpoint → CLIP Encode → KSampler → VAE Decode → SaveImage). Se exporta desde la UI con el botón "Save (API Format)". Los nodos tienen IDs numéricos y nosotros sobreescribimos los campos que nos interesan (prompt text, width, height, seed) antes de enviar.

### Workflows que vamos a mantener

Guardados en `backend/data/comfyui_workflows/` y referenciados desde `config.py`:

| Archivo | Modelo | Uso | Tamaños |
|---------|--------|-----|---------|
| `scene_sdxl.json` | JuggernautXL o DreamShaperXL | Fondo de escena (20–60 por capítulo) | 1344×768 / 768×1344 / 1024×1024 |
| `cover_flux.json` | FLUX.1 dev fp8 | Portada con texto legible | 1344×768 (16:9 YouTube) |
| `cover_sdxl.json` | SDXL + LoRA título | Alternativa low-VRAM | 1344×768 |

El **usuario final** puede añadir sus propios workflows soltando el JSON en esa carpeta y declarándolo en settings. Es el extension point sin tocar código.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│ FastAPI backend                                               │
│                                                               │
│  POST /api/studio/generate-image                             │
│  {prompt, aspect_ratio, seed?, style?}                       │
│      │                                                        │
│      ▼                                                        │
│  image_gen.generate_image(...)                                │
│      │                                                        │
│      ▼                                                        │
│  ComfyUIProvider.generate_async(prompt, aspect, seed)         │
│      │                                                        │
│      │  1. Load template JSON (scene_sdxl.json)               │
│      │  2. Patch: prompt, width/height, seed                  │
│      │  3. POST /prompt  → prompt_id                          │
│      │  4. Open WS, listen for `executed` event              │
│      │  5. GET /view?filename=...   (download bytes)          │
│      ▼                                                        │
│  Save PNG → STUDIO_COVERS_DIR/gen_xxx.png                     │
│  (mismo camino que el placeholder, zero changes downstream)   │
└──────────────────────────────────────────────────────────────┘
            │
            │  HTTP/WS
            ▼
┌──────────────────────────────────────────────────────────────┐
│ ComfyUI server (process aparte, 127.0.0.1:8188)               │
│   Checkpoints:  JuggernautXL, FLUX-dev-fp8                    │
│   Custom nodes: IPAdapter-plus (coherencia personajes)        │
└──────────────────────────────────────────────────────────────┘
```

La PNG resultante cae en `STUDIO_COVERS_DIR`, que ya está en `_ALLOWED_ROOTS` del router (`OUTPUT_DIR | STUDIO_DIR | JOBS_DIR` via `STUDIO_DIR` parent) → **el slideshow sigue aceptándola sin cambios**.

---

## Fases

| Fase | Qué aporta | Esfuerzo | Riesgo |
|------|-----------|----------|--------|
| **F1** — `ComfyUIProvider` MVP (1 workflow SDXL) | Imágenes de escena reales | ~4h | Bajo |
| **F2** — Health check + UX de errores | Mensaje claro si ComfyUI está caído | ~1h | Bajo |
| **F3** — Selector de estilo (múltiples workflows) | Portada FLUX + escena SDXL + anime, etc. | ~2h | Bajo |
| **F4** — Coherencia de personajes (IPAdapter) | Misma cara/estilo en todas las escenas | ~3-4h | Medio |
| **F5** — Consistencia de aspect ratio + bucket | Tamaños nativos SDXL (1344×768, no 1920×1080) | ~1h | Bajo |
| **F6** — Progreso en tiempo real en el FE | Barra de progreso durante generación | ~2h | Medio |

**MVP usable (F1+F2)**: ~5h. Produce imágenes reales generadas localmente integradas con el slideshow existente.

---

## F1 — `ComfyUIProvider` MVP (~4h)

### Objetivo
Subclase de `ImageProvider` que envía un workflow SDXL a ComfyUI, espera a que termine, y devuelve los bytes del PNG. Un único workflow de escena (sin selección de estilo todavía).

### Config nueva

`backend/config.py` añade:

```python
# Image generation
image_provider: Literal["placeholder", "comfyui"] = "placeholder"
comfyui_url: str = "http://127.0.0.1:8188"
comfyui_timeout_s: float = 120.0
comfyui_workflow_scene: str = "scene_sdxl.json"  # path relativo a data/comfyui_workflows/
```

Settings via `.env` (sin hardcoded URLs / keys — siguiendo convención del proyecto).

### `ComfyUIProvider`

Responsabilidades:
1. **Cargar el JSON template** una vez al inicializar (no por request).
2. **Patchear campos conocidos**: prompt (nodo "CLIPTextEncode", campo `text`), size (nodo "EmptyLatentImage", `width/height`), seed (nodo "KSampler", `seed`). Los IDs de nodos varían por workflow — usar un mini-esquema que mapee campos lógicos → ruta en el JSON:
   ```python
   SCENE_SDXL_BINDINGS = {
       "prompt": ("6", "inputs", "text"),
       "negative": ("7", "inputs", "text"),
       "width":  ("5", "inputs", "width"),
       "height": ("5", "inputs", "height"),
       "seed":   ("3", "inputs", "seed"),
   }
   ```
   Si el usuario sustituye el workflow, puede exportar su propio mapping en un `.bindings.json` junto al `.json`.
3. **Enviar `POST /prompt`** con `{"prompt": patched_graph, "client_id": self.client_id}`.
4. **Esperar resultado**. Dos opciones:
   - **WebSocket** (recomendado): escuchar el mensaje `{"type": "executed", "data": {"prompt_id": ..., "output": {"images": [...]}}}` para _nuestro_ prompt_id. Más reactivo.
   - **Polling a `/history/{prompt_id}`** cada 500 ms: más simple de implementar, OK para MVP.
   Empezar con polling, pasar a WS en F6.
5. **Descargar la imagen**: `GET /view?filename=<name>&subfolder=<sub>&type=output` → bytes directos.
6. **Timeout** con `asyncio.wait_for(generate_async(...), timeout=120)` — si un modelo tarda más, el FE verá un error claro.

### Resolución de aspect ratio

SDXL genera mejor en **buckets específicos**, no a 1920×1080 bruto:

```python
SDXL_BUCKETS = {
    "16:9": (1344, 768),
    "9:16": (768, 1344),
    "1:1":  (1024, 1024),
    "4:3":  (1152, 896),
}
```

FLUX admite tamaños más flexibles (1344×768 16:9 funciona bien), pero SDXL sale degradado fuera de buckets. El provider expone los buckets en vez del 1920×1080 del placeholder — el slideshow escala al render time vía ffmpeg sin pérdida visible.

### Estructura del módulo

[backend/services/image_gen.py](../backend/services/image_gen.py) pasa de ~190 líneas a ~400. Si crece más, partir:

```
backend/services/image_gen/
├── __init__.py          # re-exporta get_provider, generate_image
├── base.py              # ImageProvider ABC + VALID_ASPECT_RATIOS
├── placeholder.py       # PlaceholderProvider (lo actual)
├── comfyui.py           # ComfyUIProvider
└── workflows.py         # Carga de templates + bindings
```

Dejar la división para cuando aparezca el segundo workflow en F3; antes es overengineering.

### `_build_provider()` ramifica

```python
def _build_provider() -> ImageProvider:
    name = settings.image_provider
    if name == "comfyui":
        return ComfyUIProvider(
            url=settings.comfyui_url,
            workflow_path=COMFYUI_WORKFLOWS_DIR / settings.comfyui_workflow_scene,
            timeout_s=settings.comfyui_timeout_s,
        )
    return PlaceholderProvider()
```

### Tests (F1)

Sin conectar a un ComfyUI real — **mock del transport HTTP**:

- `test_comfyui_provider_patches_prompt_into_graph` — carga un template mínimo, verifica que `patched["6"]["inputs"]["text"]` == prompt.
- `test_comfyui_provider_patches_dimensions_from_aspect` — 16:9 → 1344×768 en el nodo correcto.
- `test_comfyui_provider_sends_post_prompt` — mock `httpx.AsyncClient.post`, assert body shape.
- `test_comfyui_provider_polls_history_and_downloads` — mock devuelve histórico con imagen, provider devuelve bytes.
- `test_comfyui_provider_timeout_raises` — servidor no responde a tiempo.
- `test_comfyui_provider_server_down_raises_clear_error` — connection refused.

Todos usando `respx` o `httpx.MockTransport` — CI no necesita ComfyUI.

---

## F2 — Health check + UX de errores (~1h)

### Backend

Endpoint nuevo: `GET /api/studio/image-provider/status` devuelve:

```json
{
  "name": "comfyui",
  "available": true,
  "version": "0.3.x",
  "server_url": "http://127.0.0.1:8188"
}
```

- Para `placeholder`: siempre `available: true`.
- Para `comfyui`: hace `GET {url}/system_stats` (endpoint ya existente) con timeout corto (2s). Si falla → `available: false` + `error: "connection_refused" | "timeout" | ...`.

### Frontend

Dos cosas:

1. **Chip de estado en `SettingsSection.tsx`**: "Image provider: ComfyUI ✓" / "ComfyUI offline — arranca `python main.py` en tu carpeta de ComfyUI".
2. **Error UX en el dialog de generación**: si `generateImage()` falla con el código de "provider unavailable", mensaje dedicado en vez del genérico "Error: ...".

El chip se refresca al abrir Settings y al abrir el dialog de generación (no polling continuo).

---

## F3 — Selector de estilo (~2h)

### Motivación
Portadas y escenas necesitan modelos/prompts distintos. Usuario elige en el FE qué "estilo" aplicar (→ qué workflow).

### Backend

- `config.py` añade:
  ```python
  comfyui_workflow_cover: str = "cover_flux.json"
  # Optional: un dict por si quieren definir más
  comfyui_styles: dict[str, str] = {}  # {"anime": "scene_pony.json", ...}
  ```
- Endpoint `GET /api/studio/image-styles` devuelve la lista de estilos disponibles (leyendo los JSON encontrados en la carpeta + los declarados en settings):
  ```json
  {"styles": [
    {"id": "scene", "label": "Escena (SDXL)", "aspect_ratios": ["16:9","9:16","1:1"]},
    {"id": "cover", "label": "Portada (FLUX)", "aspect_ratios": ["16:9"]}
  ]}
  ```
- `GenerateImageRequest` admite `style: str = "scene"`.
- `ComfyUIProvider` mantiene un registro `{style_id: (template, bindings)}` y ramifica al generar.

### Frontend

- `ImageGenDialog` añade un `<select>` de estilo (solo visible si hay >1 estilo disponible).
- Default: `"scene"` para el botón "Generate" de cada escena; en la futura vista de portada de proyecto, `"cover"`.

### Tests

- `test_list_image_styles_from_workflows_dir`
- `test_generate_image_with_unknown_style_400`
- `test_generate_image_routes_to_correct_workflow`

---

## F4 — Coherencia de personajes (~3-4h, opcional)

### Problema
Sin restricción, cada escena del capítulo tiene personajes distintos. Para narración de relatos queremos "el mismo narrador/protagonista" en todas.

### Solución
Workflow con **IPAdapter-plus** + nodo `LoadImage`:
1. Usuario sube una imagen de referencia ("así es mi personaje").
2. Workflow inyecta esa imagen como embedding condicionando al sampler.
3. Resultado: los personajes generados preservan rasgos de la referencia.

### Backend

- `ComfyUIProvider.generate_async(prompt, aspect, seed, reference_image_path=None)`.
- Si `reference_image_path` está, se copia al directorio `input/` de ComfyUI (o bien se sube via `POST /upload/image` si corre remoto) y se patchea el nodo `LoadImage`.
- Reference images por proyecto: `data/projects/{project_id}/character_ref.png`.

### Frontend

- En `ProjectSettings` (ya existe) nuevo campo "Referencia de personaje" — subida de imagen → `POST /api/projects/{id}/character-ref`.
- Al generar imagen de escena, el provider pasa automáticamente la referencia del proyecto.

### Tests

- `test_character_ref_copied_to_comfyui_input`
- `test_generate_without_character_ref_omits_ipadapter_node` — si no hay referencia, cargar un workflow alternativo sin IPAdapter.

---

## F5 — Aspect ratio buckets (~1h)

Ya cubierto dentro de F1 pero documentado como fase por si se quiere iterar:

- Añadir `get_bucket(provider_name, aspect) -> (w, h)` en lugar de hardcodear dentro de `ComfyUIProvider`.
- Para FLUX: buckets distintos, más permisivos.
- Tests parametrizados aspect × provider → tamaño esperado.

---

## F6 — Progreso en tiempo real en el FE (~2h)

### Motivación
SDXL tarda 5-10s, FLUX 20-40s. El dialog queda bloqueado sin feedback — en F1 mostramos spinner, en F6 barra real.

### Backend
- Provider usa WebSocket de ComfyUI en vez de polling. Publica el progreso a un callback.
- Endpoint nuevo: `GET /api/studio/image-progress/{job_id}` devuelve `{step: 14, total: 25}`.
- Integrar con el registry de progreso que ya existe (`backend/services/progress.py`) — reusar infra, no inventar.

### Frontend
- `generateImage()` recibe un `onProgress` callback; el dialog muestra una barra 0-100%.
- Si WebSocket no está disponible, fallback a polling cada 1s.

---

## Instalación y setup (documentación para README)

### Para el usuario

```bash
# 1. Clonar ComfyUI fuera del repo VoxForge
cd ~/tools
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt

# 2. Descargar modelos
# SDXL (7 GB):
curl -L https://huggingface.co/.../juggernautXL_v9.safetensors -o models/checkpoints/juggernautXL_v9.safetensors

# FLUX dev fp8 (12 GB) — opcional para portadas:
curl -L https://huggingface.co/.../flux1-dev-fp8.safetensors -o models/checkpoints/flux1-dev-fp8.safetensors

# 3. ComfyUI-Manager (instala nodos custom fácilmente)
cd custom_nodes
git clone https://github.com/ltdrdata/ComfyUI-Manager

# 4. Arrancar
python main.py  # escucha en 127.0.0.1:8188

# 5. En VoxForge, config:
# .env
IMAGE_PROVIDER=comfyui
COMFYUI_URL=http://127.0.0.1:8188
```

### Para VoxForge (nosotros)

Incluir los JSON de workflow en el repo bajo `backend/data/comfyui_workflows/`. El usuario NO tiene que construir workflows desde cero — abre su ComfyUI, carga nuestro JSON (botón "Load"), verifica que encuentra los modelos referenciados, y listo.

---

## Decisiones tomadas

| Decisión | Alternativa descartada | Razón |
|----------|------------------------|-------|
| ComfyUI como servidor aparte | `diffusers` embebido | Evita compartir VRAM con XTTS; usuario mantiene su instalación SD sin duplicar |
| Workflow JSON con bindings | Construir el grafo en código | El usuario puede editar el workflow en su UI y sustituirlo sin que toquemos Python |
| Provider pattern existente | Endpoint nuevo dedicado | Ya funciona con placeholder; respeta la abstracción |
| Polling en F1, WS en F6 | WS desde F1 | Menos código inicial, iteramos cuando el UX lo justifique |
| SDXL para escenas, FLUX para portadas | FLUX para todo | FLUX x 60 escenas = 30+ min de render. SDXL va a 5-10s |
| Buckets SDXL en vez de 1920×1080 | Generar a 1920×1080 bruto | Fuera de buckets SDXL degrada visiblemente; ffmpeg escala en render |
| Referencia de personaje por proyecto | Por escena | Consistencia global es el 90% del valor; por-escena es nicho |

---

## Cuestiones abiertas

1. **¿Subida directa de workflows desde el FE?** Permitir al usuario subir su propio `.json` de ComfyUI desde Settings y asignarle un nombre de estilo. Requiere validación (que sea un grafo válido + bindings provistos). **Probable F7**.

2. **¿Batch mode?** Generar las N escenas de un capítulo en una sola ronda, con pausa entre cada para no saturar la cola de ComfyUI. Podría ser un botón "Generar todas" en `SceneManager`. **Probable F8**, después de MVP.

3. **¿Fallback transparente al placeholder cuando ComfyUI cae?** Tentador, pero **NO**: el usuario debe saber que está recibiendo placeholders. Mejor error claro.

4. **¿Re-usar seeds para regenerar con prompt editado?** Hoy el dialog permite seed manual. En F6 podríamos añadir "Reutilizar seed anterior" como checkbox. Minimal lift.

5. **Control de concurrencia**. ComfyUI tiene cola interna, pero si el usuario pulsa "Generar" en 5 escenas a la vez, todas quedan encoladas. El FE debería mostrar "3/5 en cola" más que lanzarlas en paralelo silenciosamente. Probable semaforo en FE con `p-limit(2)`.

6. **Contenido NSFW**. Modelos open-source puros (SDXL, FLUX) pueden generar contenido no deseado. Añadir negative prompt por defecto ("nsfw, nudity, ...") en los workflows. Documentar que el usuario es responsable del contenido generado.

---

## Orden de merge recomendado

1. **F1** (provider + workflow SDXL + tests mockeados) — mergeable sin ComfyUI, el placeholder sigue siendo default.
2. **F2** (health check + UX de error) — independiente, pequeño.
3. Pausa: **producir un capítulo completo con ComfyUI real** para validar calidad/tiempos con audio de verdad.
4. **F5** en el mismo sprint si aparecen degradaciones de calidad.
5. **F3** (estilos múltiples + FLUX portada) solo cuando las escenas SDXL se vean bien.
6. **F4** (IPAdapter) y **F6** (progreso real) en paralelo, ambos son mejoras ortogonales.

---

## Dependencias nuevas

- **Python**: ninguna. Usamos `httpx` (ya en `requirements.txt`) para hablar con ComfyUI. WebSocket via `websockets` library (agregar en F6).
- **Runtime externa**: ComfyUI + checkpoints. **No se instala** desde VoxForge — el usuario lo monta aparte. El `README` documenta los pasos.
- **Frontend**: ninguna.

Esto mantiene CI intacto: `requirements-ci.txt` no cambia, los tests mockean `httpx`, y el placeholder sigue siendo el default sin ComfyUI disponible.
