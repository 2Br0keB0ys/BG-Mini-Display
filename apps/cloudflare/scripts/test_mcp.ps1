param(
  [string]$McpUrl = $(if ($env:BGDISPLAY_MCP_URL) { $env:BGDISPLAY_MCP_URL } else { "https://bgdisplay-worker.zanebaize.workers.dev/mcp" }),
  [string]$McpKey = $env:BGDISPLAY_MCP_KEY,
  [switch]$ShowBg,
  [switch]$RunHealth,
  [switch]$RunPushover,
  [switch]$SendLivePushover,
  [switch]$UseAdminSession,
  [string]$AdminOrigin = $(if ($env:BGDISPLAY_ADMIN_ORIGIN) { $env:BGDISPLAY_ADMIN_ORIGIN } else { "https://setup.2brokeboys.uk" })
)

$endpoint = "${McpUrl}?key=$McpKey"
Write-Host "MCP endpoint: $McpUrl"
if (-not [string]::IsNullOrWhiteSpace($McpKey)) {
  Write-Host "Key tail: ...$($McpKey.Substring([Math]::Max(0, $McpKey.Length - 6)))"
}

$script:UseAdminHeaders = $false
$script:AdminHeaders = @{}

function New-AdminSession {
  $workerBase = [Uri]$McpUrl
  $sessionUrl = "{0}://{1}/api/admin/session" -f $workerBase.Scheme, $workerBase.Authority
  $headers = @{ Origin = $AdminOrigin }
  $resp = Invoke-RestMethod -Uri $sessionUrl -Method GET -Headers $headers -UseBasicParsing -ErrorAction Stop
  if (-not $resp.token) {
    throw "Admin session request succeeded but did not return a token."
  }
  $script:AdminHeaders = @{ Origin = $AdminOrigin; 'X-Admin-Session' = $resp.token }
  $script:UseAdminHeaders = $true
  Write-Host "Admin session acquired via trusted origin $AdminOrigin" -ForegroundColor Yellow
}

function Invoke-McpJsonRpc {
  param([string]$Body)

  $invokeParams = @{
    Uri = $(if ($script:UseAdminHeaders) { $McpUrl } else { $endpoint })
    Method = "POST"
    ContentType = "application/json"
    Body = $Body
    UseBasicParsing = $true
    ErrorAction = "Stop"
  }
  if ($script:UseAdminHeaders) {
    $invokeParams.Headers = $script:AdminHeaders
  }

  return Invoke-RestMethod @invokeParams
}

function Invoke-McpTool {
  param(
    [int]$Id,
    [string]$Name,
    [hashtable]$Arguments = @{}
  )

  $req = @{
    jsonrpc = "2.0"
    id = $Id
    method = "tools/call"
    params = @{
      name = $Name
      arguments = $Arguments
    }
  } | ConvertTo-Json -Depth 8

  return Invoke-McpJsonRpc -Body $req
}

function Get-McpTextContent {
  param([object]$Response)
  if ($Response.result.content -and $Response.result.content.Count -gt 0) {
    return $Response.result.content[0].text
  }
  return ($Response | ConvertTo-Json -Depth 10)
}

if ($UseAdminSession) {
  New-AdminSession
} elseif ([string]::IsNullOrWhiteSpace($McpKey)) {
  New-AdminSession
}

if (-not $script:UseAdminHeaders) {
  try {
    $meta = Invoke-RestMethod -Uri $endpoint -Method GET -UseBasicParsing -ErrorAction Stop
    Write-Host "[OK] GET /mcp metadata" -ForegroundColor Green
    Write-Host ("Server: {0} {1}" -f $meta.name, $meta.version)
  } catch {
    if ($_.Exception.Message -match "Invalid device key") {
      Write-Host "[WARN] Device key rejected, retrying via admin session" -ForegroundColor Yellow
      New-AdminSession
    } else {
      Write-Host "[FAIL] GET /mcp metadata" -ForegroundColor Red
      throw
    }
  }
}

if ($script:UseAdminHeaders) {
  Write-Host "[SKIP] GET /mcp metadata (admin-session mode uses POST fallback)" -ForegroundColor Yellow
}

try {
  $toolsListReq = @{
    jsonrpc = "2.0"
    id = 1
    method = "tools/list"
    params = @{}
  } | ConvertTo-Json -Depth 6
  $toolsListResp = Invoke-McpJsonRpc -Body $toolsListReq
  $tools = @($toolsListResp.result.tools)
  Write-Host "[OK] tools/list" -ForegroundColor Green
  Write-Host ("Tools ({0}): {1}" -f $tools.Count, (($tools | ForEach-Object { $_.name }) -join ", "))
} catch {
  Write-Host "[FAIL] tools/list" -ForegroundColor Red
  throw
}

if ($ShowBg) {
  try {
    $bgResp = Invoke-McpTool -Id 2 -Name "get_current_bg"
    Write-Host "[OK] get_current_bg" -ForegroundColor Green
    Write-Host (Get-McpTextContent -Response $bgResp)
  } catch {
    Write-Host "[FAIL] get_current_bg" -ForegroundColor Red
    throw
  }
}

if ($RunHealth) {
  try {
    $healthResp = Invoke-McpTool -Id 5 -Name "get_health_summary"
    Write-Host "[OK] get_health_summary" -ForegroundColor Green
    Write-Host (Get-McpTextContent -Response $healthResp)
  } catch {
    Write-Host "[FAIL] get_health_summary" -ForegroundColor Red
    throw
  }

  try {
    $readinessResp = Invoke-McpTool -Id 6 -Name "get_full_readiness"
    Write-Host "[OK] get_full_readiness" -ForegroundColor Green
    Write-Host (Get-McpTextContent -Response $readinessResp)
  } catch {
    Write-Host "[FAIL] get_full_readiness" -ForegroundColor Red
    throw
  }
}

if ($RunPushover) {
  try {
    $statusResp = Invoke-McpTool -Id 3 -Name "get_pushover_status"
    $statusText = Get-McpTextContent -Response $statusResp
    $status = $statusText | ConvertFrom-Json
    Write-Host "[OK] get_pushover_status" -ForegroundColor Green
    Write-Host $statusText

    if (-not $status.configured) {
      throw "Pushover credentials are not configured in worker KV."
    }

    if ($SendLivePushover) {
      $testResp = Invoke-McpTool -Id 4 -Name "send_test_pushover" -Arguments @{ category = "general" }
      $testText = Get-McpTextContent -Response $testResp
      $testResult = $testText | ConvertFrom-Json
      if (-not $testResult.ok) {
        throw "send_test_pushover returned ok=false: $testText"
      }
      Write-Host "[OK] send_test_pushover" -ForegroundColor Green
      Write-Host $testText
    } else {
      Write-Host "[SKIP] send_test_pushover (pass -SendLivePushover to send a real notification)" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "[FAIL] Pushover MCP tests" -ForegroundColor Red
    throw
  }
}
