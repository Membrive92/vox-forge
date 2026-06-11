# setup.ps1 — provision idempotente de vendor/ComfyUI + modelos (~55 GB).
# Ver docs/SETUP_PROVISIONING.md. Compatible con Windows PowerShell 5.1.
# Re-ejecutable: lo ya presente con tamano plausible no se re-descarga.

$ErrorActionPreference = "Stop"

# Fuerza UTF-8 en los procesos Python hijos (pip, comfy-cli): su salida usa
# caracteres Unicode (p. ej. la flecha →) que revientan con UnicodeEncodeError
# bajo el codepage cp1252 de consolas Windows no interactivas.
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

# Raiz del modulo = directorio padre de scripts/
$ModuleRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ModuleRoot

. "$PSScriptRoot\_checks.ps1"

# Actualiza `<Key> = "<Value>"` en config\pipeline.toml conservando el resto de
# la linea (comentarios). SETUP_PROVISIONING §2: el script registra en la config
# el pin de ComfyUI y el interprete del workspace; no se deja como paso manual.
function Set-PipelineTomlValue {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Value
    )
    $configPath = Join-Path $ModuleRoot "config\pipeline.toml"
    if (-not (Test-Path $configPath)) {
        throw "config\pipeline.toml not found at $configPath; cannot record $Key."
    }
    $pattern = '^(\s*' + [regex]::Escape($Key) + '\s*=\s*)"[^"]*"'
    $found = $false
    $updated = foreach ($line in (Get-Content $configPath)) {
        if (-not $found -and $line -match $pattern) {
            $found = $true
            $line -replace $pattern, ('${1}"' + $Value + '"')
        } else {
            $line
        }
    }
    if (-not $found) {
        throw "Key '$Key' not found in config\pipeline.toml; add it manually with value `"$Value`"."
    }
    # UTF-8 sin BOM: tomllib no acepta BOM.
    [System.IO.File]::WriteAllLines($configPath, [string[]]$updated)
    Write-Host "[OK] config\pipeline.toml: $Key = `"$Value`""
}

# ---------------------------------------------------------------- prechecks §1
Assert-Gpu
Warn-IfLowRam
Assert-DiskFree -Gb 80
$PyVer = Assert-Python
Warn-IfOldDriver

# ------------------------------------------------- §2 bootstrap venv + comfy-cli
$Bootstrap = Join-Path $ModuleRoot "vendor\comfy-bootstrap"
$BootstrapPython = Join-Path $Bootstrap "Scripts\python.exe"
$ComfyExe = Join-Path $Bootstrap "Scripts\comfy.exe"
$Workspace = Join-Path $ModuleRoot "vendor\ComfyUI"

if (-not (Test-Path $BootstrapPython)) {
    Write-Host "Creating bootstrap venv (py $PyVer) at $Bootstrap ..."
    & py $PyVer -m venv $Bootstrap
    if ($LASTEXITCODE -ne 0) { throw "Failed to create bootstrap venv." }
} else {
    Write-Host "[SKIP] Bootstrap venv already exists."
}

Write-Host "Installing/upgrading comfy-cli in the bootstrap venv ..."
& $BootstrapPython -m pip install --upgrade comfy-cli
if ($LASTEXITCODE -ne 0) { throw "pip install comfy-cli failed." }

# Sin telemetria (CLAUDE.md) y sin prompts interactivos: este script debe poder
# correr desatendido. 'tracking disable' ademas evita el prompt de consentimiento
# del primer uso.
& $ComfyExe --skip-prompt tracking disable
if ($LASTEXITCODE -ne 0) { Write-Warning "comfy tracking disable failed; continuing." }

# ------------------------------------------------------- §2 ComfyUI workspace
if (-not (Test-Path (Join-Path $Workspace "main.py"))) {
    Write-Host "Installing ComfyUI into $Workspace (this downloads PyTorch CUDA wheels) ..."
    # --nvidia: hardware objetivo fijo (RTX 4070 Super); sin el flag, comfy-cli
    # pregunta el tipo de GPU de forma interactiva y colgaria un run desatendido.
    & $ComfyExe --skip-prompt --workspace $Workspace install --nvidia
    if ($LASTEXITCODE -ne 0) { throw "comfy-cli install failed." }
} else {
    Write-Host "[SKIP] ComfyUI workspace already installed."
}

# Localizar el python.exe del workspace (lo usa ComfyEngine). No adivinar:
# buscar bajo vendor\ComfyUI y fallar con mensaje claro si no aparece.
$WorkspacePython = $null
$candidates = @(
    (Join-Path $Workspace ".venv\Scripts\python.exe"),
    (Join-Path $Workspace "venv\Scripts\python.exe")
)
foreach ($c in $candidates) {
    if (Test-Path $c) { $WorkspacePython = $c; break }
}
if ($null -eq $WorkspacePython) {
    $hit = Get-ChildItem -Path $Workspace -Recurse -Filter "python.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $hit) { $WorkspacePython = $hit.FullName }
}
if ($null -eq $WorkspacePython) {
    throw ("Could not locate python.exe under $Workspace. comfy-cli may have installed ComfyUI against another environment. " +
           "Find the interpreter that runs ComfyUI and set [engine].python_exe in config\pipeline.toml manually.")
}
Write-Host "[OK] Workspace python: $WorkspacePython"
# Registrar el interprete en la config (ruta relativa a la raiz del modulo,
# con barras /: las contrabarras serian escapes invalidos en TOML basico).
$RelWorkspacePython = $WorkspacePython.Substring($ModuleRoot.Length).TrimStart('\').Replace('\', '/')
Set-PipelineTomlValue -Key "python_exe" -Value $RelWorkspacePython

# --------------------------------------------------------- §3 custom node GGUF
$GgufDir = Join-Path $Workspace "custom_nodes\ComfyUI-GGUF"
if (-not (Test-Path $GgufDir)) {
    Write-Host "Installing custom node comfyui-gguf via comfy-cli ..."
    & $ComfyExe --skip-prompt --workspace $Workspace node install comfyui-gguf
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "comfy-cli node install failed; falling back to git clone."
        git clone https://github.com/city96/ComfyUI-GGUF $GgufDir
        if ($LASTEXITCODE -ne 0) { throw "git clone of ComfyUI-GGUF failed." }
        & $WorkspacePython -m pip install -r (Join-Path $GgufDir "requirements.txt")
        if ($LASTEXITCODE -ne 0) { throw "pip install of ComfyUI-GGUF requirements failed." }
    }
} else {
    Write-Host "[SKIP] ComfyUI-GGUF custom node already present."
}

# ----------------------------------------------------------- §4 model downloads
# Una entrada por fichero: Url, RelPath (carpeta bajo el workspace), FinalName
# (nombre final en disco; las LoRAs se renombran), MinBytes (tamano minimo
# plausible para detectar descargas truncadas o paginas de error).
$Models = @(
    @{ Url = "https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF/resolve/main/HighNoise/Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf";
       RelPath = "models/unet"; FinalName = "Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf"; MinBytes = 10GB },
    @{ Url = "https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF/resolve/main/LowNoise/Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf";
       RelPath = "models/unet"; FinalName = "Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf"; MinBytes = 10GB },
    @{ Url = "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors";
       RelPath = "models/text_encoders"; FinalName = "umt5_xxl_fp8_e4m3fn_scaled.safetensors"; MinBytes = 5GB },
    @{ Url = "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors";
       RelPath = "models/vae"; FinalName = "wan_2.1_vae.safetensors"; MinBytes = 200MB },
    @{ Url = "https://huggingface.co/lightx2v/Wan2.2-Lightning/resolve/main/Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1/high_noise_model.safetensors";
       RelPath = "models/loras"; FinalName = "wan22_i2v_lightning4_high.safetensors"; MinBytes = 400MB },
    @{ Url = "https://huggingface.co/lightx2v/Wan2.2-Lightning/resolve/main/Wan2.2-I2V-A14B-4steps-lora-rank64-Seko-V1/low_noise_model.safetensors";
       RelPath = "models/loras"; FinalName = "wan22_i2v_lightning4_low.safetensors"; MinBytes = 400MB },
    # 2026-06: el repo Comfy-Org retiro el fichero fp8 pre-cuantizado; se baja
    # el bf16 oficial y el workflow lo carga con weight_dtype=fp8_e4m3fn
    # (mismo consumo de VRAM en runtime; ver SETUP_PROVISIONING seccion 5).
    @{ Url = "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/diffusion_models/z_image_turbo_bf16.safetensors";
       RelPath = "models/diffusion_models"; FinalName = "z_image_turbo_bf16.safetensors"; MinBytes = 11GB },
    @{ Url = "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/text_encoders/qwen_3_4b.safetensors";
       RelPath = "models/text_encoders"; FinalName = "qwen_3_4b.safetensors"; MinBytes = 6GB },
    @{ Url = "https://huggingface.co/Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors";
       RelPath = "models/vae"; FinalName = "ae.safetensors"; MinBytes = 250MB }
)

foreach ($m in $Models) {
    $destDir = Join-Path $Workspace ($m.RelPath -replace "/", "\")
    $finalPath = Join-Path $destDir $m.FinalName
    $downloadName = [System.IO.Path]::GetFileName(([uri]$m.Url).LocalPath)
    $downloadPath = Join-Path $destDir $downloadName

    # Idempotencia: si el fichero final existe con tamano plausible, saltar.
    if (Test-Path $finalPath) {
        $size = (Get-Item $finalPath).Length
        if ($size -ge $m.MinBytes) {
            Write-Host "[SKIP] $($m.FinalName) already present ($([math]::Round($size / 1GB, 2)) GB)."
            continue
        }
        Write-Warning "$($m.FinalName) exists but is too small ($size bytes); re-downloading."
        Remove-Item $finalPath -Force
    }

    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Write-Host "Downloading $downloadName -> $($m.RelPath) ..."
    & $ComfyExe --skip-prompt --workspace $Workspace model download --url $m.Url --relative-path $m.RelPath
    if ($LASTEXITCODE -ne 0) {
        throw ("Download failed for $($m.Url). If it is a 404, the repo may have reorganized split_files/: " +
               "list it with the HF API and locate the file by name (see SETUP_PROVISIONING §4 notes).")
    }

    # Renombrado (LoRAs): el nombre descargado difiere del nombre final.
    if ($downloadName -ne $m.FinalName) {
        if (-not (Test-Path $downloadPath)) {
            throw "Expected downloaded file not found: $downloadPath"
        }
        Move-Item -Force $downloadPath $finalPath
        Write-Host "Renamed $downloadName -> $($m.FinalName)."
    }

    # Verificacion de tamano tras la descarga.
    if (-not (Test-Path $finalPath)) {
        throw "File missing after download: $finalPath"
    }
    $size = (Get-Item $finalPath).Length
    if ($size -lt $m.MinBytes) {
        throw "Downloaded file $($m.FinalName) is suspiciously small ($size bytes < $($m.MinBytes)). Truncated download or error page; delete it and retry."
    }
    Write-Host "[OK] $($m.FinalName) ($([math]::Round($size / 1GB, 2)) GB)."
}

# ------------------------------------------------------------ pin de ComfyUI
$pin = (& git -C $Workspace rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw "Could not read the ComfyUI git commit (is $Workspace a git checkout?)." }
$pin = "$pin".Trim()
$pin | Out-File -Encoding ascii (Join-Path $ModuleRoot "vendor\comfyui.pin")
Write-Host "[OK] vendor\comfyui.pin written: $pin"
Set-PipelineTomlValue -Key "comfyui_pin" -Value $pin

Write-Host ""
Write-Host "Provision complete. Next HUMAN step: export the two workflows from the GUI"
Write-Host "(docs/SETUP_PROVISIONING.md §5), then run: python -m pipeline validate"
