# BGDisplay Context Snapshot

Last updated: 2026-04-26

This file is a concise operational snapshot for fast onboarding.

## What It Is

BGDisplay is an M5Stack Core2 bedside/desk glucose display.

- Primary source: Dexcom Share
- Fallback source: Nightscout
- Cloud backend: Cloudflare Worker + KV + Durable Object WebSocket relay
- Setup/admin UI: single-page Cloudflare Pages app

## Current Versions

| Component | Version |
|---|---|
| Firmware | 3.0.0-S |
| Worker | 3.0.0 |
| UI | Single-file runtime UI (no explicit semver in file) |

## Live Architecture

```text
Dexcom Share (primary)  --->
                          M5Stack Core2 firmware ---> signed HTTPS ---> Cloudflare Worker ---> KV
Nightscout (fallback) --->                            \              \
                                                       \              --> Durable Object WS relay
                                                        \
                                                         --> Cloudflare Pages UI (admin/config)
```

## Key Behaviors

- Device tries Dexcom first, then Nightscout on failure.
- Config saves from UI trigger immediate WebSocket push (`config-changed`) to the device.
- Device still performs HTTPS ping fallback when WebSocket is unavailable.
- Sensitive values in NVS are AES-encrypted using a chip-derived key.
- HMAC signed requests are required for device API operations.
- API keys rotate on a 7-day schedule with overlap support.
- Daily AI digest is generated on Worker cron and fetched by device.
- Optional Pushover alerting and digest push are supported.

## Important Paths

- Firmware: `firmware/bgdisplay/src/`
- Worker: `apps/cloudflare/src/worker.js`
- Worker config: `apps/cloudflare/wrangler.toml`
- UI: `apps/pages/index.html`

## Notes

- MQTT is no longer part of the active design.
- Cellular fallback remains planned, not currently active.
- For full implementation detail, use `CLAUDE.md` as the source of truth.
