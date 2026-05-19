# BG Display Mini Setup Guide (Beginner-Friendly, Windows)

This guide is for someone with little to no technical background.

You will:
1. Run one guided setup command
2. Sign in to required services
3. Build and flash firmware

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

## Part 1 — One-Command Guided Setup (Recommended)

### Run from repo root

From PowerShell in the repo root, run:

- `pwsh ./scripts/bootstrap_windows.ps1`

This script:
- Installs Git, Node.js, Python, Wrangler CLI, Infisical CLI
- Walks you through account login
- Prompts for required setup values
- Runs build/deploy checks

If you can follow prompts and press Enter when asked, you can complete setup.

## Part 2 — Manual Setup (Optional)

Install these one by one:
- Git
- Node.js LTS (includes npm)
- Python 3.11
- VS Code
- PlatformIO VS Code extension
- Wrangler CLI (`npm install -g wrangler`)
- Infisical CLI (`npm install -g @infisical/cli`)

---

## Part 3 — Create/Connect Accounts

1. GitHub: create account and sign in.
2. Cloudflare: create account and sign in.
3. Infisical: create account and sign in.
4. (Optional) Nightscout account.

Then in terminal:
- `wrangler login`
- `infisical login`

---

## Part 4 — Configure Secrets (Infisical)

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

## Part 5 — Deploy Cloudflare Services

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

## Part 6 — Build and Flash Firmware

From repository root:

1. Build:
   - `pio run`
2. Flash (USB connected):
   - `pio run -t upload`

If `pio` is not found in plain terminal, use VS Code + PlatformIO extension terminal.

---

## Part 7 — First Boot and Device Setup

1. Power device.
2. If no WiFi saved, connect phone/laptop to `BG_MiniView_XXXX`.
3. Open `http://192.168.4.1`.
4. Enter WiFi credentials.
5. Device connects, enrolls, and pulls config.

---

## Part 8 — Public Repo Safety Rules

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

## Hardware Link

- M5Stack Core2 on Amazon: https://www.amazon.com/s?k=M5Stack+Core2

## Medical Disclaimer

This project is not a medical device and does not provide medical advice. Always verify readings and treatment decisions with approved medical equipment and a licensed clinician.
