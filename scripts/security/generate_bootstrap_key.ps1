param(
  [switch]$CopyToClipboard,
  [switch]$AsEnvLine
)

$ErrorActionPreference = "Stop"

# bg_ro_ + 32 lowercase alphanumeric chars
$alphabet = "abcdefghijklmnopqrstuvwxyz0123456789".ToCharArray()
$chars = for ($i = 0; $i -lt 32; $i++) {
  $alphabet[(Get-Random -Minimum 0 -Maximum $alphabet.Length)]
}
$key = "bg_ro_" + (-join $chars)

if ($AsEnvLine) {
  Write-Output "BGDISPLAY_DEFAULT_DEVICE_KEY=$key"
}
else {
  Write-Output $key
}

if ($CopyToClipboard) {
  if (Get-Command Set-Clipboard -ErrorAction SilentlyContinue) {
    $key | Set-Clipboard
    Write-Host "[bootstrap-key] Key copied to clipboard." -ForegroundColor Green
  }
  else {
    Write-Warning "Set-Clipboard not available in this shell."
  }
}

Write-Host "[bootstrap-key] Rotate this key in Infisical and device bootstrap config immediately." -ForegroundColor Yellow
