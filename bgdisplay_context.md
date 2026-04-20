# BGDisplay Project — Full Context Brief

## What This Is
A dedicated medical BG (blood glucose) display device built on M5Stack Core2, showing real-time Dexcom G7 readings via Nightscout. Sits on a work desk. Owner is T2D (Type 2, not Type 1), uses Dexcom G7 CGM and Omnipod 5 insulin pump, based in Oklahoma City, US/Central timezone.

---

## Hardware

| Component | Detail |
|---|---|
| **Device** | M5Stack Core2 V1.1 (ESP32-D0WDQ6-V3, 320x240 IPS touch, 390mAh battery) |
| **SD Card** | Installed in Core2 SD slot |
| **Network** | Home: "2 Broke Boys" WiFi. Work: open/isolated corporate network |
| **Future** | M5Stack LTE module (SIM7600G) planned but not yet installed |

---

## Architecture Overview

```
Nightscout (primary BG source)
    ↓ HTTPS poll every 1-5 min
Dexcom Share (fallback)
    ↓
M5Stack Core2 (ESP32 firmware)
    ↓ outbound HTTPS only
Cloudflare Worker (bgdisplay-worker.zanebaize.workers.dev)
    ↓ KV storage
Cloudflare KV (config + auth + logs)
    ↑ config UI
Cloudflare Pages (bgdisplay-ui.pages.dev) — dark mode, 2-col, collapsible
    
HiveMQ Cloud MQTT (5a2bf35ae7ae4900ad04ff78ed4db6bd.s1.eu.hivemq.cloud:8883)
    ↓ persistent TLS connection from Core2
    ← Worker publishes to bgdisplay/all/sync on every config save
    → Core2 receives instantly, pulls full config (~1-2 second total sync time
```

---

## Cloudflare Infrastructure

| Resource | Value |
|---|---|
| **Worker URL** | `https://bgdisplay-worker.zanebaize.workers.dev` |
| **Pages URL** | `https://bgdisplay-ui.pages.dev` |
| **KV: Config** | `c86909e122f0453a978dda571eebac25` (BGDISPLAY_CONFIG) |
| **KV: Auth** | `1e7f3aa136174b6eacdbd78bd4ce7a45` (BGDISPLAY_AUTH) |
| **Account subdomain** | `zanebaize.workers.dev` |
| **Wrangler project path** | `C:\Users\zaneb\Downloads\bgdisplay\cloudflare` |

### Worker Endpoints
- `GET /api/ping?v=N` — lightweight version check (device calls every 1 min)
- `GET /api/config` — full config pull (device calls when ping says changed)
- `POST /api/status` — device pushes uptime/RSSI/firmware/SD status
- `POST /api/key-ack` — device ACKs new API key after auto-rotation
- `GET /api/admin/config` — UI fetches config + meta
- `POST /api/admin/config` — UI saves config, increments version, sets force_sync, publishes MQTT
- `GET /api/admin/export` — download config JSON
- `POST /api/admin/import` — restore config
- `POST /api/admin/clear-log` — wipe change log

### Security Model
- **Device auth**: `X-Device-Key` header — read-only key `bg_ro_***REDACTED***`
- **Auto key rotation**: enforced every 7 days, non-configurable, zero-downtime handoff over HTTPS
- **Admin auth**: Cloudflare Access JWT + scoped admin session token
- **Rate limiting**: configurable (default 45/min per IP)
- **Lockout**: configurable attempts + duration
- **Config versioning**: integer incremented on every save, device tracks and only pulls on change

---

## MQTT (Instant Sync)

| Detail | Value |
|---|---|
| **Broker** | HiveMQ Cloud Free (AWS eu) |
| **Host** | `5a2bf35ae7ae4900ad04ff78ed4db6bd.s1.eu.hivemq.cloud` |
| **Port** | 8883 (TLS) |
| **TLS cert** | Let's Encrypt ISRG Root X1 (pinned in firmware) |
| **Credentials** | username: `bgdisplay`, password: configured in UI |
| **Topics** | `bgdisplay/all/sync` (broadcast), `bgdisplay/{chipId}/sync` (device-specific) |
| **Device client ID** | `bgdisplay_82E81F84` |
| **Flow** | UI saves → Worker publishes to MQTT → Core2 receives → pulls config → ~1-2 sec total |

---

## Firmware

| Detail | Value |
|---|---|
| **Version** | 2.0.0 |
| **Framework** | Arduino via PlatformIO + M5Unified library |
| **IDE** | VS Code + PlatformIO extension |
| **Project path** | `C:\Users\zaneb\Downloads\bgdisplay\firmware\bgdisplay` |
| **Board** | m5stack-core2, COM6 |
| **Upload speed** | 1500000 |

### Source Files (all in `src/`)
| File | Purpose |
|---|---|
| `bgdisplay.ino` | Main sketch — setup, loop, polling, CF config sync, status push, NTP |
| `config.h` | AppConfig struct, encrypted NVS save/load |
| `crypto.h` | AES-128-CBC encryption using chip-derived key (mbedTLS) |
| `display.h` | M5Canvas double-buffered rendering — zero flicker |
| `dexcom.h` | Dexcom Share API — email OR phone number login, fallback source |
| `nightscout.h` | Nightscout API — BG + trend only, token auth |
| `wifi_setup.h` | AP mode captive portal — WiFi-only setup form |
| `mqtt_sync.h` | HiveMQ Cloud MQTT with ISRG Root X1 TLS cert |
| `sd_logger.h` | Encrypted SD logging (AES-128, chip-derived key) |

### Key Behaviors
- **Display**: M5Canvas sprite — all drawing off-screen, pushed atomically (zero flicker)
- **BG source**: Nightscout primary → Dexcom fallback
- **Config sync**: MQTT push (instant) + ping fallback every 1 min
- **Encryption**: All sensitive NVS fields encrypted with chip-derived AES-128 key — stolen device = useless data
- **SD logs**: Encrypted with same chip-derived key, rotates at 100KB
- **NTP**: NIST servers (`time.nist.gov`, `time-a-g.nist.gov`, `time-b-g.nist.gov`)
- **Time display**: Current time on main screen, synced to NIST
- **WiFi signal**: Bars + dBm on main screen, SSID at bottom

### Display Layout
```
┌─────────────────────────────────┐
│ DEX          12:45pm    ▌▌▌▌    │  ← status bar
│                                 │
│                                 │
│           97  ->                │  ← BG + trend (large, color coded)
│           5 min ago             │
│                                 │
│ ─────────────────────────────── │  ← separator
│ 2 Broke Boys            -45 dBm │  ← SSID + signal
└─────────────────────────────────┘
```

BG colors: Green (in range) / Yellow (high) / Orange (urgent high) / Red (low or urgent low)

### Settings Screen (tap gear icon top-right)
- WiFi SSID + signal strength/quality
- Connection status (live, refreshes every 5 sec):
  - Cloudflare (checks 1.1.1.1 + Worker) — Connected / Not Connected
  - MQTT — Connected / Not Connected  
  - Nightscout — Connected / Not Connected
- Config URL: `bgdisplay-ui.pages.dev`
- Auto-closes after 60 seconds

---

## Config UI (bgdisplay-ui.pages.dev)

- Dark mode permanent
- Two-column layout, collapsible sections
- Sections: Instant Sync (MQTT), Wi-Fi, Data Sources, BG Alerts, Display, Security, Backup & Restore, Diagnostics, System
- Save button changes to "Syncing..." and polls until device confirms sync
- Nightscout is primary, Dexcom is fallback (both in Data Sources section)
- No Nightscout/Omnipod pod data — BG + trend only

### Config Fields (stored in Cloudflare KV)
```
wifi_ssid, wifi_pass
mqtt_host, mqtt_user, mqtt_pass
nightscout_url, nightscout_secret
dexcom_user, dexcom_pass, dexcom_region
poll_interval_min, stale_data_warn_min, config_ping_min
bg_units, urgent_low, low, high, urgent_high, bg_alert_style
show_last_reading_time, show_trend_arrow
brightness, auto_dim_min, dim_to_pct
dnd_enabled, dnd_from, dnd_to
clock_24hr, timezone
rate_limit_per_min, lockout_enabled, lockout_attempts, lockout_duration_min
session_timeout_min, ip_allowlist_enabled, auto_backup
```

---

## Nightscout

| Detail | Value |
|---|---|
| **URL** | `https://krypton.nightscoutpro.com` |
| **Auth** | Token: `***REDACTED***` (passed as `?token=` param) |
| **Endpoint** | `/api/v1/entries.json?count=1&token=***REDACTED***` |
| **Data pulled** | BG value (`sgv`), trend direction (`direction`), timestamp (`date`) |
| **Pod/pump data** | NOT pulled — Omnipod/Glooko data intentionally excluded |

---

## Dexcom Share (fallback)

| Detail | Value |
|---|---|
| **Username** | Phone number format: `+14056551665` |
| **Region** | US |
| **Login endpoint** | `share2.dexcom.com` |
| **Session TTL** | 4 hours, auto-renews |
| **Supports** | Email OR phone number (`+1xxxxxxxxxx`) login |

---

## Local File Structure

```
C:\Users\zaneb\Downloads\bgdisplay\
├── cloudflare\
│   ├── wrangler.toml          (KV IDs configured)
│   └── src\worker.js          (v2.0 Worker)
├── pages\
│   └── index.html             (v2.0 dark UI)
└── firmware\bgdisplay\
    ├── platformio.ini         (m5stack-core2, PubSubClient added)
    └── src\
        ├── bgdisplay.ino
        ├── config.h
        ├── crypto.h
        ├── display.h
        ├── dexcom.h
        ├── nightscout.h
        ├── wifi_setup.h
        ├── mqtt_sync.h
        └── sd_logger.h
```

---

## Deploy Commands

```powershell
# Deploy Worker
cd C:\Users\zaneb\Downloads\bgdisplay\cloudflare
wrangler deploy

# Deploy Pages UI
wrangler pages deploy C:\Users\zaneb\Downloads\bgdisplay\pages --project-name bgdisplay-ui

# Flash firmware (VS Code PlatformIO)
# Left sidebar → PlatformIO → m5stack-core2 → General → Upload
```

---

## Current Status (as of last session)

- ✅ Hardware working — Core2 displaying BG readings from Nightscout
- ✅ WiFi connected, SD card mounted
- ✅ MQTT connected to HiveMQ — instant sync tested and confirmed working
- ✅ Config UI live and dark mode
- ✅ Encrypted NVS + encrypted SD logs
- ✅ Zero-flicker display via M5Canvas double buffering
- ✅ Settings screen with live connection status (refreshes every 5 sec)
- ✅ Auto key rotation (7-day enforced, fully automated)
- ⏳ Cellular LTE module (M5Stack SIM7600G) — planned, not yet purchased/installed
- ⏳ Cloudflare Access (Google SSO) on config UI — not yet configured

---

## Known Issues / Recent Fixes

- MQTT `rc=-2` was TLS cert failure — fixed by pinning ISRG Root X1 in `mqtt_sync.h`
- Display flicker was caused by `fillScreen()` on every redraw — fixed with M5Canvas sprite double buffering
- Nightscout 401 — fixed by switching from `api-secret` header to `?token=` URL param
- Stack overflow crash — fixed with `ARDUINO_LOOP_STACK_SIZE=16384` in platformio.ini
- `build_cache_dir` warning in PlatformIO — harmless, ignore
- `MQTT_KEEPALIVE` redefined warning — harmless, ignore

---

## Owner Preferences

- Direct and concise communication
- Copy-paste ready commands
- Lead with the fix
- Minimal back-and-forth
- Always end with a clear next step
- Markdown formatting for scannability
