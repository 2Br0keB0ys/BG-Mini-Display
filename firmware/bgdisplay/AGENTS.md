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

## Build Optimizations

The `platformio.ini` is configured for fast, optimized builds:
- **Link-Time Optimization (`-flto`)**: Enables whole-program optimization across object files
- **RTTI and Exception Disabled**: `-fno-rtti -fno-exceptions` reduces code bloat (~15-20% size reduction)
- **Optimization Level**: `-O2` balances speed and code size
- **No strict warnings**: `-Wno-unused-parameter` allows flexible function signatures
All header files are included in the main sketch; avoid creating new .cpp files unless necessary to avoid recompilation overhead.
