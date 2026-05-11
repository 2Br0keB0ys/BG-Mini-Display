# BG MiniView Setup Guide (Beginner-Friendly, Windows)

This guide is for someone with little to no technical background.

You will:
1. Install required tools
2. Create accounts
3. Set secrets in Infisical
4. Deploy cloud services
5. Build/flash firmware

---

## Before You Start

You need:
- A Windows PC with internet
- M5Stack Core2 + USB-C cable
- A GitHub account
- A Cloudflare account
- An Infisical account

Optional:
- Nightscout account / URL

---

## Part 1 — Install Software

### Option A (recommended): one helper script

From PowerShell in the repo root, run:

- `scripts/bootstrap_windows.ps1`

This script:
- Installs Git, Node.js, Python, Wrangler CLI, Infisical CLI
- Walks you through account login
- Prompts for required setup values
- Runs build/deploy checks

### Option B (manual)

Install these one by one:
- Git
- Node.js LTS (includes npm)
- Python 3.11
- VS Code
- PlatformIO VS Code extension
- Wrangler CLI (`npm install -g wrangler`)
- Infisical CLI (`npm install -g @infisical/cli`)

---

## Part 2 — Create/Connect Accounts

1. GitHub: create account and sign in.
2. Cloudflare: create account and sign in.
3. Infisical: create account and sign in.
4. (Optional) Nightscout account.

Then in terminal:
- `wrangler login`
- `infisical login`

---

## Part 3 — Configure Secrets (Infisical)

Create these keys in your Infisical project/environment:

Required:
- `BGDISPLAY_DEFAULT_DEVICE_KEY` (format: `bg_ro_` + 32 lowercase letters/numbers)
- `BGDISPLAY_DEFAULT_TIMEZONE` (for example `US/Central`)
- `WORKER_URL` (your worker URL)

Optional:
- `NIGHTSCOUT_URL`
- `NIGHTSCOUT_API_TOKEN`

Then sync firmware secrets locally:

- `firmware/scripts/firmware_secrets_sync.ps1 -InfisicalProjectId <project-id> -InfisicalEnv <env>`

Important:
- `firmware/src/secrets.h` is local-only and gitignored.
- Never copy raw secrets into docs, issues, or commits.

---

## Part 4 — Deploy Cloudflare Services

From `apps/cloudflare`:

1. Install dependencies:
   - `npm ci`
2. Set worker secret (secure prompt):
   - `wrangler secret put KV_ENCRYPT_KEY`
3. Deploy worker:
   - `npm run deploy:worker`
4. Deploy UI:
   - `npm run deploy:pages`

---

## Part 5 — Build and Flash Firmware

From repository root:

1. Build:
   - `pio run`
2. Flash (USB connected):
   - `pio run -t upload`

If `pio` is not found in plain terminal, use VS Code + PlatformIO extension terminal.

---

## Part 6 — First Boot and Device Setup

1. Power device.
2. If no WiFi saved, connect phone/laptop to `BG_MiniView_XXXX`.
3. Open `http://192.168.4.1`.
4. Enter WiFi credentials.
5. Device connects, enrolls, and pulls config.

---

## Part 7 — Public Repo Safety Rules

Always keep private data out of git:
- No real keys/tokens/passwords in commits
- No local config state files
- No personal machine paths

Use:
- `docs/public-repo-safety.md`
- `CONTRIBUTING.md`

---

## Troubleshooting (Simple)

- **Wrangler login fails**: retry and complete browser auth.
- **Infisical CLI fails**: run `infisical login` again.
- **Firmware build fails**: ensure PlatformIO extension is installed and use its terminal.
- **Device shows `---`**: verify source credentials in cloud config.
- **No digest/push alerts**: confirm `KV_ENCRYPT_KEY` is set and notifications are configured.

---

## Next Step

After setup works once, create a short private note with your project IDs and process so you can repeat setup quickly.
