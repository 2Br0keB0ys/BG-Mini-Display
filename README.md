# BGDisplay — Setup & Deployment Guide

## Project Structure
```
bgdisplay/
├── cloudflare/
│   ├── wrangler.toml       # Worker config
│   └── src/worker.js       # API backend
├── pages/
│   └── index.html          # Config web UI
└── firmware/
    ├── bgdisplay.ino       # Main sketch
    ├── config.h            # AppConfig struct + NVS persistence
    ├── display.h           # All rendering logic
    ├── nightscout.h        # Nightscout API polling
    ├── dexcom.h            # Dexcom Share fallback
    └── wifi_setup.h        # AP mode captive portal
```

---

## Step 1 — Cloudflare Setup

### 1a. Install Wrangler
```bash
npm install -g wrangler
wrangler login
```

### 1b. Create KV Namespaces
```bash
wrangler kv:namespace create BGDISPLAY_CONFIG
wrangler kv:namespace create BGDISPLAY_AUTH
```
Copy the IDs output and paste them into `wrangler.toml`.

### 1c. Deploy the Worker
```bash
cd cloudflare
npm install
npm run deploy:worker
```
Note your Worker URL: `https://bgdisplay-worker.YOURNAME.workers.dev`

### 1d. Get your initial Device API Key
Hit this URL once in your browser (authenticated via Cloudflare Access):
```
GET https://bgdisplay-worker.YOURNAME.workers.dev/api/init
```
Copy the `initialKey` from the response — you need it for the firmware.

---

## Step 2 — Cloudflare Pages (Config UI)

### 2a. Edit pages/index.html
Set the `WORKER_URL` variable at the top of the `<script>` block:
```js
const WORKER_URL = "https://bgdisplay-worker.YOURNAME.workers.dev";
```

### 2b. Deploy to Cloudflare Pages
```bash
cd cloudflare
npm install
npm run deploy:pages
```

This deploy runs from the `pages/` directory so Wrangler does not try to parse the Worker config in `cloudflare/wrangler.toml`.
This deploy runs from the `pages/` directory so Wrangler does not try to parse the Worker config in `cloudflare/wrangler.toml`.

Then set your custom domain (e.g. `bgdisplay.yourdomain.com`) in the Cloudflare dashboard.

### 2c. Enable Cloudflare Access
- Go to Zero Trust → Access → Applications
- Add application → Self-hosted
- Domain: `bgdisplay.yourdomain.com`
- Policy: Allow your Google/email account

---

## Step 3 — Arduino IDE Setup

### 3a. Install Board Support
In Arduino IDE → Preferences → Additional Board URLs, add:
```
https://m5stack.oss-cn-shenzhen.aliyuncs.com/resource/arduino/package_m5stack_index.json
```
Then: Tools → Board Manager → search "M5Stack" → Install

### 3b. Select Board
Tools → Board → M5Stack-Core2

### 3c. Install Libraries
Tools → Library Manager — install these:
- **M5Core2** (by M5Stack)
- **ArduinoJson** (by Benoit Blanchon) — v6.x
- All dependencies M5Core2 pulls in automatically

### 3d. Set firmware credentials
Before flashing, edit `bgdisplay.ino` and fill in:
- `workerUrl` — your Worker URL
- `deviceKey` — the initial key from Step 1d

Or leave blank and use AP Mode setup on first boot.

---

## Step 4 — First Boot

1. Flash the firmware via USB-C
2. Device boots → shows "BGDisplay" splash → tries WiFi
3. No WiFi saved → enters AP Mode automatically
4. On your phone: connect to the on-screen `BGDisplay-Setup-XXXX` network using the on-screen password
5. Browser opens automatically → fill in:
   - Work Wi-Fi SSID + password
   - Worker URL
   - Device API key (from Step 1d)
   - Nightscout URL + secret
   - Dexcom credentials
6. Tap Save → device restarts → connects to work Wi-Fi → starts displaying BG

---

## Step 5 — All Future Config Changes

Open `https://bgdisplay.yourdomain.com` in any browser.
No app, no hotspot, no USB — just your browser.

---

## Firmware OTA Updates (future)
Not yet implemented. Currently update via USB-C cable.
Connect to a laptop, reflash via Arduino IDE.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `KEY ERROR - REFLASH` on display | API key was rotated — get new key from UI → Rotate → reflash |
| `STALE` banner showing | Nightscout not reachable from device, check NS URL in config |
| Device shows `---` | Both Nightscout and Dexcom failing — check credentials in UI |
| AP Mode not showing captive portal | Open browser manually to `http://192.168.4.1` |
| Config changes not applying | Wait up to 60 seconds — device polls every 60s |

---

## Adding Cellular (Later)
When you add the M5Stack LTE module:
1. Enable `cellular_fallback` in the config UI
2. The firmware already has the toggle plumbed in
3. Add APN config to `wifi_setup.h` (T-Mobile APN: `fast.t-mobile.com`)
4. The Cloudflare Worker and Pages UI require zero changes
