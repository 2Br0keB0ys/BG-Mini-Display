param(
  [string]$Port = "COM6",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

$python = Join-Path $env:USERPROFILE ".platformio\penv\Scripts\python.exe"
$toolRoot = Join-Path $env:USERPROFILE ".platformio\packages\tool-esptoolpy"
$espefuse = Join-Path $toolRoot "espefuse.py"
$espsecure = Join-Path $toolRoot "espsecure.py"

if (-not (Test-Path $python)) { throw "PlatformIO Python not found: $python" }
if (-not (Test-Path $espefuse)) { throw "espefuse.py not found: $espefuse" }
if (-not (Test-Path $espsecure)) { throw "espsecure.py not found: $espsecure" }

Write-Host "[1/4] Reading eFuse summary (safe/read-only)..."
& $python $espefuse --chip esp32 -p $Port summary

$keyRoot = Join-Path $env:USERPROFILE ".bgdisplay-keys"
New-Item -ItemType Directory -Force -Path $keyRoot | Out-Null
$flashKey = Join-Path $keyRoot "flash_encryption_key.bin"
$bootKey = Join-Path $keyRoot "secure_boot_v1_key.bin"

if (-not (Test-Path $flashKey)) {
  Write-Host "[2/4] Generating flash encryption key..."
  & $python $espsecure generate_flash_encryption_key --keylen 256 $flashKey
}

if (-not (Test-Path $bootKey)) {
  Write-Host "[3/4] Generating secure boot key..."
  & $python $espsecure generate_signing_key --version 1 $bootKey
}

Write-Host "Keys stored in: $keyRoot"

if (-not $Apply) {
  Write-Host ""
  Write-Host "Dry run complete. No irreversible changes were made."
  Write-Host "To APPLY irreversible security fuses, run:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/secure_provision.ps1 -Port $Port -Apply"
  Write-Host ""
  Write-Host "WARNING: Applying secure fuses can permanently disable UART flashing if misconfigured."
  exit 0
}

Write-Host "[4/4] Applying irreversible eFuse changes..."
Write-Host "This enables flash encryption + secure boot key storage + UART/JTAG hardening."

# Burn keys into dedicated eFuse blocks.
& $python $espefuse --chip esp32 -p $Port burn_key flash_encryption $flashKey
& $python $espefuse --chip esp32 -p $Port burn_key secure_boot_v1 $bootKey

# Harden debug/extraction paths.
& $python $espefuse --chip esp32 -p $Port burn_efuse JTAG_DISABLE 1
& $python $espefuse --chip esp32 -p $Port burn_efuse DISABLE_DL_ENCRYPT 1
& $python $espefuse --chip esp32 -p $Port burn_efuse DISABLE_DL_DECRYPT 1
& $python $espefuse --chip esp32 -p $Port burn_efuse DISABLE_DL_CACHE 1

Write-Host "Provisioning commands completed. Re-run summary to verify state."