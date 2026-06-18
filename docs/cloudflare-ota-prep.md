# Cloudflare OTA Operations (Production)

This project now uses a production OTA flow backed by Cloudflare Worker + R2.

## Current Production State

- Worker endpoints for OTA are deployed.
- R2 firmware bucket is configured: `bgdisplay-firmware`.
- Stable release metadata is present via `/api/admin/ota`.
- Firmware `v4.1.4` is deployed on device and supports OTA commands.

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
  - Example key: `stable/bg-display-mini-4.1.4.bin`
4. Register release metadata
  - `POST /api/admin/ota`
5. Queue validation command
  - `ota-check`
6. Roll out update
  - `ota-apply`

### Scripted alternative (no Cloudflare Access session needed)

Steps 3–6 can be done directly via `wrangler`/KV instead of the admin HTTP API — useful when running from a terminal without a browser-authenticated Cloudflare Access session. This is exactly what `getOtaRelease()`/`normalizeOtaRelease()` in `worker.js` read, so writing the same shape directly to KV is equivalent to `POST /api/admin/ota`:

```bash
cd apps/cloudflare
npx wrangler r2 object put "bgdisplay-firmware/stable/bg-display-mini-<version>.bin" --file "../../firmware/.pio/build/m5stack-core2/firmware.bin" --remote
npx wrangler kv key put "ota_release:stable" --path "<release.json>" --namespace-id <BGDISPLAY_CONFIG id> --remote
```

Then queue commands by writing the same envelope shape `POST /api/admin/command` would (`{id, type, args, createdAt, expiresAt}`) to KV key `command:all` — the worker signs the envelope itself when the device polls `/api/command`, so no signature needs to be computed client-side. Check `command:last_ack` (and `worker_events`) afterward to confirm the device executed it.

## Example Release Metadata

KV stores (and `normalizeOtaRelease()` expects) **camelCase** field names — `r2Key`/`sizeBytes`, not `r2_key`/`size_bytes` (those snake_case forms are accepted as input aliases but normalized away on write):

```json
{
  "channel": "stable",
  "version": "4.1.4",
  "r2Key": "stable/bg-display-mini-4.1.4.bin",
  "sizeBytes": 1332448,
  "md5": "628929b6c52fa68eddebee292642cc61",
  "sha256": "471c62abcaad755a77c911fcb069832cc82a43fbc20c19a9f1ab203e45d2328b",
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
- `performCloudOtaUpdate()` bounds the download with a 15s stall timeout (`client.setTimeout(15000)`), so a hung/failing OTA fails fast instead of blocking `loop()` indefinitely.
- A device cannot pick up a release that shares its currently-running version string — the manifest endpoint treats `compareVersions(release.version, current) <= 0` as "no update available". Always bump `FIRMWARE_VERSION` before registering a new release, even for a same-day rebuild.
- `device_status` (and the `firmware`/`uptime` fields in it) only refreshes every 5 minutes via the device's periodic status push, and that timer restarts from 0 on every boot — after an `ota-apply` reboot, expect a stale pre-update snapshot in KV for up to ~5 minutes even though the update already succeeded. Trust the `command:last_ack` / `worker_events` ack (`"Updated to <version>"`) as the immediate signal, not `device_status`.

## Workday OTA Quick Plan (Recommended)

1. Prepare release metadata in Worker (`/api/admin/ota`, or directly via KV — see "Scripted alternative" above) with accurate `version` (must be newer than what's currently running), `r2Key`, `sizeBytes`, and hashes.
2. Start with `mandatory: false` and queue `ota-check` to verify device sees the release.
3. Queue `ota-apply` for controlled update timing.
4. For urgent forced rollout, set `mandatory: true` and ensure devices are online; they will auto-apply on the next OTA check cycle.
5. Confirm success via `/api/admin/config` device status (`firmware`, `lastSeen`) and latest SD log upload.
