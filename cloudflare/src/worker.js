// BGDisplay Cloudflare Worker v2.0
// Dexcom-only, HTTPS smart config sync via /api/ping, automated key rotation

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Key, X-Command-Id, X-Log-Lines, X-Admin-Session, CF-Access-Jwt-Assertion",
};

const KEY_ROTATE_MS     = 7 * 24 * 60 * 60 * 1000;
const PENDING_KEY_TTL_MS = 48 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_SEC = 8 * 60 * 60;

const DEFAULT_DND_SCHEDULE = {
  sun: { from: "23:00", to: "06:00" },
  mon: { from: "23:00", to: "06:00" },
  tue: { from: "23:00", to: "06:00" },
  wed: { from: "23:00", to: "06:00" },
  thu: { from: "23:00", to: "06:00" },
  fri: { from: "23:00", to: "06:00" },
  sat: { from: "23:00", to: "06:00" },
};

function normalizeClock(v, fallback) {
  if (typeof v !== "string") return fallback;
  const m = v.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return fallback;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

function normalizeDndSchedule(sched, fallbackFrom, fallbackTo) {
  const src = (sched && typeof sched === "object") ? sched : {};
  const out = {};
  for (const [day, def] of Object.entries(DEFAULT_DND_SCHEDULE)) {
    const d = src[day] && typeof src[day] === "object" ? src[day] : {};
    const fromFallback = normalizeClock(fallbackFrom, def.from);
    const toFallback = normalizeClock(fallbackTo, def.to);
    out[day] = {
      from: normalizeClock(d.from, fromFallback),
      to: normalizeClock(d.to, toFallback),
    };
  }
  return out;
}

const DEFAULT_CONFIG = {
  // WiFi
  wifi_ssid: "", wifi_pass: "", cellular_fallback: false, reconnect_attempts: 5,
  // Nightscout (primary)
  nightscout_url: "", nightscout_secret: "",
  // Dexcom (fallback)
  dexcom_user: "", dexcom_pass: "", dexcom_region: "US",
  // Polling
  poll_interval_min: 5, stale_data_warn_min: 15, config_ping_min: 1,
  // BG thresholds
  bg_units: "mg/dL", urgent_low: 55, low: 70, high: 180, urgent_high: 250,
  bg_alert_style: "pulse",
  // Display
  show_last_reading_time: true, show_trend_arrow: true,
  brightness: 75, auto_dim_min: 10, dim_to_pct: 10,
  dnd_enabled: false, dnd_from: "23:00", dnd_to: "06:00",
  dnd_use_schedule: true,
  dnd_schedule: DEFAULT_DND_SCHEDULE,
  clock_24hr: false, timezone: "US/Central",
  // Security
  rate_limit_per_min: 45, lockout_enabled: true,
  lockout_attempts: 5, lockout_duration_min: 15,
  device_write_rate_limit_per_min: 20,
  admin_write_rate_limit_per_min: 15,
  session_timeout_min: 30, ip_allowlist_enabled: false, ip_allowlist: [],
  // Alerts / Monitoring
  alert_offline_min: 15,
  alert_stale_min: 30,
  alert_battery_low_pct: 15,
  alert_cooldown_min: 60,
  auto_backup: true,
};

function normalizeConfig(cfg) {
  const out = { ...DEFAULT_CONFIG, ...(cfg || {}) };

  // Backward compatibility: migrate seconds-based ping setting.
  if (out.config_ping_min === undefined && out.config_ping_sec !== undefined) {
    const sec = Number(out.config_ping_sec);
    out.config_ping_min = Number.isFinite(sec) ? Math.max(1, Math.round(sec / 60)) : 1;
  }

  // MQTT retired from firmware; strip stale keys from older backups.
  delete out.mqtt_host;
  delete out.mqtt_user;
  delete out.mqtt_pass;
  delete out.config_ping_sec;

  out.alert_offline_min = Math.max(5, Math.min(240, Number(out.alert_offline_min || 15)));
  out.alert_stale_min = Math.max(5, Math.min(240, Number(out.alert_stale_min || 30)));
  out.alert_battery_low_pct = Math.max(5, Math.min(40, Number(out.alert_battery_low_pct || 15)));
  out.alert_cooldown_min = Math.max(5, Math.min(360, Number(out.alert_cooldown_min || 60)));
  out.rate_limit_per_min = Math.max(10, Math.min(300, Number(out.rate_limit_per_min || 45)));
  out.device_write_rate_limit_per_min = Math.max(5, Math.min(180, Number(out.device_write_rate_limit_per_min || 20)));
  out.admin_write_rate_limit_per_min = Math.max(3, Math.min(120, Number(out.admin_write_rate_limit_per_min || 15)));
  out.dnd_use_schedule = out.dnd_use_schedule !== false;
  out.dnd_schedule = normalizeDndSchedule(out.dnd_schedule, out.dnd_from, out.dnd_to);

  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function generateKey() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "bg_ro_";
  for (let i = 0; i < 32; i++) key += chars[Math.floor(Math.random() * chars.length)];
  return key;
}

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

async function hmacSha256Hex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getClientIP(r) {
  return r.headers.get("CF-Connecting-IP") || r.headers.get("X-Forwarded-For") || "unknown";
}

function maskIP(ip) {
  const p = ip.split(".");
  return p.length === 4 ? `${p[0]}.xx.xx.${p[3]}` : "xx.xx.xx.xx";
}

function parseHost(urlLike) {
  try {
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isTrustedAdminOrigin(request, env) {
  const originHost = parseHost(request.headers.get("Origin") || "");
  const refererHost = parseHost(request.headers.get("Referer") || "");

  const defaults = [
    "bgdisplay-ui.pages.dev",
    "setup.2brokeboys.uk",
    "localhost",
    "127.0.0.1",
  ];

  const extra = String(env.ADMIN_ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(h => h.replace(/^https?:\/\//, "").replace(/\/$/, ""));

  const allowed = new Set([...defaults, ...extra]);

  return allowed.has(originHost) || allowed.has(refererHost);
}

async function verifyDeviceSignature(request, env, keyHash, rawBody = "") {
  const tsStr = request.headers.get("X-Sig-Ts") || "";
  const nonce = request.headers.get("X-Sig-Nonce") || "";
  const bodyHdr = (request.headers.get("X-Sig-Body") || "").toLowerCase();
  const sigHdr = (request.headers.get("X-Signature") || "").toLowerCase();

  if (!tsStr || !nonce || !bodyHdr || !sigHdr) return { ok: false, error: "Missing signature headers" };

  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, error: "Invalid signature timestamp" };

  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(nonce)) {
    return { ok: false, error: "Invalid nonce format" };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) return { ok: false, error: "Signature timestamp out of range" };

  const nonceKey = `sig_nonce:${keyHash}:${nonce}`;
  if (await env.BGDISPLAY_AUTH.get(nonceKey)) {
    return { ok: false, error: "Replay detected" };
  }

  const bodyHash = await sha256(rawBody || "");
  if (bodyHash !== bodyHdr) return { ok: false, error: "Body hash mismatch" };

  const u = new URL(request.url);
  const pathWithQuery = `${u.pathname}${u.search}`;
  const canonical = `${request.method}\n${pathWithQuery}\n${ts}\n${nonce}\n${bodyHash}`;
  const expect = await hmacSha256Hex(keyHash, canonical);
  if (expect !== sigHdr) return { ok: false, error: "Invalid signature" };

  await env.BGDISPLAY_AUTH.put(nonceKey, "1", { expirationTtl: 600 });
  return { ok: true };
}

async function signCommandEnvelope(cmd, keyHash) {
  const canonical = `${cmd.id}|${cmd.type}|${cmd.createdAt}|${cmd.expiresAt}`;
  return hmacSha256Hex(keyHash, canonical);
}

function isDeviceKeyValid(auth, keyHash) {
  if (!auth || !keyHash) return false;
  return keyHash === auth.keyHash
    || (auth.pendingKeyHash && keyHash === auth.pendingKeyHash)
    || (auth.recoveryKeyHash && keyHash === auth.recoveryKeyHash);
}

async function checkReplayToken(env, scope, token, ttlSec = 600) {
  if (!token) return { ok: true };
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(token)) {
    return { ok: false, error: "Invalid request id" };
  }
  const key = `reqid:${scope}:${token}`;
  if (await env.BGDISPLAY_AUTH.get(key)) {
    return { ok: false, error: "Duplicate request" };
  }
  await env.BGDISPLAY_AUTH.put(key, "1", { expirationTtl: ttlSec });
  return { ok: true };
}

// ─── Rate Limiting ─────────────────────────────────────────────────────────────

async function checkRateLimit(env, bucket, limitPerMin) {
  const key = `ratelimit:${bucket}`;
  const now = Date.now();
  let r = await env.BGDISPLAY_AUTH.get(key, { type: "json" }) || { count: 0, windowStart: now };
  if (now - r.windowStart > 60000) r = { count: 1, windowStart: now }; else r.count++;
  await env.BGDISPLAY_AUTH.put(key, JSON.stringify(r), { expirationTtl: 120 });
  return r.count <= limitPerMin;
}

async function checkLockout(env, ip) {
  const r = await env.BGDISPLAY_AUTH.get(`lockout:${ip}`, { type: "json" });
  if (!r) return { locked: false };
  if (r.lockedUntil && Date.now() < r.lockedUntil) return { locked: true, until: r.lockedUntil };
  return { locked: false };
}

async function recordFailedAuth(env, ip, maxAttempts, lockoutMin) {
  const key = `lockout:${ip}`;
  let r = await env.BGDISPLAY_AUTH.get(key, { type: "json" }) || { attempts: 0 };
  r.attempts = (r.attempts || 0) + 1;
  if (r.attempts >= maxAttempts) r.lockedUntil = Date.now() + lockoutMin * 60000;
  await env.BGDISPLAY_AUTH.put(key, JSON.stringify(r), { expirationTtl: lockoutMin * 120 });
}

async function clearFailedAuth(env, ip) { await env.BGDISPLAY_AUTH.delete(`lockout:${ip}`); }

async function incrementFailedAuthCount(env) {
  const key = "failed_auth_24h";
  const r = await env.BGDISPLAY_AUTH.get(key, { type: "json" }) || { count: 0, resetAt: Date.now() + 86400000 };
  if (Date.now() > r.resetAt) { r.count = 1; r.resetAt = Date.now() + 86400000; } else r.count++;
  await env.BGDISPLAY_AUTH.put(key, JSON.stringify(r), { expirationTtl: 86400 });
}

// ─── Change Log ────────────────────────────────────────────────────────────────

async function appendChangeLog(env, entry) {
  let log = await env.BGDISPLAY_CONFIG.get("changelog", { type: "json" }) || [];
  log.unshift({ msg: entry, ts: Date.now() });
  if (log.length > 50) log = log.slice(0, 50);
  await env.BGDISPLAY_CONFIG.put("changelog", JSON.stringify(log));
}

async function appendWorkerEvent(env, event) {
  let log = await env.BGDISPLAY_CONFIG.get("worker_events", { type: "json" }) || [];
  log.unshift({ ...event, ts: Date.now() });
  if (log.length > 200) log = log.slice(0, 200);
  await env.BGDISPLAY_CONFIG.put("worker_events", JSON.stringify(log));
}

async function shouldEmitAlert(env, key, cooldownMs) {
  const now = Date.now();
  const k = `alert:${key}`;
  const last = await env.BGDISPLAY_AUTH.get(k);
  if (last && now - Number(last) < cooldownMs) return false;
  await env.BGDISPLAY_AUTH.put(k, String(now), { expirationTtl: Math.max(60, Math.ceil(cooldownMs / 1000) * 2) });
  return true;
}

function computeMetrics(status, telemetry, events) {
  const samples = Array.isArray(telemetry) ? telemetry : [];
  const ev = Array.isArray(events) ? events : [];

  let avgRssi = null;
  let minBattery = null;
  let maxBattery = null;
  let staleSamples = 0;
  if (samples.length > 0) {
    let sumRssi = 0;
    let rssiCount = 0;
    for (const s of samples) {
      if (typeof s.rssi === "number") {
        sumRssi += s.rssi;
        rssiCount++;
      }
      if (typeof s.batteryPct === "number") {
        minBattery = minBattery === null ? s.batteryPct : Math.min(minBattery, s.batteryPct);
        maxBattery = maxBattery === null ? s.batteryPct : Math.max(maxBattery, s.batteryPct);
      }
      if (typeof s.lastReadingAgeSec === "number" && s.lastReadingAgeSec > 1800) staleSamples++;
    }
    avgRssi = rssiCount ? Math.round(sumRssi / rssiCount) : null;
  }

  const now = Date.now();
  const oneHourAgo = now - 3600000;
  const eventCounts1h = {
    alert: 0,
    commandAckOk: 0,
    commandAckFail: 0,
    configSave: 0,
  };
  for (const e of ev) {
    if (!e?.ts || e.ts < oneHourAgo) continue;
    if (e.type === "alert") eventCounts1h.alert++;
    if (e.type === "config-save") eventCounts1h.configSave++;
    if (e.type === "command-ack") {
      if (e.ok) eventCounts1h.commandAckOk++;
      else eventCounts1h.commandAckFail++;
    }
  }

  return {
    samples: samples.length,
    avgRssi,
    minBattery,
    maxBattery,
    staleSamplePct: samples.length ? Math.round((staleSamples / samples.length) * 100) : 0,
    lastSeenTs: status?.lastSeen || null,
    lastBgValue: typeof status?.bgValue === "number" ? status.bgValue : null,
    eventCounts1h,
    sourceHealth: {
      nsOk: Number(status?.nsOk || 0),
      nsFail: Number(status?.nsFail || 0),
      dexOk: Number(status?.dexOk || 0),
      dexFail: Number(status?.dexFail || 0),
      failStreak: Number(status?.bgPollFailStreak || 0),
      activeSource: status?.source || "none",
    },
    confidence: {
      score: (() => {
        let score = 100;
        if (typeof status?.lastReadingAgeSec === "number" && status.lastReadingAgeSec > 20 * 60) score -= 35;
        if (typeof status?.bgPollFailStreak === "number") score -= Math.min(40, status.bgPollFailStreak * 6);
        if (typeof avgRssi === "number" && avgRssi < -82) score -= 10;
        return Math.max(0, Math.min(100, score));
      })(),
    },
  };
}

async function issueAdminSession(env, ip) {
  const token = crypto.randomUUID();
  await env.BGDISPLAY_AUTH.put(`admin_session:${token}`, JSON.stringify({ ip, createdAt: Date.now() }), {
    expirationTtl: ADMIN_SESSION_TTL_SEC,
  });
  return token;
}

async function validateAdminSession(env, request) {
  let token = request.headers.get("X-Admin-Session") || "";
  if (!token) {
    const u = new URL(request.url);
    const allowQuerySession = request.method === "GET"
      && u.pathname === "/api/admin/logs/latest"
      && u.searchParams.get("download") === "1";
    if (allowQuerySession) {
      token = u.searchParams.get("session") || "";
    }
  }
  if (!token) return false;
  const s = await env.BGDISPLAY_AUTH.get(`admin_session:${token}`, { type: "json" });
  return !!s;
}

// ─── Config Version (ping mechanism) ─────────────────────────────────────────
// Incremented every time config is saved via UI
// Device pings /api/ping every 5 min — only does full pull if version changed

async function getConfigVersion(env) {
  const v = await env.BGDISPLAY_CONFIG.get("config_version");
  return v ? parseInt(v) : 0;
}

async function incrementConfigVersion(env) {
  const v = await getConfigVersion(env);
  const newV = v + 1;
  await env.BGDISPLAY_CONFIG.put("config_version", String(newV));
  return newV;
}

// ─── Automated Key Rotation ────────────────────────────────────────────────────

async function handleAutoRotation(env, auth) {
  const now = Date.now();
  if (auth.pendingKeyHash && auth.pendingKeyExpiry && now < auth.pendingKeyExpiry) {
    return auth.pendingKey || null;
  }
  if (auth.pendingKeyHash) {
    delete auth.pendingKey; delete auth.pendingKeyHash; delete auth.pendingKeyExpiry;
  }
  if (now - (auth.lastRotated || 0) < KEY_ROTATE_MS) return null;
  const newKey = generateKey();
  auth.pendingKey       = newKey;
  auth.pendingKeyHash   = await sha256(newKey);
  auth.pendingKeyExpiry = now + PENDING_KEY_TTL_MS;
  await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
  await appendChangeLog(env, "Auto-rotation initiated — awaiting device ACK");
  return newKey;
}

async function promoteKey(env, auth) {
  auth.keyHash = auth.pendingKeyHash;
  auth.lastRotated = Date.now();
  auth.lastRotatedReason = "auto";
  delete auth.pendingKey; delete auth.pendingKeyHash; delete auth.pendingKeyExpiry;
  await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
  await appendChangeLog(env, "API key auto-rotated — device confirmed");
}

async function updateDeviceStatus(env, ip, body, config) {
  const status = {
    lastSeen: Date.now(), ip: maskIP(ip),
    connection: body.connection || "wifi",
    uptime:     body.uptime     || 0,
    firmware:   body.firmware   || "unknown",
    freeMemory: body.freeMemory || 0,
    rssi:       body.rssi       || 0,
    ssid:       body.ssid       || "",
    deviceIP:   body.ip         || "",
    sdAvailable:body.sdAvailable|| false,
    batteryPct: body.batteryPct ?? null,
    bgValue: body.bgValue ?? null,
    lastReadingAgeSec: body.lastReadingAgeSec ?? null,
    resetReason: body.resetReason || "",
    source: body.source || "none",
    nsOk: body.nsOk ?? 0,
    nsFail: body.nsFail ?? 0,
    dexOk: body.dexOk ?? 0,
    dexFail: body.dexFail ?? 0,
    bgPollFailStreak: body.bgPollFailStreak ?? 0,
  };

  await env.BGDISPLAY_CONFIG.put("device_status", JSON.stringify(status));

  let telemetry = await env.BGDISPLAY_CONFIG.get("telemetry_recent", { type: "json" }) || [];
  telemetry.unshift({
    ts: Date.now(),
    uptime: status.uptime,
    rssi: status.rssi,
    batteryPct: status.batteryPct,
    bgValue: status.bgValue,
    lastReadingAgeSec: status.lastReadingAgeSec,
  });
  if (telemetry.length > 720) telemetry = telemetry.slice(0, 720);
  await env.BGDISPLAY_CONFIG.put("telemetry_recent", JSON.stringify(telemetry));

  const batteryLowPct = Number(config?.alert_battery_low_pct || 15);
  const staleMin = Number(config?.alert_stale_min || 30);
  const cooldownMs = Number(config?.alert_cooldown_min || 60) * 60 * 1000;

  if (typeof status.batteryPct === "number" && status.batteryPct >= 0 && status.batteryPct <= batteryLowPct) {
    if (await shouldEmitAlert(env, "low-battery", cooldownMs)) {
      await appendChangeLog(env, `Alert: battery low (${status.batteryPct}%)`);
      await appendWorkerEvent(env, { type: "alert", level: "warning", msg: "low-battery", batteryPct: status.batteryPct });
    }
  }

  if (typeof status.lastReadingAgeSec === "number" && status.lastReadingAgeSec > staleMin * 60) {
    if (await shouldEmitAlert(env, "stale-data", cooldownMs)) {
      await appendChangeLog(env, `Alert: stale data (${Math.floor(status.lastReadingAgeSec / 60)} min old)`);
      await appendWorkerEvent(env, { type: "alert", level: "warning", msg: "stale-data", ageSec: status.lastReadingAgeSec });
    }
  }
}


// ─── Router ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const ip = getClientIP(request);

    if (method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    // First boot
    let auth = await env.BGDISPLAY_CONFIG.get("auth", { type: "json" });
    if (!auth) {
      const initialKey = generateKey();
      auth = { keyHash: await sha256(initialKey), lastRotated: Date.now(), initialized: true };
      await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      if (path === "/api/init") return json({ initialKey, message: "Store this key in firmware. It will not be shown again." });
    }

    const configRaw = await env.BGDISPLAY_CONFIG.get("config", { type: "json" });
    const config = normalizeConfig(configRaw);
    if (!(await checkRateLimit(env, `ip:${ip}`, config.rate_limit_per_min || 45))) {
      return json({ error: "Rate limit exceeded" }, 429);
    }

    // ── GET /api/ping — Lightweight version check ─────────────────────────────
    // Device calls this every 5 min — no full config data, just version number
    if (path === "/api/ping" && method === "GET") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);

      const lockStatus = await checkLockout(env, ip);
      if (lockStatus.locked) return json({ error: "Locked", until: lockStatus.until }, 403);

      const keyHash = await sha256(deviceKey);
      if (auth.pendingKeyHash && keyHash === auth.pendingKeyHash) {
        await promoteKey(env, auth);
        return json({ ok: true, keyConfirmed: true });
      }
      if (!isDeviceKeyValid(auth, keyHash)) {
        await recordFailedAuth(env, ip, config.lockout_attempts||5, config.lockout_duration_min||15);
        await incrementFailedAuthCount(env);
        return json({ error: "Invalid key" }, 401);
      }
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);
      await clearFailedAuth(env, ip);

      const version = await getConfigVersion(env);
      const deviceVersion = parseInt(url.searchParams.get("v") || "0");
      return json({
        v:         version,
        changed:   version > deviceVersion,
        ts:        Date.now(),
      });
    }

    // ── GET /api/config — Full config pull ────────────────────────────────────
    if (path === "/api/config" && method === "GET") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) { await incrementFailedAuthCount(env); return json({ error: "Missing key" }, 401); }

      const lockStatus = await checkLockout(env, ip);
      if (lockStatus.locked) return json({ error: "Locked", until: lockStatus.until }, 403);

      const keyHash = await sha256(deviceKey);
      if (auth.pendingKeyHash && keyHash === auth.pendingKeyHash) {
        await promoteKey(env, auth);
        await clearFailedAuth(env, ip);
        const version = await getConfigVersion(env);
        return json({ config, config_version: version, ts: Date.now(), keyConfirmed: true });
      }
      if (!isDeviceKeyValid(auth, keyHash)) {
        await recordFailedAuth(env, ip, config.lockout_attempts||5, config.lockout_duration_min||15);
        await incrementFailedAuthCount(env);
        return json({ error: "Invalid key" }, 401);
      }
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);
      await clearFailedAuth(env, ip);

      const pendingKey = await handleAutoRotation(env, auth);
      auth = await env.BGDISPLAY_CONFIG.get("auth", { type: "json" });
      const version = await getConfigVersion(env);

      const resp = { config, config_version: version, ts: Date.now() };
      if (pendingKey) { resp.newKey = pendingKey; resp.rotateNow = true; }
      return json(resp);
    }

    // ── POST /api/key-ack ─────────────────────────────────────────────────────
    if (path === "/api/key-ack" && method === "POST") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      if (auth.pendingKeyHash && keyHash === auth.pendingKeyHash) {
        await promoteKey(env, auth); return json({ ok: true });
      }
      if (isDeviceKeyValid(auth, keyHash)) return json({ ok: true });
      return json({ error: "Key mismatch" }, 401);
    }

    // ── POST /api/status ──────────────────────────────────────────────────────
    if (path === "/api/status" && method === "POST") {
      if (!(await checkRateLimit(env, `device-write:${ip}`, config.device_write_rate_limit_per_min || 20))) {
        return json({ error: "Device write rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      const valid = isDeviceKeyValid(auth, keyHash);
      if (!valid) return json({ error: "Invalid key" }, 401);
      const reqId = request.headers.get("X-Request-Id") || "";
      const replay = await checkReplayToken(env, `status:${keyHash.slice(0, 12)}`, reqId, 900);
      if (!replay.ok) return json({ error: replay.error }, 409);
      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      let parsed = {};
      try { parsed = rawBody ? JSON.parse(rawBody) : {}; }
      catch { return json({ error: "Invalid JSON" }, 400); }
      await updateDeviceStatus(env, ip, parsed, config);
      return json({ ok: true });
    }

    // ── POST /api/log-upload — Device uploads decrypted SD logs ─────────────
    if (path === "/api/log-upload" && method === "POST") {
      if (!(await checkRateLimit(env, `device-write:${ip}`, config.device_write_rate_limit_per_min || 20))) {
        return json({ error: "Device write rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      const valid = isDeviceKeyValid(auth, keyHash);
      if (!valid) return json({ error: "Invalid key" }, 401);

      const reqId = request.headers.get("X-Request-Id") || request.headers.get("X-Command-Id") || "";
      const replay = await checkReplayToken(env, `log-upload:${keyHash.slice(0, 12)}`, reqId, 1800);
      if (!replay.ok) return json({ error: replay.error }, 409);

      const text = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, text);
      if (!sig.ok) return json({ error: sig.error }, 401);
      if (!text || !text.trim()) return json({ error: "Empty log payload" }, 400);
      if (text.length > 200000) return json({ error: "Log payload too large" }, 413);

      const lineCountHeader = Number(request.headers.get("X-Log-Lines") || 0);
      const lines = Number.isFinite(lineCountHeader) && lineCountHeader > 0
        ? lineCountHeader
        : text.split("\n").filter(Boolean).length;

      const meta = {
        uploadedAt: Date.now(),
        commandId: request.headers.get("X-Command-Id") || "",
        lineCount: lines,
        bytes: text.length,
      };

      await env.BGDISPLAY_CONFIG.put("sdlog:last_text", text);
      await env.BGDISPLAY_CONFIG.put("sdlog:last_meta", JSON.stringify(meta));
      await appendChangeLog(env, `SD logs uploaded (${meta.lineCount} lines)`);
      await appendWorkerEvent(env, { type: "sd-log-upload", lines: meta.lineCount, bytes: meta.bytes });

      return json({ ok: true, meta });
    }

    // ── GET /api/command — Device command pull ───────────────────────────────
    if (path === "/api/command" && method === "GET") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);

      const keyHash = await sha256(deviceKey);
      const valid = isDeviceKeyValid(auth, keyHash);
      if (!valid) return json({ error: "Invalid key" }, 401);
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);

      const cmd = await env.BGDISPLAY_CONFIG.get("command:all", { type: "json" });
      if (!cmd) return json({ pending: false, ts: Date.now() });

      if (cmd.expiresAt && Date.now() > cmd.expiresAt) {
        await env.BGDISPLAY_CONFIG.delete("command:all");
        return json({ pending: false, ts: Date.now() });
      }

      const cmdSig = await signCommandEnvelope(cmd, keyHash);
      return json({
        pending: true,
        command: { id: cmd.id, type: cmd.type, args: cmd.args || {}, createdAt: cmd.createdAt, expiresAt: cmd.expiresAt, sig: cmdSig },
        ts: Date.now(),
      });
    }

    // ── POST /api/command-ack — Device command ACK ───────────────────────────
    if (path === "/api/command-ack" && method === "POST") {
      if (!(await checkRateLimit(env, `device-write:${ip}`, config.device_write_rate_limit_per_min || 20))) {
        return json({ error: "Device write rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);

      const keyHash = await sha256(deviceKey);
      const valid = isDeviceKeyValid(auth, keyHash);
      if (!valid) return json({ error: "Invalid key" }, 401);

      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; }
      catch { return json({ error: "Invalid JSON" }, 400); }

      const reqId = request.headers.get("X-Request-Id") || "";
      const replay = await checkReplayToken(env, `command-ack:${keyHash.slice(0, 12)}`, reqId || (body?.id || ""), 1800);
      if (!replay.ok) return json({ error: replay.error }, 409);

      const cmdId = body?.id;
      if (!cmdId) return json({ error: "Missing command id" }, 400);

      const cmd = await env.BGDISPLAY_CONFIG.get("command:all", { type: "json" });
      if (!cmd || cmd.id !== cmdId) return json({ ok: true, ignored: true });

      const ack = {
        id: cmdId,
        type: cmd.type,
        ok: !!body.ok,
        message: body.message || "",
        ts: Date.now(),
      };
      await env.BGDISPLAY_CONFIG.put("command:last_ack", JSON.stringify(ack));
      await env.BGDISPLAY_CONFIG.delete("command:all");
      await appendChangeLog(env, `Command ${cmd.type} ${ack.ok ? "ACK" : "failed"}`);
      await appendWorkerEvent(env, { type: "command-ack", command: cmd.type, ok: ack.ok, message: ack.message });

      return json({ ok: true });
    }

    // ── Admin routes ──────────────────────────────────────────────────────────
    const cfJwt = request.headers.get("CF-Access-Jwt-Assertion");
    const hasSession = await validateAdminSession(env, request);
    const trustedOrigin = isTrustedAdminOrigin(request, env);
    if (!cfJwt && !trustedOrigin && !hasSession) {
      return json({ error: "Unauthorized. Cloudflare Access is required." }, 401);
    }

    if (path === "/api/admin/session" && method === "GET") {
      const token = await issueAdminSession(env, ip);
      return json({ ok: true, token, expiresInSec: ADMIN_SESSION_TTL_SEC });
    }

    if (path === "/api/admin/config" && method === "GET") {
      const status     = await env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }) || {};
      const changelog  = await env.BGDISPLAY_CONFIG.get("changelog",     { type: "json" }) || [];
      const events     = await env.BGDISPLAY_CONFIG.get("worker_events", { type: "json" }) || [];
      const telemetry  = await env.BGDISPLAY_CONFIG.get("telemetry_recent", { type: "json" }) || [];
      const lastLogUpload = await env.BGDISPLAY_CONFIG.get("sdlog:last_meta", { type: "json" }) || null;
      const secretMeta = await env.BGDISPLAY_CONFIG.get("secret_meta", { type: "json" }) || {};
      const pendingCmd = await env.BGDISPLAY_CONFIG.get("command:all", { type: "json" });
      const lastCmdAck = await env.BGDISPLAY_CONFIG.get("command:last_ack", { type: "json" });
      const failedAuth = await env.BGDISPLAY_AUTH.get("failed_auth_24h", { type: "json" }) || { count: 0 };
      const version    = await getConfigVersion(env);

      const offlineMin = Number(config?.alert_offline_min || 15);
      const cooldownMs = Number(config?.alert_cooldown_min || 60) * 60 * 1000;
      if (status?.lastSeen && Date.now() - status.lastSeen > offlineMin * 60 * 1000) {
        if (await shouldEmitAlert(env, "device-offline", cooldownMs)) {
          await appendChangeLog(env, `Alert: device offline (>${offlineMin} min)`);
          await appendWorkerEvent(env, { type: "alert", level: "warning", msg: "device-offline" });
        }
      }

      const metrics = computeMetrics(status, telemetry, events);

      const now = Date.now();
      const reminders = [];
      if (secretMeta.nightscoutSecretUpdatedAt && now - secretMeta.nightscoutSecretUpdatedAt > 30 * 86400000) {
        reminders.push({ key: "nightscout_secret", msg: "Nightscout secret older than 30 days" });
      }
      if (secretMeta.dexcomPassUpdatedAt && now - secretMeta.dexcomPassUpdatedAt > 30 * 86400000) {
        reminders.push({ key: "dexcom_pass", msg: "Dexcom password older than 30 days" });
      }

      return json({
        config, status, changelog,
        metrics,
        workerEvents: events.slice(0, 20),
        telemetryRecent: telemetry.slice(0, 120),
        secretMeta,
        reminders,
        lastLogUpload,
        pendingCommand: pendingCmd || null,
        lastCommandAck: lastCmdAck || null,
        failedAuthCount:  failedAuth.count,
        lastRotated:      auth.lastRotated,
        nextAutoRotate:   (auth.lastRotated || 0) + KEY_ROTATE_MS,
        keyTail:          auth.keyHash ? auth.keyHash.slice(-4) : "????",
        recoveryKeyEnabled: !!auth.recoveryKeyHash,
        recoveryKeyTail: auth.recoveryKeyHash ? auth.recoveryKeyHash.slice(-4) : "",
        recoveryKeyUpdatedAt: auth.recoveryKeyUpdatedAt || null,
        rotateDays:       7,
        pendingRotation:  !!(auth.pendingKeyHash),
        config_version:   version,
        device_config_version: status?.config_version || 0,
      });
    }

    if (path === "/api/admin/config" && method === "POST") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }
      const adminReqId = request.headers.get("X-Request-Id") || "";
      const adminReplay = await checkReplayToken(env, `admin-config:${ip}`, adminReqId, 900);
      if (!adminReplay.ok) return json({ error: adminReplay.error }, 409);

      const body = await request.json().catch(() => null);
      if (!body) return json({ error: "Invalid JSON" }, 400);
      const merged = normalizeConfig({ ...config, ...body });

      const secretMeta = await env.BGDISPLAY_CONFIG.get("secret_meta", { type: "json" }) || {};
      if (typeof body.nightscout_secret === "string" && body.nightscout_secret !== config.nightscout_secret) {
        secretMeta.nightscoutSecretUpdatedAt = Date.now();
      }
      if (typeof body.dexcom_pass === "string" && body.dexcom_pass !== config.dexcom_pass) {
        secretMeta.dexcomPassUpdatedAt = Date.now();
      }

      await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(merged));
      await env.BGDISPLAY_CONFIG.put("secret_meta", JSON.stringify(secretMeta));
      const newVersion = await incrementConfigVersion(env);
      await appendChangeLog(env, `Config updated (v${newVersion})`);
      if (merged.auto_backup) {
        await env.BGDISPLAY_CONFIG.put(`backup:${Date.now()}`, JSON.stringify(merged), { expirationTtl: 30*86400 });
      }
      console.log(`Config v${newVersion} saved`);
      await appendWorkerEvent(env, { type: "config-save", version: newVersion });

      return json({ ok: true, config_version: newVersion });
    }

    if (path === "/api/admin/metrics" && method === "GET") {
      const status = await env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }) || {};
      const telemetry = await env.BGDISPLAY_CONFIG.get("telemetry_recent", { type: "json" }) || [];
      const events = await env.BGDISPLAY_CONFIG.get("worker_events", { type: "json" }) || [];
      const metrics = computeMetrics(status, telemetry, events);
      return json({
        metrics,
        telemetryRecent: telemetry.slice(0, 120),
        workerEvents: events.slice(0, 40),
      });
    }

    if (path === "/api/admin/logs/latest" && method === "GET") {
      const meta = await env.BGDISPLAY_CONFIG.get("sdlog:last_meta", { type: "json" });
      const text = await env.BGDISPLAY_CONFIG.get("sdlog:last_text");
      if (!meta || !text) return json({ error: "No uploaded logs yet" }, 404);

      const q = (url.searchParams.get("q") || "").toLowerCase();
      const lvl = (url.searchParams.get("lvl") || "").toUpperCase();
      const limit = Math.max(1, Math.min(400, Number(url.searchParams.get("limit") || 80)));
      const filtered = text
        .split("\n")
        .filter(Boolean)
        .filter(line => !q || line.toLowerCase().includes(q))
        .filter(line => !lvl || line.includes(`\"lvl\":\"${lvl}\"`));

      if (url.searchParams.get("download") === "1") {
        const ts = new Date(meta.uploadedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
        return new Response(text, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="bgdisplay-sd-logs-${ts}.log"`,
          },
        });
      }

      return json({
        meta,
        total: filtered.length,
        preview: filtered.slice(0, limit),
      });
    }

    if (path === "/api/admin/maintenance" && method === "GET") {
      const status = await env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }) || {};
      const secretMeta = await env.BGDISPLAY_CONFIG.get("secret_meta", { type: "json" }) || {};
      const now = Date.now();
      return json({
        rebootSchedule: "Daily 03:00 local",
        lastResetReason: status.resetReason || "unknown",
        sourceFailStreak: Number(status.bgPollFailStreak || 0),
        keyRotationDueInMs: Math.max(0, ((auth.lastRotated || 0) + KEY_ROTATE_MS) - now),
        nightscoutSecretAgeDays: secretMeta.nightscoutSecretUpdatedAt ? Math.floor((now - secretMeta.nightscoutSecretUpdatedAt) / 86400000) : null,
        dexcomPassAgeDays: secretMeta.dexcomPassUpdatedAt ? Math.floor((now - secretMeta.dexcomPassUpdatedAt) / 86400000) : null,
      });
    }

    if (path === "/api/admin/command" && method === "POST") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }
      const adminReqId = request.headers.get("X-Request-Id") || "";
      const adminReplay = await checkReplayToken(env, `admin-command:${ip}`, adminReqId, 900);
      if (!adminReplay.ok) return json({ error: adminReplay.error }, 409);

      const body = await request.json().catch(() => null);
      if (!body?.type) return json({ error: "Missing command type" }, 400);

      const allowed = ["reboot", "sync-now", "upload-logs", "factory-reset"];
      if (!allowed.includes(body.type)) return json({ error: "Unsupported command" }, 400);

      const cmd = {
        id: crypto.randomUUID(),
        type: body.type,
        args: body.args || {},
        createdAt: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000,
      };

      await env.BGDISPLAY_CONFIG.put("command:all", JSON.stringify(cmd));
      await appendChangeLog(env, `Command queued: ${cmd.type}`);
      await appendWorkerEvent(env, { type: "command-queue", command: cmd.type });

      return json({ ok: true, command: cmd });
    }

    if (path === "/api/admin/recovery-key" && method === "POST") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }

      const body = await request.json().catch(() => null);
      if (!body || typeof body.recovery_device_key !== "string") {
        return json({ error: "Missing recovery_device_key" }, 400);
      }

      const key = body.recovery_device_key.trim();
      if (!key || key.length < 16 || key.length > 96 || !key.startsWith("bg_ro_")) {
        return json({ error: "Invalid recovery key format" }, 400);
      }

      auth.recoveryKeyHash = await sha256(key);
      auth.recoveryKeyUpdatedAt = Date.now();
      await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      await appendChangeLog(env, "Recovery firmware key updated");
      await appendWorkerEvent(env, { type: "recovery-key-update" });

      return json({ ok: true, recoveryKeyTail: auth.recoveryKeyHash.slice(-4), recoveryKeyUpdatedAt: auth.recoveryKeyUpdatedAt });
    }

    if (path === "/api/admin/recovery-key" && method === "DELETE") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }

      delete auth.recoveryKeyHash;
      delete auth.recoveryKeyUpdatedAt;
      await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      await appendChangeLog(env, "Recovery firmware key cleared");
      await appendWorkerEvent(env, { type: "recovery-key-clear" });

      return json({ ok: true });
    }

    if (path === "/api/admin/clear-log" && method === "POST") {
      await env.BGDISPLAY_CONFIG.put("changelog", JSON.stringify([]));
      return json({ ok: true });
    }

    if (path === "/api/admin/export" && method === "GET") {
      const version = await getConfigVersion(env);
      return new Response(JSON.stringify({ config, exportedAt: Date.now(), version: "2.0.0", config_version: version }, null, 2), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="bgdisplay-config-${Date.now()}.json"` },
      });
    }

    if (path === "/api/admin/import" && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.config) return json({ error: "Invalid import file" }, 400);
      const merged = normalizeConfig(body.config);
      await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(merged));
      const newVersion = await incrementConfigVersion(env);
      await appendChangeLog(env, `Config imported from backup (v${newVersion})`);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  },
};
