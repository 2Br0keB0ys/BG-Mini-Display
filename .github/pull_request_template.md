## Summary
- What changed?
- Why now?

## Scope
- [ ] Firmware (`firmware/`)
- [ ] Worker (`apps/cloudflare/`)
- [ ] UI (`apps/ui/`)
- [ ] Docs only

## Validation
- [ ] `pio run` (if firmware changed)
- [ ] `node --check apps/cloudflare/src/worker.js` (if worker changed)
- [ ] `npm ci` + local build/tests for changed app(s)
- [ ] Manual smoke test notes added below

## Security / Safety
- [ ] No secrets committed
- [ ] Signing / auth flows unchanged or explicitly documented
- [ ] Sensitive logs redacted

## OTA Impact
- [ ] No OTA impact
- [ ] OTA behavior changed and documented in `docs/cloudflare-ota-prep.md`

## Notes for Reviewers
- Risks / rollback plan:
- Follow-ups:
