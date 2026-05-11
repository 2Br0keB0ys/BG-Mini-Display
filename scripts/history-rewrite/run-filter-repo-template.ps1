param(
  [Parameter(Mandatory = $true)]
  [string]$MirrorRepoPath,
  [Parameter(Mandatory = $true)]
  [string]$ReplaceTextFile,
  [Parameter(Mandatory = $true)]
  [string]$PathsToRemoveFile,
  [switch]$Execute
)

$ErrorActionPreference = "Stop"

Write-Host "[history-rewrite] Mirror repo: $MirrorRepoPath" -ForegroundColor Cyan
Write-Host "[history-rewrite] Replace rules: $ReplaceTextFile" -ForegroundColor Cyan
Write-Host "[history-rewrite] Remove paths file: $PathsToRemoveFile" -ForegroundColor Cyan

if (-not (Test-Path $MirrorRepoPath)) { throw "Mirror repo path not found." }
if (-not (Test-Path $ReplaceTextFile)) { throw "Replace text file not found." }
if (-not (Test-Path $PathsToRemoveFile)) { throw "Paths file not found." }

Set-Location $MirrorRepoPath

$cmd = "git filter-repo --replace-text `"$ReplaceTextFile`" --paths-from-file `"$PathsToRemoveFile`" --invert-paths"
Write-Host "\nPlanned command:" -ForegroundColor Yellow
Write-Host $cmd -ForegroundColor Gray

if (-not $Execute) {
  Write-Host "\nDry-run mode only. Re-run with -Execute to perform rewrite." -ForegroundColor Green
  exit 0
}

Invoke-Expression $cmd

git reflog expire --expire=now --all
git gc --prune=now --aggressive

Write-Host "\nRewrite complete. Verify with git log -G checks, then force-push mirror." -ForegroundColor Green
