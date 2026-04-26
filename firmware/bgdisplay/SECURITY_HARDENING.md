# BGDisplay Security Hardening

This project already applies multiple security controls in firmware and backend.

## Current Security Controls

- Sensitive NVS fields are encrypted with a per-device key derived from chip identity.
- SD logs are encrypted with the same hardware root (different salt).
- Device-to-worker requests are HMAC signed (timestamp + nonce + body hash).
- Worker enforces replay checks, rate limits, and key rotation windows.
- Credential-like values are redacted from UI responses.

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
- Run this only after validating the firmware image you intend to keep on the device.
