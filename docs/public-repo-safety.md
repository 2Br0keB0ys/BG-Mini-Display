# Public Repo Safety: What Stays Private vs Public

This guide explains what belongs in git and what must stay private.

## ✅ Safe to commit (public)

- Source code (`firmware/`, `apps/cloudflare/`, `apps/ui/`)
- Documentation and runbooks (`README.md`, `docs/*.md`)
- Example configs with placeholders (for example: `*.example.*`)
- GitHub workflows and templates (`.github/`)

## ❌ Never commit (private)

- Real API keys/tokens/secrets
- `firmware/src/secrets.h` containing real values
- `.env` / `.dev.vars` files with credentials
- Local Infisical workspace config (`.infisical.json`)
- Local assistant/editor permission overrides (`.claude/settings.local.json`)
- Device enrollment exports or logs containing unique identifiers

## Secret management policy

All real secrets should come from **Infisical** (or equivalent secret manager) and be injected at runtime/setup.

### Required secret flow

1. Store values in Infisical.
2. Sync firmware bootstrap values with `firmware/scripts/firmware_secrets_sync.ps1`.
3. Set worker secrets with Wrangler (`wrangler secret put ...`) from secure values.
4. Keep local secret files out of git via `.gitignore`.

## Quick pre-push checklist

- [ ] `git status --short` is clean except intended files
- [ ] No `.env`, `.dev.vars`, `secrets.h`, or `.infisical.json` in staged files
- [ ] No raw tokens/keys in changed text
- [ ] Commands and docs use placeholders like `<project-id>`
