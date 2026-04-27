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
pio run                         # compile (from workspace root)
pio run -t upload               # compile + flash via USB
pio device monitor              # serial monitor
```
`platformio.ini` at the workspace root sets `src_dir`, `build_dir`, and `libdeps_dir` — all pointing into `firmware/bgdisplay/`. Run PlatformIO from the workspace root; do **not** `cd firmware/bgdisplay` first (the nested `platformio.ini` there is the original and can still be used with `-d firmware/bgdisplay` if needed).

Flash requires USB-C connection to M5Stack Core2 at 1500000 baud. OTA is implemented via `ArduinoOTA` — hostname `bgdisplay-{last4-chip-id}.local`, password = device key.

`pio` is installed inside VS Code's PlatformIO extension. From a plain shell use the full path: `~/.platformio/penv/Scripts/pio.exe` (Windows).

### Cloudflare Worker & Pages
```bash
cd apps/cloudflare
npm run deploy:worker           # wrangler deploy (worker)
npm run deploy:pages            # wrangler pages deploy to Pages production branch (UI)
npm run deploy:all              # both in sequence
npm run test:mcp                # MCP smoke test (metadata + tools/list)
npm run test:mcp:bg             # MCP smoke test + live get_current_bg
node --check src/worker.js      # syntax check (no validate script)
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
| `display.h` | Off-screen rendering via M5Canvas (double-buffering), dirty tracking, BG color coding, trend arrows, BG sparkline (24-pt history), battery meter, AI digest screen (`showDigestScreen`), **Omnipod clinical thresholds** (severity-based color evaluation for reservoir 5U/15U/25U and expiry 1h/4h/8h) |
| `crypto.h` | AES-128-CBC via mbedTLS; key derived from unique ESP32 chip ID — stolen device = unreadable data |
| `nightscout.h` | Polls `/api/v1/entries.json`, extracts sgv + trend + timestamp |
| `dexcom.h` | Two-step Share API auth (email or phone), 4h session TTL, US/international regions |
| `glooko.h` | Pump data status fetch — supports multiple sources: Glooko (direct API), Tandem, Medtronic, Tidepool. Returns IOB, last bolus, pod change data. |
| `wifi_setup.h` | AP mode captive portal on 192.168.4.1 for first-boot WiFi setup only; generates WiFi QR code |
| `sd_logger.h` | Encrypted JSON log rotation at 100KB; uses same chip-derived key (different salt: `BGDisplay_SD_v1`) |
| `ota.h` | `ArduinoOTA` — active when `ENABLE_OTA=1` (default) |
| `ws_sync.h` | Persistent WSS client to `/api/ws` (Durable Object relay); any `config-changed` push triggers immediate `pullCloudflareConfig()` |

**NVS encrypted fields:** `deviceKey`, `wifiPass`, `nightscoutSecret`, `dexcomUser`, `dexcomPass`. All other fields stored plain. Salt: `BGDisplay_NVS_v1`.

**Key patterns:**
- **BG source priority:** Dexcom Share is tried first; Nightscout is the fallback. Both failing → display `---` and "STALE" banner after `staleDataWarnMin`.
- **Display:** All drawing to off-screen `M5Canvas` sprite, pushed atomically to avoid flicker. Redraws only on dirty data (BG value, trend, time, RSSI coarse, stale state, key error). Includes BG sparkline and battery % top-right.
- **Config sync:** WebSocket connection to `/api/ws` (Durable Object relay) is the primary push channel — on `config-changed` message the device immediately calls `pullCloudflareConfig()`. HTTPS ping fallback: 30s when WS is disconnected, `configPingMin` (capped 5 min) when WS is up.
- **Command poll:** Device polls `GET /api/command` every 60s for remote commands (`reboot`, `sync-now`, `upload-logs`, `factory-reset`). Commands are HMAC-signed envelopes verified by firmware.
- **Log upload:** Firmware uploads decrypted SD logs to `/api/log-upload` every 2 minutes (small payload) and on `upload-logs` command.
- **Auth:** Requests signed with HMAC-SHA256 (method + path + timestamp + nonce + body hash). API keys auto-rotate every 7 days with 48h overlap window.
- **BG poll backoff:** On 3+ consecutive failures, poll interval is floored to 3 min; on 8+, floored to 5 min.
- **Pump data poll:** Optional multi-source pump sync (Glooko, Tandem, Medtronic, Tidepool) every 30+ minutes (`glooko_poll_min`, clamped to 30-240). Fetches IOB, last bolus, reservoir, pod expiry (if available).
- **Credential handling:** Glooko endpoint/token are stored in cloud config and never sent to firmware `/api/config` payloads.
- **Daily auto-reboot:** At 3:00 AM local time, once per calendar day, after device has been up 10+ min.
- **Power button:** Single click → immediate config sync (DND wake). Hold once → arms factory reset; hold again within 10s → confirms factory reset.
- **Factory reset:** Clears all NVS except `workerUrl`, `deviceKey`, and `timezone` (cloud identity preserved so device can pull config again after WiFi re-setup).
- **First-flash bootstrap:** Worker URL and device key come from `secrets.h` macros (`BGDISPLAY_DEFAULT_WORKER_URL`, `BGDISPLAY_DEFAULT_DEVICE_KEY`). Copy `secrets.example.h` to `secrets.h` and fill in before flashing.
- **NVS encryption:** Chip ID acts as hardware root-of-trust. Same key used for SD logs (different salt).
- **Stack:** `ARDUINO_LOOP_STACK_SIZE=16384` in root `platformio.ini` (prevents overflow crash).
- **Timezone support:** US/Central, US/Eastern, US/Mountain, US/Pacific (mapped to POSIX strings). NTP: NIST primary → public pool fallback.
- **AI Daily Digest:** On boot (after WiFi + config), firmware calls `GET /api/digest`. If a digest is available, `showDigestScreen()` displays it for 10 s. Bottom-left tap (x<160, y>170) on the main screen replays the digest. Global `gDigestText[1024]` holds it in memory.
- **WebSocket reconnect:** `ws_sync.h` uses 8 s reconnect interval. WS event handler is flag-only (sets `_wsTriggerPull`); the actual config pull happens in `wsTick()` after `_wsClient.loop()` returns to avoid re-entrancy.

### Cloudflare Worker (`apps/cloudflare/src/worker.js`)

Current worker version: `3.0.0` (set in `wrangler.toml` `WORKER_VERSION` var).

Single file handling all backend logic. Two KV namespaces:
- `BGDISPLAY_CONFIG`: config JSON, version counter, changelog (50 entries), device status, telemetry (720 points), SD logs, commands, `daily_digest`, `pushover_creds`, `last_pushover_alert`
- `BGDISPLAY_AUTH`: key hashes + recovery key hash, nonce cache, rate limit buckets, admin sessions, lockout state

**Bindings:**
- `CONFIG_SYNC` — Durable Object (`ConfigSyncRelay`) for WebSocket relay; one instance per device
- `AI` — Workers AI binding (used by `generateDailyDigest()` and `generateHourlyDigest()`)
- `KV_ENCRYPT_KEY` — Worker secret (set via `wrangler secret put`); AES-256-GCM key for encrypting Pushover credentials in KV. If unset, Pushover credentials cannot be stored.

**Pump Provider Modules** (`apps/cloudflare/src/providers/`):
- `glooko.js` — Glooko API integration; direct pump data fetch (IOB, last bolus, pod change)
- `tandem.js` — Tandem t:slim / Control-IQ API integration for pump data
- `medtronic.js` — Medtronic CareLink API integration for MiniMed pump data
- `tidepool.js` — Tidepool API integration for multi-device pump data fetch
All adapters follow a common interface: authenticate, fetch latest pump data, return standardized `{insulin_on_board, last_bolus_units, last_bolus_timestamp, pod_change_timestamp, ...}` object.

**Device endpoints** (X-Device-Key + HMAC signature auth):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/ws` | WebSocket upgrade → Durable Object relay |
| GET | `/api/ping?v=N` | Lightweight version check |
| GET | `/api/config` | Full config pull + key rotation |
| POST | `/api/key-ack` | ACK key rotation |
| POST | `/api/status` | Push device telemetry |
| GET | `/api/command` | Poll for pending command |
| POST | `/api/command-ack` | ACK command execution |
| POST | `/api/log-upload` | Upload decrypted SD logs |
| GET | `/api/digest` | Fetch today's AI digest text (204 = none yet) |
| GET | `/api/omnipod` | Fetch proxied Omnipod status from Worker-side Glooko integration |

**Admin endpoints** (Cloudflare Access JWT + scoped session token):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/admin/session` | Issue session token |
| GET | `/api/admin/config` | Fetch config + all metadata (includes `digest`, `pushoverConfigured`) |
| POST | `/api/admin/config` | Save config, bump version; Pushover creds stored separately encrypted |
| GET | `/api/admin/metrics` | Standalone telemetry metrics |
| GET | `/api/admin/maintenance` | Maintenance signals |
| POST | `/api/admin/command` | Queue device command |
| POST/DELETE | `/api/admin/recovery-key` | Set/clear recovery firmware key |
| GET | `/api/admin/logs/latest` | View/download uploaded SD logs |
| GET | `/api/admin/export` | Download config JSON |
| POST | `/api/admin/import` | Restore config |
| POST | `/api/admin/clear-log` | Wipe changelog |
| GET | `/api/admin/digest` | View today's cached AI digest |

**MCP endpoint** (JSON-RPC 2.0, device-key auth):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/mcp` | MCP server — tool calls for BG data, config read, digest |

**Cron triggers** (defined in `wrangler.toml`):
- `45 12,13 * * *` — `generateDailyDigest(env, false, "daily")`: generates daily AI summary via `@cf/meta/llama-3.1-8b-instruct` using last 24h of Nightscout readings at 7:45 AM US/Central. Guard prevents double-run per calendar day. Stores in KV key `daily_digest`. Pushes to Pushover at configured hour if enabled.
- `0 14-23 * * *` + `0 0-5 * * *` — `generateDailyDigest(env, false, "hourly")`: generates hourly summaries (1-hour window) every hour 8 AM–11 PM US/Central. Stored per-hour in KV keys like `hourly_digest_14`. Pushes to Pushover if digest push enabled. Uses shorter AI prompts (1-2 sentences, 120 token limit).
- `*/5 * * * *` — `runPushoverAlertCheck()` + `sendDigestPushover()`: checks critical BG thresholds and sends Pushover notifications; also handles daily/hourly digest Pushover pushes on schedule.

**Durable Object — `ConfigSyncRelay`:** Holds WebSocket connections for the device. When admin saves config (version bump), the worker broadcasts a `{"type":"config-changed","version":N}` message to all connected sockets, triggering an immediate device pull.

**Recovery key:** A separate optional `bg_ro_*` key stored in auth KV. Accepted by firmware after a local flash wipe when the primary key is gone. Set via admin UI → Security section.

Security features: replay protection (nonce + ±5min timestamp), IP-based rate limiting (general + device-write + admin-write buckets), IP lockout, request deduplication (`X-Request-Id`). Pushover API credentials never returned in API responses (redacted in `redactConfig()`).

`normalizeConfig()` strips retired MQTT fields (`mqtt_host`, `mqtt_user`, `mqtt_pass`, `config_ping_sec`) from old backups on load.

### Config UI (`apps/pages/index.html`)

Single HTML file — no build step. Dark mode only. `WORKER_URL` is hardcoded at the top of the `<script>` block and must be edited before deploying. Section open/closed state persists in `localStorage`. Render is fully string-template based — `render()` rebuilds the entire `#app` innerHTML each call. DND times are displayed and stored in 12-hour format in the UI, converted to 24-hour on save.

**Sections:** Display, BG Sources (Nightscout + Dexcom), Alerts/DND, **Pushover alerts** (enable toggle, user key, API token, cooldown — creds sent to worker separately, not stored in config JSON), **EndoAI** (shows today's AI-generated glucose summary text, generation button, model info, schedule details, Pushover push controls with time selector), Security, Advanced. **Top controls:** Global "Expand all" and "Collapse all" buttons for quick section navigation (state persisted in localStorage).

### Scripts (`firmware/bgdisplay/scripts/`)

| Script | Purpose |
|--------|---------|
| `secure_provision.ps1` | ESP32 hardware security provisioning — burns flash encryption key + secure boot V1 key into eFuses, disables JTAG/download-mode decrypt. Dry-run by default; requires `-Apply` flag to make irreversible changes. Keys stored in `~/.bgdisplay-keys/`. **One-time operation per device — cannot be undone.** |

## Hardware

- **Device:** M5Stack Core2 V1.1 (ESP32-D0WDQ6-V3, 320×240 IPS touch, 390mAh battery)
- **Display:** 320×240 via M5Unified library (v0.2.4)
- **SD Card:** Installed in Core2 SD slot for encrypted log storage
- **Network:** WiFi only (cellular LTE via M5Stack SIM7600G module is planned but not purchased; `cellular_fallback` toggle is in config but not implemented in firmware)

## Setup Flow

1. Set Worker secrets: `wrangler secret put KV_ENCRYPT_KEY` (required for Pushover creds encryption)
2. Deploy worker: `npm run deploy:worker` (creates Durable Object class on first deploy via migration tag `v1`)
3. Flash firmware (with `secrets.h` containing real worker URL + device key)
4. On first boot with no saved WiFi → AP mode (`BGDisplay-Setup-XXXX` network) — form only collects WiFi SSID + password
5. Device connects to WiFi → immediately pulls full config from `/api/config`, opens WebSocket to `/api/ws`, fetches AI digest from `/api/digest`
6. All future config changes via `https://setup.2brokeboys.uk` (Cloudflare Pages UI) — config saves trigger instant WS push to device

## Config Field Notes

Worker uses `snake_case` JSON keys. Firmware `pullCloudflareConfig()` accepts both `snake_case` and legacy `camelCase` variants for backward compatibility. `normalizeConfig()` in the worker fills defaults and validates ranges on every read/write.
