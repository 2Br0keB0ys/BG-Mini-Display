# BGDisplay Context Snapshot

Last updated: 2026-05-11

This file is a concise operational snapshot for fast onboarding.

## What It Is

BGDisplay is an M5Stack Core2 bedside/desk glucose display.

- Primary source: Dexcom Share
- Fallback source: Nightscout
- Optional Omnipod source: Glooko pod-status endpoint (30-minute cadence)
- Cloud backend: Cloudflare Worker + KV + Durable Object WebSocket relay
- Setup/admin UI: single-page Cloudflare Pages app

## Current Versions

| Component | Version |
|---|---|
| Firmware | 4.1.1 |
| Worker | 3.0.0 |
| UI | React/Vite production UI (`apps/ui`) |

## Live Architecture

```text
Dexcom Share (primary)  --->
                          M5Stack Core2 firmware ---> signed HTTPS ---> Cloudflare Worker ---> KV
Nightscout (fallback) --->                            \              \
                                                       \              --> Durable Object WS relay
                                                        \
                                                         --> Cloudflare Pages UI (`apps/ui`)

OTA release artifacts live in R2 (`bgdisplay-firmware`) and are delivered via signed short-lived Worker URLs.
```

## Key Behaviors

- Device tries Dexcom first, then Nightscout on failure.
- Device optionally polls Glooko Omnipod data every 30+ minutes.
- Config saves from UI trigger immediate WebSocket push (`config-changed`) to the device.
- Device still performs HTTPS ping fallback when WebSocket is unavailable.
- Sensitive values in NVS are AES-encrypted using a chip-derived key.
- HMAC signed requests are required for device API operations.
- API keys rotate on a 7-day schedule with overlap support.
- Daily AI digest is generated on Worker cron and fetched by device.
- Optional Pushover alerting and digest push are supported.
- OTA remote commands are available: `ota-check`, `ota-apply`.
- Cloud OTA device flow: `/api/ota/manifest` -> signed `/api/ota/download/:channel/:version`.

## Important Paths

- Firmware: `firmware/src/`
- Worker: `apps/cloudflare/src/worker.js`
- Worker config: `apps/cloudflare/wrangler.toml`
- UI (production): `apps/ui/`

## Archived Paths

- NAS MCP: `archive/apps/nas-control-mcp/`
- n8n artifacts: `archive/n8n/`
- Legacy UI snapshot: `apps/pages/`

## Notes

- MQTT is no longer part of the active design.
- Cellular fallback remains planned, not currently active.
- Retired Checkly automation is archived under `archive/checkly/`.
- For full implementation detail, use `CLAUDE.md` as the source of truth.
