param(
  [Parameter(Mandatory = $false)]
  [switch]$SkipInfisical,
  [Parameter(Mandatory = $false)]
  [string]$InfisicalEnv = "production",
  [Parameter(Mandatory = $false)]
  [string]$InfisicalProjectId = "",

  [Parameter(Mandatory = $false)]
  [switch]$DeployWorker,
  [Parameter(Mandatory = $false)]
  [switch]$DeployPages,
  [Parameter(Mandatory = $false)]
  [switch]$SyncFirmwareSecrets,
  [Parameter(Mandatory = $false)]
  [switch]$SyncDeviceConfig,
  [Parameter(Mandatory = $false)]
  [string]$AdminSessionToken = "",
  [Parameter(Mandatory = $false)]
  [switch]$BuildFirmware,

  [Parameter(Mandatory = $false)]
  [string]$WorkerUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$NightscoutUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$NightscoutApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareAccountId = "",
  [Parameter(Mandatory = $false)]
  [string]$DeviceBootstrapKey = "",
  [Parameter(Mandatory = $false)]
  [string]$Timezone = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Url {
  param([string]$Raw)
  if (-not $Raw) { return "" }
  $u = [string]$Raw
  $u = $u.Trim()
  if (-not $u) { return "" }
  return $u.TrimEnd('/')
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
$cloudflareDir = Join-Path $repoRoot "apps\cloudflare"

$infisicalEnabled = -not $SkipInfisical
function Resolve-InfisicalCli {
  $cmd = Get-Command infisical -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $defaultPath = Join-Path $env:APPDATA "npm\infisical.cmd"
  if (Test-Path $defaultPath) { return $defaultPath }

  return $null
}

$infisicalCliPath = Resolve-InfisicalCli
$infisicalAvailable = -not [string]::IsNullOrWhiteSpace($infisicalCliPath)

if ($infisicalEnabled -and -not $infisicalAvailable) {
  Write-Host "Infisical CLI not found at $infisicalCliPath" -ForegroundColor Yellow
  Write-Host "Continuing with explicit parameters only." -ForegroundColor Yellow
}

function Invoke-InfisicalCli {
  param([string[]]$CliArgs)
  return & $infisicalCliPath @CliArgs 2>&1
}

if ($infisicalEnabled -and $infisicalAvailable) {
  Write-Host "Hydrating missing values from Infisical..." -ForegroundColor Cyan
  $exportArgs = @("--silent", "export", "--env", $InfisicalEnv, "--format", "json")
  if ($InfisicalProjectId) { $exportArgs += @("--projectId", $InfisicalProjectId) }

  $raw = Invoke-InfisicalCli -CliArgs $exportArgs
  $line = ($raw | Out-String).Trim()
  if (-not $line) { throw "Infisical export returned no data." }

  $exported = $line | ConvertFrom-Json
  $secretMap = @{}
  if ($exported -is [System.Array]) {
    foreach ($item in $exported) {
      if ($item.key -and ($null -ne $item.value)) {
        $secretMap[[string]$item.key] = [string]$item.value
      }
    }
  } else {
    foreach ($prop in $exported.PSObject.Properties) {
      $secretMap[[string]$prop.Name] = [string]$prop.Value
    }
  }

  if (-not $WorkerUrl -and $secretMap.ContainsKey("WORKER_URL")) { $WorkerUrl = $secretMap["WORKER_URL"] }
  if (-not $NightscoutUrl -and $secretMap.ContainsKey("NIGHTSCOUT_URL")) { $NightscoutUrl = $secretMap["NIGHTSCOUT_URL"] }
  if (-not $NightscoutApiToken -and $secretMap.ContainsKey("NIGHTSCOUT_API_TOKEN")) { $NightscoutApiToken = $secretMap["NIGHTSCOUT_API_TOKEN"] }
  if (-not $NightscoutApiToken -and $secretMap.ContainsKey("NIGHTSCOUT_APITOKEN")) { $NightscoutApiToken = $secretMap["NIGHTSCOUT_APITOKEN"] }
  if (-not $CloudflareApiToken -and $secretMap.ContainsKey("CLOUDFLARE_API_TOKEN")) { $CloudflareApiToken = $secretMap["CLOUDFLARE_API_TOKEN"] }
  if (-not $CloudflareAccountId -and $secretMap.ContainsKey("CLOUDFLARE_ACCOUNT_ID")) { $CloudflareAccountId = $secretMap["CLOUDFLARE_ACCOUNT_ID"] }

  # Firmware-centric secret aliases
  if (-not $DeviceBootstrapKey -and $secretMap.ContainsKey("BGDISPLAY_DEFAULT_DEVICE_KEY")) { $DeviceBootstrapKey = $secretMap["BGDISPLAY_DEFAULT_DEVICE_KEY"] }
  if (-not $DeviceBootstrapKey -and $secretMap.ContainsKey("DEVICE_BOOTSTRAP_KEY")) { $DeviceBootstrapKey = $secretMap["DEVICE_BOOTSTRAP_KEY"] }
  if (-not $Timezone -and $secretMap.ContainsKey("BGDISPLAY_DEFAULT_TIMEZONE")) { $Timezone = $secretMap["BGDISPLAY_DEFAULT_TIMEZONE"] }
  if (-not $Timezone -and $secretMap.ContainsKey("TIMEZONE")) { $Timezone = $secretMap["TIMEZONE"] }
}

$WorkerUrl = Normalize-Url $WorkerUrl
$NightscoutUrl = Normalize-Url $NightscoutUrl

if ($CloudflareApiToken) { $env:CLOUDFLARE_API_TOKEN = $CloudflareApiToken }
if ($CloudflareAccountId) { $env:CLOUDFLARE_ACCOUNT_ID = $CloudflareAccountId }

if (-not ($DeployWorker -or $DeployPages -or $SyncFirmwareSecrets -or $SyncDeviceConfig -or $BuildFirmware)) {
  Write-Host "No actions selected. Available actions:" -ForegroundColor Yellow
  Write-Host "  -DeployWorker -DeployPages -SyncFirmwareSecrets -SyncDeviceConfig -BuildFirmware" -ForegroundColor Yellow
  exit 1
}

if (($SyncFirmwareSecrets -or $SyncDeviceConfig) -and -not $WorkerUrl) {
  throw "WorkerUrl is required for selected action(s)."
}

if ($SyncDeviceConfig -and -not $AdminSessionToken) {
  throw "SyncDeviceConfig requires -AdminSessionToken. Obtain it via GET $WorkerUrl/api/admin/session after authenticating with Cloudflare Access."
}

if ($SyncFirmwareSecrets) {
  if (-not $DeviceBootstrapKey) {
    throw "SyncFirmwareSecrets requires DeviceBootstrapKey (BGDISPLAY_DEFAULT_DEVICE_KEY or DEVICE_BOOTSTRAP_KEY)."
  }
  if (-not $Timezone) { $Timezone = "US/Central" }
}

Write-Host "Project Infisical Ops" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot" -ForegroundColor Gray
Write-Host "Actions: worker=$DeployWorker pages=$DeployPages syncFirmware=$SyncFirmwareSecrets syncDeviceConfig=$SyncDeviceConfig buildFirmware=$BuildFirmware" -ForegroundColor Gray

if ($DeployWorker) {
  Write-Host "Deploying worker..." -ForegroundColor Cyan
  Push-Location $cloudflareDir
  npm run deploy:worker
  Pop-Location
}

if ($DeployPages) {
  Write-Host "Deploying pages..." -ForegroundColor Cyan
  Push-Location $cloudflareDir
  npm run deploy:pages
  Pop-Location
}

if ($SyncFirmwareSecrets) {
  Write-Host "Syncing firmware secrets.h..." -ForegroundColor Cyan
  $firmwareSyncScript = Join-Path $repoRoot "firmware\scripts\firmware_secrets_sync.ps1"
  if (-not (Test-Path $firmwareSyncScript)) { throw "Missing $firmwareSyncScript" }
  $syncArgs = @{
    SkipInfisical      = $true
    DeviceBootstrapKey = $DeviceBootstrapKey
    WorkerUrl          = $WorkerUrl
    Timezone           = $Timezone
  }
  & $firmwareSyncScript @syncArgs
}

if ($BuildFirmware) {
  Write-Host "Building firmware (secrets sync + pio compile)..." -ForegroundColor Cyan

  # Sync secrets.h first (skips if no bootstrap key available)
  $firmwareSyncScript = Join-Path $repoRoot "firmware\scripts\firmware_secrets_sync.ps1"
  if (Test-Path $firmwareSyncScript) {
    $syncArgs = @{}
    if ($DeviceBootstrapKey -and $WorkerUrl) {
      $syncArgs.SkipInfisical      = $true
      $syncArgs.DeviceBootstrapKey = $DeviceBootstrapKey
      $syncArgs.WorkerUrl          = $WorkerUrl
      if ($Timezone) { $syncArgs.Timezone = $Timezone }
      Write-Host "  Syncing secrets.h..." -ForegroundColor Gray
      & $firmwareSyncScript @syncArgs
    } elseif ($infisicalEnabled -and $infisicalAvailable) {
      $syncArgs.InfisicalEnv = $InfisicalEnv
      if ($InfisicalProjectId) { $syncArgs.InfisicalProjectId = $InfisicalProjectId }
      Write-Host "  Syncing secrets.h from Infisical..." -ForegroundColor Gray
      & $firmwareSyncScript @syncArgs
    } else {
      Write-Host "  No secrets available — building without secrets.h (CI mode, uses __has_include guard)." -ForegroundColor DarkGray
    }
  }

  $pioExe = "$env:USERPROFILE\.platformio\penv\Scripts\pio.exe"
  if (-not (Test-Path $pioExe)) { throw "PlatformIO not found at $pioExe — install via VS Code PlatformIO extension." }
  Push-Location $repoRoot
  try {
    & $pioExe run
    if ($LASTEXITCODE -ne 0) { throw "pio run exited $LASTEXITCODE" }
    Write-Host "Firmware build succeeded." -ForegroundColor Green
  } finally {
    Pop-Location
  }
}

if ($SyncDeviceConfig) {
  Write-Host "Syncing per-device config from Infisical to Worker KV..." -ForegroundColor Cyan

  # Collect all bg_device_<chipId>_* secrets from $secretMap
  $deviceSecrets = @{}
  if ($infisicalEnabled -and $infisicalAvailable) {
    foreach ($key in $secretMap.Keys) {
      if ($key -match '^bg_device_([0-9a-fA-F]{8,16})_(.+)$') {
        $chipId = $Matches[1].ToLower()
        $field  = $Matches[2].ToLower()
        if (-not $deviceSecrets.ContainsKey($chipId)) { $deviceSecrets[$chipId] = @{} }
        $deviceSecrets[$chipId][$field] = $secretMap[$key]
      }
    }
  }

  if ($deviceSecrets.Count -eq 0) {
    Write-Host "  No bg_device_* secrets found in Infisical — nothing to sync." -ForegroundColor DarkGray
  } else {
    $headers = @{
      "Content-Type"   = "application/json"
      "X-Admin-Session" = $AdminSessionToken
    }
    foreach ($chipId in $deviceSecrets.Keys) {
      $patch = @{}
      $fields = $deviceSecrets[$chipId]
      if ($fields.ContainsKey("timezone")) { $patch["timezone"] = $fields["timezone"] }
      # Skip KEY field — that's identity, not a config override
      if ($patch.Count -eq 0) {
        Write-Host "  [$chipId] No config overrides (only KEY stored) — skipped." -ForegroundColor DarkGray
        continue
      }
      $body = $patch | ConvertTo-Json -Compress
      try {
        $uri = "$WorkerUrl/api/admin/device-config/$chipId"
        Invoke-RestMethod -Uri $uri -Method POST -Headers $headers -Body $body | Out-Null
        Write-Host "  [$chipId] Synced: $($patch.Keys -join ', ')" -ForegroundColor Green
      } catch {
        Write-Warning "  [$chipId] Failed to sync: $($_.Exception.Message)"
      }
    }
  }
}

Write-Host "Project operations complete." -ForegroundColor Green
