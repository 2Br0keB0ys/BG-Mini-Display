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
  [switch]$SetupCheckly,
  [Parameter(Mandatory = $false)]
  [switch]$RotateMonitorKey,
  [Parameter(Mandatory = $false)]
  [switch]$SyncFirmwareSecrets,

  [Parameter(Mandatory = $false)]
  [switch]$FastStabilize,
  [Parameter(Mandatory = $false)]
  [switch]$SkipWorkerDeployOnRotate,
  [Parameter(Mandatory = $false)]
  [string]$NewMonitorKey = "",

  [Parameter(Mandatory = $false)]
  [string]$ChecklyApiKey = "",
  [Parameter(Mandatory = $false)]
  [string]$ChecklyAccountId = "",
  [Parameter(Mandatory = $false)]
  [string]$MonitorKey = "",
  [Parameter(Mandatory = $false)]
  [string]$WorkerUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$NightscoutUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$AlertEmail = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareAccountId = "",
  [Parameter(Mandatory = $false)]
  [string]$DeviceBootstrapKey = "",
  [Parameter(Mandatory = $false)]
  [string]$Timezone = "",
  [Parameter(Mandatory = $false)]
  [string]$ChecklyHeartbeatUrl = "",
  [Parameter(Mandatory = $false)]
  [int]$ChecklyHeartbeatSec = 60
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
$cloudflareScriptsDir = Join-Path $cloudflareDir "scripts"
$setupChecklyPath = Join-Path $cloudflareScriptsDir "setup_checkly.ps1"
$rotateMonitorPath = Join-Path $cloudflareScriptsDir "rotate_monitor_key.ps1"
$firmwareSecretsPath = Join-Path $repoRoot "firmware\src\secrets.h"

if (-not (Test-Path $setupChecklyPath)) { throw "Missing $setupChecklyPath" }
if (-not (Test-Path $rotateMonitorPath)) { throw "Missing $rotateMonitorPath" }

$infisicalEnabled = -not $SkipInfisical
$infisicalCliPath = "C:\Users\zaneb\AppData\Roaming\npm\infisical.cmd"
$infisicalAvailable = Test-Path $infisicalCliPath

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

  if (-not $ChecklyApiKey -and $secretMap.ContainsKey("CHECKLY_API_KEY")) { $ChecklyApiKey = $secretMap["CHECKLY_API_KEY"] }
  if (-not $ChecklyAccountId -and $secretMap.ContainsKey("CHECKLY_ACCOUNT_ID")) { $ChecklyAccountId = $secretMap["CHECKLY_ACCOUNT_ID"] }
  if (-not $MonitorKey -and $secretMap.ContainsKey("CHECKLY_MONITOR_KEY")) { $MonitorKey = $secretMap["CHECKLY_MONITOR_KEY"] }
  if (-not $WorkerUrl -and $secretMap.ContainsKey("WORKER_URL")) { $WorkerUrl = $secretMap["WORKER_URL"] }
  if (-not $NightscoutUrl -and $secretMap.ContainsKey("NIGHTSCOUT_URL")) { $NightscoutUrl = $secretMap["NIGHTSCOUT_URL"] }
  if (-not $AlertEmail -and $secretMap.ContainsKey("ALERT_EMAIL")) { $AlertEmail = $secretMap["ALERT_EMAIL"] }
  if (-not $CloudflareApiToken -and $secretMap.ContainsKey("CLOUDFLARE_API_TOKEN")) { $CloudflareApiToken = $secretMap["CLOUDFLARE_API_TOKEN"] }
  if (-not $CloudflareAccountId -and $secretMap.ContainsKey("CLOUDFLARE_ACCOUNT_ID")) { $CloudflareAccountId = $secretMap["CLOUDFLARE_ACCOUNT_ID"] }

  # Firmware-centric secret aliases
  if (-not $DeviceBootstrapKey -and $secretMap.ContainsKey("BGDISPLAY_DEFAULT_DEVICE_KEY")) { $DeviceBootstrapKey = $secretMap["BGDISPLAY_DEFAULT_DEVICE_KEY"] }
  if (-not $DeviceBootstrapKey -and $secretMap.ContainsKey("DEVICE_BOOTSTRAP_KEY")) { $DeviceBootstrapKey = $secretMap["DEVICE_BOOTSTRAP_KEY"] }
  if (-not $Timezone -and $secretMap.ContainsKey("BGDISPLAY_DEFAULT_TIMEZONE")) { $Timezone = $secretMap["BGDISPLAY_DEFAULT_TIMEZONE"] }
  if (-not $Timezone -and $secretMap.ContainsKey("TIMEZONE")) { $Timezone = $secretMap["TIMEZONE"] }
  if (-not $ChecklyHeartbeatUrl -and $secretMap.ContainsKey("BGDISPLAY_CHECKLY_HEARTBEAT_URL")) { $ChecklyHeartbeatUrl = $secretMap["BGDISPLAY_CHECKLY_HEARTBEAT_URL"] }
  if (-not $ChecklyHeartbeatUrl -and $secretMap.ContainsKey("CHECKLY_HEARTBEAT_URL")) { $ChecklyHeartbeatUrl = $secretMap["CHECKLY_HEARTBEAT_URL"] }
  if ($ChecklyHeartbeatSec -eq 60 -and $secretMap.ContainsKey("BGDISPLAY_CHECKLY_HEARTBEAT_SEC")) {
    $parsedSec = 60
    if ([int]::TryParse([string]$secretMap["BGDISPLAY_CHECKLY_HEARTBEAT_SEC"], [ref]$parsedSec)) {
      $ChecklyHeartbeatSec = $parsedSec
    }
  }
}

$WorkerUrl = Normalize-Url $WorkerUrl
$NightscoutUrl = Normalize-Url $NightscoutUrl

if ($CloudflareApiToken) { $env:CLOUDFLARE_API_TOKEN = $CloudflareApiToken }
if ($CloudflareAccountId) { $env:CLOUDFLARE_ACCOUNT_ID = $CloudflareAccountId }

if (-not ($DeployWorker -or $DeployPages -or $SetupCheckly -or $RotateMonitorKey -or $SyncFirmwareSecrets)) {
  Write-Host "No actions selected. Available actions:" -ForegroundColor Yellow
  Write-Host "  -DeployWorker -DeployPages -SetupCheckly -RotateMonitorKey -SyncFirmwareSecrets" -ForegroundColor Yellow
  exit 1
}

if (($SetupCheckly -or $RotateMonitorKey -or $SyncFirmwareSecrets) -and -not $WorkerUrl) {
  throw "WorkerUrl is required for selected action(s)."
}

if ($SetupCheckly) {
  if (-not $ChecklyApiKey) { throw "SetupCheckly requires ChecklyApiKey." }
  if (-not $MonitorKey) { throw "SetupCheckly requires MonitorKey." }
}

if ($RotateMonitorKey) {
  if (-not $ChecklyApiKey) { throw "RotateMonitorKey requires ChecklyApiKey." }
}

if ($SyncFirmwareSecrets) {
  if (-not $DeviceBootstrapKey) {
    throw "SyncFirmwareSecrets requires DeviceBootstrapKey (BGDISPLAY_DEFAULT_DEVICE_KEY or DEVICE_BOOTSTRAP_KEY)."
  }
  if (-not $Timezone) { $Timezone = "US/Central" }
}

Write-Host "Project Infisical Ops" -ForegroundColor Cyan
Write-Host "Repo: $repoRoot" -ForegroundColor Gray
Write-Host "Actions: worker=$DeployWorker pages=$DeployPages setupCheckly=$SetupCheckly rotateKey=$RotateMonitorKey syncFirmware=$SyncFirmwareSecrets" -ForegroundColor Gray

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

if ($SetupCheckly) {
  Write-Host "Applying Checkly monitor definitions..." -ForegroundColor Cyan
  $setupArgs = @{
    SkipInfisical = $true
    ChecklyApiKey = $ChecklyApiKey
    WorkerUrl = $WorkerUrl
    MonitorKey = $MonitorKey
  }
  if ($ChecklyAccountId) { $setupArgs.ChecklyAccountId = $ChecklyAccountId }
  if ($NightscoutUrl) { $setupArgs.NightscoutUrl = $NightscoutUrl }
  if ($AlertEmail) { $setupArgs.AlertEmail = $AlertEmail }
  if ($FastStabilize) { $setupArgs.FastStabilize = $true }

  & $setupChecklyPath @setupArgs
}

if ($RotateMonitorKey) {
  Write-Host "Rotating monitor key..." -ForegroundColor Cyan
  $rotateArgs = @{
    SkipInfisical = $true
    ChecklyApiKey = $ChecklyApiKey
    WorkerUrl = $WorkerUrl
  }
  if ($ChecklyAccountId) { $rotateArgs.ChecklyAccountId = $ChecklyAccountId }
  if ($NightscoutUrl) { $rotateArgs.NightscoutUrl = $NightscoutUrl }
  if ($NewMonitorKey) { $rotateArgs.NewMonitorKey = $NewMonitorKey }
  if ($SkipWorkerDeployOnRotate) { $rotateArgs.SkipWorkerDeploy = $true }

  & $rotateMonitorPath @rotateArgs
}

if ($SyncFirmwareSecrets) {
  Write-Host "Syncing firmware secrets.h from hydrated values..." -ForegroundColor Cyan
  $escapedWorker = $WorkerUrl.Replace('"', '')
  $escapedDevice = $DeviceBootstrapKey.Replace('"', '')
  $escapedTimezone = $Timezone.Replace('"', '')
  $heartbeatRaw = ""
  if ($ChecklyHeartbeatUrl) { $heartbeatRaw = $ChecklyHeartbeatUrl }
  $escapedHeartbeatUrl = $heartbeatRaw.Replace('"', '')

  $content = @(
    "#pragma once",
    "",
    "// Generated by scripts/project_infisical_ops.ps1",
    "#define BGDISPLAY_DEFAULT_WORKER_URL `"$escapedWorker`"",
    "#define BGDISPLAY_DEFAULT_DEVICE_KEY `"$escapedDevice`"",
    "#define BGDISPLAY_DEFAULT_TIMEZONE `"$escapedTimezone`"",
    "#define BGDISPLAY_CHECKLY_HEARTBEAT_URL `"$escapedHeartbeatUrl`"",
    "#define BGDISPLAY_CHECKLY_HEARTBEAT_SEC $ChecklyHeartbeatSec"
  ) -join "`r`n"

  Set-Content -Path $firmwareSecretsPath -Value $content -Encoding ascii
  Write-Host "Updated $firmwareSecretsPath" -ForegroundColor Green
}

Write-Host "Project operations complete." -ForegroundColor Green
