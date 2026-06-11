# _checks.ps1 — prechecks de provision (SETUP_PROVISIONING §1).
# Compatible con Windows PowerShell 5.1: sin '&&', sin operador ternario.
# Mensajes de consola en ingles (convencion del proyecto).

function Assert-Gpu {
    # GPU NVIDIA presente con ~12 GB de VRAM. Aborta si falla.
    $smi = Get-Command nvidia-smi -ErrorAction SilentlyContinue
    if ($null -eq $smi) {
        throw "PRECHECK FAILED: nvidia-smi not found in PATH. An NVIDIA GPU with current drivers is required."
    }
    $raw = & nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>$null
    if ($null -eq $raw) {
        throw "PRECHECK FAILED: nvidia-smi did not return GPU info. Check the NVIDIA driver installation."
    }
    $totalMib = 0
    foreach ($line in @($raw)) {
        $v = 0
        if ([int]::TryParse(($line.Trim()), [ref]$v)) {
            if ($v -gt $totalMib) { $totalMib = $v }
        }
    }
    # 12 GB nominales aparecen como ~12282 MiB; umbral con margen.
    if ($totalMib -lt 11000) {
        throw "PRECHECK FAILED: GPU VRAM is ${totalMib} MiB; at least ~12 GB is required (target: RTX 4070 Super)."
    }
    Write-Host "[OK] GPU detected with ${totalMib} MiB VRAM."
}

function Warn-IfLowRam {
    # RAM de sistema: < 32 GB no aborta, pero avisa (swapping con el offload del umt5).
    $cs = Get-CimInstance Win32_ComputerSystem
    $ramGb = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1)
    if ($ramGb -lt 31) {
        Write-Warning "System RAM is ${ramGb} GB (< 32 GB). umt5 offload + expert caching may cause disk swapping and much slower runs."
    } else {
        Write-Host "[OK] System RAM: ${ramGb} GB."
    }
}

function Assert-DiskFree {
    # Disco libre en la unidad del repo. Aborta si < $Gb.
    param([int]$Gb = 80)
    $driveLetter = (Get-Item $PSScriptRoot).PSDrive.Name
    $drive = Get-PSDrive -Name $driveLetter
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    if ($freeGb -lt $Gb) {
        throw "PRECHECK FAILED: only ${freeGb} GB free on drive ${driveLetter}:; at least ${Gb} GB is required (~55 GB of models plus workspace)."
    }
    Write-Host "[OK] Disk free on ${driveLetter}: ${freeGb} GB."
}

function Assert-Python {
    # Python 3.11 o 3.12 accesible via 'py'. Aborta si no hay ninguno.
    # Devuelve el argumento de version para 'py' (p. ej. "-3.12").
    $py = Get-Command py -ErrorAction SilentlyContinue
    if ($null -eq $py) {
        throw "PRECHECK FAILED: Python launcher 'py' not found. Install Python 3.12 from python.org."
    }
    foreach ($ver in @("-3.12", "-3.11")) {
        & py $ver --version *>$null
        if ($LASTEXITCODE -eq 0) {
            $found = (& py $ver --version)
            Write-Host "[OK] Python found: $found (py $ver)."
            return $ver
        }
    }
    throw "PRECHECK FAILED: neither Python 3.12 nor 3.11 is available via 'py'. ComfyUI requires 3.11/3.12."
}

function Warn-IfOldDriver {
    # Driver NVIDIA razonablemente reciente (CUDA 12.x). Solo avisa.
    $raw = & nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>$null
    if ($null -eq $raw) {
        Write-Warning "Could not read NVIDIA driver version; ensure it supports CUDA 12.x."
        return
    }
    $verStr = @($raw)[0].Trim()
    $major = 0
    $parsed = [int]::TryParse(($verStr.Split('.')[0]), [ref]$major)
    # CUDA 12.x requiere driver >= 525 en Windows.
    if ($parsed -and $major -lt 525) {
        Write-Warning "NVIDIA driver $verStr looks old for CUDA 12.x (need >= 525). Consider updating."
    } else {
        Write-Host "[OK] NVIDIA driver: $verStr."
    }
}
