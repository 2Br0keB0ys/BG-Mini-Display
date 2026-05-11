param(
  [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git is required to run secret_guard.ps1"
}

# Patterns to block outright (incident-specific and high-risk generic)
$blockedPatterns = @(
  @{ Name = "Leaked Infisical project id"; Pattern = "8eaddd1f-66e5-43cc-abe6-1e84100ebd9d" },
  @{ Name = "Leaked device MAC"; Pattern = "84:1f:e8:82:ed:e8" },
  @{ Name = "Leaked device chip id"; Pattern = "0000e8ed82e81f84" },
  @{ Name = "Raw bg_ro bootstrap/recovery key"; Pattern = "\bbg_ro_[a-z0-9]{32}\b" }
)

# File paths we intentionally ignore for this guard.
# - archive/* is historical material
# - history-rewrite tooling may include intentionally redacted test literals
$ignoredPathRegex = "^(archive/|scripts/history-rewrite/)"

# Allowed placeholder forms for docs/examples.
$allowedLineRegex = @(
  "bg_ro_x{32}",
  "bg_ro_[A-Z_<>-]+",
  "bg_ro_\.\.\."
)

$trackedFiles = git ls-files
$violations = New-Object System.Collections.Generic.List[object]

foreach ($file in $trackedFiles) {
  if ($file -match $ignoredPathRegex) {
    continue
  }

  if ($file -eq "scripts/security/secret_guard.ps1") {
    continue
  }

  foreach ($rule in $blockedPatterns) {
    try {
      $foundMatches = Select-String -Path $file -Pattern $rule.Pattern -AllMatches -CaseSensitive
    }
    catch {
      continue
    }

    foreach ($match in $foundMatches) {
      $line = $match.Line

      $isAllowed = $false
      foreach ($allow in $allowedLineRegex) {
        if ($line -match $allow) {
          $isAllowed = $true
          break
        }
      }

      if (-not $isAllowed) {
        $violations.Add([PSCustomObject]@{
            File    = $file
            Line    = $match.LineNumber
            Rule    = $rule.Name
            Snippet = $line.Trim()
          }) | Out-Null
      }
    }
  }
}

if ($violations.Count -gt 0) {
  Write-Host "[secret-guard] Found blocked secret-like literals:" -ForegroundColor Red
  $violations | Sort-Object File, Line | Format-Table -AutoSize
  exit 1
}

if ($VerboseOutput) {
  Write-Host "[secret-guard] Scanned $($trackedFiles.Count) tracked files." -ForegroundColor Cyan
}
Write-Host "[secret-guard] PASS: no blocked literals detected." -ForegroundColor Green
