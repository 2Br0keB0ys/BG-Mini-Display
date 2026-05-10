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

  # Chip ID (auto-detected from device if not provided)
  [Parameter(Mandatory = $false)]
  [string]$ChipId = "",

  # Hardware security fuses (irreversible - off by default)
  [Parameter(Mandatory = $false)]
  [switch]$ApplyHardwareSecurity,

  # Skip flags - allow partial runs
  [Parameter(Mandatory = $false)]
  [switch]$SkipHardwareCheck,
  [Parameter(Mandatory = $false)]
  [switch]$SkipChipIdDetect,
  [Parameter(Mandatory = $false)]
  [switch]$SkipSecretsSync,
  [Parameter(Mandatory = $false)]
  [switch]$SkipBuild,
  [Parameter(Mandatory = $false)]
  [switch]$SkipFlash,
  [Parameter(Mandatory = $false)]
  [switch]$SkipVerify,
  [Parameter(Mandatory = $false)]
  [switch]$SkipAuditLog,

  # Audit log output directory (default: firmware/scripts/provision_logs/)
  [Parameter(Mandatory = $false)]
  [string]$AuditLogDir = ""
)

$ErrorActionPreference = "Stop"
$startTime = Get-Date

$scriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot     = Resolve-Path (Join-Path $scriptDir "..\..")
$pioExe       = "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"
$python       = "$env:USERPROFILE\.platformio\penv\Scripts\python.exe"
$toolRoot     = "$env:USERPROFILE\.platformio\packages\tool-esptoolpy"
$esptoolPy    = Join-Path $toolRoot "esptool.py"
$secureScript = Join-Path $scriptDir "secure_provision.ps1"
$syncScript   = Join-Path $scriptDir "firmware_secrets_sync.ps1"

if (-not $AuditLogDir) { $AuditLogDir = Join-Path $scriptDir "provision_logs" }

$results    = [ordered]@{}
$stepTimes  = [ordered]@{}

function Step-Pass([string]$name) {
  $results[$name]   = "PASS"
  $stepTimes[$name] = (Get-Date).ToString("o")
  Write-Host "  [PASS] $name" -ForegroundColor Green
}
function Step-Skip([string]$name, [string]$reason = "") {
  $results[$name]   = "SKIP"
  $stepTimes[$name] = (Get-Date).ToString("o")
  $msg = "  [SKIP] $name"
  if ($reason) { $msg += " ($reason)" }
  Write-Host $msg -ForegroundColor DarkGray
}
function Step-Warn([string]$name, [string]$msg = "") {
  $results[$name]   = "WARN"
  $stepTimes[$name] = (Get-Date).ToString("o")
  Write-Host "  [WARN] $name" -ForegroundColor Yellow
  if ($msg) { Write-Host "         $msg" -ForegroundColor Yellow }
}
function Step-Fail([string]$name, [string]$msg = "") {
  $results[$name]   = "FAIL"
  $stepTimes[$name] = (Get-Date).ToString("o")
  Write-Host "  [FAIL] $name" -ForegroundColor Red
  if ($msg) { Write-Host "         $msg" -ForegroundColor Yellow }
  throw "Provisioning aborted at: $name"
}

Write-Host ""
Write-Host "BG MiniView Device Provisioning" -ForegroundColor Cyan
Write-Host "Port: $Port | Repo: $repoRoot" -ForegroundColor Gray
Write-Host "Started: $($startTime.ToString('yyyy-MM-dd HH:mm:ss'))" -ForegroundColor Gray
Write-Host ""

# -- Step 1: Hardware check (eFuse summary) ------------------------------------
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

# -- Step 2: Apply hardware security fuses (IRREVERSIBLE) ---------------------
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

# -- Step 3: Detect Chip ID via esptool ----------------------------------------
# Reads the eFuse MAC from the device (same value as ESP.getEfuseMac() in firmware).
# Chip ID is logged in the audit trail and printed for reference.
# The device will self-enroll on first WiFi connect using this ID.
if ($ChipId) {
  $ChipId = $ChipId.ToLower().Trim()
  Write-Host "[3] Chip ID provided: $ChipId" -ForegroundColor Cyan
  Step-Pass "Chip ID detection"
} elseif ($SkipChipIdDetect) {
  Step-Skip "Chip ID detection" "SkipChipIdDetect"
} else {
  Write-Host "[3] Detecting chip ID via esptool read_mac..." -ForegroundColor Cyan
  if (-not (Test-Path $python)) {
    Step-Skip "Chip ID detection" "PlatformIO Python not found at $python"
  } elseif (-not (Test-Path $esptoolPy)) {
    Step-Skip "Chip ID detection" "esptool.py not found at $esptoolPy"
  } else {
    try {
      $raw = & $python $esptoolPy --chip esp32 --port $Port read_mac 2>&1
      $macLine = $raw | Where-Object { $_ -match 'MAC:\s*([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})' } | Select-Object -Last 1
      if ($macLine -and $macLine -match 'MAC:\s*([0-9a-fA-F]{2}(?::[0-9a-fA-F]{2}){5})') {
        $macStr   = $Matches[1]
        # Convert MAC (aa:bb:cc:dd:ee:ff) to firmware chip ID format:
        # ESP.getEfuseMac() packs bytes little-endian into a uint64_t, then formats as %016llx.
        $macBytes = $macStr -split ":" | ForEach-Object { [Convert]::ToInt64($_, 16) }
        [uint64]$chipInt = [uint64]$macBytes[0] `
          -bor ([uint64]$macBytes[1] -shl 8) `
          -bor ([uint64]$macBytes[2] -shl 16) `
          -bor ([uint64]$macBytes[3] -shl 24) `
          -bor ([uint64]$macBytes[4] -shl 32) `
          -bor ([uint64]$macBytes[5] -shl 40)
        $ChipId = $chipInt.ToString("x16")
        Write-Host "    MAC: $macStr -> Chip ID: $ChipId" -ForegroundColor Gray
        Step-Pass "Chip ID detection"
      } else {
        Step-Warn "Chip ID detection" "Could not parse MAC from esptool output. Run with -ChipId to set manually."
      }
    } catch {
      Step-Warn "Chip ID detection" $_.Exception.Message
    }
  }
}

# -- Step 4: Sync secrets.h from Infisical ------------------------------------
if ($SkipSecretsSync) {
  Step-Skip "Secrets sync" "SkipSecretsSync"
} else {
  if (-not (Test-Path $syncScript)) { Step-Fail "Secrets sync" "firmware_secrets_sync.ps1 not found at $syncScript" }
  Write-Host "[4] Syncing firmware/src/secrets.h..." -ForegroundColor Cyan
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

# -- Step 5: PlatformIO build --------------------------------------------------
if ($SkipBuild) {
  Step-Skip "Firmware build" "SkipBuild"
} else {
  if (-not (Test-Path $pioExe)) { Step-Fail "Firmware build" "PlatformIO not found at $pioExe" }
  Write-Host "[5] Building firmware (pio run)..." -ForegroundColor Cyan
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

# -- Step 6: PlatformIO flash --------------------------------------------------
if ($SkipFlash) {
  Step-Skip "Firmware flash" "SkipFlash"
} else {
  if (-not (Test-Path $pioExe)) { Step-Fail "Firmware flash" "PlatformIO not found at $pioExe" }
  Write-Host "[6] Flashing firmware to $Port..." -ForegroundColor Cyan
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

# -- Step 7: Verify worker is reachable ----------------------------------------
# Checks the Cloudflare Worker is up. Device self-enrolls on first WiFi connect
# (AP mode: connect to BG_MiniView_XXXX, enter WiFi credentials, device calls /api/enroll).
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

if ($SkipVerify) {
  Step-Skip "Worker verify" "SkipVerify"
} elseif (-not $verifyUrl) {
  Step-Skip "Worker verify" "no WorkerUrl - pass -WorkerUrl or -UseInfisical to enable"
} else {
  Write-Host "[7] Verifying worker is reachable at $verifyUrl..." -ForegroundColor Cyan
  $deadline = (Get-Date).AddSeconds(30)
  $ok = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -Uri "$verifyUrl/api/ping" -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
      if ($r.StatusCode -lt 500) { $ok = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
    Write-Host "    ...retrying" -ForegroundColor DarkGray
  }
  if ($ok) {
    Step-Pass "Worker verify"
  } else {
    Step-Warn "Worker verify" "Worker did not respond in 30s - check deployment"
  }
}

# -- Summary -------------------------------------------------------------------
$endTime     = Get-Date
$durationSec = [int]($endTime - $startTime).TotalSeconds

Write-Host ""
Write-Host "Provisioning summary:" -ForegroundColor Cyan
foreach ($entry in $results.GetEnumerator()) {
  $color = switch ($entry.Value) { "PASS" { "Green" } "FAIL" { "Red" } "WARN" { "Yellow" } default { "DarkGray" } }
  Write-Host ("  {0,-30} {1}" -f $entry.Key, $entry.Value) -ForegroundColor $color
}
if ($ChipId) {
  Write-Host ""
  Write-Host ("  {0,-30} {1}" -f "Chip ID", $ChipId) -ForegroundColor White
}
Write-Host ("  {0,-30} {1}s" -f "Duration", $durationSec) -ForegroundColor Gray
Write-Host ""

$hasFail = $results.Values -contains "FAIL"
if ($hasFail) {
  Write-Host "Provisioning completed with failures." -ForegroundColor Red
} else {
  Write-Host "Provisioning complete." -ForegroundColor Green
  if ($ChipId) {
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Power on device - it will start in AP mode (SSID: BG_MiniView_XXXX)" -ForegroundColor Gray
    Write-Host "  2. Connect to AP and enter WiFi credentials" -ForegroundColor Gray
    Write-Host "  3. Device will self-enroll at /api/enroll using chip ID: $ChipId" -ForegroundColor Gray
    Write-Host "  4. Verify enrollment in the admin UI (Security -> Enrolled Devices)" -ForegroundColor Gray
  }
}

# -- Audit log -----------------------------------------------------------------
if (-not $SkipAuditLog) {
  try {
    New-Item -ItemType Directory -Force -Path $AuditLogDir | Out-Null
    $logName = "provision_$($startTime.ToString('yyyyMMdd_HHmmss')).json"
    $logPath = Join-Path $AuditLogDir $logName

    $overall = if ($hasFail) { "FAIL" } elseif ($results.Values -contains "WARN") { "WARN" } else { "PASS" }

    $logObj = [ordered]@{
      provisionedAt = $startTime.ToString("o")
      completedAt   = $endTime.ToString("o")
      durationSec   = $durationSec
      overall       = $overall
      port          = $Port
      chipId        = $ChipId
      workerUrl     = $verifyUrl
      useInfisical  = [bool]$UseInfisical
      infisicalEnv  = $InfisicalEnv
      steps         = $results
      stepTimes     = $stepTimes
    }

    $logObj | ConvertTo-Json -Depth 5 | Set-Content -Path $logPath -Encoding utf8
    Write-Host "Audit log: $logPath" -ForegroundColor DarkGray
  } catch {
    Write-Host "  (Audit log write failed: $($_.Exception.Message))" -ForegroundColor DarkGray
  }
}
