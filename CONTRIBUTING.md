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

## Code style quick rules

- Keep formatting consistent with Prettier and lint clean with ESLint.
- For JavaScript/React changes, run lint in the affected app(s):
  - `cd apps/cloudflare && npm run lint`
  - `cd apps/ui && npm run lint`
- If formatting drifts, run:
  - `cd apps/cloudflare && npm run format`
  - `cd apps/ui && npm run format`
- Line endings are enforced by repository `.gitattributes`:
  - Source/docs/config use `LF`
  - PowerShell scripts (`*.ps1`) use `CRLF`
- Avoid introducing unrelated reformat-only diffs outside the files you touched.

## Pull request expectations

- Keep changes focused and minimal.
- Update docs when behavior changes.
- Preserve security-sensitive behavior:
  - HMAC signing
  - nonce / replay checks
  - encrypted credential storage
- Do not commit secrets or tokens.
- Use Infisical (or equivalent secret manager) for real secrets; keep repository files placeholder-only.

## Public repository safety

- Review `docs/public-repo-safety.md` before opening PRs.
- Keep local-only files untracked (`secrets.h`, `.env*`, `.dev.vars`, `.infisical.json`, `.claude/settings.local.json`).

## First-time setup help

- Beginner walkthrough: `docs/setup-for-beginners.md`
- Guided Windows helper: `scripts/bootstrap_windows.ps1`

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
