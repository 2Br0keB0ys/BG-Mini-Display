---
description: "Firmware guardrails for ESP32 BG Display Mini changes"
applyTo: "firmware/**"
---

# Firmware instructions

Use these rules for files under `firmware/**`.

- Keep patches small and focused; avoid broad refactors unless requested.
- Preserve safety/security behavior:
  - Signed request flow (HMAC + timestamp/nonce semantics)
  - Encrypted NVS/SD handling for sensitive fields
  - No credential leakage in logs/serial output
- Preserve display UX constraints:
  - Flicker-free off-screen canvas rendering
  - Readability on 320x240
  - Correct source priority messaging (Dexcom primary, Nightscout fallback)
- Prefer header-only module pattern already used in firmware.
- Do not add new third-party dependencies unless required.
- Keep factory reset/enrollment behavior unchanged unless explicitly requested.

## Validation before finishing

From repository root:

- `pio run`

If build cannot be run, clearly state that in the final update.

## Canonical references

- Firmware-specific notes: [`firmware/AGENTS.md`](../../firmware/AGENTS.md)
- Root guidance: [`AGENTS.md`](../../AGENTS.md)
- Security details: [`firmware/SECURITY_HARDENING.md`](../../firmware/SECURITY_HARDENING.md)
