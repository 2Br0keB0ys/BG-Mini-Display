param(
  [Parameter(Mandatory = $false)]
  [switch]$UseInfisical,
  [Parameter(Mandatory = $false)]
  [string]$ApiKey = "",
  [Parameter(Mandatory = $false)]
  [string]$AccountId = ""
)

if ($UseInfisical) {
  if (-not $env:INFISICAL_TOKEN) {
    Write-Host "INFISICAL_TOKEN not set" -ForegroundColor Red
    exit 1
  }
  if (-not $ApiKey) {
    $ApiKey = infisical secrets get CHECKLY_API_KEY --projectId bg-miniview --env production 2>&1 | Select-Object -Last 1
  }
  if (-not $AccountId) {
    $AccountId = infisical secrets get CHECKLY_ACCOUNT_ID --projectId bg-miniview --env production 2>&1 | Select-Object -Last 1
  }
}

if (-not $ApiKey) {
  Write-Host "Missing ApiKey" -ForegroundColor Red
  exit 1
}
if (-not $AccountId) {
  $acctResp = curl.exe -sS --max-time 30 -H "Authorization: Bearer $ApiKey" "https://api.checklyhq.com/v1/accounts" | ConvertFrom-Json
  $AccountId = $acctResp[0].id
}

$checks = curl.exe -sS --max-time 30 -H "Authorization: Bearer $ApiKey" -H "x-checkly-account: $AccountId" "https://api.checklyhq.com/v1/checks?limit=100" | ConvertFrom-Json

function Set-Check($name, $assertions, $description) {
  $c = $checks | Where-Object { $_.name -eq $name } | Select-Object -First 1
  if (-not $c) {
    Write-Host "Skip: $name not found" -ForegroundColor Yellow
    return
  }

  $c.shouldFail = $false
  $c.description = $description
  $c.request.assertions = $assertions

  if ($c.PSObject.Properties.Name -contains 'id') { $c.PSObject.Properties.Remove('id') }
  if ($c.PSObject.Properties.Name -contains 'created_at') { $c.PSObject.Properties.Remove('created_at') }
  if ($c.PSObject.Properties.Name -contains 'updated_at') { $c.PSObject.Properties.Remove('updated_at') }

  $json = $c | ConvertTo-Json -Depth 20
  $tmp = [IO.Path]::GetTempFileName()
  Set-Content -Path $tmp -Value $json -NoNewline
  $resp = curl.exe -sS --max-time 30 -X PUT "https://api.checklyhq.com/v1/checks/$($c.id)" -H "Authorization: Bearer $ApiKey" -H "x-checkly-account: $AccountId" -H "Content-Type: application/json" --data-binary "@$tmp"
  Remove-Item $tmp -Force

  $obj = $resp | ConvertFrom-Json
  Write-Host "Updated: $($obj.name)" -ForegroundColor Green
}

# Real connectivity check (device must be online)
Set-Check "BG Device Connectivity" @(
  @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "200"; property = ""; regex = "" },
  @{ source = "JSON_BODY"; comparison = "EQUALS"; property = "$.device.online"; target = "true"; regex = "" }
) "Passes only when worker responds and device.online=true."

# Auth-guard checks: pass only when endpoint is protected (401 + Missing key)
$authAssertions = @(
  @{ source = "STATUS_CODE"; comparison = "EQUALS"; target = "401"; property = ""; regex = "" },
  @{ source = "JSON_BODY"; comparison = "EQUALS"; property = "$.error"; target = "Missing key"; regex = "" }
)

Set-Check "BG Config Reachability" $authAssertions "Passes only if /api/config is protected and returns Missing key for unauthenticated calls."
Set-Check "BG WebSocket Reachability" $authAssertions "Passes only if /api/ws is protected and returns Missing key for unauthenticated calls."
Set-Check "BG Digest Reachability" $authAssertions "Passes only if /api/digest is protected and returns Missing key for unauthenticated calls."
Set-Check "BG Command Reachability" $authAssertions "Passes only if /api/command is protected and returns Missing key for unauthenticated calls."

Write-Host "Assertion hardening complete." -ForegroundColor Cyan
