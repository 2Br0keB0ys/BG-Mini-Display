# Contributing

Thanks for contributing to BG MiniView.

## Scope to prioritize

Active production surfaces:
- `firmware/`
- `apps/cloudflare/`
- `apps/ui/`
- `docs/cloudflare-ota-prep.md`

Archived paths (work only when explicitly requested):
- `archive/`
- `apps/pages/`

## Local validation (before PR)

Run the checks that match your changes:

- Firmware:
  - `pio run`
- Worker:
  - `node --check apps/cloudflare/src/worker.js`
- UI:
  - `cd apps/ui`
  - `npm ci`
  - `npm run build`

## Pull request expectations

- Keep changes focused and minimal.
- Update docs when behavior changes.
- Preserve security-sensitive behavior:
  - HMAC signing
  - nonce / replay checks
  - encrypted credential storage
- Do not commit secrets or tokens.

## OTA-related changes

If OTA behavior changes, update `docs/cloudflare-ota-prep.md` in the same PR.
