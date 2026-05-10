# BG MiniView + Infisical Setup Guide

## Step 1: Create Infisical Project

1. Go to https://app.infisical.com
2. **Create new project:**
   - Name: `bg-miniview`
   - Description: "Blood glucose display monitoring and configuration"
3. Choose environment: `production` (default)

## Step 2: Add Secrets to Infisical

Navigate to your `bg-miniview` project → `production` environment → **Secrets** tab.

Add these secrets (click **+ Add Secret** for each):

| Key | Value | Description | Required |
|-----|-------|-------------|----------|
| `CHECKLY_API_KEY` | (from Checkly Account Settings → API Keys) | API key for monitor creation | ✅ Yes |
| `CHECKLY_ACCOUNT_ID` | (from `GET /v1/accounts` id) | Checkly account header value used by API | ✅ Recommended |
| `CHECKLY_MONITOR_KEY` | `ckm_...` | Shared key used by `/api/monitor/status-check` | ✅ Yes |
| `WORKER_URL` | `https://bgdisplay.your-domain.workers.dev` | Cloudflare Worker URL | ✅ Yes |
| `NIGHTSCOUT_URL` | `https://your-ns.herokuapp.com` | Nightscout instance URL | ⚠️ Optional |
| `NIGHTSCOUT_API_TOKEN` | Nightscout bearer token | Optional auth for private Nightscout endpoint checks | ⚠️ Optional |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token | Recommended for deploy automation | ✅ Recommended |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | Optional for deploy context | ⚠️ Optional |
| `BGDISPLAY_DEFAULT_DEVICE_KEY` | `bg_ro_...` | Firmware bootstrap device key used in `secrets.h` | ✅ Recommended |
| `BGDISPLAY_DEFAULT_TIMEZONE` | `US/Central` | Firmware bootstrap timezone | ⚠️ Optional |
| `BGDISPLAY_CHECKLY_HEARTBEAT_URL` | `https://ping.checklyhq.com/...` | Device-side heartbeat endpoint for firmware | ⚠️ Optional |
| `BGDISPLAY_CHECKLY_HEARTBEAT_SEC` | `60` | Device-side heartbeat interval in seconds | ⚠️ Optional |

**Save all secrets.**

## Step 3: Create Service Token (for Automation)

This allows the setup script to fetch secrets without interactive login.

1. Go to **Project Settings** (gear icon, top right)
2. Navigate to **Service Tokens** tab
3. Click **+ Add Service Token**
4. Configuration:
   - Name: `bg-miniview-setup-script`
   - Environment: `production`
   - Permissions: `read` (only needs to read secrets)
5. Click **Create Token**
6. **Copy the token immediately** — you'll only see it once

The token looks like: `st_xxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Step 4: Store Service Token Locally

**Option A (Recommended for personal machine):**
```powershell
# Store in environment variable (Windows)
[Environment]::SetEnvironmentVariable("INFISICAL_TOKEN", "st_xxxxxxxxxxxxxxxxxxxxxxxxxxxx", "User")

# Verify:
$env:INFISICAL_TOKEN
```

**Option B (For CI/CD systems):**
- Add `INFISICAL_TOKEN` as secret in your CI system (GitHub Actions, etc.)

**Option C (Temporary, one-time use):**
```powershell
$env:INFISICAL_TOKEN = "st_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

## Step 5: Install Infisical CLI (Windows)

```powershell
# Install via Scoop (recommended)
scoop install infisical

# Or via npm
npm install -g @infisical/cli

# Or download from: https://infisical.com/docs/cli/overview

# Verify installation:
infisical --version
```

## Step 6: Run Setup Script

```powershell
cd apps\cloudflare

# Method 1: Script auto-fetches from Infisical
.\scripts\setup_checkly.ps1

# Method 2: If you prefer to pass secrets manually
.\scripts\setup_checkly.ps1 `
  -ChecklyApiKey "YOUR_KEY" `
  -MonitorKey "ckm_..." `
  -WorkerUrl "https://..." `
  -NightscoutUrl "https://..." `
  -AlertEmail "you@example.com"
```

## Step 7: Rotate Monitor Key Safely

Use the rotation helper to rotate `CHECKLY_MONITOR_KEY` in one flow:

```powershell
cd apps\cloudflare
.\scripts\rotate_monitor_key.ps1
```

What it does:
1. Generates a new `ckm_...` key (or uses `-NewMonitorKey` if provided).
2. Updates Cloudflare Worker secret `CHECKLY_MONITOR_KEY`.
3. Deploys the worker (unless `-SkipWorkerDeploy`).
4. Reapplies Checkly monitor definitions with the new key.
5. Verifies `/api/monitor/status-check` responds with `ok=true`.

Optional flags:
- `-UseInfisical` (or default behavior) to hydrate values from Infisical.
- `-SkipInfisical` to force only manual parameters.
- `-InfisicalEnv production`
- `-InfisicalProjectId <id>`
- `-ChecklyApiKey ... -WorkerUrl ... -MonitorKey ...`

## Step 8: Run Full Project Operations from Infisical

For project-wide automation (deploy + monitoring + firmware secret sync), run:

```powershell
cd scripts
.\project_infisical_ops.ps1 -DeployWorker -SetupCheckly -SyncFirmwareSecrets
```

Common action switches:
- `-DeployWorker`
- `-DeployPages`
- `-SetupCheckly`
- `-RotateMonitorKey`
- `-SyncFirmwareSecrets`

Notes:
- Defaults to Infisical-first hydration unless you pass `-SkipInfisical`.
- `-SyncFirmwareSecrets` writes `firmware/src/secrets.h` from hydrated values.
- You can chain actions in one run for full operational workflows.

## Infisical Project Structure (Reference)

```
bg-miniview/
  └─ production/
      ├─ CHECKLY_API_KEY = st_xxxxx
        ├─ CHECKLY_ACCOUNT_ID = xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        ├─ CHECKLY_MONITOR_KEY = ckm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
      ├─ WORKER_URL = https://bgdisplay.xxxxx.workers.dev
      ├─ NIGHTSCOUT_URL = https://xxxx.herokuapp.com
      ├─ NIGHTSCOUT_API_TOKEN = (optional) <nightscout-token>
      ├─ ALERT_EMAIL = you@example.com
        ├─ SLACK_WEBHOOK = (optional) https://hooks.slack.com/...
        ├─ CLOUDFLARE_API_TOKEN = (optional) <token>
        └─ CLOUDFLARE_ACCOUNT_ID = (optional) <account-id>
```

## Troubleshooting

### "infisical: command not found"
- Infisical CLI not installed or not in PATH
- Install: `scoop install infisical` or `npm install -g @infisical/cli`
- Restart terminal after install

### "INFISICAL_TOKEN not set"
- Set token: `[Environment]::SetEnvironmentVariable("INFISICAL_TOKEN", "st_...", "User")`
- Restart VS Code / terminal

### "Cannot fetch secrets from Infisical"
- Verify service token is valid (not expired)
- Check project name is `bg-miniview`
- Verify environment is `production`
- Run `infisical auth` to test authentication

### "Secret not found"
- Ensure secret keys match exactly (case-sensitive):
  - `CHECKLY_API_KEY` (not `checklyApiKey`)
  - `CHECKLY_ACCOUNT_ID` (not `checklyAccountId`)
  - `CHECKLY_MONITOR_KEY` (not `monitorKey`)
  - `WORKER_URL` (not `workerUrl`)
  - `NIGHTSCOUT_URL` (not `nightscoutUrl`)

## Security Notes

- **Service Token:** Treat like a password. Never commit to git.
- **Environment Variable:** Stored in Windows Registry (`HKEY_CURRENT_USER\Environment`)
- **Rotation:** Regenerate service token periodically in Infisical UI
- **Audit:** Infisical logs all secret access — check "Activity" tab in project

## Next Steps

1. ✅ Create `bg-miniview` project in Infisical Cloud
2. ✅ Add 5 secrets (CHECKLY_API_KEY, WORKER_URL, etc.)
3. ✅ Create service token
4. ✅ Store token in `$env:INFISICAL_TOKEN`
5. ✅ Run: `.\scripts\setup_checkly.ps1`
