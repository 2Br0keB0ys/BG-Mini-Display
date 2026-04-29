# BG MiniView n8n Workflows

These workflows are import-ready templates for:

1. Critical BG escalation
2. Daily digest fan-out
3. Device stale-data auto-remediation

## Files

- critical-bg-escalation.workflow.json
- daily-digest-fanout.workflow.json
- device-stale-auto-remediation.workflow.json

## Required environment variables (n8n container)

- BG_MCP_BASE_URL=https://bgdisplay-worker.zanebaize.workers.dev
- BG_MCP_KEY=bg_ro_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
- PUSHOVER_USER_KEY=your_user_key
- PUSHOVER_API_TOKEN=your_api_token
- BG_DIGEST_ARCHIVE_WEBHOOK=https://your-nas-endpoint.example/path (optional)

## Quick test command (from NAS shell)

curl -sS -X POST "${BG_MCP_BASE_URL}/mcp?key=${BG_MCP_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"ping","method":"tools/list","params":{}}'

## Docker compose snippet example

services:
  n8n:
    image: n8nio/n8n:latest
    environment:
      - BG_MCP_BASE_URL=https://bgdisplay-worker.zanebaize.workers.dev
      - BG_MCP_KEY=bg_ro_replace_me
      - PUSHOVER_USER_KEY=replace_me
      - PUSHOVER_API_TOKEN=replace_me
      - BG_DIGEST_ARCHIVE_WEBHOOK=

After updating compose, restart n8n.

## Import steps

1. n8n UI -> Workflows -> Import from File
2. Import each JSON file in this folder
3. Open each workflow and verify node expressions resolved environment variables
4. Run each workflow once with "Execute workflow"
5. Activate workflows one by one after validation

## Notes

- These templates use MCP endpoint authentication via query key.
- They intentionally avoid admin session endpoints so they work behind Cloudflare Access without additional JWT plumbing.
- Cooldowns/state are stored per-workflow using n8n global workflow static data.
- You can later replace env-based secrets with n8n credentials if preferred.
