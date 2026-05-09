# BG MiniView Checkly Integration Setup
# Idempotent upsert of checks with strict assertions.

param(
  [Parameter(Mandatory = $false)]
  [switch]$UseInfisical,
  [Parameter(Mandatory = $false)]
  [string]$InfisicalEnv = "dev",
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
  [string]$AlertEmail = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareApiToken = "",
  [Parameter(Mandatory = $false)]
  [string]$CloudflareAccountId = ""
)

$ErrorActionPreference = "Stop"

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
  $InfisicalProjectId = "<REDACTED_INFISICAL_PROJECT_ID>"
}

$InfisicalCliPath = "C:\Users\zaneb\AppData\Roaming\npm\infisical.cmd"
if (-not (Test-Path $InfisicalCliPath)) {
  Write-Host "Infisical CLI not found at $InfisicalCliPath" -ForegroundColor Red
  exit 1
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

if ($UseInfisical) {
  Write-Host "Fetching secrets from Infisical..." -ForegroundColor Cyan
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
  } catch {
    Write-Host "Failed to export secrets from Infisical: $($_.Exception.Message)" -ForegroundColor Red
  }
}

if (-not $ChecklyApiKey -or -not $WorkerUrl) {
  Write-Host "Missing ChecklyApiKey or WorkerUrl" -ForegroundColor Red
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

if (-not $ChecklyAccountId) {
  $accounts = Invoke-Checkly -Method "GET" -Path "/accounts" | ConvertFrom-Json
  $ChecklyAccountId = $accounts[0].id
}

Write-Host "`nBG MiniView Checkly Setup" -ForegroundColor Cyan
Write-Host "Worker: $WorkerUrl" -ForegroundColor Gray
Write-Host "Account: $ChecklyAccountId`n" -ForegroundColor Gray

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
    $id = ($resp | ConvertFrom-Json).id
    Write-Host "  Updated: $Name ($id)" -ForegroundColor Green
  } else {
    $resp = Invoke-Checkly -Method "POST" -Path "/checks" -Body $tmp
    $id = ($resp | ConvertFrom-Json).id
    Write-Host "  Created: $Name ($id)" -ForegroundColor Green
  }

  Remove-Item $tmp -Force
}

$authGuardAssertions = @(
  @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "401"; property = ""; regex = "" }
)

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

Upsert-Check "BG Device Connectivity" ($common + @{
  name = "BG Device Connectivity"
  frequency = 5
  description = "Passes only when worker is reachable and device.online=true."
  request = @{
    method = "GET"; url = "$WorkerUrl/api/status-check"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @();
    assertions = @(
      @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" },
      @{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.device.online"; regex = "" }
    )
  }
})

Upsert-Check "BG Config Reachability" ($common + @{
  name = "BG Config Reachability"; frequency = 60; description = "Passes only when /api/config returns auth guard response.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/config?v=4"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = $authGuardAssertions }
})

Upsert-Check "BG WebSocket Reachability" ($common + @{
  name = "BG WebSocket Reachability"; frequency = 120; description = "Passes only when /api/ws is protected and returns 401 unauthenticated.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/ws"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = $authGuardAssertions }
})

Upsert-Check "BG Digest Reachability" ($common + @{
  name = "BG Digest Reachability"; frequency = 120; description = "Passes only when /api/digest returns auth guard response.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/digest"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = $authGuardAssertions }
})

Upsert-Check "BG Command Reachability" ($common + @{
  name = "BG Command Reachability"; frequency = 180; description = "Passes only when /api/command returns auth guard response.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/command"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = $authGuardAssertions }
})

Upsert-Check "Dexcom Share Connectivity" ($common + @{
  name = "Dexcom Share Connectivity"; frequency = 180; description = "Dexcom Share endpoint availability check.";
  request = @{ method = "GET"; url = "https://share2.dexcom.com/ShareWebServices/Services/General/LoginPublisherAccountByName"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = @(@{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "405"; property = ""; regex = "" }) }
})

if ($NightscoutUrl) {
  $nightscoutHeaders = @()
  $nightscoutAssertions = @(
    @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "401"; property = ""; regex = "" }
  )
  if ($NightscoutApiToken) {
    $nightscoutHeaders = @(
      @{ key = "Authorization"; value = "Bearer $NightscoutApiToken" }
    )
    $nightscoutAssertions = @(
      @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" }
    )
  }
  Upsert-Check "Nightscout Connectivity" ($common + @{
    name = "Nightscout Connectivity"; frequency = 120; description = "Nightscout endpoint availability check.";
    request = @{ method = "GET"; url = "$NightscoutUrl/api/v1/entries.json?count=1"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $nightscoutHeaders; queryParameters = @(); assertions = $nightscoutAssertions }
  })
}

Upsert-Check "BG Daily Digest Freshness" ($common + @{
  name = "BG Daily Digest Freshness"; frequency = 360; description = "Daily digest freshness signal.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/status-check"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = @(@{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.digest.digestIsFresh"; regex = "" }) }
})

Upsert-Check "BG Hourly Pipeline Alive" ($common + @{
  name = "BG Hourly Pipeline Alive"; frequency = 180; description = "Hourly pipeline signal based on status endpoint availability.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/status-check"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = @(@{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" }) }
})

Upsert-Check "BG Worker Health" ($common + @{
  name = "BG Worker Health"; frequency = 360; description = "Basic worker endpoint health.";
  request = @{ method = "GET"; url = "$WorkerUrl/api/detect-timezone"; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = @(); assertions = @(@{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" }) }
})

Write-Host "`nDone. Checkly monitors are up to date." -ForegroundColor Green
Write-Host "https://app.checklyhq.com/checks" -ForegroundColor Cyan
