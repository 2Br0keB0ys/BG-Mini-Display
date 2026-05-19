#!/usr/bin/env bash
set -euo pipefail

# Required env vars:
# MCP_URL, MCP_BEARER, CF_ID, CF_SECRET, WF_DIR
# Optional:
# ACTIVATE=true|false (default: true)

: "${MCP_URL:?MCP_URL is required}"
: "${MCP_BEARER:?MCP_BEARER is required}"
: "${CF_ID:?CF_ID is required}"
: "${CF_SECRET:?CF_SECRET is required}"
: "${WF_DIR:?WF_DIR is required}"

ACTIVATE="${ACTIVATE:-true}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}

need_cmd curl
need_cmd jq

mcp_post() {
  local payload="$1"
  curl -sS -X POST "$MCP_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $MCP_BEARER" \
    -H "CF-Access-Client-Id: $CF_ID" \
    -H "CF-Access-Client-Secret: $CF_SECRET" \
    -d "$payload"
}

mcp_tool_call() {
  local id="$1"
  local tool="$2"
  local args_json="$3"
  mcp_post "{\"jsonrpc\":\"2.0\",\"id\":\"${id}\",\"method\":\"tools/call\",\"params\":{\"name\":\"${tool}\",\"arguments\":${args_json}}}"
}

import_file() {
  local file_path="$1"
  echo "[import] $file_path"
  local resp
  resp=$(mcp_tool_call "import-$(date +%s%N)" "n8n_import_workflow_from_file" "{\"filePath\":\"${file_path}\"}")
  echo "$resp" | jq -e '.error == null' >/dev/null
  echo "$resp" | jq -r '.result.content[0].text' | jq . >/dev/null
}

list_workflows_json() {
  local resp
  resp=$(mcp_tool_call "list-$(date +%s%N)" "n8n_api_request" '{"method":"GET","path":"/api/v1/workflows"}')
  echo "$resp" | jq -e '.error == null' >/dev/null
  echo "$resp" | jq -r '.result.content[0].text'
}

activate_workflow() {
  local workflow_id="$1"
  echo "[activate] $workflow_id"
  local payload
  payload=$(printf '{"method":"PATCH","path":"/api/v1/workflows/%s","body":{"active":true}}' "$workflow_id")
  local resp
  resp=$(mcp_tool_call "act-$(date +%s%N)" "n8n_api_request" "$payload")
  echo "$resp" | jq -e '.error == null' >/dev/null
}

critical_file="$WF_DIR/critical-bg-escalation.workflow.json"
digest_file="$WF_DIR/daily-digest-fanout.workflow.json"
stale_file="$WF_DIR/device-stale-auto-remediation.workflow.json"

for f in "$critical_file" "$digest_file" "$stale_file"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing file: $f" >&2
    exit 1
  fi
done

import_file "$critical_file"
import_file "$digest_file"
import_file "$stale_file"

echo "[list] fetching workflows"
wf_json=$(list_workflows_json)

critical_id=$(echo "$wf_json" | jq -r '.data.data[] | select(.name=="BG Display Mini - Critical BG Escalation") | .id' | head -n1)
digest_id=$(echo "$wf_json" | jq -r '.data.data[] | select(.name=="BG Display Mini - Daily Digest Fan-out") | .id' | head -n1)
stale_id=$(echo "$wf_json" | jq -r '.data.data[] | select(.name=="BG Display Mini - Device Stale Auto-remediation") | .id' | head -n1)

echo "Imported workflow IDs:"
echo "  Critical: ${critical_id:-<not found>}"
echo "  Digest  : ${digest_id:-<not found>}"
echo "  Stale   : ${stale_id:-<not found>}"

if [[ "$ACTIVATE" == "true" ]]; then
  [[ -n "$critical_id" ]] && activate_workflow "$critical_id"
  [[ -n "$digest_id" ]] && activate_workflow "$digest_id"
  [[ -n "$stale_id" ]] && activate_workflow "$stale_id"
  echo "Activation complete."
else
  echo "ACTIVATE=false, skipped activation."
fi

echo "Done."
