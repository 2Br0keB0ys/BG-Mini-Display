param(
  [Parameter(Mandatory = $true)]
  [string]$ApiKey,
  [Parameter(Mandatory = $true)]
  [string]$AccountId
)

$targets = @(
  @{ id = '61601332-4b8a-4755-b516-149364bf6ff2'; name = 'BG Config Reachability'; url = 'https://bgdisplay-worker.zanebaize.workers.dev/api/config?v=4'; freq = 60 },
  @{ id = '351a9661-33b0-4ede-a625-a27d74fdc561'; name = 'BG WebSocket Reachability'; url = 'https://bgdisplay-worker.zanebaize.workers.dev/api/ws'; freq = 120 },
  @{ id = '0776c29c-3725-41f4-9be8-836e62400a38'; name = 'BG Digest Reachability'; url = 'https://bgdisplay-worker.zanebaize.workers.dev/api/digest'; freq = 120 },
  @{ id = 'bb2bad19-b072-455c-aa33-37a83b70632b'; name = 'BG Command Reachability'; url = 'https://bgdisplay-worker.zanebaize.workers.dev/api/command'; freq = 180 }
)

foreach ($t in $targets) {
  $payload = @{
    name = $t.name
    checkType = 'API'
    activated = $true
    muted = $false
    shouldFail = $false
    frequency = $t.freq
    locations = @('us-east-1')
    description = 'Passes only when endpoint returns expected unauthenticated guard response (401 + Missing key).'
    request = @{
      method = 'GET'
      url = $t.url
      followRedirects = $true
      skipSSL = $false
      ipFamily = 'IPv4'
      body = ''
      bodyType = 'NONE'
      headers = @()
      queryParameters = @()
      assertions = @(
        @{ source = 'STATUS_CODE'; comparison = 'EQUALS'; target = '401'; property = ''; regex = '' },
        @{ source = 'JSON_BODY'; comparison = 'EQUALS'; property = '$.error'; target = 'Missing key'; regex = '' }
      )
    }
    doubleCheck = $true
    degradedResponseTime = 5000
    maxResponseTime = 20000
  } | ConvertTo-Json -Depth 20

  $tmp = [IO.Path]::GetTempFileName()
  Set-Content -Path $tmp -Value $payload -NoNewline
  $resp = curl.exe -sS --max-time 30 -X PUT "https://api.checklyhq.com/v1/checks/$($t.id)" -H "Authorization: Bearer $ApiKey" -H "x-checkly-account: $AccountId" -H "Content-Type: application/json" --data-binary "@$tmp"
  Remove-Item $tmp -Force

  try {
    $obj = $resp | ConvertFrom-Json
    Write-Host "Updated: $($obj.name)" -ForegroundColor Green
  } catch {
    Write-Host "Failed update response for $($t.name): $resp" -ForegroundColor Red
  }
}
