# Contributing

Thanks for contributing to BG MiniView.

## Scope to prioritize

Active production surfaces:
- `firmware/`
- `apps/cloudflare/`
- `apps/ui/`
- `docs/cloudflare-ota-prep.md`

Archived paths (work only when explicitly requested):
- `archive/`
- `apps/pages/`

## Local validation (before PR)

Run the checks that match your changes:

- Firmware:
  - `pio run`
- Worker:
  - `node --check apps/cloudflare/src/worker.js`
- UI:
  - `cd apps/ui`
  - `npm ci`
  - `npm run build`

## Pull request expectations

- Keep changes focused and minimal.
- Update docs when behavior changes.
- Preserve security-sensitive behavior:
  - HMAC signing
  - nonce / replay checks
  - encrypted credential storage
- Do not commit secrets or tokens.

## OTA-related changes

If OTA behavior changes, update `docs/cloudflare-ota-prep.md` in the same PR.

## Release checklist

Use this lightweight checklist before tagging a release:

- [ ] Working tree is clean (`git status --short`)
- [ ] PR merged to `main`
- [ ] Scope documented (firmware / worker / UI / docs)
- [ ] Security-sensitive behavior reviewed (auth/signing/replay/encryption)
- [ ] Validate only changed surfaces:
  - Firmware: `pio run`
  - Worker: `node --check apps/cloudflare/src/worker.js`
  - UI: `cd apps/ui`, `npm ci`, `npm run build`
- [ ] If OTA changed, `docs/cloudflare-ota-prep.md` updated in same PR
- [ ] Rollback path identified

## Branch protection (recommended for public repo)

Configure branch protection on `main` in GitHub settings:

- Require pull request before merge
- Require 1 approval and CODEOWNERS review
- Dismiss stale approvals on new commits
- Require status checks: `firmware-build`, `worker-validate`, `label`
- Require conversation resolution before merge
- Disable bypasses for protected checks
