# BG MiniView Checkly Integration Setup
# Idempotent upsert of checks with strict assertions.

param(
  [Parameter(Mandatory = $false)]
  [switch]$UseInfisical,
  [Parameter(Mandatory = $false)]
  [switch]$SkipInfisical,
  [Parameter(Mandatory = $false)]
  [switch]$FastStabilize,
  [Parameter(Mandatory = $false)]
  [string]$InfisicalEnv = "dev",
  [Parameter(Mandatory = $false)]
  [string]$InfisicalProjectId = "",
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
  [string]$NightscoutApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$AlertEmail = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareAccountId = ""
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

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InfisicalConfigPath = Join-Path $ScriptDir ".infisical.json"
if (Test-Path $InfisicalConfigPath) {
  try {
    $cfg = Get-Content -Raw $InfisicalConfigPath | ConvertFrom-Json
    if (-not $InfisicalProjectId -and $cfg.workspaceId) { $InfisicalProjectId = [string]$cfg.workspaceId }
  } catch {}
}
if (-not $InfisicalProjectId) {
  # Fallback to known workspace id from local init.
  $InfisicalProjectId = "8eaddd1f-66e5-43cc-abe6-1e84100ebd9d"
}

$InfisicalCliPath = "C:\Users\zaneb\AppData\Roaming\npm\infisical.cmd"
$InfisicalEnabled = $UseInfisical -or (-not $SkipInfisical)
$InfisicalCliAvailable = Test-Path $InfisicalCliPath

if ($InfisicalEnabled -and -not $InfisicalCliAvailable) {
  Write-Host "Infisical CLI not found at $InfisicalCliPath" -ForegroundColor Yellow
  Write-Host "Continuing with manual/script parameters only." -ForegroundColor Yellow
}

function Invoke-InfisicalCli {
  param([string[]]$CliArgs)
  return & $InfisicalCliPath @CliArgs 2>&1
}

function Get-InfisicalSecret {
  param([string]$Name)
  $envCandidates = @($InfisicalEnv, "production", "dev") | Select-Object -Unique
  foreach ($envName in $envCandidates) {
    try {
      $secretArgs = @("--silent", "secrets", "get", $Name, "--env", $envName, "--output", "json")
      if ($InfisicalProjectId) { $secretArgs += @("--projectId", $InfisicalProjectId) }
      $raw = Invoke-InfisicalCli -CliArgs $secretArgs
      $line = ($raw | Out-String).Trim()
      if (-not $line) { continue }
      $parsed = $line | ConvertFrom-Json
      if ($parsed -and $parsed[0] -and $parsed[0].secretValue) {
        return [string]$parsed[0].secretValue
      }
    } catch {}
  }
  return ""
}

if ($InfisicalEnabled -and $InfisicalCliAvailable) {
  if ($UseInfisical) {
    Write-Host "Fetching secrets from Infisical..." -ForegroundColor Cyan
  } else {
    Write-Host "Infisical-first mode: attempting to hydrate missing values from Infisical..." -ForegroundColor Cyan
  }
  # Support both service-token auth (INFISICAL_TOKEN) and prior CLI login session.
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
    if (-not $AlertEmail -and $secretMap.ContainsKey("ALERT_EMAIL")) { $AlertEmail = $secretMap["ALERT_EMAIL"] }
    if (-not $CloudflareApiToken -and $secretMap.ContainsKey("CLOUDFLARE_API_TOKEN")) { $CloudflareApiToken = $secretMap["CLOUDFLARE_API_TOKEN"] }
    if (-not $CloudflareAccountId -and $secretMap.ContainsKey("CLOUDFLARE_ACCOUNT_ID")) { $CloudflareAccountId = $secretMap["CLOUDFLARE_ACCOUNT_ID"] }
    if (-not $MonitorKey -and $secretMap.ContainsKey("CHECKLY_MONITOR_KEY")) { $MonitorKey = $secretMap["CHECKLY_MONITOR_KEY"] }
  } catch {
    Write-Host "Failed to export secrets from Infisical: $($_.Exception.Message)" -ForegroundColor Red
  }
}

$WorkerUrl = Normalize-WorkerUrl $WorkerUrl

$missingRequired = @()
if (-not $ChecklyApiKey) { $missingRequired += "CHECKLY_API_KEY / -ChecklyApiKey" }
if (-not $WorkerUrl) { $missingRequired += "WORKER_URL / -WorkerUrl" }
if (-not $MonitorKey) { $missingRequired += "CHECKLY_MONITOR_KEY / -MonitorKey" }

if ($missingRequired.Count -gt 0) {
  Write-Host "Missing required inputs:" -ForegroundColor Red
  foreach ($m in $missingRequired) {
    Write-Host "  - $m" -ForegroundColor Red
  }
  Write-Host "Tip: set these in Infisical and rerun (default mode), or pass flags explicitly." -ForegroundColor Yellow
  exit 1
}

if ($WorkerUrl -notmatch '^https://') {
  Write-Host "WorkerUrl must use https://" -ForegroundColor Red
  exit 1
}

if ($MonitorKey -notmatch '^ckm_[A-Za-z0-9]+$') {
  Write-Host "MonitorKey format is invalid. Expected prefix ckm_." -ForegroundColor Red
  exit 1
}

if ($CloudflareApiToken) {
  Write-Host "Cloudflare API token loaded from secrets (ready for future automation)." -ForegroundColor Green
}
if ($NightscoutApiToken) {
  Write-Host "Nightscout API token loaded from secrets." -ForegroundColor Green
}

function Invoke-Checkly {
  param(
    [string]$Method,
    [string]$Path,
    [string]$Body = ""
  )

  $baseArgs = @("-sS", "--max-time", "30", "-X", $Method, "https://api.checklyhq.com/v1$Path", "-H", "Authorization: Bearer $ChecklyApiKey")
  if ($ChecklyAccountId) {
    $baseArgs += @("-H", "x-checkly-account: $ChecklyAccountId")
  }
  if ($Body) {
    $baseArgs += @("-H", "Content-Type: application/json", "--data-binary", "@$Body")
  }
  return curl.exe @baseArgs
}

function Get-MonitorHeaders {
  if ([string]::IsNullOrWhiteSpace($MonitorKey)) { return @() }
  return @(
    @{ key = "X-Monitor-Key"; value = $MonitorKey }
  )
}

if (-not $ChecklyAccountId) {
  $accounts = Invoke-Checkly -Method "GET" -Path "/accounts" | ConvertFrom-Json
  $ChecklyAccountId = $accounts[0].id
}

Write-Host "`nBG MiniView Checkly Setup" -ForegroundColor Cyan
Write-Host "Worker: $WorkerUrl" -ForegroundColor Gray
Write-Host "Account: $ChecklyAccountId`n" -ForegroundColor Gray
if ($FastStabilize) {
  Write-Host "Fast stabilization mode enabled: all checks will run every 5 minutes." -ForegroundColor Yellow
}

try {
  $workerTest = curl.exe -sS --max-time 20 "$WorkerUrl/api/detect-timezone" | ConvertFrom-Json
  if (-not $workerTest.detected) { throw "detect-timezone missing expected payload" }
  Write-Host "Worker responding" -ForegroundColor Green
} catch {
  Write-Host "Worker not responding: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$existing = Invoke-Checkly -Method "GET" -Path "/checks?limit=100" | ConvertFrom-Json

# Remove duplicate checks by name so stale definitions do not keep failing.
$dupes = $existing | Group-Object name | Where-Object { $_.Count -gt 1 }
foreach ($dup in $dupes) {
  $ordered = $dup.Group | Sort-Object updated_at -Descending
  $keep = $ordered | Select-Object -First 1
  $drop = $ordered | Select-Object -Skip 1
  foreach ($d in $drop) {
    try {
      Invoke-Checkly -Method "DELETE" -Path "/checks/$($d.id)" | Out-Null
      Write-Host "  Removed duplicate check: $($d.name) ($($d.id))" -ForegroundColor Yellow
    } catch {
      Write-Host "  Failed to remove duplicate check: $($d.name) ($($d.id))" -ForegroundColor Red
    }
  }
}

if ($dupes.Count -gt 0) {
  $existing = Invoke-Checkly -Method "GET" -Path "/checks?limit=100" | ConvertFrom-Json
}

$normalFrequencies = @{
  "BG Device Connectivity" = 5
  "BG Config Reachability" = 60
  "BG WebSocket Reachability" = 120
  "BG Digest Reachability" = 120
  "BG Command Reachability" = 180
  "Dexcom Share Connectivity" = 180
  "Nightscout Connectivity" = 120
  "BG Daily Digest Freshness" = 360
  "BG Hourly Pipeline Alive" = 180
  "BG Worker Health" = 360
}

function Get-CheckFrequency {
  param(
    [string]$CheckName
  )

  if ($FastStabilize) { return 5 }
  if ($normalFrequencies.ContainsKey($CheckName)) { return [int]$normalFrequencies[$CheckName] }
  return 60
}

function Upsert-Check {
  param(
    [string]$Name,
    [hashtable]$Payload
  )

  $payloadJson = $Payload | ConvertTo-Json -Depth 20
  $tmp = [IO.Path]::GetTempFileName()
  Set-Content -Path $tmp -Value $payloadJson -NoNewline

  $match = $existing | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if ($match) {
    $resp = Invoke-Checkly -Method "PUT" -Path "/checks/$($match.id)" -Body $tmp
    $parsed = $null
    try { $parsed = $resp | ConvertFrom-Json } catch {}
    $id = if ($parsed -and $parsed.id) { $parsed.id } else { $match.id }
    Write-Host "  Updated: $Name ($id)" -ForegroundColor Green
  } else {
    $resp = Invoke-Checkly -Method "POST" -Path "/checks" -Body $tmp
    $parsed = $null
    try { $parsed = $resp | ConvertFrom-Json } catch {}
    $id = if ($parsed -and $parsed.id) { $parsed.id } else { "unknown" }
    if ($id -eq "unknown") {
      Remove-Item $tmp -Force
      throw "Create failed for check '$Name' (no id in response)"
    }
    Write-Host "  Created: $Name ($id)" -ForegroundColor Green
  }

  Remove-Item $tmp -Force
}

$common = @{
  checkType = "API"
  activated = $true
  muted = $false
  shouldFail = $false
  locations = @("us-east-1")
  doubleCheck = $true
  degradedResponseTime = 5000
  maxResponseTime = 20000
}

Write-Host "`nUpserting monitors..." -ForegroundColor Yellow

$monitorHeaders = Get-MonitorHeaders
$monitorUrl = "$WorkerUrl/api/monitor/status-check"

Upsert-Check "BG Device Connectivity" ($common + @{
  name = "BG Device Connectivity"
  frequency = Get-CheckFrequency "BG Device Connectivity"
  description = "Passes only when monitor endpoint reports device.online=true."
  request = @{
    method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @();
    assertions = @(
      @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" },
      @{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.device.online"; regex = "" }
    )
  }
})

Upsert-Check "BG Config Reachability" ($common + @{
  name = "BG Config Reachability"; frequency = Get-CheckFrequency "BG Config Reachability"; description = "Passes only when protected config route is guarded correctly.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.configAuthGuard"; regex = "" }) }
})

Upsert-Check "BG WebSocket Reachability" ($common + @{
  name = "BG WebSocket Reachability"; frequency = Get-CheckFrequency "BG WebSocket Reachability"; description = "Passes only when protected websocket route is guarded correctly.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.wsAuthGuard"; regex = "" }) }
})

Upsert-Check "BG Digest Reachability" ($common + @{
  name = "BG Digest Reachability"; frequency = Get-CheckFrequency "BG Digest Reachability"; description = "Passes only when protected digest route is guarded correctly.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.digestAuthGuard"; regex = "" }) }
})

Upsert-Check "BG Command Reachability" ($common + @{
  name = "BG Command Reachability"; frequency = Get-CheckFrequency "BG Command Reachability"; description = "Passes only when protected command route is guarded correctly.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.commandAuthGuard"; regex = "" }) }
})

Upsert-Check "Dexcom Share Connectivity" ($common + @{
  name = "Dexcom Share Connectivity"; frequency = Get-CheckFrequency "Dexcom Share Connectivity"; description = "Passes when Dexcom host is reachable from worker monitor probe.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.upstream.dexcomRootReachable"; regex = "" }) }
})

if ($NightscoutUrl) {
  Upsert-Check "Nightscout Connectivity" ($common + @{
    name = "Nightscout Connectivity"; frequency = Get-CheckFrequency "Nightscout Connectivity"; description = "Nightscout endpoint availability check.";
    request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.upstream.nightscoutReachable"; regex = "" }) }
  })
}

Upsert-Check "BG Daily Digest Freshness" ($common + @{
  name = "BG Daily Digest Freshness"; frequency = Get-CheckFrequency "BG Daily Digest Freshness"; description = "Daily digest freshness signal.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.digest.digestIsFresh"; regex = "" }) }
})

Upsert-Check "BG Hourly Pipeline Alive" ($common + @{
  name = "BG Hourly Pipeline Alive"; frequency = Get-CheckFrequency "BG Hourly Pipeline Alive"; description = "Hourly pipeline signal based on status endpoint availability.";
  request = @{ method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @(); assertions = @(@{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" }) }
})

Upsert-Check "BG Worker Health" ($common + @{
  name = "BG Worker Health"; frequency = Get-CheckFrequency "BG Worker Health"; description = "Basic worker endpoint health.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/detect-timezone"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = @(@{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" }) }
})

Write-Host "`nDone. Checkly monitors are up to date." -ForegroundColor Green
Write-Host "https://app.checklyhq.com/checks" -ForegroundColor Cyan
