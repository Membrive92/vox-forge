# levantar-app.ps1 — arranca VoxForge completo (backend + frontend).
#
# Uso:
#   - Doble clic en  levantar-app.bat   (lo más cómodo), o
#   - Desde una terminal en la raíz del repo:
#       powershell -ExecutionPolicy Bypass -File instructions\levantar-app.ps1
#
# Abre dos ventanas nuevas (una por servicio) para que veas los logs y
# puedas pararlos con Ctrl+C de forma independiente.

$ErrorActionPreference = "Stop"

# La raíz del repo es el directorio padre de instructions/
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "VoxForge — arrancando desde $RepoRoot" -ForegroundColor Cyan

# --- Prechecks mínimos -------------------------------------------------
foreach ($cmd in @("python", "npm")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "No se encuentra '$cmd' en el PATH. Instálalo antes de continuar."
    }
}
if (-not (Get-Command "ffmpeg" -ErrorAction SilentlyContinue)) {
    Write-Warning "ffmpeg no está en el PATH. La síntesis y el render de vídeo lo necesitan; instálalo (https://ffmpeg.org)."
}

# Instalar dependencias de frontend si faltan
if (-not (Test-Path (Join-Path $RepoRoot "node_modules"))) {
    Write-Host "node_modules no existe — ejecutando 'npm install' (una vez)..." -ForegroundColor Yellow
    npm install
}

# --- Backend (FastAPI + uvicorn, recarga en caliente) ------------------
# Muestreo XTTS apretado: reduce la deriva de acento (seseo) en la voz
# clonada con acento de España. Ver instructions/configuracion-voz.md (§5).
$XttsEnv = "`$env:VOXFORGE_XTTS_TEMPERATURE='0.5'; `$env:VOXFORGE_XTTS_TOP_P='0.7'; `$env:VOXFORGE_XTTS_TOP_K='40'; "
Write-Host "Lanzando backend  -> http://127.0.0.1:8000" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$RepoRoot'; $XttsEnv python -m uvicorn backend:app --reload --port 8000"
)

# --- Frontend (Vite) ---------------------------------------------------
Write-Host "Lanzando frontend -> http://localhost:3000" -ForegroundColor Green
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location '$RepoRoot'; npm run dev"
)

Write-Host ""
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host " App:      http://localhost:3000" -ForegroundColor Cyan
Write-Host " API:      http://127.0.0.1:8000/api/health"
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Para PARAR: cierra las dos ventanas nuevas (o Ctrl+C en cada una)."
Write-Host "Imágenes reales (opcional): ver instructions/README.md (ComfyUI + PROD-05)."
