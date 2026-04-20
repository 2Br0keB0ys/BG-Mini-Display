# BGDisplay Security Hardening

This project already encrypts sensitive values in NVS using a per-device key derived from chip identity.

## What Was Hardened In Firmware

- Dexcom enhanced debug logging that exposed sensitive data was removed.
- Dexcom auth/login state now clears on failures.
- Build remains functional with normal diagnostics, without printing credential payloads.

## Why This Matters For Stolen Devices

Without hardware fuse hardening, a thief with physical access may still attempt firmware replacement or low-level extraction.

To avoid rotating all passwords/API keys after theft, use the staged hardening below.

## Staged Hardening Workflow

1. Run safe dry-run inspection and key generation:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/secure_provision.ps1 -Port COM6
```

2. Confirm your device still boots and your latest firmware is working.

3. Apply irreversible fuse hardening:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/secure_provision.ps1 -Port COM6 -Apply
```

## Important Notes

- `-Apply` is irreversible.
- Keep generated keys in a secure backup.
- Test one device first before rolling out to others.
- After irreversible hardening, serial recovery options are reduced.
