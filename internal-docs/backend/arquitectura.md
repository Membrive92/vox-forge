# Arquitectura del Backend

## Estructura del paquete

```
backend/
├── __init__.py              → Punto de entrada: exporta `app`
├── main.py                  → Fabrica de la aplicacion FastAPI
├── config.py                → Configuracion centralizada
├── checks.py                → Verificaciones al arrancar
├── paths.py                 → Rutas del sistema de archivos
├── catalogs.py              → Datos estaticos (voces, formatos)
├── schemas.py               → Modelos Pydantic (entrada/salida)
├── exceptions.py            → Excepciones de dominio
├── dependencies.py          → Inyeccion de dependencias
├── utils.py                 → Utilidades (limpieza)
├── services/
│   ├── tts_engine.py        → Motor dual de sintesis
│   ├── clone_engine.py      → Motor de clonacion XTTS v2
│   └── profile_manager.py   → Gestion de perfiles
└── routers/
    ├── synthesis.py          → Endpoint de sintesis
    ├── voices.py             → Endpoints de voces y muestras
    ├── profiles.py           → Endpoints CRUD de perfiles
    └── health.py             → Endpoint de salud
```

## Capas

La arquitectura sigue un patron de tres capas estricto:

```
┌──────────────────────────────────────────────┐
│                 ROUTERS                       │
│  Responsabilidad:                            │
│  - Recibir HTTP, validar con Pydantic        │
│  - Delegar a servicios                       │
│  - Devolver respuestas HTTP                  │
│  - NO acceder a disco directamente           │
│  - NO contener logica de negocio             │
├──────────────────────────────────────────────┤
│                 SERVICES                      │
│  Responsabilidad:                            │
│  - Logica de negocio pura                    │
│  - Acceso a disco y APIs externas            │
│  - Lanzar excepciones de dominio             │
│  - NO conocer FastAPI ni HTTP                │
├──────────────────────────────────────────────┤
│              EXCEPCIONES                      │
│  Responsabilidad:                            │
│  - Representar errores del dominio           │
│  - Traduccion a HTTP via handler global      │
└──────────────────────────────────────────────┘
```

### Reglas

1. Los **routers** nunca hacen `raise HTTPException` para errores de dominio — las excepciones de dominio se traducen automaticamente en el handler global.
2. Los **servicios** nunca importan `fastapi` — son modulos Python puros.
3. Las **excepciones** definen su `status_code` y `code`, pero no conocen la respuesta HTTP.

## Configuracion (config.py)

Usa `pydantic-settings` con prefijo `VOXFORGE_`:

```python
class Settings(BaseSettings):
    base_dir: Path             # Raiz del proyecto
    data_subdir: str = "data"  # Subdirectorio de datos
    cors_origins: list[str]    # Origenes permitidos
    max_text_length: int       # Limite de texto (500.000)
    chunk_max_chars: int       # Tamano maximo de chunk (3.000)
    cleanup_max_age_hours: int # Horas antes de limpiar (24)
    log_level: str             # Nivel de log (INFO)
```

Se puede sobreescribir via `.env` o variables de entorno:

```bash
VOXFORGE_MAX_TEXT_LENGTH=1000000
VOXFORGE_CHUNK_MAX_CHARS=5000
```

## Inyeccion de dependencias (dependencies.py)

Los servicios se crean como singletons al importar el modulo:

```python
_profile_manager = ProfileManager(PROFILES_FILE)
_tts_engine = TTSEngine(_profile_manager)
```

Se exponen como funciones para `Depends()` de FastAPI:

```python
def get_profile_manager() -> ProfileManager:
    return _profile_manager

def get_tts_engine() -> TTSEngine:
    return _tts_engine
```

Esto permite sobreescribirlos en tests con `app.dependency_overrides`.

## Excepciones de dominio (exceptions.py)

Jerarquia:

```
DomainError (base, 500)
├── ProfileNotFound (404)
├── UnsupportedVoiceError (400)
├── UnsupportedFormatError (400)
├── InvalidSampleError (400)
├── SampleNotFound (404)
└── SynthesisError (500)
```

El handler global registrado en `main.py` las traduce:

```python
@app.exception_handler(DomainError)
async def _handle_domain(_, exc):
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message, "code": exc.code},
    )
```

## Verificaciones al arrancar (checks.py)

Al crear la app, `run_startup_checks()` verifica:

1. **ffmpeg**: busca primero en `tools/ffmpeg/bin/` (instalacion local), luego en el PATH del sistema. Si lo encuentra localmente, lo anade al PATH del proceso.
2. Si no encuentra ffmpeg, muestra un warning con instrucciones de instalacion.

## Ciclo de vida de una request

```
1. Request HTTP llega a FastAPI
2. Middleware CORS procesa headers
3. Router valida con modelo Pydantic (422 si falla)
4. Router llama al servicio via Depends()
5. Servicio ejecuta logica, puede lanzar excepcion de dominio
6. Si hay excepcion → handler global la traduce a JSON con status code
7. Si todo OK → router devuelve FileResponse o JSONResponse
8. BackgroundTasks ejecuta limpieza de archivos (si aplica)
```

## Concurrencia

- **ProfileManager**: usa `asyncio.Lock` para proteger lecturas/escrituras al JSON. Escritura atomica (`tmp` + `os.replace`) para evitar corrupcion si el proceso se interrumpe.
- **TTSEngine**: sin estado compartido mutable. Cada request genera archivos con UUID unico.
- **CloneEngine**: el modelo XTTS se carga una vez y se mantiene en GPU. La sintesis se ejecuta en `asyncio.to_thread()` para no bloquear el event loop.
- **Endpoints async**: los que hacen I/O async real (Edge-TTS, lectura de archivos) son `async def`. Los que son CPU-bound se delegan a `to_thread`.
