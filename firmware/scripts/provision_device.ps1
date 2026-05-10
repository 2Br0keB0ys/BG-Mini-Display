param(
  [Parameter(Mandatory = $false)]
  [string]$Port = "COM6",

  # Infisical / secrets
  [Parameter(Mandatory = $false)]
  [switch]$UseInfisical,
  [Parameter(Mandatory = $false)]
  [string]$InfisicalEnv = "production",
  [Parameter(Mandatory = $false)]
  [string]$InfisicalProjectId = "",
  [Parameter(Mandatory = $false)]
  [string]$WorkerUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$DeviceKey = "",

  # Hardware security fuses (irreversible — off by default)
  [Parameter(Mandatory = $false)]
  [switch]$ApplyHardwareSecurity,

  # Skip flags — allow partial runs
  [Parameter(Mandatory = $false)]
  [switch]$SkipHardwareCheck,
  [Parameter(Mandatory = $false)]
  [switch]$SkipSecretsSync,
  [Parameter(Mandatory = $false)]
  [switch]$SkipBuild,
  [Parameter(Mandatory = $false)]
  [switch]$SkipFlash,
  [Parameter(Mandatory = $false)]
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"

$scriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot      = Resolve-Path (Join-Path $scriptDir "..\..")
$pioExe        = "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"
$secureScript  = Join-Path $scriptDir "secure_provision.ps1"
$syncScript    = Join-Path $scriptDir "firmware_secrets_sync.ps1"

$results = [ordered]@{}

function Step-Pass([string]$name) {
  $results[$name] = "PASS"
  Write-Host "  [PASS] $name" -ForegroundColor Green
}
function Step-Skip([string]$name, [string]$reason = "") {
  $results[$name] = "SKIP"
  $msg = "  [SKIP] $name"
  if ($reason) { $msg += " ($reason)" }
  Write-Host $msg -ForegroundColor DarkGray
}
function Step-Fail([string]$name, [string]$msg = "") {
  $results[$name] = "FAIL"
  Write-Host "  [FAIL] $name" -ForegroundColor Red
  if ($msg) { Write-Host "         $msg" -ForegroundColor Yellow }
  throw "Provisioning aborted at: $name"
}

Write-Host ""
Write-Host "BG MiniView Device Provisioning" -ForegroundColor Cyan
Write-Host "Port: $Port | Repo: $repoRoot" -ForegroundColor Gray
Write-Host ""

# ── Step 1: Hardware check (eFuse summary) ────────────────────────────────────
if ($SkipHardwareCheck) {
  Step-Skip "Hardware check" "SkipHardwareCheck"
} else {
  if (-not (Test-Path $secureScript)) { Step-Fail "Hardware check" "secure_provision.ps1 not found at $secureScript" }
  Write-Host "[1] Reading eFuse summary..." -ForegroundColor Cyan
  try {
    & $secureScript -Port $Port
    Step-Pass "Hardware check"
  } catch {
    Step-Fail "Hardware check" $_.Exception.Message
  }
}

# ── Step 2: Apply hardware security fuses (IRREVERSIBLE) ─────────────────────
if (-not $ApplyHardwareSecurity) {
  Step-Skip "Hardware security fuses" "pass -ApplyHardwareSecurity to burn eFuses (irreversible)"
} else {
  if (-not (Test-Path $secureScript)) { Step-Fail "Hardware security fuses" "secure_provision.ps1 not found" }
  Write-Host "[2] Applying hardware security fuses (IRREVERSIBLE)..." -ForegroundColor Red
  Write-Host "    This will burn flash encryption + secure boot keys into eFuses." -ForegroundColor Yellow
  $confirm = Read-Host "    Type YES to confirm"
  if ($confirm -ne "YES") { Step-Skip "Hardware security fuses" "user declined" }
  else {
    try {
      & $secureScript -Port $Port -Apply
      Step-Pass "Hardware security fuses"
    } catch {
      Step-Fail "Hardware security fuses" $_.Exception.Message
    }
  }
}

# ── Step 3: Sync secrets.h from Infisical ────────────────────────────────────
if ($SkipSecretsSync) {
  Step-Skip "Secrets sync" "SkipSecretsSync"
} else {
  if (-not (Test-Path $syncScript)) { Step-Fail "Secrets sync" "firmware_secrets_sync.ps1 not found at $syncScript" }
  Write-Host "[3] Syncing firmware/src/secrets.h..." -ForegroundColor Cyan
  try {
    $syncArgs = @{}
    if ($UseInfisical) {
      $syncArgs.InfisicalEnv = $InfisicalEnv
      if ($InfisicalProjectId) { $syncArgs.InfisicalProjectId = $InfisicalProjectId }
    } else {
      $syncArgs.SkipInfisical = $true
      if ($WorkerUrl) { $syncArgs.WorkerUrl = $WorkerUrl }
      if ($DeviceKey) { $syncArgs.DeviceBootstrapKey = $DeviceKey }
    }
    & $syncScript @syncArgs
    Step-Pass "Secrets sync"
  } catch {
    Step-Fail "Secrets sync" $_.Exception.Message
  }
}

# ── Step 4: PlatformIO build ──────────────────────────────────────────────────
if ($SkipBuild) {
  Step-Skip "Firmware build" "SkipBuild"
} else {
  if (-not (Test-Path $pioExe)) { Step-Fail "Firmware build" "PlatformIO not found at $pioExe" }
  Write-Host "[4] Building firmware (pio run)..." -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    & $pioExe run
    if ($LASTEXITCODE -ne 0) { throw "pio run exited $LASTEXITCODE" }
    Step-Pass "Firmware build"
  } catch {
    Step-Fail "Firmware build" $_.Exception.Message
  } finally {
    Pop-Location
  }
}

# ── Step 5: PlatformIO flash ──────────────────────────────────────────────────
if ($SkipFlash) {
  Step-Skip "Firmware flash" "SkipFlash"
} else {
  if (-not (Test-Path $pioExe)) { Step-Fail "Firmware flash" "PlatformIO not found at $pioExe" }
  Write-Host "[5] Flashing firmware to $Port..." -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    & $pioExe run -t upload --upload-port $Port
    if ($LASTEXITCODE -ne 0) { throw "pio run -t upload exited $LASTEXITCODE" }
    Step-Pass "Firmware flash"
  } catch {
    Step-Fail "Firmware flash" $_.Exception.Message
  } finally {
    Pop-Location
  }
}

# ── Step 6: Verify device appears online ─────────────────────────────────────
if ($SkipVerify) {
  Step-Skip "Device verify" "SkipVerify"
} elseif (-not $WorkerUrl -and -not $UseInfisical) {
  Step-Skip "Device verify" "no WorkerUrl - pass -WorkerUrl or -UseInfisical to enable"
} else {
  $verifyUrl = $WorkerUrl
  if (-not $verifyUrl -and $UseInfisical) {
    $secretsH = Join-Path $repoRoot "firmware\src\secrets.h"
    if (Test-Path $secretsH) {
      foreach ($line in (Get-Content $secretsH)) {
        if ($line -like "*BGDISPLAY_DEFAULT_WORKER_URL*") {
          $parts = $line -split '"'
          if ($parts.Count -ge 3) { $verifyUrl = $parts[1].Trim().TrimEnd('/') }
          break
        }
      }
    }
  }
  if (-not $verifyUrl) {
    Step-Skip "Device verify" "could not determine WorkerUrl"
  } else {
    Write-Host "[6] Waiting for device to appear online (up to 90s)..." -ForegroundColor Cyan
    $deadline = (Get-Date).AddSeconds(90)
    $ok = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $r = Invoke-WebRequest -Uri "$verifyUrl/api/ping" -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($r.StatusCode -lt 500) { $ok = $true; break }
      } catch { }
      Start-Sleep -Seconds 5
      Write-Host "    ...waiting" -ForegroundColor DarkGray
    }
    if ($ok) {
      Step-Pass "Device verify"
    } else {
      $results["Device verify"] = "WARN"
      Write-Host "  [WARN] Device verify: ping did not succeed in 90s" -ForegroundColor Yellow
    }
  }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Provisioning summary:" -ForegroundColor Cyan
foreach ($entry in $results.GetEnumerator()) {
  $color = switch ($entry.Value) { "PASS" { "Green" } "FAIL" { "Red" } "WARN" { "Yellow" } default { "DarkGray" } }
  Write-Host ("  {0,-30} {1}" -f $entry.Key, $entry.Value) -ForegroundColor $color
}
Write-Host ""
if ($results.Values -contains "FAIL") {
  Write-Host "Provisioning completed with failures." -ForegroundColor Red
} else {
  Write-Host "Provisioning complete." -ForegroundColor Green
}
