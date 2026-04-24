# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BGDisplay is an ESP32-based medical blood glucose display built on the M5Stack Core2. It shows real-time Dexcom G7 readings sourced from Nightscout (primary) with Dexcom Share as fallback. The system has three components: Arduino firmware, a Cloudflare Worker backend, and a single-page config UI hosted on Cloudflare Pages.

**Data flow:**
```
Nightscout → (poll) → M5Stack Core2 firmware → (signed HTTPS) → Cloudflare Worker → KV storage
                                                                                          ↑
Dexcom Share (fallback)                                                         Cloudflare Pages UI
```

## Commands

### Firmware (PlatformIO)
```bash
cd firmware/bgdisplay
pio run -d .                    # compile
pio run -d . -t upload          # compile + flash via USB
pio device monitor              # serial monitor
```
Flash requires USB-C connection to M5Stack Core2 at 1500000 baud. There is no OTA — `ota.h` is a stub.

### Cloudflare Worker & Pages
```bash
cd cloudflare
npm run deploy:worker           # wrangler deploy (worker)
npm run deploy:pages            # wrangler pages deploy (UI)
npm run validate                # node syntax check on worker.js
```

### CI
GitHub Actions (`.github/workflows/ci.yml`) runs PlatformIO firmware build and worker syntax validation on push/PR to main.

## Architecture

### Firmware (`firmware/bgdisplay/src/`)

The main sketch is `bgdisplay.ino`. All modules are header-only files included by the sketch:

| File | Responsibility |
|------|---------------|
| `config.h` | `AppConfig` struct (~70 fields), NVS save/load with AES-128-CBC encryption for sensitive fields |
| `display.h` | Off-screen rendering via M5Canvas (double-buffering), dirty tracking, BG color coding, trend arrows |
| `crypto.h` | AES-128-CBC via mbedTLS; key derived from unique ESP32 chip ID — stolen device = unreadable data |
| `nightscout.h` | Polls `/api/v1/entries.json`, extracts sgv + trend + timestamp |
| `dexcom.h` | Two-step Share API auth (email or phone), 4h session TTL, US/international regions |
| `wifi_setup.h` | AP mode captive portal on 192.168.4.1 for first-boot config; generates WiFi QR code |
| `sd_logger.h` | Encrypted JSON log rotation at 100KB; uses same chip-derived key (different salt) |
| `ota.h` | Stub — not implemented |

**Key patterns:**
- Display: All drawing to off-screen `M5Canvas` sprite, pushed atomically to avoid flicker. Only redraws on dirty data.
- Config sync: Device pings `GET /api/ping?v={version}` every minute; only fetches full config on version change.
- Auth: Requests signed with HMAC-SHA256 (method + path + timestamp + nonce + body hash). API keys auto-rotate every 7 days with 48h overlap window.
- Fallback: Nightscout failure → Dexcom Share. Both fail → display `---` and "STALE" banner after threshold.
- NVS encryption: Sensitive fields (WiFi password, Nightscout token, Dexcom credentials) encrypted before storage; chip ID acts as hardware root-of-trust.
- Stack: `ARDUINO_LOOP_STACK_SIZE=16384` in `platformio.ini` (prevents overflow crash).

### Cloudflare Worker (`cloudflare/src/worker.js`)

Single ~43KB file handling all backend logic. Two KV namespaces:
- `BGDISPLAY_CONFIG`: config JSON, version counter, changelog (50 entries)
- `BGDISPLAY_AUTH`: key hashes, nonce cache, rate limit buckets, admin sessions

Device endpoints (X-Device-Key + HMAC signature auth): `/api/ping`, `/api/config`, `/api/status`, `/api/key-ack`

Admin endpoints (Cloudflare Access JWT + scoped session token): `/api/admin/config`, `/api/admin/export`, `/api/admin/import`, `/api/admin/logs/latest`, `/api/admin/clear-log`

Security features: replay protection (nonce + ±5min timestamp), IP-based rate limiting, IP lockout, request deduplication.

### Config UI (`pages/index.html`)

Single ~49KB HTML file — no build step. Dark mode only. Deployed to Cloudflare Pages. Uses fetch to call the Worker's admin endpoints. Save polls until device confirms sync via version increment.

## Hardware

- **Device:** M5Stack Core2 V1.1 (ESP32-D0WDQ6-V3, 320×240 IPS touch, 390mAh battery)
- **Display:** 320×240 via M5Unified library (v0.2.4)
- **SD Card:** Installed in Core2 SD slot for encrypted log storage
- **Network:** WiFi only (cellular LTE via M5Stack SIM7600G module is planned but not purchased)

## Configuration Fields

The `AppConfig` struct has ~70 fields covering: WiFi credentials, Nightscout URL/token, Dexcom email+password+region, polling intervals, BG alert thresholds, display brightness/dim/timezone, per-day DND schedule, security (rate limiting, IP allowlist), and monitoring thresholds. The captive portal handles initial setup; all subsequent changes go through the Cloudflare Pages UI.
