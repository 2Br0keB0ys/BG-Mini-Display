# Release Checklist

Use this checklist for low-risk, repeatable releases across firmware, worker, and UI.

## 1) Pre-flight

- [ ] Working tree is clean (`git status --short`)
- [ ] PR merged to `main`
- [ ] Release scope documented (firmware / worker / UI / docs)
- [ ] Security-sensitive changes reviewed (auth/signing/replay/encryption)

## 2) Validate changed surfaces

Run only what matches your release scope.

### Firmware

- [ ] `pio run`
- [ ] If OTA changed, verify `docs/cloudflare-ota-prep.md` was updated in same PR

### Worker

- [ ] `node --check apps/cloudflare/src/worker.js`
- [ ] If dependencies changed: install and verify from `apps/cloudflare/`

### UI

- [ ] From `apps/ui/`: `npm ci`
- [ ] From `apps/ui/`: `npm run build`

## 3) Deployment readiness

- [ ] Required secrets configured (no plaintext secrets in repo)
- [ ] Cloudflare bindings/vars match expected release behavior
- [ ] Rollback approach identified (previous firmware channel/version or worker rollback)

## 4) Post-release verification

- [ ] Device can pull config and report status
- [ ] Worker health endpoints/admin flows respond as expected
- [ ] UI loads and saves config successfully
- [ ] OTA manifest/download path works for intended channel (if applicable)

## 5) Recordkeeping

- [ ] Add concise release note summary in PR/commit history
- [ ] Link any operational follow-up tasks/issues
