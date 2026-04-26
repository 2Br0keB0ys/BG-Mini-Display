param(
  [string]$McpUrl = "https://bgdisplay-worker.zanebaize.workers.dev/mcp",
  [string]$McpKey = "bg_ro_REDACTED_POSSIBLE_SECRET",
  [switch]$ShowBg
)

$endpoint = "${McpUrl}?key=$McpKey"
Write-Host "MCP endpoint: $McpUrl"
Write-Host "Key tail: ...$($McpKey.Substring([Math]::Max(0, $McpKey.Length - 6)))"

try {
  $meta = Invoke-RestMethod -Uri $endpoint -Method GET -UseBasicParsing -ErrorAction Stop
  Write-Host "[OK] GET /mcp metadata" -ForegroundColor Green
  Write-Host ("Server: {0} {1}" -f $meta.name, $meta.version)
} catch {
  Write-Host "[FAIL] GET /mcp metadata" -ForegroundColor Red
  throw
}

$toolsListReq = @{
  jsonrpc = "2.0"
  id = 1
  method = "tools/list"
  params = @{}
} | ConvertTo-Json -Depth 6

try {
  $toolsListResp = Invoke-RestMethod -Uri $endpoint -Method POST -ContentType "application/json" -Body $toolsListReq -UseBasicParsing -ErrorAction Stop
  $tools = @($toolsListResp.result.tools)
  Write-Host "[OK] tools/list" -ForegroundColor Green
  Write-Host ("Tools ({0}): {1}" -f $tools.Count, (($tools | ForEach-Object { $_.name }) -join ", "))
} catch {
  Write-Host "[FAIL] tools/list" -ForegroundColor Red
  throw
}

if ($ShowBg) {
  $bgReq = @{
    jsonrpc = "2.0"
    id = 2
    method = "tools/call"
    params = @{
      name = "get_current_bg"
      arguments = @{}
    }
  } | ConvertTo-Json -Depth 8

  try {
    $bgResp = Invoke-RestMethod -Uri $endpoint -Method POST -ContentType "application/json" -Body $bgReq -UseBasicParsing -ErrorAction Stop
    Write-Host "[OK] get_current_bg" -ForegroundColor Green
    if ($bgResp.result.content -and $bgResp.result.content.Count -gt 0) {
      Write-Host $bgResp.result.content[0].text
    } else {
      Write-Host ($bgResp | ConvertTo-Json -Depth 10)
    }
  } catch {
    Write-Host "[FAIL] get_current_bg" -ForegroundColor Red
    throw
  }
}
