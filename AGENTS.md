# 🤖 AI Agents Guidelines

> **Production scope first:** Active runtime surfaces are firmware (`firmware/`), Worker (`apps/cloudflare/`), UI (`apps/ui/`), and OTA operations (`docs/cloudflare-ota-prep.md`).

## ✅ Primary working areas

- `firmware/` — ESP32 firmware, display logic, cloud sync, OTA client.
- `apps/cloudflare/` — Worker APIs, auth/signing, KV/DO/R2 bindings, OTA control plane.
- `apps/ui/` — production configuration UI (React + Vite).
- `docs/cloudflare-ota-prep.md` — canonical OTA operations runbook.

## 🗃️ Archived/retired areas (read-only unless explicitly requested)

- `apps/pages/` — legacy static UI retained for historical reference.

## Working rules

1. Prefer minimal, targeted edits.
2. Preserve security-sensitive behavior (HMAC signing, nonce/replay checks, encrypted credential storage).
3. Keep docs aligned with production reality; avoid reintroducing retired flows as active guidance.
4. For firmware edits, keep rendering flicker-free and preserve source priority (Dexcom primary, Nightscout fallback).
5. Validate changes with the most relevant checks before finishing (build/syntax/tests where available).

## Build & deploy quick reference

- Firmware build: run PlatformIO from repository root (`platformio.ini` is root-scoped).
- Worker deploy: `apps/cloudflare` scripts (`deploy:worker`, `deploy:pages`, `deploy:all`).
- OTA release prep/rollout: follow `docs/cloudflare-ota-prep.md`.

## Notes for archive work

If a task is explicitly scoped to an archived surface, treat it as isolated legacy work and do not update production docs/paths unless the user asks.
