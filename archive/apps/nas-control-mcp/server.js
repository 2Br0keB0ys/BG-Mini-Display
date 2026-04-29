import express from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 8788);
const API_KEY = process.env.NAS_MCP_API_KEY || "";
const CF_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || "";
const CF_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || "";

const N8N_BASE_URL = (process.env.N8N_BASE_URL || "").replace(/\/$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY || "";
const N8N_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS || 20000);

const DOCKER_CONTAINER_NAME = process.env.DOCKER_CONTAINER_NAME || "n8n";
const DOCKER_COMPOSE_PROJECT_DIR = process.env.DOCKER_COMPOSE_PROJECT_DIR || "";
const ALLOWED_FILE_ROOT = process.env.ALLOWED_FILE_ROOT || "";

function badRequest(message) {
  return { error: { code: -32602, message } };
}

function mcpResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function mcpError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

function getBearer(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function requireAuth(req, res, next) {
  if (!API_KEY || !CF_CLIENT_ID || !CF_CLIENT_SECRET) {
    return res.status(500).json({ error: "Server auth env vars are not configured" });
  }

  const providedKey = getBearer(req);
  if (providedKey !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  const cfId = req.headers["cf-access-client-id"] || "";
  const cfSecret = req.headers["cf-access-client-secret"] || "";
  if (cfId !== CF_CLIENT_ID || cfSecret !== CF_CLIENT_SECRET) {
    return res.status(401).json({ error: "Cloudflare Access service token check failed" });
  }

  next();
}

function safeJoin(base, target) {
  const finalPath = path.resolve(base, target);
  const normalizedBase = path.resolve(base) + path.sep;
  if (!finalPath.startsWith(normalizedBase)) {
    throw new Error("Path escapes allowed root");
  }
  return finalPath;
}

async function n8nRequest(method, apiPath, body) {
  if (!N8N_BASE_URL || !N8N_API_KEY) {
    throw new Error("N8N_BASE_URL and N8N_API_KEY are required");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);
  try {
    const res = await fetch(`${N8N_BASE_URL}${apiPath}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-N8N-API-KEY": N8N_API_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    return {
      ok: res.ok,
      status: res.status,
      data: parsed,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function dockerCommand(args, cwd = undefined) {
  const { stdout, stderr } = await execFileAsync("docker", args, {
    cwd,
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

const TOOLS = [
  {
    name: "n8n_health",
    description: "Check n8n API health endpoint",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "n8n_api_request",
    description: "Send authenticated request to n8n API (path must start with /api/v1/)",
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "HTTP method (GET, POST, PATCH, DELETE)" },
        path: { type: "string", description: "API path, e.g. /api/v1/workflows" },
        body: { type: "object", description: "Optional JSON body" },
      },
      required: ["method", "path"],
    },
  },
  {
    name: "n8n_import_workflow_from_file",
    description: "Read local workflow JSON file and import into n8n",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "Absolute file path to workflow JSON" },
      },
      required: ["filePath"],
    },
  },
  {
    name: "docker_n8n_status",
    description: "Get docker status for the n8n container",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "docker_n8n_restart",
    description: "Restart n8n container",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "docker_n8n_logs",
    description: "Fetch recent n8n container logs",
    inputSchema: {
      type: "object",
      properties: {
        tail: { type: "number", description: "Number of log lines, default 200" },
      },
      required: [],
    },
  },
  {
    name: "docker_compose_n8n",
    description: "Run docker compose command in the configured n8n project directory",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Allowed: ps | up | restart | pull" },
      },
      required: ["action"],
    },
  },
  {
    name: "file_read_allowed",
    description: "Read file content from allowed root",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "Path relative to ALLOWED_FILE_ROOT" },
      },
      required: ["relativePath"],
    },
  },
  {
    name: "file_write_allowed",
    description: "Write file content under allowed root",
    inputSchema: {
      type: "object",
      properties: {
        relativePath: { type: "string", description: "Path relative to ALLOWED_FILE_ROOT" },
        content: { type: "string", description: "UTF-8 file content to write" },
      },
      required: ["relativePath", "content"],
    },
  },
];

async function handleToolCall(name, args) {
  if (name === "n8n_health") {
    return n8nRequest("GET", "/healthz");
  }

  if (name === "n8n_api_request") {
    const method = String(args?.method || "").toUpperCase();
    const apiPath = String(args?.path || "");
    if (!method) return badRequest("method is required");
    if (!apiPath.startsWith("/api/v1/")) {
      return badRequest("path must start with /api/v1/");
    }
    return n8nRequest(method, apiPath, args?.body);
  }

  if (name === "n8n_import_workflow_from_file") {
    const filePath = String(args?.filePath || "").trim();
    if (!filePath) return badRequest("filePath is required");

    const raw = await readFile(filePath, "utf8");
    const workflow = JSON.parse(raw);

    // Ensure inactive on import for safety.
    workflow.active = false;
    return n8nRequest("POST", "/api/v1/workflows", workflow);
  }

  if (name === "docker_n8n_status") {
    const out = await dockerCommand([
      "ps",
      "--filter",
      `name=${DOCKER_CONTAINER_NAME}`,
      "--format",
      "{{.Names}}\t{{.Image}}\t{{.Status}}",
    ]);
    return out;
  }

  if (name === "docker_n8n_restart") {
    return dockerCommand(["restart", DOCKER_CONTAINER_NAME]);
  }

  if (name === "docker_n8n_logs") {
    const tail = Number(args?.tail || 200);
    const safeTail = Number.isFinite(tail) ? Math.max(20, Math.min(1000, tail)) : 200;
    return dockerCommand(["logs", "--tail", String(safeTail), DOCKER_CONTAINER_NAME]);
  }

  if (name === "docker_compose_n8n") {
    const action = String(args?.action || "").toLowerCase();
    const allowed = new Set(["ps", "up", "restart", "pull"]);
    if (!allowed.has(action)) {
      return badRequest("action must be one of: ps, up, restart, pull");
    }
    if (!DOCKER_COMPOSE_PROJECT_DIR) {
      return badRequest("DOCKER_COMPOSE_PROJECT_DIR is not set");
    }

    const actionArgs = {
      ps: ["compose", "ps"],
      up: ["compose", "up", "-d", "n8n"],
      restart: ["compose", "restart", "n8n"],
      pull: ["compose", "pull", "n8n"],
    }[action];

    return dockerCommand(actionArgs, DOCKER_COMPOSE_PROJECT_DIR);
  }

  if (name === "file_read_allowed") {
    if (!ALLOWED_FILE_ROOT) return badRequest("ALLOWED_FILE_ROOT is not set");
    const relativePath = String(args?.relativePath || "").trim();
    if (!relativePath) return badRequest("relativePath is required");
    const filePath = safeJoin(ALLOWED_FILE_ROOT, relativePath);
    const content = await readFile(filePath, "utf8");
    return { filePath, content };
  }

  if (name === "file_write_allowed") {
    if (!ALLOWED_FILE_ROOT) return badRequest("ALLOWED_FILE_ROOT is not set");
    const relativePath = String(args?.relativePath || "").trim();
    const content = String(args?.content ?? "");
    if (!relativePath) return badRequest("relativePath is required");
    const filePath = safeJoin(ALLOWED_FILE_ROOT, relativePath);
    await writeFile(filePath, content, "utf8");
    return { ok: true, filePath, bytes: Buffer.byteLength(content, "utf8") };
  }

  return badRequest(`Unknown tool: ${name}`);
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "nas-control-mcp" });
});

app.get("/mcp", requireAuth, (_req, res) => {
  res.json({
    name: "nas-control-mcp",
    version: "1.0.0",
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
  });
});

app.post("/mcp", requireAuth, async (req, res) => {
  const body = req.body;
  const method = body?.method;
  const id = body?.id ?? null;

  try {
    if (method === "initialize") {
      return res.json(
        mcpResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "nas-control-mcp", version: "1.0.0" },
        }),
      );
    }

    if (method === "tools/list") {
      return res.json(mcpResult(id, { tools: TOOLS }));
    }

    if (method === "tools/call") {
      const toolName = body?.params?.name;
      const args = body?.params?.arguments || {};
      const result = await handleToolCall(toolName, args);

      return res.json(
        mcpResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        }),
      );
    }

    return res.json(mcpError(id, -32601, "Method not found"));
  } catch (error) {
    return res.json(mcpError(id, -32000, String(error?.message || error)));
  }
});

app.listen(PORT, () => {
  console.log(`nas-control-mcp listening on :${PORT}`);
});
