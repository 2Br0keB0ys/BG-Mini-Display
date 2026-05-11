param(
  [string]$SourceRepoPath = "N:\vsCode\bgdisplay",
  [string]$MirrorRepoPath = "N:\vsCode\bgdisplay-rewrite.git",
  [string]$RemoteUrl = "https://github.com/2Br0keB0ys/bgdisplay.git",
  [switch]$InitMirror,
  [switch]$TrustMirrorPath,
  [switch]$CreateBackupBundle,
  [switch]$ExecuteRewrite,
  [switch]$PushMirror,
  [switch]$IncludeArchivedPaths
)

$ErrorActionPreference = "Stop"

Write-Host "[history-rewrite] Source: $SourceRepoPath" -ForegroundColor Cyan
Write-Host "[history-rewrite] Mirror: $MirrorRepoPath" -ForegroundColor Cyan
Write-Host "[history-rewrite] Remote: $RemoteUrl" -ForegroundColor Cyan

if (-not (Test-Path $SourceRepoPath)) {
  throw "Source repo path not found: $SourceRepoPath"
}

$replaceFile = Join-Path $SourceRepoPath "scripts\history-rewrite\replace-text.txt"
$pathsFile = Join-Path $SourceRepoPath "scripts\history-rewrite\paths-to-remove.txt"

if (-not (Test-Path $replaceFile)) { throw "Missing replace-text file: $replaceFile" }
if (-not (Test-Path $pathsFile)) { throw "Missing paths-to-remove file: $pathsFile" }

if ($InitMirror) {
  if (Test-Path $MirrorRepoPath) {
    throw "Mirror path already exists. Remove it first or choose a new path: $MirrorRepoPath"
  }

  Write-Host "[history-rewrite] Creating fresh mirror clone..." -ForegroundColor Yellow
  git clone --mirror $RemoteUrl $MirrorRepoPath
}

if (-not (Test-Path $MirrorRepoPath)) {
  throw "Mirror repo path not found. Run with -InitMirror first: $MirrorRepoPath"
}

if ($TrustMirrorPath) {
  $resolvedMirror = (Resolve-Path $MirrorRepoPath).Path
  Write-Host "[history-rewrite] Trusting mirror path in git safe.directory: $resolvedMirror" -ForegroundColor Yellow
  git config --global --add safe.directory $resolvedMirror
}

$bareCheck = git -C $MirrorRepoPath rev-parse --is-bare-repository 2>$null
if (-not $bareCheck) {
  throw "Git cannot access mirror repo at $MirrorRepoPath. If this is a network path, rerun with -TrustMirrorPath."
}

if ($CreateBackupBundle) {
  $bundlePath = Join-Path (Split-Path $MirrorRepoPath -Parent) "bgdisplay-pre-rewrite.bundle"
  Write-Host "[history-rewrite] Creating backup bundle: $bundlePath" -ForegroundColor Yellow
  git -C $MirrorRepoPath bundle create $bundlePath --all
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git command not found in PATH"
}

$filterCmd = "git -C `"$MirrorRepoPath`" filter-repo --replace-text `"$replaceFile`" --paths-from-file `"$pathsFile`" --invert-paths"

if (-not $IncludeArchivedPaths) {
  # Default mode keeps archive content intact. To rewrite archive contents too,
  # set -IncludeArchivedPaths and update replace/paths files as needed.
  Write-Host "[history-rewrite] Default mode: archive paths are not specially expanded." -ForegroundColor Gray
}

Write-Host "`n[history-rewrite] Planned rewrite command:" -ForegroundColor Yellow
Write-Host $filterCmd -ForegroundColor Gray

if (-not $ExecuteRewrite) {
  Write-Host "`n[history-rewrite] Dry-run only. Re-run with -ExecuteRewrite to perform history rewrite." -ForegroundColor Green
  Write-Host "[history-rewrite] Optional flags: -CreateBackupBundle -PushMirror" -ForegroundColor Green
  exit 0
}

Invoke-Expression $filterCmd

git -C $MirrorRepoPath reflog expire --expire=now --all
git -C $MirrorRepoPath gc --prune=now --aggressive

Write-Host "`n[history-rewrite] Rewrite complete." -ForegroundColor Green
Write-Host "[history-rewrite] Verify with pattern checks before pushing." -ForegroundColor Green

git -C $MirrorRepoPath log --all --oneline -G "<REDACTED_INFISICAL_PROJECT_ID>"
git -C $MirrorRepoPath log --all --oneline -G "<REDACTED_DEVICE_MAC>|<REDACTED_DEVICE_CHIP_ID>"
git -C $MirrorRepoPath log --all --oneline -G "bg_ro_"

if ($PushMirror) {
  Write-Host "`n[history-rewrite] Force-pushing rewritten mirror to origin..." -ForegroundColor Yellow
  git -C $MirrorRepoPath remote set-url origin $RemoteUrl
  git -C $MirrorRepoPath push --force --mirror origin
  Write-Host "[history-rewrite] Push complete." -ForegroundColor Green
}
