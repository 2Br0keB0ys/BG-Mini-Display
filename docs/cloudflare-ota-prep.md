# Cloudflare OTA Operations (Production)

This project now uses a production OTA flow backed by Cloudflare Worker + R2.

## Current Production State

- Worker endpoints for OTA are deployed.
- R2 firmware bucket is configured: `bgdisplay-firmware`.
- Stable release metadata is present via `/api/admin/ota`.
- Firmware `v4.1.1` is deployed on device and supports OTA commands.

## OTA Architecture

```text
PlatformIO build -> firmware .bin
  -> upload artifact to R2
  -> register release metadata in Worker KV
  -> device polls /api/ota/manifest (signed)
  -> worker returns short-lived signed download URL
  -> device applies update and reboots
```

## Runtime Endpoints

### Device-facing

- `GET /api/ota/manifest`
- `GET /api/ota/download/:channel/:version`

### Admin-facing

- `GET /api/admin/ota`
- `POST /api/admin/ota`
- `DELETE /api/admin/ota`

## Release Checklist

1. Build firmware
  - `pio run`
2. Compute artifact hashes (`md5`, `sha256`) and size
3. Upload artifact to R2 (remote)
  - Example key: `stable/bg-display-mini-4.1.1.bin`
4. Register release metadata
  - `POST /api/admin/ota`
5. Queue validation command
  - `ota-check`
6. Roll out update
  - `ota-apply`

## Example Release Metadata

```json
{
  "channel": "stable",
  "version": "4.1.1",
  "r2_key": "stable/bg-display-mini-4.1.1.bin",
  "size_bytes": 1319520,
  "md5": "5435983217e346a7d701e4979313051a",
  "sha256": "f7715a703e043cd02ebcde1ad9063531010022df506154fccf511e1806b0bbab",
  "notes": "Production OTA release",
  "mandatory": false
}
```

## Device Command Behavior

- `ota-check`: validates whether a newer release is available for channel/current version.
- `ota-apply`: fetches manifest, downloads signed artifact, applies update, then reboots.
- Firmware now performs the first periodic OTA manifest check immediately after boot (no initial multi-hour wait).
- If release metadata has `mandatory: true`, device auto-applies that release on the next due OTA check.

## Operational Notes

- Signed download URLs are short-lived and generated per manifest response.
- Keep `ArduinoOTA` enabled for local recovery/update workflows.
- Use channel strategy (`stable`, `beta`) for staged rollout.
- Ensure minimum battery and network quality before triggering fleet-wide `ota-apply`.

## Workday OTA Quick Plan (Recommended)

1. Prepare release metadata in Worker (`/api/admin/ota`) with accurate `version`, `r2_key`, `size_bytes`, and hashes.
2. Start with `mandatory: false` and queue `ota-check` to verify device sees the release.
3. Queue `ota-apply` for controlled update timing.
4. For urgent forced rollout, set `mandatory: true` and ensure devices are online; they will auto-apply on the next OTA check cycle.
5. Confirm success via `/api/admin/config` device status (`firmware`, `lastSeen`) and latest SD log upload.
