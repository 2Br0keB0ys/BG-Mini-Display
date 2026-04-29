# NAS Control MCP (Level B)

MCP server for controlled NAS automation with:

- n8n API control (list/import/update/activate/run via generic API tool)
- Docker n8n controls (status/restart/logs + compose actions)
- Restricted file read/write in one allowed directory
- Dual auth: Cloudflare Access service token headers + Bearer API key

## Security model

Requests must include all of:

1. `Authorization: Bearer <NAS_MCP_API_KEY>`
2. `CF-Access-Client-Id: <CF_ACCESS_CLIENT_ID>`
3. `CF-Access-Client-Secret: <CF_ACCESS_CLIENT_SECRET>`

## Setup

1. Copy `.env.example` to `.env` and fill values.
2. Build + run:

```bash
cd apps/nas-control-mcp
cp .env.example .env
# edit .env

docker compose -f docker-compose.nas-control-mcp.yml up -d --build
```

3. Verify health:

```bash
curl -s http://127.0.0.1:8788/health
```

## Cloudflared tunnel route

Add a route in your existing tunnel config to point your chosen hostname/path to `http://127.0.0.1:8788`.

Example:

```yaml
ingress:
  - hostname: mcp.2brokeboys.uk
    service: http://127.0.0.1:8788
  - service: http_status:404
```

Then reload cloudflared.

## MCP probe examples

Set shell vars first:

```bash
export MCP_URL="https://mcp.2brokeboys.uk/mcp"
export MCP_BEARER="replace_me"
export CF_ID="replace_me"
export CF_SECRET="replace_me"
```

List tools:

```bash
curl -sS "$MCP_URL" \
  -H "Authorization: Bearer $MCP_BEARER" \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET"
```

MCP tools/list:

```bash
curl -sS -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_BEARER" \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  -d '{"jsonrpc":"2.0","id":"1","method":"tools/list","params":{}}'
```

Check n8n status via tool:

```bash
curl -sS -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_BEARER" \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  -d '{"jsonrpc":"2.0","id":"2","method":"tools/call","params":{"name":"docker_n8n_status","arguments":{}}}'
```

Import one workflow via MCP tool:

```bash
curl -sS -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_BEARER" \
  -H "CF-Access-Client-Id: $CF_ID" \
  -H "CF-Access-Client-Secret: $CF_SECRET" \
  -d '{"jsonrpc":"2.0","id":"3","method":"tools/call","params":{"name":"n8n_import_workflow_from_file","arguments":{"filePath":"/absolute/path/to/critical-bg-escalation.workflow.json"}}}'
```

## Recommended next hardening

1. Rotate `NAS_MCP_API_KEY` monthly.
2. Keep Cloudflare Access policy limited to service token initially.
3. Add request logging sink (e.g., Loki/SIEM) for tool call audits.
4. Keep `ALLOWED_FILE_ROOT` narrow.
5. Keep `docker_compose_n8n` action allowlist as-is unless explicitly needed.
