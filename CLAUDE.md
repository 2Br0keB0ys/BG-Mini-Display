# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BGDisplay is an ESP32-based medical blood glucose display built on the M5Stack Core2. It shows real-time Dexcom G7 readings sourced from Dexcom Share (primary) with Nightscout as fallback. The system has three components: Arduino firmware, a Cloudflare Worker backend, and a single-page config UI hosted on Cloudflare Pages.

**Data flow:**
```
Dexcom Share (primary) → M5Stack Core2 firmware → (signed HTTPS) → Cloudflare Worker → KV storage
Nightscout (fallback)                                                                        ↑
                                                                              Cloudflare Pages UI
```

## Commands

### Firmware (PlatformIO)
```bash
cd firmware/bgdisplay
pio run -d .                    # compile
pio run -d . -t upload          # compile + flash via USB
pio device monitor              # serial monitor
```
Flash requires USB-C connection to M5Stack Core2 at 1500000 baud. OTA is implemented via `ArduinoOTA` — hostname `bgdisplay-{last4-chip-id}.local`, password = device key.

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

Current firmware version: `3.0.0-S` (defined in `config.h`).

The main sketch is `bgdisplay.ino`. All modules are header-only files included by the sketch:

| File | Responsibility |
|------|---------------|
| `config.h` | `AppConfig` struct (~40 fields), NVS save/load with AES-128-CBC encryption for sensitive fields |
| `display.h` | Off-screen rendering via M5Canvas (double-buffering), dirty tracking, BG color coding, trend arrows, BG sparkline (24-pt history), battery meter |
| `crypto.h` | AES-128-CBC via mbedTLS; key derived from unique ESP32 chip ID — stolen device = unreadable data |
| `nightscout.h` | Polls `/api/v1/entries.json`, extracts sgv + trend + timestamp |
| `dexcom.h` | Two-step Share API auth (email or phone), 4h session TTL, US/international regions |
| `wifi_setup.h` | AP mode captive portal on 192.168.4.1 for first-boot WiFi setup only; generates WiFi QR code |
| `sd_logger.h` | Encrypted JSON log rotation at 100KB; uses same chip-derived key (different salt: `BGDisplay_SD_v1`) |
| `ota.h` | `ArduinoOTA` — active when `ENABLE_OTA=1` (default) |

**NVS encrypted fields:** `deviceKey`, `wifiPass`, `nightscoutSecret`, `dexcomUser`, `dexcomPass`. All other fields stored plain. Salt: `BGDisplay_NVS_v1`.

**Key patterns:**
- **BG source priority:** Dexcom Share is tried first; Nightscout is the fallback. Both failing → display `---` and "STALE" banner after `staleDataWarnMin`.
- **Display:** All drawing to off-screen `M5Canvas` sprite, pushed atomically to avoid flicker. Redraws only on dirty data (BG value, trend, time, RSSI coarse, stale state, key error). Includes BG sparkline and battery % top-right.
- **Config sync:** Device pings `GET /api/ping?v={version}` capped at every 60s; only fetches full config on version change.
- **Command poll:** Device polls `GET /api/command` every 60s for remote commands (`reboot`, `sync-now`, `upload-logs`, `factory-reset`). Commands are HMAC-signed envelopes verified by firmware.
- **Log upload:** Firmware uploads decrypted SD logs to `/api/log-upload` every 2 minutes (small payload) and on `upload-logs` command.
- **Auth:** Requests signed with HMAC-SHA256 (method + path + timestamp + nonce + body hash). API keys auto-rotate every 7 days with 48h overlap window.
- **BG poll backoff:** On 3+ consecutive failures, poll interval is floored to 3 min; on 8+, floored to 5 min.
- **Daily auto-reboot:** At 3:00 AM local time, once per calendar day, after device has been up 10+ min.
- **Power button:** Single click → immediate config sync (DND wake). Hold once → arms factory reset; hold again within 10s → confirms factory reset.
- **Factory reset:** Clears all NVS except `workerUrl`, `deviceKey`, and `timezone` (cloud identity preserved so device can pull config again after WiFi re-setup).
- **First-flash bootstrap:** Worker URL and device key come from `secrets.h` macros (`BGDISPLAY_DEFAULT_WORKER_URL`, `BGDISPLAY_DEFAULT_DEVICE_KEY`). Copy `secrets.example.h` to `secrets.h` and fill in before flashing.
- **NVS encryption:** Chip ID acts as hardware root-of-trust. Same key used for SD logs (different salt).
- **Stack:** `ARDUINO_LOOP_STACK_SIZE=16384` in `platformio.ini` (prevents overflow crash).
- **Timezone support:** US/Central, US/Eastern, US/Mountain, US/Pacific (mapped to POSIX strings). NTP: NIST primary → public pool fallback.

### Cloudflare Worker (`cloudflare/src/worker.js`)

Single file handling all backend logic. Two KV namespaces:
- `BGDISPLAY_CONFIG`: config JSON, version counter, changelog (50 entries), device status, telemetry (720 points), SD logs, commands
- `BGDISPLAY_AUTH`: key hashes + recovery key hash, nonce cache, rate limit buckets, admin sessions, lockout state

**Device endpoints** (X-Device-Key + HMAC signature auth):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ping?v=N` | Lightweight version check |
| GET | `/api/config` | Full config pull + key rotation |
| POST | `/api/key-ack` | ACK key rotation |
| POST | `/api/status` | Push device telemetry |
| GET | `/api/command` | Poll for pending command |
| POST | `/api/command-ack` | ACK command execution |
| POST | `/api/log-upload` | Upload decrypted SD logs |

**Admin endpoints** (Cloudflare Access JWT + scoped session token):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/session` | Issue session token |
| GET | `/api/admin/config` | Fetch config + all metadata |
| POST | `/api/admin/config` | Save config, bump version |
| GET | `/api/admin/metrics` | Standalone telemetry metrics |
| GET | `/api/admin/maintenance` | Maintenance signals |
| POST | `/api/admin/command` | Queue device command |
| POST/DELETE | `/api/admin/recovery-key` | Set/clear recovery firmware key |
| GET | `/api/admin/logs/latest` | View/download uploaded SD logs |
| GET | `/api/admin/export` | Download config JSON |
| POST | `/api/admin/import` | Restore config |
| POST | `/api/admin/clear-log` | Wipe changelog |

**Recovery key:** A separate optional `bg_ro_*` key stored in auth KV. Accepted by firmware after a local flash wipe when the primary key is gone. Set via admin UI → Security section.

Security features: replay protection (nonce + ±5min timestamp), IP-based rate limiting (general + device-write + admin-write buckets), IP lockout, request deduplication (`X-Request-Id`).

`normalizeConfig()` strips retired MQTT fields (`mqtt_host`, `mqtt_user`, `mqtt_pass`, `config_ping_sec`) from old backups on load.

### Config UI (`pages/index.html`)

Single ~49KB HTML file — no build step. Dark mode only. `WORKER_URL` is hardcoded at the top of the `<script>` block and must be edited before deploying. Section open/closed state persists in `localStorage`. Render is fully string-template based — `render()` rebuilds the entire `#app` innerHTML each call. DND times are displayed and stored in 12-hour format in the UI, converted to 24-hour on save.

## Hardware

- **Device:** M5Stack Core2 V1.1 (ESP32-D0WDQ6-V3, 320×240 IPS touch, 390mAh battery)
- **Display:** 320×240 via M5Unified library (v0.2.4)
- **SD Card:** Installed in Core2 SD slot for encrypted log storage
- **Network:** WiFi only (cellular LTE via M5Stack SIM7600G module is planned but not purchased; `cellular_fallback` toggle is in config but not implemented in firmware)

## Setup Flow

1. Flash firmware (with `secrets.h` containing real worker URL + device key)
2. On first boot with no saved WiFi → AP mode (`BGDisplay-Setup-XXXX` network) — form only collects WiFi SSID + password
3. Device connects to WiFi → immediately pulls full config from `/api/config` (gets Nightscout/Dexcom credentials from cloud)
4. All future config changes via `https://setup.2brokeboys.uk` (Cloudflare Pages UI)

## Config Field Notes

Worker uses `snake_case` JSON keys. Firmware `pullCloudflareConfig()` accepts both `snake_case` and legacy `camelCase` variants for backward compatibility. `normalizeConfig()` in the worker fills defaults and validates ranges on every read/write.
