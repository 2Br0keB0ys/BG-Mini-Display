# BGDisplay

BGDisplay is an ESP32-based blood glucose display for M5Stack Core2.

Current architecture:
- Dexcom Share is the primary data source
- Nightscout is fallback
- Firmware syncs config from a Cloudflare Worker
- Cloudflare Pages hosts the browser-based setup UI
- WebSocket push is used for near-instant config refresh

## Repository Layout

```text
bgdisplay/
├── apps/
│   ├── cloudflare/        # Worker + wrangler config
│   └── pages/             # Single-file UI (index.html)
├── firmware/bgdisplay/    # PlatformIO firmware for M5Stack Core2
├── CLAUDE.md              # Deep architecture and ops reference
└── bgdisplay_context.md   # Current project snapshot
```

## Prerequisites

- Node.js 18+
- Wrangler CLI
- VS Code with PlatformIO extension
- M5Stack Core2 with USB-C cable

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

## 2) Deploy Config UI (Cloudflare Pages)

Edit `apps/pages/index.html` and set `WORKER_URL` at the top of the script block.

```bash
cd apps/cloudflare
npm run deploy:pages
```

Optional but recommended: protect the Pages domain with Cloudflare Access.

## 3) Flash Firmware (PlatformIO)

1. Copy `firmware/bgdisplay/src/secrets.example.h` to `firmware/bgdisplay/src/secrets.h`.
2. Set:
    - `BGDISPLAY_DEFAULT_WORKER_URL`
    - `BGDISPLAY_DEFAULT_DEVICE_KEY`
    - `BGDISPLAY_DEFAULT_TIMEZONE` (optional)
3. Build and flash:

```bash
cd firmware/bgdisplay
pio run -d .
pio run -d . -t upload
```

From plain Windows shell, `pio` may need full path:
`~/.platformio/penv/Scripts/pio.exe`

## 4) First Boot

1. If no WiFi is saved, device enters AP setup mode.
2. Join `BGDisplay-Setup-XXXX` network.
3. Open `http://192.168.4.1` if captive portal does not auto-open.
4. Enter WiFi credentials.
5. Device connects, pulls cloud config, then starts BG polling.

## 5) Configure Runtime Settings

Use the Cloudflare Pages UI for:
- Display preferences
- Dexcom and Nightscout credentials
- Glooko Omnipod endpoint/token and 30-minute pod status polling
- Alert thresholds and DND
- Pushover alerts and daily digest push
- Security and advanced options

## Display Features

### Main Screen
- **Large BG value** with trend arrow (updated every 5 minutes)
- **Sparkline history** (24-point glucose trend chart)
- **Omnipod summary line** (if Glooko enabled):
    - Format: `Pod ON/OFF IOB X.XU Res X.XU Exp XhYZm`
    - **Color-coded clinical thresholds:**
        - **GREEN:** Healthy (Res >25U, Exp >8h)
        - **YELLOW:** Warning (Res 15-25U, Exp 4-8h)
        - **ORANGE:** Urgent (Res 5-15U, Exp 1-4h)
        - **RED:** Critical (Res ≤5U, Exp <1h)
    - Color reflects most critical condition (reservoir or expiry)
- **Status bar** with connection indicators and timestamp

### Settings Menu
- Dexcom, Nightscout, and Glooko Omnipod connection status
- Alert and DND settings
- Display brightness and theme options

## Troubleshooting

| Symptom | What to check |
|---|---|
| Device shows `---` | Dexcom and Nightscout credentials/endpoints |
| `STALE` appears | Data source reachability or stale threshold too low |
| Config changes delayed | WebSocket disconnected, device falls back to ping interval |
| Setup portal does not open | Browse to `http://192.168.4.1` manually |
| `KEY ERROR` overlay | Device key mismatch or invalid key in cloud |

## Notes

- OTA is implemented via `ArduinoOTA` when enabled in firmware.
- Cellular fallback is a planned hardware path and not currently active.
- There is no supported public direct Omnipod cloud API in this project; Omnipod data is integrated via Glooko endpoint polling.
- See `CLAUDE.md` for endpoint lists, auth model, and full architecture details.
