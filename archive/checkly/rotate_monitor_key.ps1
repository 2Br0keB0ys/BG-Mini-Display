# BG MiniView monitor-key rotation helper
# Rotates CHECKLY_MONITOR_KEY across Cloudflare Worker and Checkly monitor definitions.

param(
  [Parameter(Mandatory = $false)]
  [switch]$UseInfisical,
  [Parameter(Mandatory = $false)]
  [switch]$SkipInfisical,
  [Parameter(Mandatory = $false)]
  [string]$InfisicalEnv = "production",
  [Parameter(Mandatory = $false)]
  [string]$InfisicalProjectId = "",
  [Parameter(Mandatory = $false)]
  [string]$ChecklyApiKey = "",
  [Parameter(Mandatory = $false)]
  [string]$ChecklyAccountId = "",
  [Parameter(Mandatory = $false)]
  [string]$WorkerUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$NightscoutUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$NightscoutApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$NewMonitorKey = "",
  [Parameter(Mandatory = $false)]
  [switch]$SkipWorkerDeploy
)

$ErrorActionPreference = "Stop"

function Normalize-WorkerUrl {
  param([string]$Raw)
  if (-not $Raw) { return "" }
  $u = [string]$Raw
  $u = $u.Trim()
  if (-not $u) { return "" }
  return $u.TrimEnd('/')
}

function New-MonitorKey {
  # 24 random bytes -> 48 hex chars
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $hex = [System.BitConverter]::ToString($bytes).Replace("-", "").ToLowerInvariant()
  return "ckm_$hex"
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..\..\..")
$cloudflareDir = Resolve-Path (Join-Path $scriptDir "..")
$setupChecklyPath = Join-Path $scriptDir "setup_checkly.ps1"

if (-not (Test-Path $setupChecklyPath)) {
  throw "setup_checkly.ps1 not found at $setupChecklyPath"
}

$infisicalEnabled = $UseInfisical -or (-not $SkipInfisical)
function Resolve-InfisicalCliPath {
  $cmd = Get-Command infisical -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $defaultPath = Join-Path $env:APPDATA "npm\infisical.cmd"
  if (Test-Path $defaultPath) { return $defaultPath }

  return $null
}

$infisicalCliPath = Resolve-InfisicalCliPath
$infisicalAvailable = Test-Path $infisicalCliPath

if ($infisicalEnabled -and -not $infisicalAvailable) {
  Write-Host "Infisical CLI not found at $infisicalCliPath" -ForegroundColor Yellow
  Write-Host "Continuing with manually supplied values only." -ForegroundColor Yellow
}

function Invoke-InfisicalCli {
  param([string[]]$CliArgs)
  return & $infisicalCliPath @CliArgs 2>&1
}

if ($infisicalEnabled -and $infisicalAvailable) {
  Write-Host "Hydrating missing values from Infisical..." -ForegroundColor Cyan
  try {
    $exportArgs = @("--silent", "export", "--env", $InfisicalEnv, "--format", "json")
    if ($InfisicalProjectId) { $exportArgs += @("--projectId", $InfisicalProjectId) }
    $raw = Invoke-InfisicalCli -CliArgs $exportArgs
    $line = ($raw | Out-String).Trim()
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
    if (-not $WorkerUrl -and $secretMap.ContainsKey("WORKER_URL")) { $WorkerUrl = $secretMap["WORKER_URL"] }
    if (-not $NightscoutUrl -and $secretMap.ContainsKey("NIGHTSCOUT_URL")) { $NightscoutUrl = $secretMap["NIGHTSCOUT_URL"] }
    if (-not $NightscoutApiToken -and $secretMap.ContainsKey("NIGHTSCOUT_API_TOKEN")) { $NightscoutApiToken = $secretMap["NIGHTSCOUT_API_TOKEN"] }
    if (-not $NightscoutApiToken -and $secretMap.ContainsKey("NIGHTSCOUT_APITOKEN")) { $NightscoutApiToken = $secretMap["NIGHTSCOUT_APITOKEN"] }
  } catch {
    Write-Host "Infisical export failed: $($_.Exception.Message)" -ForegroundColor Red
  }
}

$WorkerUrl = Normalize-WorkerUrl $WorkerUrl

if (-not $ChecklyApiKey) { throw "Missing ChecklyApiKey (or CHECKLY_API_KEY in Infisical)." }
if (-not $WorkerUrl) { throw "Missing WorkerUrl (or WORKER_URL in Infisical)." }
if ($WorkerUrl -notmatch '^https://') { throw "WorkerUrl must use https://" }

if (-not $NewMonitorKey) {
  $NewMonitorKey = New-MonitorKey
}
if ($NewMonitorKey -notmatch '^ckm_[A-Za-z0-9]+$') {
  throw "NewMonitorKey is invalid. Expected prefix ckm_."
}

Write-Host "Rotating CHECKLY_MONITOR_KEY..." -ForegroundColor Cyan
Set-Location $cloudflareDir
$NewMonitorKey | npx --yes wrangler secret put CHECKLY_MONITOR_KEY | Out-Null

if (-not $SkipWorkerDeploy) {
  Write-Host "Deploying worker after secret rotation..." -ForegroundColor Cyan
  npm run deploy:worker
}

if ($infisicalEnabled -and $infisicalAvailable) {
  Write-Host "Updating Infisical CHECKLY_MONITOR_KEY..." -ForegroundColor Cyan
  $updated = $false

  try {
    $setArgsA = @("--silent", "secrets", "set", "CHECKLY_MONITOR_KEY=$NewMonitorKey", "--env", $InfisicalEnv)
    if ($InfisicalProjectId) { $setArgsA += @("--projectId", $InfisicalProjectId) }
    $outA = Invoke-InfisicalCli -CliArgs $setArgsA
    if ($LASTEXITCODE -eq 0) { $updated = $true }
    if (-not $updated -and $outA) { Write-Host ($outA | Out-String) -ForegroundColor Yellow }
  } catch {}

  if (-not $updated) {
    try {
      $setArgsB = @("--silent", "secrets", "set", "--secretName", "CHECKLY_MONITOR_KEY", "--secretValue", $NewMonitorKey, "--env", $InfisicalEnv)
      if ($InfisicalProjectId) { $setArgsB += @("--projectId", $InfisicalProjectId) }
      $outB = Invoke-InfisicalCli -CliArgs $setArgsB
      if ($LASTEXITCODE -eq 0) { $updated = $true }
      if (-not $updated -and $outB) { Write-Host ($outB | Out-String) -ForegroundColor Yellow }
    } catch {}
  }

  if (-not $updated) {
    Write-Host "Unable to update Infisical automatically. Set CHECKLY_MONITOR_KEY manually." -ForegroundColor Yellow
  }
}

Write-Host "Reapplying Checkly monitor definitions with new monitor key..." -ForegroundColor Cyan
$setupArgs = @{
  SkipInfisical = $true
  ChecklyApiKey = $ChecklyApiKey
  WorkerUrl = $WorkerUrl
  MonitorKey = $NewMonitorKey
}
if ($ChecklyAccountId) { $setupArgs.ChecklyAccountId = $ChecklyAccountId }
if ($NightscoutUrl) { $setupArgs.NightscoutUrl = $NightscoutUrl }
if ($NightscoutApiToken) { $setupArgs.NightscoutApiToken = $NightscoutApiToken }

& $setupChecklyPath @setupArgs

Write-Host "Verifying monitor endpoint with rotated key..." -ForegroundColor Cyan
$probe = curl.exe -sS -H "X-Monitor-Key: $NewMonitorKey" "$WorkerUrl/api/monitor/status-check" | ConvertFrom-Json
if (-not $probe.ok) {
  throw "Monitor endpoint verification failed after rotation."
}

$masked = if ($NewMonitorKey.Length -gt 10) { $NewMonitorKey.Substring(0, 10) + "..." } else { $NewMonitorKey }
Write-Host "Rotation complete. Active monitor key: $masked" -ForegroundColor Green
Write-Host "If you store monitor key in firmware/local secrets, update that value as well." -ForegroundColor Yellow
Set-Location $repoRoot
