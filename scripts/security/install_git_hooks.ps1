param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to install hooks"
}

$hookPath = Join-Path $repoRoot ".githooks"
$preCommitPath = Join-Path $hookPath "pre-commit"

if (-not (Test-Path $preCommitPath)) {
  throw "Missing hook template: $preCommitPath"
}

$current = git config --local --get core.hooksPath 2>$null
if ($current -and $current -ne ".githooks" -and -not $Force) {
  throw "core.hooksPath is already set to '$current'. Re-run with -Force to override."
}

git config --local core.hooksPath .githooks
Write-Host "[install-hooks] core.hooksPath set to .githooks" -ForegroundColor Green
Write-Host "[install-hooks] Pre-commit hook will run scripts/security/secret_guard.ps1" -ForegroundColor Green
