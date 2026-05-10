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
  $InfisicalProjectId = "<REDACTED_INFISICAL_PROJECT_ID>"
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

  $baseArgs = @(
    "-sS",
    "--fail-with-body",
    "--connect-timeout", "10",
    "--max-time", "45",
    "--retry", "5",
    "--retry-all-errors",
    "--retry-delay", "2",
    "--retry-max-time", "90",
    "-X", $Method,
    "https://api.checklyhq.com/v1$Path",
    "-H", "Authorization: Bearer $ChecklyApiKey",
    "-H", "Accept: application/json"
  )
  if ($ChecklyAccountId) {
    $baseArgs += @("-H", "x-checkly-account: $ChecklyAccountId")
  }
  if ($Body) {
    $baseArgs += @("-H", "Content-Type: application/json", "--data-binary", "@$Body")
  }

  $prevNativeErrorPref = $false
  $hadNativeErrorPref = $false
  if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $hadNativeErrorPref = $true
    $prevNativeErrorPref = $Global:PSNativeCommandUseErrorActionPreference
    $Global:PSNativeCommandUseErrorActionPreference = $false
  }

  $prevErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $response = & curl.exe @baseArgs 2>&1
  } finally {
    $ErrorActionPreference = $prevErrorActionPreference
    if ($hadNativeErrorPref) {
      $Global:PSNativeCommandUseErrorActionPreference = $prevNativeErrorPref
    }
  }
  if ($LASTEXITCODE -ne 0) {
    $msg = ($response | Out-String).Trim()
    if (-not $msg) {
      $msg = "No response body from Checkly API."
    }
    throw "Checkly API call failed: $Method $Path`n$msg"
  }

  return ($response | Out-String).Trim()
}

function ConvertFrom-ChecklyJson {
  param([string]$Raw)
  try {
    return ($Raw | ConvertFrom-Json)
  } catch {
    throw "Failed to parse Checkly JSON response.`n$Raw"
  }
}

function Get-ChecklyList {
  param([string]$Path)
  $raw = Invoke-Checkly -Method "GET" -Path $Path
  $parsed = ConvertFrom-ChecklyJson -Raw $raw
  if ($parsed -is [System.Array]) {
    return $parsed
  }
  if ($parsed -and $parsed.checks) {
    return @($parsed.checks)
  }
  if ($parsed -and $parsed.items) {
    return @($parsed.items)
  }
  if ($null -eq $parsed) {
    return @()
  }
  return @($parsed)
}

function Get-MonitorHeaders {
  if ([string]::IsNullOrWhiteSpace($MonitorKey)) { return @() }
  return ,@(
    @{ key = "X-Monitor-Key"; value = $MonitorKey }
  )
}

if (-not $ChecklyAccountId) {
  $accounts = Get-ChecklyList -Path "/accounts"
  if (-not $accounts -or -not $accounts[0] -or -not $accounts[0].id) {
    throw "Unable to resolve Checkly account id from /accounts"
  }
  $ChecklyAccountId = $accounts[0].id
}

Write-Host "`nBG MiniView Checkly Setup" -ForegroundColor Cyan
Write-Host "Worker: $WorkerUrl" -ForegroundColor Gray
Write-Host "Account: $ChecklyAccountId`n" -ForegroundColor Gray
if ($FastStabilize) {
  Write-Host "Fast stabilization mode enabled: all checks will run every 5 minutes." -ForegroundColor Yellow
}

try {
  $workerRaw = & curl.exe -sS --fail-with-body --connect-timeout 10 --max-time 20 "$WorkerUrl/api/detect-timezone" 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($workerRaw | Out-String).Trim()
  }
  $workerTest = $workerRaw | ConvertFrom-Json
  if (-not $workerTest.detected) { throw "detect-timezone missing expected payload" }
  Write-Host "Worker responding" -ForegroundColor Green
} catch {
  Write-Host "Worker not responding: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$existing = Get-ChecklyList -Path "/checks?limit=100"

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
  $existing = Get-ChecklyList -Path "/checks?limit=100"
}

$normalFrequencies = @{
  "BG Worker API Health" = 5
  "Nightscout Direct Connectivity" = 120
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
  Set-Content -Path $tmp -Value $payloadJson -NoNewline -Encoding ascii

  $match = $existing | Where-Object { $_.name -eq $Name } | Select-Object -First 1
  if ($match) {
    $resp = Invoke-Checkly -Method "PUT" -Path "/checks/$($match.id)" -Body $tmp
    $parsed = $null
    try { $parsed = ConvertFrom-ChecklyJson -Raw $resp } catch {}
    $id = if ($parsed -and $parsed.id) { $parsed.id } else { $match.id }
    Write-Host "  Updated: $Name ($id)" -ForegroundColor Green
  } else {
    $resp = Invoke-Checkly -Method "POST" -Path "/checks" -Body $tmp
    $parsed = $null
    try { $parsed = ConvertFrom-ChecklyJson -Raw $resp } catch {}
    $id = "unknown"
    if ($parsed -and $parsed.id) {
      $id = $parsed.id
    } elseif ($parsed -and $parsed.check -and $parsed.check.id) {
      $id = $parsed.check.id
    } else {
      # Some API responses omit id; re-query by name before failing.
      $refetched = Get-ChecklyList -Path "/checks?limit=100"
      $created = $refetched | Where-Object { $_.name -eq $Name } | Sort-Object updated_at -Descending | Select-Object -First 1
      if ($created -and $created.id) {
        $id = $created.id
        $script:existing = $refetched
      }
    }
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

# Consolidated monitor profile: one worker API check plus optional direct Nightscout check.
$desiredCheckNames = @("BG Worker API Health")
if ($NightscoutUrl) {
  $desiredCheckNames += "Nightscout Direct Connectivity"
}

$legacyCheckNames = @(
  "BG Device Connectivity",
  "BG Config Reachability",
  "BG WebSocket Reachability",
  "BG Digest Reachability",
  "BG Command Reachability",
  "Dexcom Share Connectivity",
  "Nightscout Connectivity",
  "BG Daily Digest Freshness",
  "BG Hourly Pipeline Alive",
  "BG Worker Health",
  "BG MiniView Health"
)

$toDelete = $existing | Where-Object { ($legacyCheckNames -contains $_.name) -and -not ($desiredCheckNames -contains $_.name) }
foreach ($check in $toDelete) {
  try {
    Invoke-Checkly -Method "DELETE" -Path "/checks/$($check.id)" | Out-Null
    Write-Host "  Removed legacy check: $($check.name) ($($check.id))" -ForegroundColor Yellow
  } catch {
    Write-Host "  Failed to remove legacy check: $($check.name) ($($check.id))" -ForegroundColor Red
  }
}

if ($toDelete.Count -gt 0) {
  $existing = Invoke-Checkly -Method "GET" -Path "/checks?limit=100" | ConvertFrom-Json
}

Upsert-Check "BG Worker API Health" ($common + @{
  name = "BG Worker API Health"
  frequency = Get-CheckFrequency "BG Worker API Health"
  description = "Consolidated worker API monitor endpoint and auth-guard health check."
  request = @{
    method = "GET"; url = $monitorUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = $monitorHeaders; queryParameters = @();
    assertions = @(
      @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" },
      @{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.ok"; regex = "" },
      @{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.configAuthGuard"; regex = "" },
      @{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.wsAuthGuard"; regex = "" },
      @{ source = "JSON_BODY"; comparison = "EQUALS"; target = "true"; property = "$.protectedRoutes.digestAuthGuard"; regex = "" }
    )
  }
})

if ($NightscoutUrl) {
  $nightscoutBase = $NightscoutUrl.TrimEnd('/')
  $nightscoutStatusUrl = "$nightscoutBase/api/v1/status.json"
  $nightscoutQueryParameters = @()
  if ($NightscoutApiToken) {
    $nightscoutQueryParameters = @(@{ key = "token"; value = $NightscoutApiToken })
  }
  Upsert-Check "Nightscout Direct Connectivity" ($common + @{
    name = "Nightscout Direct Connectivity"; frequency = Get-CheckFrequency "Nightscout Direct Connectivity"; description = "Direct Nightscout status endpoint availability check.";
    request = @{ method = "GET"; url = $nightscoutStatusUrl; followRedirects = $true; skipSSL = $false; ipFamily = "IPv4"; body = ""; bodyType = "NONE"; headers = @(); queryParameters = $nightscoutQueryParameters; assertions = @(@{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" }) }
  })
}

Write-Host "`nDone. Checkly monitors are up to date." -ForegroundColor Green
Write-Host "https://app.checklyhq.com/checks" -ForegroundColor Cyan
