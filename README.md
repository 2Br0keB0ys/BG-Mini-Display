# BG MiniView

BG MiniView is an ESP32-based blood glucose display for M5Stack Core2.

Current architecture:
- Dexcom Share is the primary data source
- Nightscout is fallback
- Firmware syncs config from a Cloudflare Worker
- Cloudflare Pages hosts the browser-based setup UI
- WebSocket push is used for near-instant config refresh

Archived/retired optional surfaces now live under `archive/`.

## Production Status

- Cloudflare Worker + Pages are deployed.
- OTA release channel `stable` is active with signed manifest/download flow.
- Firmware `v4.1.1` is the current production baseline.

## Repository Layout

```text
bg-miniview/
├── archive/               # archived NAS MCP, n8n workflow material, legacy workspace files
├── apps/
│   ├── cloudflare/        # Worker + wrangler config
│   ├── ui/                # Production React/Vite UI (deployed to Cloudflare Pages)
│   └── pages/             # Legacy single-file UI snapshot
├── firmware/              # PlatformIO firmware for BG MiniView on M5Stack Core2
├── CLAUDE.md              # Deep architecture and ops reference
└── docs/                  # Operational runbooks and public-repo guides
```

## Prerequisites

- Node.js 18+
- Wrangler CLI
- VS Code with PlatformIO extension
- M5Stack Core2 with USB-C cable

## Code Quality & Formatting

Run lint/format checks in each app workspace:

```bash
cd apps/cloudflare
npm run lint
npm run format

cd ../ui
npm run lint
npm run format
```

Line endings are normalized via repository-level `.gitattributes`:
- Most source/docs/config files use `LF`
- PowerShell scripts (`*.ps1`) use `CRLF`

For first-time users, see:
- `docs/setup-for-beginners.md` (full step-by-step onboarding)
- `scripts/bootstrap_windows.ps1` (guided Windows setup helper)
- `docs/public-repo-safety.md` (what is private vs safe to commit)

Security helpers:
- `scripts/security/generate_bootstrap_key.ps1` (generate a new `bg_ro_` bootstrap key for rotation)
- `scripts/security/secret_guard.ps1` (scan tracked files for blocked secret-like literals)
- `scripts/security/install_git_hooks.ps1` (enable local pre-commit secret guard via `.githooks/pre-commit`)

## 1) Deploy Cloudflare Worker

```bash
cd apps/cloudflare
npm install
npm run deploy:worker
```

Before first deploy, set Worker secrets as needed:

```bash
wrangler secret put KV_ENCRYPT_KEY
```

MCP smoke testing (using project test endpoint/key defaults):

```bash
cd apps/cloudflare
npm run test:mcp
npm run test:mcp:bg
npm run test:mcp:health
npm run test:mcp:pushover
```

- `test:mcp` verifies authenticated MCP metadata + `tools/list`.
- `test:mcp:bg` additionally runs `get_current_bg`.
- `test:mcp:health` prints a readable worker health summary.
- `test:mcp:pushover` checks Pushover MCP status and auth readiness.
- `test:mcp:pushover:live` sends a real test notification.
- MCP includes `get_key_auth_status` to show active/pending/recovery key state.
- MCP includes `get_full_readiness` for one-shot readiness checks across auth, digest, Pushover, device recency, and bindings.
- Override defaults when needed:
    - `./scripts/test_mcp.ps1 -McpUrl "https://<worker>/mcp" -McpKey "bg_ro_..."`
    - `./scripts/test_mcp.ps1 -UseAdminSession` for admin-session fallback when the device key has rotated.

## 2) Deploy Config UI (Cloudflare Pages)

Production UI is built from `apps/ui/` and deployed via the Cloudflare app scripts.

```bash
cd apps/cloudflare
npm run deploy:pages
```

`deploy:pages` is pinned to the `production` branch so direct uploads go to the live Pages environment rather than Preview.

Optional but recommended: protect the Pages domain with Cloudflare Access.

## 3) Flash Firmware (PlatformIO)

1. Copy `firmware/src/secrets.example.h` to `firmware/src/secrets.h`.
2. Set:
    - `BGDISPLAY_DEFAULT_WORKER_URL`
    - `BGDISPLAY_DEFAULT_DEVICE_KEY`
    - `BGDISPLAY_DEFAULT_TIMEZONE` (optional)
3. Build and flash:

```bash
pio run
pio run -t upload
```

Run these commands from the repository root. Root `platformio.ini` points PlatformIO at `firmware/src`.

From plain Windows shell, `pio` may need full path:
`~/.platformio/penv/Scripts/pio.exe`

## 4) First Boot

1. If no WiFi is saved, device enters AP setup mode.
2. Join `BG_MiniView_XXXX` network.
3. Open `http://192.168.4.1` if captive portal does not auto-open.
4. Enter WiFi credentials.
5. Device connects, pulls cloud config, then starts BG polling.

## 5) Configure Runtime Settings

Use the Cloudflare Pages UI for:
- Display preferences
- Dexcom and Nightscout credentials
- **Pump data source** (Glooko, Tandem, Medtronic, Tidepool) with 30+ minute polling
- Alert thresholds and DND
- **Pushover phone alerts** and digest push
- **EndoAI** — AI-powered glucose summaries (daily at 7:00 AM, hourly 8 AM–11 PM)
- Security and advanced options

## 6) OTA Release Operations (Cloudflare)

OTA is productionized and uses Worker-signed download URLs backed by R2.

High-level release flow:

1. Build firmware (`pio run`)
2. Upload `.bin` to R2 (`bgdisplay-firmware/<channel>/<artifact>.bin`)
3. Register release metadata with `POST /api/admin/ota`
4. Device executes `ota-check` / `ota-apply` via command queue

## Display Features

### Main Screen
- **Large BG value** with trend arrow (updated every 5 minutes)
- **Sparkline history** (24-point glucose trend chart)
- **Pump status line** (if pump data sync enabled):
    - Format: `Pod ON/OFF IOB X.XU Res X.XU Exp XhYZm`
    - Supports **Glooko, Tandem, Medtronic, Tidepool** data sources
    - **Color-coded clinical thresholds:**
        - **GREEN:** Healthy (Res >25U, Exp >8h)
        - **YELLOW:** Warning (Res 15-25U, Exp 4-8h)
        - **ORANGE:** Urgent (Res 5-15U, Exp 1-4h)
        - **RED:** Critical (Res ≤5U, Exp <1h)
    - Color reflects most critical condition (reservoir or expiry)
- **Status bar** with connection indicators and timestamp
- **EndoAI digest delivery:** summaries are sent via Pushover notifications (display rendering removed in firmware v4.0.1-S)

### Settings Menu
- Dexcom, Nightscout, and pump data source connection status
- **EndoAI** section with today's summary, generation button, and hourly/daily schedule
- Pump data source selection (Glooko, Tandem, Medtronic, Tidepool)
- Alert and DND settings with per-day customization
- Pushover phone alerts and digest push scheduling
- Display brightness, timezone, and theme options
- **Expand all / Collapse all** buttons for quick section navigation

## Troubleshooting

| Symptom | What to check |
|---|---|
| Device shows `---` | Dexcom and Nightscout credentials/endpoints |
| `STALE` appears | Data source reachability or stale threshold too low |
| Config changes delayed | WebSocket disconnected, device falls back to ping interval |
| Setup portal does not open | Browse to `http://192.168.4.1` manually |
| `KEY ERROR` overlay | Device key mismatch or invalid key in cloud |

## Notes

- OTA supports both local LAN (`ArduinoOTA`) and Cloudflare-managed signed update flow.
- Cellular fallback is a planned hardware path and not currently active.
- **Pump data sources:** Direct integrations with Glooko, Tandem, Medtronic, and Tidepool APIs
- **EndoAI:** Daily summaries generated at 7:00 AM US/Central; hourly summaries every hour 8 AM–11 PM. Both can push to Pushover if credentials configured.
- **Build profile:** Firmware uses a conservative/stable profile (`-O2`, `-DCORE_DEBUG_LEVEL=0`, `-DARDUINO_LOOP_STACK_SIZE=16384`, `-Wall -Wextra -Wno-unused-parameter`).
- See `CLAUDE.md` for endpoint lists, auth model, pump provider details, and full architecture.

## Archived Components

- `archive/apps/nas-control-mcp/` contains the retired NAS MCP control surface.
- `archive/n8n/cloudflare-n8n/` contains archived import-ready n8n workflow templates.
- `archive/n8n/workflows/` contains the archived n8n-as-code sync workspace and `archive/n8n/n8nac-config.json`.
- `archive/checkly/` contains retired Checkly automation scripts.

## License

This project is licensed under the Apache License 2.0. See `LICENSE` and `NOTICE`.

If you redistribute or derive from this project, you must preserve attribution notices.
