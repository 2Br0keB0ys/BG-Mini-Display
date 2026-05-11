# Firmware Agent Notes

Use these rules when modifying files under `firmware`.

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
	- `pio run`
- If build cannot be run, state that clearly in the final update.

## Build Optimizations

Current `platformio.ini` build profile is intentionally conservative and stable:
- **Optimization Level**: `-O2`
- **Debug level**: `-DCORE_DEBUG_LEVEL=0`
- **Loop stack size**: `-DARDUINO_LOOP_STACK_SIZE=16384`
- **Warnings**: `-Wall -Wextra -Wno-unused-parameter`

All header files are included in the main sketch; avoid creating new `.cpp` files unless needed, to keep iteration fast.
