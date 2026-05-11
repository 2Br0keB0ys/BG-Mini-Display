param(
  [switch]$SkipInstalls,
  [switch]$SkipPauses
)

$ErrorActionPreference = "Stop"

Write-Host "[BG MiniView Setup] Starting beginner-friendly Windows setup." -ForegroundColor Cyan
Write-Host "[BG MiniView Setup] This script installs tools, then walks through account + secret setup." -ForegroundColor Cyan

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  throw "winget is required. Install/update App Installer from Microsoft Store, then rerun this script."
}

if (-not $SkipInstalls) {
  $tools = @(
    @{ Command = "code";    Winget = "Microsoft.VisualStudioCode"; Name = "Visual Studio Code" },
    @{ Command = "git";     Winget = "Git.Git";                   Name = "Git" },
    @{ Command = "node";    Winget = "OpenJS.NodeJS.LTS";         Name = "Node.js LTS" },
    @{ Command = "python";  Winget = "Python.Python.3.11";        Name = "Python 3.11" },
    @{ Command = "npm";     Winget = "OpenJS.NodeJS.LTS";         Name = "npm" }
  )

  foreach ($tool in $tools) {
    if (Get-Command $tool.Command -ErrorAction SilentlyContinue) {
      Write-Host "[BG MiniView Setup] $($tool.Name) already installed." -ForegroundColor Green
    } else {
      Write-Host "[BG MiniView Setup] Installing $($tool.Name)..." -ForegroundColor Cyan
      winget install --id $tool.Winget --silent --accept-package-agreements --accept-source-agreements
    }
  }

  if (-not (Get-Command wrangler -ErrorAction SilentlyContinue)) {
    Write-Host "[BG MiniView Setup] Installing Wrangler CLI via npm..." -ForegroundColor Cyan
    npm install -g wrangler
  }

  if (-not (Get-Command infisical -ErrorAction SilentlyContinue)) {
    Write-Host "[BG MiniView Setup] Installing Infisical CLI via npm..." -ForegroundColor Cyan
    npm install -g @infisical/cli
  }

  if (Get-Command code -ErrorAction SilentlyContinue) {
    Write-Host "[BG MiniView Setup] Installing VS Code PlatformIO extension..." -ForegroundColor Cyan
    code --install-extension platformio.platformio-ide --force
  }
} else {
  Write-Host "[BG MiniView Setup] Skipping installs by request." -ForegroundColor Yellow
}

Write-Host "[BG MiniView Setup] Step 1: Creating/opening required accounts." -ForegroundColor Cyan
Start-Process "https://github.com/signup" | Out-Null
Start-Process "https://dash.cloudflare.com/sign-up" | Out-Null
Start-Process "https://app.infisical.com/signup" | Out-Null
if (-not $SkipPauses) { Read-Host "Press Enter after account setup/sign-in pages are done" | Out-Null }

Write-Host "[BG MiniView Setup] Step 2: Select repository path." -ForegroundColor Cyan
$repoPath = Read-Host "Enter local repo path (default: N:\vsCode\bgdisplay)"
if (-not $repoPath) { $repoPath = "N:\vsCode\bgdisplay" }
if (-not (Test-Path $repoPath)) { throw "Path not found: $repoPath" }
Set-Location $repoPath

$infisicalExample = Join-Path $repoPath "apps\cloudflare\scripts\.infisical.example.json"
$infisicalLocal = Join-Path $repoPath "apps\cloudflare\scripts\.infisical.json"
if ((Test-Path $infisicalExample) -and -not (Test-Path $infisicalLocal)) {
  Copy-Item $infisicalExample $infisicalLocal
}

$claudeExample = Join-Path $repoPath ".claude\settings.local.example.json"
$claudeLocal = Join-Path $repoPath ".claude\settings.local.json"
if ((Test-Path $claudeExample) -and -not (Test-Path $claudeLocal)) {
  Copy-Item $claudeExample $claudeLocal
}

Write-Host "[BG MiniView Setup] Step 3: Cloudflare Wrangler login." -ForegroundColor Cyan
wrangler login
if (-not $SkipPauses) { Read-Host "Press Enter when Wrangler login is complete" | Out-Null }

Write-Host "[BG MiniView Setup] Step 4: Infisical CLI login." -ForegroundColor Cyan
infisical login
if (-not $SkipPauses) { Read-Host "Press Enter when Infisical login is complete" | Out-Null }

Write-Host "[BG MiniView Setup] Step 5: Enter setup values." -ForegroundColor Cyan
$infisicalProjectId = Read-Host "Enter Infisical Project ID"
$infisicalEnv = Read-Host "Enter Infisical environment (default: prod)"
if (-not $infisicalEnv) { $infisicalEnv = "prod" }
$workerUrl = Read-Host "Enter Cloudflare Worker URL (https://...workers.dev)"
$timezone = Read-Host "Timezone (default: US/Central)"
if (-not $timezone) { $timezone = "US/Central" }
$bootstrapKey = Read-Host "Enter BGDISPLAY_DEFAULT_DEVICE_KEY (format: bg_ro_ + 32 chars)"

Write-Host "[BG MiniView Setup] Step 6: Writing required Infisical secrets." -ForegroundColor Cyan
infisical secrets set "BGDISPLAY_DEFAULT_DEVICE_KEY=$bootstrapKey" --env=$infisicalEnv --projectId=$infisicalProjectId
infisical secrets set "BGDISPLAY_DEFAULT_TIMEZONE=$timezone" --env=$infisicalEnv --projectId=$infisicalProjectId
infisical secrets set "WORKER_URL=$workerUrl" --env=$infisicalEnv --projectId=$infisicalProjectId

Write-Host "[BG MiniView Setup] Step 7: Syncing firmware secrets.h from Infisical." -ForegroundColor Cyan
& "$repoPath\firmware\scripts\firmware_secrets_sync.ps1" -InfisicalProjectId $infisicalProjectId -InfisicalEnv $infisicalEnv

Write-Host "[BG MiniView Setup] Step 8: Set Worker secret KV_ENCRYPT_KEY." -ForegroundColor Cyan
wrangler secret put KV_ENCRYPT_KEY

Write-Host "[BG MiniView Setup] Step 9: Installing dependencies and validating apps." -ForegroundColor Cyan
Set-Location "$repoPath\apps\cloudflare"
npm ci
node --check src/worker.js
Set-Location "$repoPath\apps\ui"
npm ci
npm run build

Write-Host "[BG MiniView Setup] Step 10: Deploying worker and pages." -ForegroundColor Cyan
Set-Location "$repoPath\apps\cloudflare"
npm run deploy:worker
npm run deploy:pages

Write-Host "[BG MiniView Setup] Step 11: Building firmware." -ForegroundColor Cyan
Set-Location $repoPath
pio run

Write-Host "[BG MiniView Setup] Setup complete." -ForegroundColor Green
Write-Host "[BG MiniView Setup] Next: flash via USB, connect to BG_MiniView_XXXX, and complete WiFi onboarding." -ForegroundColor Green
Write-Host "[BG MiniView Setup] See docs/setup-for-beginners.md for full troubleshooting." -ForegroundColor Green
