# Security Policy

## Supported scope

This repository handles medical-adjacent telemetry and device auth flows.
Please report any vulnerability that may affect:

- Device/worker authentication and signing
- Replay protection (nonce/timestamp checks)
- Secret storage or exposure
- OTA artifact integrity or unauthorized update paths

## Safety disclaimer

This repository is not a medical device and is not a substitute for professional medical advice.

- Do not use this software as your sole source for treatment decisions.
- Always verify with approved medical equipment and a licensed clinician.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository:

- https://github.com/2Br0keB0ys/bgdisplay/security/advisories/new

Please include:
- Affected component/path
- Reproduction details
- Impact assessment
- Suggested mitigation (if known)

## Response goals

- Initial triage acknowledgement: within 72 hours
- Confirmed issues are prioritized by severity and exploitability
- High-risk auth/secret/update-chain issues are handled with urgent priority

## Safe disclosure

Please do not disclose publicly until a fix or mitigation is available.
