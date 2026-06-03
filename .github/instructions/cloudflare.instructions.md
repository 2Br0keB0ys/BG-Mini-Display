---
description: "Worker + Pages guardrails for BG Display Mini Cloudflare changes"
applyTo: "apps/cloudflare/**"
---

# Cloudflare Worker instructions

Use these rules for files under `apps/cloudflare/**`.

- Keep edits minimal and targeted; preserve existing endpoint contracts and response shapes.
- Preserve auth/security behavior:
  - Device HMAC + nonce replay checks
  - Admin session/origin gates
  - Rate limits and lockout logic
  - KV encryption for Pushover credentials (`KV_ENCRYPT_KEY`)
- Do not log or expose sensitive values (device keys, Dexcom/Nightscout secrets, Pushover creds).
- Keep Dexcom primary, Nightscout fallback semantics intact for BG retrieval.
- MCP updates must preserve JSON-RPC 2.0 compatibility and existing tool names unless explicitly requested.
- Keep `normalizeConfig()` backward-compatible with existing config keys/migrations.
- If changing digest behavior, preserve DND behavior and deterministic fallback path.

## Validation before finishing

From `apps/cloudflare/` run the most relevant checks:

- `npm run lint`
- `npm run format:check`
- `node --check src/worker.js`
- `npm run test:mcp` (and targeted `test:mcp:*` where relevant)

## Canonical references

- Root agent guidance: [`AGENTS.md`](../../AGENTS.md)
- OTA operations: [`docs/cloudflare-ota-prep.md`](../../docs/cloudflare-ota-prep.md)
- Release workflow: [`docs/release-checklist.md`](../../docs/release-checklist.md)
