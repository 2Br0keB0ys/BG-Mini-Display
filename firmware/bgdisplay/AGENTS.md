# Firmware Agent Notes

Use these rules when modifying files under `firmware/bgdisplay`.

## Scope

- Prefer minimal, targeted edits.
- Preserve existing behavior unless the requested change requires a behavior update.
- Do not add new third-party dependencies unless necessary.

## Safety

- Keep sensitive values out of logs (Dexcom, Nightscout, device key, WiFi password).
- Preserve request signing and replay-protection flows.
- Keep encrypted-storage behavior intact for NVS and SD logs.

## Display and UX

- Keep text concise for 320x240 readability.
- Avoid introducing flicker; maintain off-screen canvas rendering flow.
- Keep source priority messaging aligned with implementation: Dexcom primary, Nightscout fallback.

## Build and Validation

- Validate compile with PlatformIO after firmware edits when possible:
	- `pio run -d firmware/bgdisplay`
- If build cannot be run, state that clearly in the final update.
