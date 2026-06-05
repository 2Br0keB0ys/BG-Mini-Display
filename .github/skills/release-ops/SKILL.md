---
name: release-ops
description: "Run pre-release checks and OTA prep for BG Display Mini firmware + Cloudflare worker" 
---

# Release Ops Skill

Use this skill when asked to do release readiness checks, preflight validation, or OTA prep for BG Display Mini.

## What this skill does

1. Runs relevant validation checks for touched surfaces (firmware, worker, UI).
2. Summarizes pass/fail with actionable next steps.
3. Prepares OTA metadata checklist and links to canonical runbook.
4. Produces a concise release report suitable for PR/release notes.

## Workflow

### 1) Determine release scope

Classify touched areas:

- Firmware (`firmware/**`)
- Worker (`apps/cloudflare/**`)
- UI (`apps/ui/**`)
- OTA metadata/operations (`docs/cloudflare-ota-prep.md`)

### 2) Run checks by scope

- Firmware scope: run `pio run` from repo root.
- Worker scope (in `apps/cloudflare`):
  - `npm run lint`
  - `npm run format:check`
  - `node --check src/worker.js`
  - `npm run test:mcp`
  - targeted `npm run test:mcp:*` for changed MCP/Pushover/readiness paths.
- UI scope (in `apps/ui`):
  - `npm run lint`
  - `npm run format:check`
  - `npm run build`

### 3) OTA readiness checklist

Do not duplicate the runbook. Follow and reference:

- [`docs/cloudflare-ota-prep.md`](../../../docs/cloudflare-ota-prep.md)

Confirm at minimum:

- Target channel and version are correct.
- Firmware artifact exists and hash/checksum fields are ready.
- Worker OTA metadata endpoints are coherent with intended release.

### 4) Release summary output

Return a compact report with:

- Scope covered
- Checks run + results
- Blocking issues
- OTA readiness status
- Recommended go/no-go

## Guardrails

- Never print secrets or key material.
- Do not alter production auth/replay protections during release-only tasks.
- Prefer minimal, reversible changes for release prep.

## Related references

- Root instructions: [`AGENTS.md`](../../../AGENTS.md)
- Firmware rules: [`firmware/AGENTS.md`](../../../firmware/AGENTS.md)
- Release checklist: [`docs/release-checklist.md`](../../../docs/release-checklist.md)
