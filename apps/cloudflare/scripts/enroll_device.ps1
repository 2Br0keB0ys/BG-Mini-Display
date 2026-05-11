param(
  [Parameter(Mandatory = $false)]
  [string]$WorkerUrl = "",
  [Parameter(Mandatory = $false)]
  [string]$DeviceKey = "",
  [Parameter(Mandatory = $false)]
  [string]$ChipId = "",
  [Parameter(Mandatory = $false)]
  [switch]$UseInfisical,
  [Parameter(Mandatory = $false)]
  [string]$InfisicalEnv = "production",
  [Parameter(Mandatory = $false)]
  [string]$InfisicalProjectId = ""
)

$ErrorActionPreference = "Stop"

function Resolve-InfisicalCli {
  $cmd = Get-Command infisical -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $defaultPath = Join-Path $env:APPDATA "npm\infisical.cmd"
  if (Test-Path $defaultPath) { return $defaultPath }

  return $null
}

# ── Infisical hydration ────────────────────────────────────────────────────────
if ($UseInfisical) {
  $infisicalCli = Resolve-InfisicalCli
  if ($infisicalCli) {
    Write-Host "Hydrating from Infisical ($InfisicalEnv)..." -ForegroundColor Cyan
    $exportArgs = @("--silent", "export", "--env", $InfisicalEnv, "--format", "json")
    if ($InfisicalProjectId) { $exportArgs += @("--projectId", $InfisicalProjectId) }
    $raw = & $infisicalCli @exportArgs 2>&1
    $line = ($raw | Out-String).Trim()
    if ($line) {
      $exported = $line | ConvertFrom-Json
      $secretMap = @{}
      if ($exported -is [System.Array]) {
        foreach ($item in $exported) {
          if ($item.key -and ($null -ne $item.value)) { $secretMap[[string]$item.key] = [string]$item.value }
        }
      } else {
        foreach ($prop in $exported.PSObject.Properties) { $secretMap[[string]$prop.Name] = [string]$prop.Value }
      }
      if (-not $WorkerUrl -and $secretMap.ContainsKey("WORKER_URL"))   { $WorkerUrl  = $secretMap["WORKER_URL"] }
      if (-not $WorkerUrl -and $secretMap.ContainsKey("BGDISPLAY_DEFAULT_WORKER_URL")) { $WorkerUrl = $secretMap["BGDISPLAY_DEFAULT_WORKER_URL"] }
      if (-not $DeviceKey -and $secretMap.ContainsKey("BGDISPLAY_DEFAULT_DEVICE_KEY")) { $DeviceKey = $secretMap["BGDISPLAY_DEFAULT_DEVICE_KEY"] }
    }
  } else {
    Write-Warning "Infisical CLI not found. Continuing with explicit parameters."
  }
}

if (-not $WorkerUrl) { throw "WorkerUrl is required (-WorkerUrl or -UseInfisical)." }
if (-not $DeviceKey) { throw "DeviceKey is required (-DeviceKey or -UseInfisical)." }
if (-not $ChipId)    { throw "ChipId is required (-ChipId). Get this from device serial output (16 hex chars, e.g. 000046e0146f6480)." }

# NOTE: Enrollment updates auth.keyHash on the worker to a new unique key.
# If you call this BEFORE flashing, you must update BGDISPLAY_DEFAULT_DEVICE_KEY in
# Infisical with the returned key, re-run firmware_secrets_sync.ps1, and rebuild before
# flashing — otherwise the firmware's bootstrap key will be rejected by the worker.
# Recommended flow: flash first, then let the device self-enroll on first WiFi connect.
# Use this script to manually re-enroll a device or to pre-register in CI pipelines
# where the firmware will be rebuilt with the returned key before flashing.
$ChipId = $ChipId.ToLower().Trim()
if ($ChipId -notmatch '^[0-9a-f]{8,16}$') { throw "ChipId must be 8-16 hex characters." }

$WorkerUrl = $WorkerUrl.Trim().TrimEnd('/')

# ── HMAC-SHA256 signing (matches firmware addSignedHeaders) ───────────────────
function Compute-SHA256Hex([string]$input) {
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($input)
  $hash  = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  return ($hash | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Compute-HMACSHA256Hex([string]$key, [string]$msg) {
  $keyBytes = [System.Text.Encoding]::UTF8.GetBytes($key)
  $msgBytes = [System.Text.Encoding]::UTF8.GetBytes($msg)
  $hmac     = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = $keyBytes
  $hash     = $hmac.ComputeHash($msgBytes)
  return ($hash | ForEach-Object { $_.ToString("x2") }) -join ""
}

$body      = "{`"chipId`":`"$ChipId`"}"
$path      = "/api/enroll"
$ts        = [string][int][System.DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$nonce     = (New-Guid).ToString("N").Substring(0, 16)
$keyHash   = Compute-SHA256Hex $DeviceKey
$bodyHash  = Compute-SHA256Hex $body
$canonical = "POST`n$path`n$ts`n$nonce`n$bodyHash"
$sig       = Compute-HMACSHA256Hex $keyHash $canonical

$headers = @{
  "Content-Type"  = "application/json"
  "X-Device-Key"  = $DeviceKey
  "X-Device-Id"   = $ChipId
  "X-Sig-Ts"      = $ts
  "X-Sig-Nonce"   = $nonce
  "X-Sig-Body"    = $bodyHash
  "X-Signature"   = $sig
}

Write-Host "Enrolling chip $ChipId against $WorkerUrl..." -ForegroundColor Cyan

try {
  $response = Invoke-WebRequest -Uri "$WorkerUrl$path" -Method POST -Headers $headers -Body $body -UseBasicParsing -ErrorAction Stop
  $json     = $response.Content | ConvertFrom-Json
  $newKey   = $json.key
  Write-Host "Enrollment successful!" -ForegroundColor Green
  Write-Host "  ChipId : $($json.chipId)"
  Write-Host "  New key: $newKey"

  # Store in Infisical under bg_device_<chipId>_KEY
  if ($UseInfisical) {
    $infisicalCli = Resolve-InfisicalCli
    if ($infisicalCli) {
      Write-Host "Storing key in Infisical as bg_device_${ChipId}_KEY ..." -ForegroundColor Cyan
      $secretName = "bg_device_${ChipId}_KEY"
      try {
        & $infisicalCli secrets set "${secretName}=${newKey}" --env $InfisicalEnv 2>&1 | Out-Null
        Write-Host "  Stored in Infisical: $secretName" -ForegroundColor Green
      } catch {
        # Try alternate syntax
        try {
          & $infisicalCli secrets set --env $InfisicalEnv "${secretName}=${newKey}" 2>&1 | Out-Null
          Write-Host "  Stored in Infisical: $secretName" -ForegroundColor Green
        } catch {
          Write-Warning "Could not store in Infisical. Key: $newKey — save this manually as $secretName"
        }
      }
    }
  }

  return $newKey
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -eq 409) {
    Write-Host "Device already enrolled (HTTP 409)." -ForegroundColor Yellow
    Write-Host "To re-enroll: DELETE /api/admin/devices/$ChipId via the admin panel first."
  } else {
    $errBody = ""
    try { $errBody = $_.Exception.Response.GetResponseStream() | % { $r = New-Object System.IO.StreamReader $_; $r.ReadToEnd() } } catch {}
    Write-Error "Enrollment failed (HTTP $statusCode): $errBody"
  }
}
