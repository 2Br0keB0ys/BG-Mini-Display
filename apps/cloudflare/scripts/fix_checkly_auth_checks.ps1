param(
  [Parameter(Mandatory = $true)]
  [string]$ApiKey,
  [Parameter(Mandatory = $true)]
  [string]$AccountId
)

$ids = @(
  '61601332-4b8a-4755-b516-149364bf6ff2', # BG Config Reachability
  '351a9661-33b0-4ede-a625-a27d74fdc561', # BG WebSocket Reachability
  '0776c29c-3725-41f4-9be8-836e62400a38', # BG Digest Reachability
  'bb2bad19-b072-455c-aa33-37a83b70632b'  # BG Command Reachability
)

foreach ($id in $ids) {
  $obj = curl.exe -sS --max-time 30 -H "Authorization: Bearer $ApiKey" -H "x-checkly-account: $AccountId" "https://api.checklyhq.com/v1/checks/$id" | ConvertFrom-Json

  $obj.shouldFail = $true
  $obj.description = "Expected unauthenticated response for protected endpoint (auth guard check)."

  if ($obj.PSObject.Properties.Name -contains 'id') { $obj.PSObject.Properties.Remove('id') }
  if ($obj.PSObject.Properties.Name -contains 'created_at') { $obj.PSObject.Properties.Remove('created_at') }
  if ($obj.PSObject.Properties.Name -contains 'updated_at') { $obj.PSObject.Properties.Remove('updated_at') }

  $json = $obj | ConvertTo-Json -Depth 20
  $tmp = [IO.Path]::GetTempFileName()
  Set-Content -Path $tmp -Value $json -NoNewline

  $resp = curl.exe -sS --max-time 30 -X PUT "https://api.checklyhq.com/v1/checks/$id" -H "Authorization: Bearer $ApiKey" -H "x-checkly-account: $AccountId" -H "Content-Type: application/json" --data-binary "@$tmp"
  Remove-Item $tmp -Force

  $updated = $resp | ConvertFrom-Json
  Write-Host "Updated: $($updated.name) shouldFail=$($updated.shouldFail)" -ForegroundColor Green
}
