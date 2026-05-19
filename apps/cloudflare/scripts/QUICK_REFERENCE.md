# Project Ops Quick Reference

## Active Production Surfaces

- Firmware (`firmware/`)
- Cloudflare Worker (`apps/cloudflare/`)
- React/Vite Pages UI (`apps/ui/`)
- OTA release management (`/api/admin/ota` + R2 artifacts)

## Core Deployment Flow

1. Deploy worker:
   - `cd apps/cloudflare`
   - `npm run deploy:worker`
2. Deploy UI:
   - `npm run deploy:pages`
3. Build firmware:
   - `cd ../..`
   - `pio run`
4. Flash firmware (USB):
   - `pio run -t upload`

## OTA Release Flow (Production)

1. Build firmware binary (`pio run`)
2. Upload to R2 `bgdisplay-firmware/<channel>/<artifact>.bin`
3. Register release metadata with `POST /api/admin/ota`
4. Queue `ota-check` and then `ota-apply` via admin command endpoint/UI
