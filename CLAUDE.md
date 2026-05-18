# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BG MiniView is an ESP32-based medical blood glucose display built on the M5Stack Core2. It shows real-time Dexcom G7 readings sourced from Dexcom Share (primary) with Nightscout as fallback. The system has three components: Arduino firmware, a Cloudflare Worker backend, and a single-page config UI hosted on Cloudflare Pages.

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
`platformio.ini` at the workspace root sets `src_dir`, `build_dir`, and `libdeps_dir` — all pointing into `firmware/`. Run PlatformIO from the workspace root.

Flash requires USB-C connection to M5Stack Core2 at 1500000 baud. OTA is implemented via `ArduinoOTA` — hostname `bg-miniview-{last4-chip-id}.local`, password = device key.

`pio` is installed inside VS Code's PlatformIO extension. From a plain shell use the full path: `~/.platformio/penv/Scripts/pio.exe` (Windows).

### Cloudflare Worker & Pages
```bash
cd apps/cloudflare
npm run deploy:worker           # wrangler deploy (worker)
npm run deploy:pages            # wrangler pages deploy to Pages production branch (UI)
npm run deploy:all              # both in sequence
npm run lint                    # eslint src --max-warnings 0
npm run format                  # prettier --write src
npm run test:mcp                # MCP smoke test (metadata + tools/list)
npm run test:mcp:bg             # MCP smoke test + live get_current_bg
node --check src/worker.js      # syntax check (no validate script)
```

### UI (React + Vite)
```bash
cd apps/ui
npm run lint                    # eslint src --max-warnings 0
npm run format                  # prettier --write src
```

### Line endings
- Repository-level `.gitattributes` normalizes text files.
- Source/docs/config default to `LF`; PowerShell scripts (`*.ps1`) use `CRLF`.

### CI
GitHub Actions (`.github/workflows/ci.yml`) runs PlatformIO firmware build and worker syntax validation on push/PR to main.

### Security helper scripts
```bash
pwsh ./scripts/security/secret_guard.ps1
pwsh ./scripts/security/generate_bootstrap_key.ps1 -CopyToClipboard
pwsh ./scripts/security/install_git_hooks.ps1
```

### Archived Components
- NAS MCP automation lives under `archive/apps/nas-control-mcp/`.
- n8n JSON templates and n8n-as-code sync artifacts live under `archive/n8n/`.
- Retired Checkly monitoring scripts live under `archive/checkly/`.

## Architecture

### Firmware (`firmware/src/`)

Current firmware version: `4.1.1` (defined in `config.h`).

The main sketch is `bgdisplay.ino`. All modules are header-only files included by the sketch:

| File | Responsibility |
|------|---------------|
| `config.h` | `AppConfig` struct (~40 fields), NVS save/load with AES-128-CBC encryption for sensitive fields |
| `display.h` | Off-screen rendering via M5Canvas (double-buffering), dirty tracking, BG color coding, trend arrows, BG sparkline (24-pt history), battery meter, **Omnipod clinical thresholds** (severity-based color evaluation for reservoir 5U/15U/25U and expiry 1h/4h/8h) |
| `crypto.h` | AES-128-CBC via mbedTLS; key derived from unique ESP32 chip ID — stolen device = unreadable data |
| `nightscout.h` | Polls `/api/v1/entries.json`, extracts sgv + trend + timestamp |
| `dexcom.h` | Two-step Share API auth (email or phone), 4h session TTL, US/international regions |
| `glooko.h` | Pump data status fetch — supports multiple sources: Glooko (direct API), Tandem, Medtronic, Tidepool. Returns IOB, last bolus, pod change data. |
| `wifi_setup.h` | AP mode captive portal on 192.168.4.1 for first-boot WiFi setup only; generates WiFi QR code |
| `sd_logger.h` | Encrypted JSON log rotation at 100KB; uses same chip-derived key (different salt: `BGDisplay_SD_v1`) |
| `ota.h` | LAN OTA (`ArduinoOTA`) + Cloudflare OTA manifest/apply flow (`/api/ota/manifest` + signed download URL) |
| `ws_sync.h` | Persistent WSS client to `/api/ws` (Durable Object relay); any `config-changed` push triggers immediate `pullCloudflareConfig()` |

**NVS encrypted fields:** `deviceKey`, `wifiPass`, `nightscoutSecret`, `dexcomUser`, `dexcomPass`. All other fields stored plain. Salt: `BGDisplay_NVS_v1`.

**Key patterns:**
- **BG source priority:** Dexcom Share is tried first; Nightscout is the fallback. Both failing → display `---` and "STALE" banner after `staleDataWarnMin`.
- **Display:** All drawing to off-screen `M5Canvas` sprite, pushed atomically to avoid flicker. Redraws only on dirty data (BG value, trend, time, RSSI coarse, stale state, key error). Includes BG sparkline and battery % top-right.
- **Config sync:** WebSocket connection to `/api/ws` (Durable Object relay) is the primary push channel — on `config-changed` message the device immediately calls `pullCloudflareConfig()`. HTTPS ping fallback: 30s when WS is disconnected, `configPingMin` (capped 5 min) when WS is up.
- **Command poll:** Device polls `GET /api/command` every 60s for remote commands (`reboot`, `sync-now`, `upload-logs`, `factory-reset`, `ota-check`, `ota-apply`). Commands are HMAC-signed envelopes verified by firmware.
- **Log upload:** Firmware uploads decrypted SD logs to `/api/log-upload` every 2 minutes (small payload) and on `upload-logs` command.
- **Auth:** Requests signed with HMAC-SHA256 (method + path + timestamp + nonce + body hash). API keys auto-rotate every 7 days with 48h overlap window.
- **BG poll backoff:** On 3+ consecutive failures, poll interval is floored to 3 min; on 8+, floored to 5 min.
- **Pump data poll:** Optional multi-source pump sync (Glooko, Tandem, Medtronic, Tidepool) every 30+ minutes (`glooko_poll_min`, clamped to 30-240). Fetches IOB, last bolus, reservoir, pod expiry (if available).
- **Credential handling:** Glooko endpoint/token are stored in cloud config and never sent to firmware `/api/config` payloads.
- **Daily auto-reboot:** At 3:00 AM local time, once per calendar day, after device has been up 10+ min.
- **Power button:** Single click → immediate config sync (DND wake). Hold once → arms factory reset; hold again within 10s → confirms factory reset.
- **Factory reset:** Clears all NVS except `workerUrl`, `deviceKey`, and `timezone` (cloud identity preserved so device can pull config again after WiFi re-setup). **Factory reset does NOT trigger re-enrollment** because `deviceKey` is preserved — see NVS erase procedure in the Infisical section to force re-enrollment.
- **First-flash bootstrap:** `secrets.h` is generated from Infisical via `firmware/scripts/firmware_secrets_sync.ps1` — do not edit by hand. Macros: `BGDISPLAY_DEFAULT_WORKER_URL`, `BGDISPLAY_DEFAULT_DEVICE_KEY`, `BGDISPLAY_DEFAULT_TIMEZONE`. After WiFi connect, `enrollDevice()` in `bgdisplay.ino` calls `POST /api/enroll` only if the NVS key equals the bootstrap key — on success the device saves a unique per-chip key to NVS and uses it for all subsequent requests.
- **NVS encryption:** Chip ID acts as hardware root-of-trust. Same key used for SD logs (different salt).
- **Stack:** `ARDUINO_LOOP_STACK_SIZE=16384` in root `platformio.ini` (prevents overflow crash).
- **Timezone support:** US/Central, US/Eastern, US/Mountain, US/Pacific (mapped to POSIX strings). NTP: NIST primary → public pool fallback.
- **AI Daily & Hourly Digests:** Generated on Worker via Cloudflare Workers AI; pushed to Pushover only (device display removed in v4.0.1-S). See **AI Architecture** section below.
- **WebSocket reconnect:** `ws_sync.h` uses 8 s reconnect interval. WS event handler is flag-only (sets `_wsTriggerPull`); the actual config pull happens in `wsTick()` after `_wsClient.loop()` returns to avoid re-entrancy.

### Cloudflare Worker (`apps/cloudflare/src/worker.js`)

Current worker version: `3.0.0` (set in `wrangler.toml` `WORKER_VERSION` var).

Single file handling all backend logic. Two KV namespaces:
- `BGDISPLAY_CONFIG`: config JSON, version counter, changelog (50 entries), device status, telemetry (720 points), SD logs, commands, `daily_digest`, `pushover_creds`, `last_pushover_alert`
- `BGDISPLAY_AUTH`: key hashes + recovery key hash, nonce cache, rate limit buckets, admin sessions, lockout state, device registry (`device_registry:<chipId>` keys)

**Bindings:**
- `CONFIG_SYNC` — Durable Object (`ConfigSyncRelay`) for WebSocket relay; one instance per device
- `AI` — Workers AI binding (used by `generateDailyDigest()` and `generateHourlyDigest()`)
- `FIRMWARE_BUCKET` — Cloudflare R2 bucket for firmware artifacts consumed by OTA signed downloads
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
| POST | `/api/enroll` | Device self-enrollment — device sends chipId + key, worker generates unique key per chip |
| GET | `/api/ping?v=N` | Lightweight version check |
| GET | `/api/config` | Full config pull + key rotation |
| POST | `/api/key-ack` | ACK key rotation |
| POST | `/api/status` | Push device telemetry |
| GET | `/api/command` | Poll for pending command |
| POST | `/api/command-ack` | ACK command execution |
| POST | `/api/log-upload` | Upload decrypted SD logs |
| GET | `/api/digest` | Fetch today's AI digest text (204 = none yet) |
| GET | `/api/omnipod` | Fetch proxied Omnipod status from Worker-side Glooko integration |
| GET | `/api/ota/manifest` | OTA release discovery (signed device auth) |
| GET | `/api/ota/download/:channel/:version` | Signed short-lived firmware download URL target |

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
| GET | `/api/admin/logs/latest` | View/download uploaded SD logs (`?download=1&session=TOKEN` for browser download) |
| GET | `/api/admin/export` | Download config JSON |
| POST | `/api/admin/import` | Restore config |
| POST | `/api/admin/clear-log` | Wipe changelog |
| GET | `/api/admin/digest` | View today's cached AI digest |
| GET | `/api/admin/devices` | List enrolled devices (chipId, keyTail, enrolledAt, lastSeen, hasPerDeviceConfig) |
| DELETE | `/api/admin/devices/:chipId` | Revoke device enrollment; restores previous key hash so device can re-enroll |
| GET | `/api/admin/device-config/:chipId` | Per-device config overrides |
| POST | `/api/admin/device-config/:chipId` | Set per-device config overrides (empty object = delete overrides) |
| GET/POST/DELETE | `/api/admin/ota` | Read/prepare/clear OTA release metadata |

**MCP endpoint** (JSON-RPC 2.0, device-key auth):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/mcp` | MCP server — tool calls for BG data, config read, digest |

**Cron triggers** (defined in `wrangler.toml`):
- `0 12,13 * * *` — `generateDailyDigest(env, false, "daily")`: generates daily AI summary via configured `ai_model` (default `@cf/meta/llama-3.1-8b-instruct`; currently using `@cf/meta/llama-3.3-70b-instruct-fp8-fast` in deployed config) using last 24h of Nightscout readings at 7:00 AM US/Central. Guard prevents double-run per calendar day. Stores in KV key `daily_digest`. Pushes to Pushover at configured hour if enabled.
- `0 14-23 * * *` + `0 0-5 * * *` — `generateDailyDigest(env, false, "hourly")`: generates hourly summaries (1-hour window) every hour 8 AM–11 PM US/Central. Stored per-hour in KV keys like `hourly_digest_14`. Pushes to Pushover if digest push enabled. Uses shorter AI prompts (1-2 sentences, 120 token limit).
- `*/5 * * * *` — `runPushoverAlertCheck()` + `sendDigestPushover()`: checks critical BG thresholds and sends Pushover notifications; also handles daily/hourly digest Pushover pushes on schedule.

**Durable Object — `ConfigSyncRelay`:** Holds WebSocket connections for the device. When admin saves config (version bump), the worker broadcasts a `{"type":"config-changed","version":N}` message to all connected sockets, triggering an immediate device pull.

**Recovery key:** A separate optional `bg_ro_*` key stored in auth KV. Accepted by firmware after a local flash wipe when the primary key is gone. Set via admin UI → Security section.

Security features: replay protection (nonce + ±5min timestamp), IP-based rate limiting (general + device-write + admin-write buckets), IP lockout, request deduplication (`X-Request-Id`). Pushover API credentials never returned in API responses (redacted in `redactConfig()`).

`normalizeConfig()` strips retired MQTT fields (`mqtt_host`, `mqtt_user`, `mqtt_pass`, `config_ping_sec`) from old backups on load.

### AI Architecture (Workers AI Integration)

**Overview:** BG MiniView uses Cloudflare Workers AI to generate contextual glucose summary text via a configurable model (`ai_model` in config). Digests are generated on a cron schedule and delivered to the user via Pushover notifications (no device display). The system supports both daily summaries (24-hour window) and hourly summaries (rolling 1-hour window).

**AI Model & Configuration:**
- **Model:** Configurable via `ai_model`; code default is `@cf/meta/llama-3.1-8b-instruct`, and current deployed value is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- **Temperature:** 0.7 (balanced creativity/consistency)
- **Token limits:** Daily 280 tokens (≈180 words), Hourly 120 tokens (≈80 words)
- **Binding:** `AI` (configured in `wrangler.toml` and `wrangler.toml` environment bindings)

**Digest Input Data:**
Each digest is generated from Nightscout glucose readings and computed statistics:
- **Daily digest:** 288 readings (24 hours at 5-min intervals) — TIR %, reading count, min/max/avg, lows/highs above/below configured thresholds (default: low=70, high=180, urgent_low=55, urgent_high=250), overnight patterns
- **Hourly digest:** 12 readings (1 hour at 5-min intervals) — rolling window stats, immediate BG status, trend direction
- **Pump context:** When multi-source pump data enabled (Glooko/Tandem/Medtronic/Tidepool), prompt includes insulin pump type, brand, model, and loop mode (e.g., "Control-IQ" vs "manual") to tailor advice

**Prompt Engineering:**

*Daily digest system prompt:*
```
You are a concise diabetes health assistant for a Type 2 diabetic using a Dexcom G7 CGM. Write a morning summary of the past 24 hours in 3-4 sentences (under 180 words). Cover: time in range, notable lows or highs, overnight pattern, and one brief actionable observation. Adapt guidance to insulin delivery context (pump/no pump and loop mode when provided). If no pump is used, do not mention pump actions. No greeting or closing. Plain text only.
```

*Hourly digest system prompt:*
```
You are a concise diabetes health assistant for a Type 2 diabetic using a Dexcom G7 CGM. Write a brief summary of the past hour in 1-2 sentences (under 80 words). Cover: current status (in range or trend), any notable excursions. Plain text only.
```

Each prompt is paired with a user message containing:
- Computed statistics (reading count, TIR, lows, highs, urgent events, min/max/avg)
- Recent glucose values (12 most recent readings, newest first)
- Pump profile JSON (type, brand, model, loop mode, notes)

**Cron Schedule:**
- **Daily digest:** Cron `45 12,13 * * *` (runs at **7:45 AM US/Central** every morning, accounting for UTC+6 offset)
  - Guard: Only generates once per calendar day; bypass with `force=true` flag
  - Stores in KV key `daily_digest` as JSON: `{ text, generatedAt, date, type: "daily", stats: { tir, min, max, avg, readingCount } }`
  - Fallback: If no Nightscout URL configured or fetch fails, stores placeholder text

- **Hourly digest:** Cron `0 12-23 * * *` + `0 0-2 * * *` (runs at top of each hour from **8 AM–10 PM US/Central**)
  - Covers daytime/evening window when user most active
  - Guard: Only generates once per calendar hour
  - Stores in KV key `hourly_digest_HH` (e.g., `hourly_digest_14` for 2 PM) as JSON: `{ text, generatedAt, date, type: "hourly", stats: { ... } }`
  - Fallback: Same placeholder logic as daily

**Failure Handling:**
- If Workers AI binding not configured → digest text = `"AI digest unavailable — Workers AI binding not configured."`
- If Nightscout fetch fails or returns no readings → digest text = `"No readings available for digest."`
- If AI request throws exception → digest text = `"AI error: [first 120 chars of error]"`
- All errors are logged to worker stdout (CloudFlare Dashboard Logs)

**Pushover Integration:**
- **Feature:** `sendDigestPushover()` cron trigger (every 5 minutes: `*/5 * * * *`) checks for new digests and sends via Pushover
- **Daily push:** Sent once per calendar day at configurable hour (default 8 AM, config field `digest_pushover_hour`, range 0–23)
  - Title: `"BG MiniView — Daily Summary"`
  - Priority: 0 (normal — informational, not urgent)
  - Respects DND window: No push if DND active
  - Guard: Tracked via KV key `last_digest_pushover` (value = date string) to prevent duplicate sends

- **Hourly push:** Sent during active hours (8 AM–10 PM local time) if enabled and DND not active
  - Title: `"BG MiniView — Hourly Update"`
  - Priority: 0 (normal)
  - Uses `digest_pushover_enabled` config flag
  - Guard: Tracked per-hour to prevent duplicates

**KV Storage:**
- Namespace: `BGDISPLAY_CONFIG`
- Keys:
  - `daily_digest` — Latest daily summary (overwritten once per calendar day)
  - `hourly_digest_HH` — Hourly summaries (12 keys for hours 12–23 and 0–1, each overwritten once per hour)
- Schema: `{ text: string, generatedAt: number (ms since epoch), date: string (YYYY-MM-DD), type: "daily"|"hourly", stats?: { tir, min, max, avg, readingCount } }`
- Retrieval: Device calls `GET /api/digest` to fetch today's `daily_digest`; admin UI views via `/api/admin/digest`

**API Endpoints:**
- `GET /api/digest` — Returns today's cached daily digest or `{ date, text: "" }` if not generated (device polls on boot; no longer displays on-screen in v4.0.1-S)
- `GET /api/admin/digest` — Admin UI endpoint; returns full digest object including timestamp and stats
- `POST /api/admin/config` with `force_digest_generation: true` — Triggers immediate digest generation (bypasses daily/hourly guard)

**Admin UI Integration (`apps/ui/`):**
- **"EndoAI" section:** Shows today's cached digest text, generation timestamp, reading stats (TIR, min/max/avg)
- **Manual generation:** "Generate Now" button calls `/api/admin/config` with force flag
- **Pushover controls:** Toggles for daily/hourly push, time selector for daily push hour, display of configured Pushover user key (masked)
- **Display note:** "Digests are sent via Pushover only; device display removed in v4.0.1-S"

**Version History:**
- **v4.0.1-S (current):** Removed device morning digest display; digests now Pushover-only
- **v4.0.1 and earlier:** Digests displayed on device for 10 seconds at boot

### Config UI (`apps/ui/`)

React + Vite + Tailwind app. Build: `npm run deploy:pages` from `apps/cloudflare/` (builds `apps/ui/`, deploys to Cloudflare Pages). Dark mode only, Inter font. Fixed sidebar navigation on desktop (≥900px), horizontal scroll tabs on mobile. `WORKER_URL` is set via `apps/ui/src/constants.js`.

**Layout:** Sidebar nav → main content with anchor sections. IntersectionObserver tracks the active section for sidebar highlighting. Advanced settings in a slide-in drawer (opened from sidebar).

**Main sections** (sidebar nav): Network (WiFi), Glucose sources (Nightscout + Dexcom), Targets & alerts, Display & schedule, Notifications (Pushover + EndoAI digest), Insulin profile (pump info).

**Advanced drawer sections:** Device actions (sync, pull SD logs, reboot, factory reset), Worker alert tuning, Diagnostics, Cloud insights, Security (key rotation, rate limiting, recovery key, changelog), **Enrolled devices** (device registry — shows chip IDs, online status, enrollment date, revoke button), Backup & restore, System status.

**SD log download:** "Device actions" card → "Latest SD log upload" → Download button opens `GET /api/admin/logs/latest?download=1&session=TOKEN` in a new tab (worker accepts session via query param for this endpoint only).

DND times displayed and stored in 12-hour format in the UI, converted to 24-hour on save. Production UI is `apps/ui/`; `apps/pages/` is retained only as an archive snapshot.

### Scripts (`firmware/scripts/`)

| Script | Purpose |
|--------|---------|
| `secure_provision.ps1` | ESP32 hardware security provisioning — burns flash encryption key + secure boot V1 key into eFuses, disables JTAG/download-mode decrypt. Dry-run by default; requires `-Apply` flag to make irreversible changes. Keys stored in `~/.bgdisplay-keys/`. **One-time operation per device — cannot be undone.** |
| `firmware_secrets_sync.ps1` | Generates `firmware/src/secrets.h` from Infisical or explicit parameters. Pass `-InfisicalProjectId` + `-InfisicalEnv` to pull from Infisical; pass `-SkipInfisical` with explicit `-DeviceBootstrapKey`/`-WorkerUrl`/`-Timezone` to bypass. Throws if `DeviceBootstrapKey` or `WorkerUrl` are missing. |
| `provision_device.ps1` | End-to-end device provisioning: (1) eFuse read, (2) optional fuse burn, (3) chip ID detection via esptool MAC read, (4) secrets.h sync, (5) PlatformIO build, (6) flash, (7) worker verify. Use `-SkipSecretsSync` when `secrets.h` is already current. Pass `-UseInfisical -InfisicalProjectId <id>` to pull secrets from Infisical during sync. **Must be saved as ASCII** — Unicode chars (em-dashes, box-drawing) in PS 5.1 cause CP1252 mis-decoding that prematurely closes string literals. |

**Enrollment flow (automatic on first WiFi connect):**
After flashing, the device calls `POST /api/enroll` (with its chip ID and bootstrap device key) during `enrollDevice()` in `bgdisplay.ino` — **only if the key currently in NVS equals `BGDISPLAY_DEFAULT_DEVICE_KEY`**. The worker validates against the stored recovery key hash, generates a unique per-chip key, stores it in `BGDISPLAY_AUTH` under `device_registry:<chipId>`, and returns the new key. The firmware saves it to NVS. Verify enrollment in the admin UI → Advanced tools → Enrolled devices.

**Force re-enrollment after reflash (NVS erase):** Reflashing does not erase NVS. If NVS already has a per-chip key, the device skips enrollment. To reset: erase the NVS partition with esptool, then also revoke the old registry entry in admin UI before the device connects — the worker returns 409 if a registry entry exists with a non-matching key hash.
```powershell
$py = "$env:USERPROFILE\.platformio\penv\Scripts\python.exe"
$es = "$env:USERPROFILE\.platformio\packages\tool-esptoolpy\esptool.py"
& $py $es --chip esp32 --port COM6 erase_region 0x9000 0x7000
```

## Hardware

- **Device:** M5Stack Core2 V1.1 (ESP32-D0WDQ6-V3, 320×240 IPS touch, 390mAh battery)
- **Display:** 320×240 via M5Unified library (v0.2.4)
- **SD Card:** Installed in Core2 SD slot for encrypted log storage
- **Network:** WiFi only (cellular LTE via M5Stack SIM7600G module is planned but not purchased; `cellular_fallback` toggle is in config but not implemented in firmware)

## Setup Flow

1. Set Worker secrets: `wrangler secret put KV_ENCRYPT_KEY` (required for Pushover creds encryption)
2. Deploy worker: `npm run deploy:worker` (creates Durable Object class on first deploy via migration tag `v1`)
3. Sync `secrets.h` from Infisical (or your secret source): `firmware/scripts/firmware_secrets_sync.ps1 -InfisicalProjectId <project-id> -InfisicalEnv <env>`
4. Flash firmware: `firmware/scripts/provision_device.ps1 -Port COM6 -SkipSecretsSync -WorkerUrl <url>`. Script detects chip ID, builds, flashes, and verifies.
5. On first boot with no saved WiFi → AP mode (`BG_MiniView_XXXX` network) — form only collects WiFi SSID + password
6. Device connects to WiFi → calls `POST /api/enroll` with its chip ID + bootstrap key → receives unique per-chip key → saves to NVS
7. Device pulls full config from `/api/config`, opens WebSocket to `/api/ws`, fetches AI digest from `/api/digest`
8. Verify enrollment in admin UI → Advanced tools → Enrolled devices (shows chip ID, online status, enrollment date)
9. All future config changes via your Cloudflare Pages UI domain — config saves trigger instant WS push to device

## Secrets Management — Infisical

Use a secrets manager (Infisical recommended) and keep environment-specific values outside git.

Minimum keys required for provisioning/deploy flows:

| Key | Description |
|-----|-------------|
| `BGDISPLAY_DEFAULT_DEVICE_KEY` | Bootstrap/recovery key used during first enrollment |
| `BGDISPLAY_DEFAULT_TIMEZONE` | Firmware bootstrap timezone |
| `WORKER_URL` | Cloudflare Worker base URL |
| `CLOUDFLARE_API_TOKEN` | Cloudflare deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
| `NIGHTSCOUT_URL` | Nightscout endpoint (optional) |
| `NIGHTSCOUT_API_TOKEN` | Nightscout token (optional) |

Example secret sync commands (replace placeholders):

```powershell
firmware/scripts/firmware_secrets_sync.ps1 -InfisicalProjectId <project-id> -InfisicalEnv <env>
```

```powershell
.\project_infisical_ops.ps1 -DeployWorker -SyncFirmwareSecrets -InfisicalProjectId <project-id>
# Available actions: -DeployWorker -DeployPages -SyncFirmwareSecrets -SyncDeviceConfig -BuildFirmware
```

Bootstrap key format: `bg_ro_` + 32 lowercase alphanumeric chars. Keep it private and rotate according to your incident response policy.

**Force re-enrollment after reflash (NVS erase):**

Factory reset preserves `deviceKey` in NVS — it will **not** trigger re-enrollment. To force the device to use the bootstrap key from `secrets.h`:
```powershell
$py = "$env:USERPROFILE\.platformio\penv\Scripts\python.exe"
$es = "$env:USERPROFILE\.platformio\packages\tool-esptoolpy\esptool.py"
& $py $es --chip esp32 --port COM6 erase_region 0x9000 0x7000
```
Revoke the old registry entry in admin UI first — the worker returns 409 if an entry exists with a non-matching key hash.

**Troubleshooting:**
- **"INFISICAL_TOKEN not set":** `[Environment]::SetEnvironmentVariable("INFISICAL_TOKEN", "st_...", "User")`
- **"Infisical CLI not found":** `npm install -g @infisical/cli`
- **Service token can't delete secrets:** Delete manually from Infisical UI — service tokens have create/update but not delete permissions
- **Device not enrolling after reflash:** NVS still has old key — erase NVS partition and revoke old registry entry in admin UI

## Config Field Notes

Worker uses `snake_case` JSON keys. Firmware `pullCloudflareConfig()` accepts both `snake_case` and legacy `camelCase` variants for backward compatibility. `normalizeConfig()` in the worker fills defaults and validates ranges on every read/write.

