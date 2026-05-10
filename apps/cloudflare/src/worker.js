// BG MiniView Cloudflare Worker v3.0
// Features: WebSocket relay (DO), Workers AI digest, MCP server, Pushover alerts


const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Device-Key, X-Device-Id, X-Command-Id, X-Log-Lines, X-Admin-Session, CF-Access-Jwt-Assertion",
};

const KEY_ROTATE_MS      = 7 * 24 * 60 * 60 * 1000;
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

// â”€â”€â”€ Geo IP Timezone Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Maps Cloudflare's IANA timezone to BG MiniView's supported zones (US only for now)
function detectTimezoneFromIANA(ianaName) {
  const mapping = {
    // Central Time
    "America/Chicago": "US/Central",
    "America/Mexico_City": "US/Central",
    "America/Belize": "US/Central",
    "America/Costa_Rica": "US/Central",
    "America/Guatemala": "US/Central",
    "America/Honduras": "US/Central",
    "America/El_Salvador": "US/Central",
    "America/Winnipeg": "US/Central",
    "America/North_Dakota/Center": "US/Central",
    "America/North_Dakota/New_Salem": "US/Central",
    "CST6CDT": "US/Central",
    // Eastern Time
    "America/New_York": "US/Eastern",
    "America/Detroit": "US/Eastern",
    "America/Indiana/Indianapolis": "US/Eastern",
    "America/Indiana/Knox": "US/Eastern",
    "America/Indiana/Marengo": "US/Eastern",
    "America/Indiana/Petersburg": "US/Eastern",
    "America/Indiana/Tell_City": "US/Eastern",
    "America/Indiana/Vevay": "US/Eastern",
    "America/Indiana/Vincennes": "US/Eastern",
    "America/Indiana/Winamac": "US/Eastern",
    "America/Kentucky/Louisville": "US/Eastern",
    "America/Kentucky/Monticello": "US/Eastern",
    "America/Toronto": "US/Eastern",
    "EST5EDT": "US/Eastern",
    // Mountain Time
    "America/Denver": "US/Mountain",
    "America/Boise": "US/Mountain",
    "America/Phoenix": "US/Mountain",
    "America/Anchorage": "US/Mountain",
    "America/Adak": "US/Mountain",
    "America/Juneau": "US/Mountain",
    "America/Metlakatla": "US/Mountain",
    "America/Nome": "US/Mountain",
    "America/Sitka": "US/Mountain",
    "America/Yakutat": "US/Mountain",
    "America/Fort_Nelson": "US/Mountain",
    "America/Edmonton": "US/Mountain",
    "MST7MDT": "US/Mountain",
    // Pacific Time
    "America/Los_Angeles": "US/Pacific",
    "America/Vancouver": "US/Pacific",
    "America/Tijuana": "US/Pacific",
    "PST8PDT": "US/Pacific",
  };
  return mapping[ianaName] || "US/Central";
}

const DEFAULT_CONFIG = {
  // WiFi
  wifi_ssid: "", wifi_pass: "", cellular_fallback: false, reconnect_attempts: 5,
  // Nightscout (fallback)
  nightscout_url: "", nightscout_secret: "",
  // Dexcom (primary)
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
  // Feature 4: Pushover alerts (non-sensitive fields only; credentials stored encrypted separately)
  pushover_enabled: false,
  pushover_alert_cooldown_min: 15,
  // Feature 4b: Daily digest push to Pushover
  digest_pushover_enabled: false,
  digest_pushover_hour: 7,  // hour in US/Central time to send the digest (0–23)
  // AI context: insulin therapy / pump profile
  insulin_pump_type: "none",
  insulin_pump_brand: "",
  insulin_pump_model: "",
  insulin_pump_loop_mode: "none",
  insulin_pump_notes: "",
};

function normalizeConfig(cfg) {
  const out = { ...DEFAULT_CONFIG, ...(cfg || {}) };

  if (out.config_ping_min === undefined && out.config_ping_sec !== undefined) {
    const sec = Number(out.config_ping_sec);
    out.config_ping_min = Number.isFinite(sec) ? Math.max(1, Math.round(sec / 60)) : 1;
  }

  // Strip retired MQTT fields and legacy keys
  delete out.mqtt_host; delete out.mqtt_user; delete out.mqtt_pass;
  delete out.config_ping_sec;
  // Pushover credentials are stored encrypted, never in the main config blob
  delete out.pushover_user_key; delete out.pushover_api_token;

  out.alert_offline_min = Math.max(5, Math.min(240, Number(out.alert_offline_min || 15)));
  out.alert_stale_min = Math.max(5, Math.min(240, Number(out.alert_stale_min || 30)));
  out.alert_battery_low_pct = Math.max(5, Math.min(40, Number(out.alert_battery_low_pct || 15)));
  out.alert_cooldown_min = Math.max(5, Math.min(360, Number(out.alert_cooldown_min || 60)));
  out.rate_limit_per_min = Math.max(10, Math.min(300, Number(out.rate_limit_per_min || 45)));
  out.device_write_rate_limit_per_min = Math.max(5, Math.min(180, Number(out.device_write_rate_limit_per_min || 20)));
  out.admin_write_rate_limit_per_min = Math.max(3, Math.min(120, Number(out.admin_write_rate_limit_per_min || 15)));
  out.dnd_use_schedule = out.dnd_use_schedule !== false;
  out.dnd_schedule = normalizeDndSchedule(out.dnd_schedule, out.dnd_from, out.dnd_to);
  out.pushover_alert_cooldown_min = Math.max(5, Math.min(60, Number(out.pushover_alert_cooldown_min || 15)));
  out.digest_pushover_hour = Math.max(0, Math.min(23, Number(out.digest_pushover_hour ?? 7)));
  const pumpType = String(out.insulin_pump_type || "none").trim().toLowerCase();
  out.insulin_pump_type = ["none", "pump", "patch-pump"].includes(pumpType) ? pumpType : "none";
  out.insulin_pump_brand = String(out.insulin_pump_brand || "").trim().slice(0, 40);
  out.insulin_pump_model = String(out.insulin_pump_model || "").trim().slice(0, 40);
  out.insulin_pump_loop_mode = String(out.insulin_pump_loop_mode || "No automation").trim().slice(0, 60);
  out.insulin_pump_notes = String(out.insulin_pump_notes || "").trim().slice(0, 180);

  return out;
}

// ─── Core Helpers ─────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

function mcpResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}

function mcpError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }), {
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Expires": "0",
    },
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
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Hex(key, msg) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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
  try { return new URL(urlLike).hostname.toLowerCase(); } catch { return ""; }
}

function isTrustedAdminOrigin(request, env) {
  const originHost = parseHost(request.headers.get("Origin") || "");
  const refererHost = parseHost(request.headers.get("Referer") || "");
  const defaults = ["bgdisplay-ui.pages.dev", "setup.2brokeboys.uk", "localhost", "127.0.0.1"];
  const extra = String(env.ADMIN_ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean)
    .map(h => h.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  const allowed = new Set([...defaults, ...extra]);
  return allowed.has(originHost) || allowed.has(refererHost);
}

// ─── KV Encryption (AES-256-GCM, key from env.KV_ENCRYPT_KEY secret) ──────────

function hexToUint8(hex) {
  const h = hex.replace(/[^0-9a-fA-F]/g, "").slice(0, 64).padEnd(64, "0");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function kvEncrypt(plaintext, keyHex) {
  if (!keyHex) return null;
  const keyBytes = hexToUint8(keyHex);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv); combined.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...combined));
}

async function kvDecrypt(ciphertext, keyHex) {
  if (!keyHex || !ciphertext) return null;
  try {
    const keyBytes = hexToUint8(keyHex);
    const cryptoKey = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    const combined = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12), enc = combined.slice(12);
    const dec = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, enc);
    return new TextDecoder().decode(dec);
  } catch { return null; }
}

// ─── Dexcom Share Fetch Helper (used by MCP get_current_bg) ──────────────────

const DEXCOM_US_BASE  = "https://share2.dexcom.com/ShareWebServices/Services";
const DEXCOM_OUS_BASE = "https://shareous1.dexcom.com/ShareWebServices/Services";
const DEXCOM_APP_ID   = "d8665ade-9673-4e27-9ff6-92db4ce13d13";

// Standard Dexcom/Nightscout trend scale (0-8)
const TREND_NAMES = {
  0: "None", 1: "DoubleUp", 2: "SingleUp", 3: "FortyFiveUp",
  4: "Flat", 5: "FortyFiveDown", 6: "SingleDown", 7: "DoubleDown", 8: "NotComputable",
};

// Accepts either a Dexcom numeric trend (0-8) or a Nightscout direction string.
// Returns { numeric, name } on the standard Dexcom scale.
function normalizeTrend(trendNum, directionStr) {
  const nsToNum = {
    DoubleUp: 1, SingleUp: 2, FortyFiveUp: 3, Flat: 4,
    FortyFiveDown: 5, SingleDown: 6, DoubleDown: 7,
  };
  if (directionStr && nsToNum[directionStr] !== undefined) {
    return { numeric: nsToNum[directionStr], name: directionStr };
  }
  const n = parseInt(trendNum, 10);
  if (!Number.isNaN(n) && n >= 0 && n <= 8) {
    return { numeric: n, name: TREND_NAMES[n] || "None" };
  }
  return { numeric: 4, name: "Flat" };
}

async function fetchDexcomShareLatest(config) {
  if (!config.dexcom_user || !config.dexcom_pass) return null;
  const base = config.dexcom_region === "Non-US" ? DEXCOM_OUS_BASE : DEXCOM_US_BASE;
  try {
    // Step 1: Authenticate — returns a quoted session UUID
    const authResp = await fetch(`${base}/General/AuthenticatePublisherAccount`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ accountName: config.dexcom_user, password: config.dexcom_pass, applicationId: DEXCOM_APP_ID }),
      signal: AbortSignal.timeout(8000),
    });
    if (!authResp.ok) return null;
    const sessionId = (await authResp.text()).replace(/^"|"$/g, "").trim();
    if (!sessionId || sessionId === "00000000-0000-0000-0000-000000000000") return null;

    // Step 2: Fetch latest reading
    const readResp = await fetch(
      `${base}/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${encodeURIComponent(sessionId)}&minutes=1440&maxCount=1`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) },
    );
    if (!readResp.ok) return null;
    const data = await readResp.json();
    if (!Array.isArray(data) || !data.length || !data[0].Value) return null;
    const r = data[0];
    // Dexcom date format: "Date(1234567890123)" or "Date(1234567890123+0000)"
    let ts = null;
    const m = (r.WT || r.ST || "").match(/Date\((\d+)/);
    if (m) ts = parseInt(m[1], 10);
    return { value: r.Value, trend: r.Trend ?? 4, direction: null, timestamp: ts };
  } catch { return null; }
}

// ─── Shared formatting helpers ─────────────────────────────────────────────────

function formatAgeDays(epochSec, nowSec) {
  if (!epochSec || epochSec <= 0) return null;
  const diffSec = nowSec - epochSec;
  if (diffSec < 0) return null;
  const days = diffSec / 86400;
  if (days < 1) return `${Math.round(diffSec / 3600)}h ago`;
  return `${days.toFixed(1)} days ago`;
}

// ─── Dexcom Sensor Session ─────────────────────────────────────────────────────

const DEXCOM_SENSOR_CACHE_KEY = "dexcom:sensor_session";
const DEXCOM_SENSOR_CACHE_MAX_AGE_SEC = 3 * 60 * 60; // 3h — sensor session changes rarely

async function fetchDexcomSensorSession(config, env) {
  if (!config.dexcom_user || !config.dexcom_pass) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (env?.BGDISPLAY_CONFIG) {
    const cached = await env.BGDISPLAY_CONFIG.get(DEXCOM_SENSOR_CACHE_KEY, { type: "json" });
    const cacheTs = Number(cached?.fetchedAt || 0);
    if (cached?.session_start_ts && (nowSec - cacheTs) <= DEXCOM_SENSOR_CACHE_MAX_AGE_SEC) {
      return cached;
    }
  }

  const base = config.dexcom_region === "Non-US" ? DEXCOM_OUS_BASE : DEXCOM_US_BASE;
  try {
    const authResp = await fetch(`${base}/General/AuthenticatePublisherAccount`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ accountName: config.dexcom_user, password: config.dexcom_pass, applicationId: DEXCOM_APP_ID }),
      signal: AbortSignal.timeout(8000),
    });
    if (!authResp.ok) return null;
    const sessionId = (await authResp.text()).replace(/^"|"$/g, "").trim();
    if (!sessionId || sessionId === "00000000-0000-0000-0000-000000000000") return null;

    // Fetch 10 days of readings to find where current sensor session started
    const readResp = await fetch(
      `${base}/Publisher/ReadPublisherLatestGlucoseValues?sessionId=${encodeURIComponent(sessionId)}&minutes=14400&maxCount=2880`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) },
    );
    if (!readResp.ok) return null;
    const data = await readResp.json();
    if (!Array.isArray(data) || !data.length) return null;

    // Parse timestamps (Dexcom format: "Date(1234567890123)")
    const readings = data.map(r => {
      const m = (r.WT || r.ST || "").match(/Date\((\d+)/);
      return m ? Math.floor(parseInt(m[1], 10) / 1000) : 0;
    }).filter(t => t > 0).sort((a, b) => b - a); // newest first

    // Walk backwards to find the start of the current contiguous session
    // A gap > 30 min (1800s) means a new sensor was inserted
    const GAP_SEC = 1800;
    let sessionStartTs = readings[readings.length - 1]; // default: oldest reading
    for (let i = 0; i < readings.length - 1; i++) {
      const gap = readings[i] - readings[i + 1];
      if (gap > GAP_SEC) {
        sessionStartTs = readings[i]; // reading just after the gap = current session start
        break;
      }
    }

    const sessionAgeDays = (nowSec - sessionStartTs) / 86400;
    // G7 is 10-day sensor, G6 is also 10 days
    const daysRemaining = Math.max(0, 10 - sessionAgeDays);

    const result = {
      session_start_ts: sessionStartTs,
      session_start_iso: new Date(sessionStartTs * 1000).toISOString(),
      session_age_days: parseFloat(sessionAgeDays.toFixed(2)),
      days_remaining: parseFloat(daysRemaining.toFixed(2)),
      fetchedAt: nowSec,
    };

    if (env?.BGDISPLAY_CONFIG) {
      await env.BGDISPLAY_CONFIG.put(
        DEXCOM_SENSOR_CACHE_KEY,
        JSON.stringify(result),
        { expirationTtl: 24 * 60 * 60 },
      );
    }
    return result;
  } catch { return null; }
}

// ─── Nightscout Fetch Helpers (used by cron jobs and MCP) ─────────────────────

async function fetchNightscoutLatest(config) {
  if (!config.nightscout_url) return null;
  try {
    const base = config.nightscout_url.replace(/\/$/, "");
    const token = config.nightscout_secret ? `&token=${encodeURIComponent(config.nightscout_secret)}` : "";
    const resp = await fetch(`${base}/api/v1/entries.json?count=1${token}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch { return null; }
}

async function fetchNightscoutHistory(config, count = 24) {
  if (!config.nightscout_url) return [];
  try {
    const base = config.nightscout_url.replace(/\/$/, "");
    const token = config.nightscout_secret ? `&token=${encodeURIComponent(config.nightscout_secret)}` : "";
    const n = Math.min(288, Math.max(1, count));
    const resp = await fetch(`${base}/api/v1/entries.json?count=${n}${token}`, {
      headers: { "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return [];
    return resp.json();
  } catch { return []; }
}

// ─── DND Window Check (Worker-side, for cron Pushover guard) ──────────────────

function isInDNDWindow(config) {
  if (!config.dnd_enabled) return false;
  const tzMap = {
    "US/Central": "America/Chicago", "US/Eastern": "America/New_York",
    "US/Mountain": "America/Denver", "US/Pacific": "America/Los_Angeles",
  };
  const ianaZone = tzMap[config.timezone] || "America/Chicago";
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: ianaZone, weekday: "short",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (type) => parts.find(p => p.type === type)?.value || "0";
    const dayShort = get("weekday").toLowerCase().slice(0, 3);
    const hour = parseInt(get("hour")); const minute = parseInt(get("minute"));
    const curMin = (hour === 24 ? 0 : hour) * 60 + minute;

    let fromStr, toStr;
    if (config.dnd_use_schedule !== false && config.dnd_schedule?.[dayShort]) {
      fromStr = config.dnd_schedule[dayShort].from || config.dnd_from || "23:00";
      toStr   = config.dnd_schedule[dayShort].to   || config.dnd_to   || "06:00";
    } else {
      fromStr = config.dnd_from || "23:00"; toStr = config.dnd_to || "06:00";
    }
    const [fH, fM] = fromStr.split(":").map(Number);
    const [tH, tM] = toStr.split(":").map(Number);
    const fromMin = fH * 60 + fM, toMin = tH * 60 + tM;
    return fromMin > toMin ? (curMin >= fromMin || curMin < toMin) : (curMin >= fromMin && curMin < toMin);
  } catch { return false; }
}

// ─── Trend Arrow Text ──────────────────────────────────────────────────────────

function trendArrowText(trend) {
  const names = {
    2: "↑↑ Rising Rapidly", 3: "↑ Rising", 4: "↗ Rising Slightly",
    5: "→ Stable", 6: "↘ Falling Slightly", 7: "↓ Falling", 8: "↓↓ Falling Rapidly",
  };
  return names[trend] || "→ Stable";
}

function directionToTrend(dir) {
  const m = { DoubleUp: 2, SingleUp: 3, FortyFiveUp: 4, Flat: 5, FortyFiveDown: 6, SingleDown: 7, DoubleDown: 8 };
  return m[dir] || 5;
}

function truncateToSentence(text, maxChars) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;

  const clipped = clean.slice(0, maxChars);
  const sentenceEnd = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (sentenceEnd >= Math.floor(maxChars * 0.6)) {
    return clipped.slice(0, sentenceEnd + 1).trim();
  }

  const wordEnd = clipped.lastIndexOf(" ");
  const safe = (wordEnd > 0 ? clipped.slice(0, wordEnd) : clipped).trim();
  return `${safe}...`;
}

const AI_MODEL_ALIASES = {
  "llama-3.1-8b": "@cf/meta/llama-3.1-8b-instruct",
  "llama-3.3-70b": "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "llama-3.2-3b": "@cf/meta/llama-3.2-3b-instruct",
  "mistral-7b": "@cf/mistral/mistral-7b-instruct-v0.2",
  "gemma-7b": "@cf/google/gemma-7b-it",
};

const DEFAULT_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct";

function normalizeAiText(raw, maxChars) {
  const flattened = String(raw || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncateToSentence(flattened, maxChars);
}

function isAiTextUsable(text, type) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^ai\s+error:/i.test(t)) return false;
  if (/^ai\s+digest\s+unavailable/i.test(t)) return false;
  if (/^i\s+cannot|^i\s+can\'?t|as\s+an\s+ai\s+language\s+model/i.test(t)) return false;
  const minLen = type === "hourly" ? 35 : 80;
  return t.length >= minLen;
}

function buildDeterministicDigest(type, ctx) {
  const {
    tir, low, high, aboveHigh, belowLow, urgLows, urgHighs,
    overnightAvg, latest, latestTrend, latestAgeMin,
    avgDelta, variability, latestLocalTime,
  } = ctx;

  if (type === "hourly") {
    return [
      `Current glucose is ${latest ?? "unknown"} mg/dL (${latestTrend}) from ${latestLocalTime}, about ${latestAgeMin ?? "unknown"} minutes ago.`,
      `Over the past hour, movement averaged ${avgDelta >= 0 ? "+" : ""}${avgDelta} mg/dL per 5 minutes with variability near ${variability} mg/dL.`
    ].join(" ");
  }

  const rangeLine = `In the last 24 hours, time in range (${low}-${high} mg/dL) was ${tir}%.`;
  const eventsLine = `There were ${belowLow} lows, ${aboveHigh} highs, with urgent events at ${urgLows} low and ${urgHighs} high readings.`;
  const overnightLine = overnightAvg != null
    ? `Overnight average glucose was ${overnightAvg} mg/dL.`
    : "Overnight average could not be calculated from available data.";
  const nowLine = `Current glucose is ${latest ?? "unknown"} mg/dL (${latestTrend}) from ${latestLocalTime}, about ${latestAgeMin ?? "unknown"} minutes ago.`;
  const trendLine = `Recent movement averaged ${avgDelta >= 0 ? "+" : ""}${avgDelta} mg/dL per 5 minutes with variability near ${variability} mg/dL.`;
  return [rangeLine, eventsLine, overnightLine, nowLine, trendLine].join(" ");
}

function getCentralDateParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

function buildDigestStorageMeta(type, now = new Date()) {
  const central = getCentralDateParts(now);
  return {
    date: central.date,
    hour: central.hour,
    key: type === "hourly" ? `hourly_digest_${central.hour}` : "daily_digest",
  };
}

function formatTimestampLocal(ts) {
  if (!Number.isFinite(ts)) return "unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(ts));
}

// ─── Feature 2: Daily & Hourly AI Digest ──────────────────────────────────────

async function generateDailyDigest(env, force = false, type = "daily") {
  const storage = buildDigestStorageMeta(type);
  const today = storage.date;
  if (!force) {
    if (type === "daily" && storage.hour !== 7) return;
    if (type === "hourly" && (storage.hour < 8 || storage.hour > 23)) return;
  }
  
  // Guard: only run once per calendar day/hour (bypassed when force=true)
  const stored = await env.BGDISPLAY_CONFIG.get(storage.key, { type: "json" });
  if (!force && stored?.date === today) return;

  const config = normalizeConfig(await env.BGDISPLAY_CONFIG.get("config", { type: "json" }));

  if (!config.nightscout_url) {
    const text = type === "hourly" ? "No Nightscout URL configured." : "No Nightscout URL configured.";
    await env.BGDISPLAY_CONFIG.put(storage.key, JSON.stringify({
      text, generatedAt: Date.now(), date: today, type,
    }));
    return;
  }

  // Fetch readings: 288 for 24h daily, 12 for 1h hourly
  const readingCount = type === "hourly" ? 12 : 288;
  const readings = await fetchNightscoutHistory(config, readingCount);
  if (!readings.length) {
    await env.BGDISPLAY_CONFIG.put(storage.key, JSON.stringify({
      text: "No readings available for digest.", generatedAt: Date.now(), date: today, type,
    }));
    return;
  }

  const values = readings.map(r => r.sgv).filter(v => v > 0);
  const latest = readings[0] || null;
  const low = config.low || 70, high = config.high || 180;
  const urgLow = config.urgent_low || 55, urgHigh = config.urgent_high || 250;
  const tir = (values.filter(v => v >= low && v <= high).length / values.length * 100).toFixed(0);
  const belowLow = values.filter(v => v < low).length;
  const aboveHigh = values.filter(v => v > high).length;
  const urgLows = values.filter(v => v < urgLow).length;
  const urgHighs = values.filter(v => v > urgHigh).length;
  const minVal = Math.min(...values), maxVal = Math.max(...values);
  const avgVal = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  const latestTrend = latest?.direction || latest?.trend || "unknown";
  const latestAgeMin = latest?.date ? Math.max(0, Math.round((Date.now() - latest.date) / 60000)) : null;
  const latestLocalTime = latest?.date ? formatTimestampLocal(latest.date) : "unknown";
  const deltaParts = [];
  for (let i = 0; i < Math.min(values.length - 1, 6); i += 1) {
    deltaParts.push(values[i] - values[i + 1]);
  }
  const avgDelta = deltaParts.length ? Math.round(deltaParts.reduce((sum, value) => sum + value, 0) / deltaParts.length) : 0;
  const variability = values.length > 1
    ? Math.round(Math.sqrt(values.reduce((sum, value) => sum + Math.pow(value - avgVal, 2), 0) / values.length))
    : 0;
  const overnightValues = type === "daily"
    ? readings.filter(r => {
        const hr = getCentralDateParts(new Date(r.date)).hour;
        return hr >= 0 && hr < 6;
      }).map(r => r.sgv).filter(v => v > 0)
    : [];
  const overnightAvg = overnightValues.length
    ? Math.round(overnightValues.reduce((sum, value) => sum + value, 0) / overnightValues.length)
    : null;

  const statsLine = `${values.length} readings over ${type === "hourly" ? "1h" : "24h"}. TIR (${low}–${high} mg/dL): ${tir}%. Below ${low}: ${belowLow}x. Above ${high}: ${aboveHigh}x. Urgent lows (<${urgLow}): ${urgLows}x. Urgent highs (>${urgHigh}): ${urgHighs}x. Min/Max/Avg: ${minVal}/${maxVal}/${avgVal} mg/dL.`;
  const recentStr = values.slice(0, 12).join(", ");
  const pumpProfile = {
    type: config.insulin_pump_type || "none",
    brand: config.insulin_pump_brand || "",
    model: config.insulin_pump_model || "",
    loopMode: config.insulin_pump_loop_mode || "none",
    notes: config.insulin_pump_notes || "",
  };

  // Fetch Dexcom sensor session age
  let sensorSession = null;
  if (config.dexcom_user && config.dexcom_pass) {
    try { sensorSession = await fetchDexcomSensorSession(config, env); } catch {}
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // Build sensor context line for AI prompt
  let sensorContextLine = "";
  if (sensorSession?.session_age_days != null) {
    const daysLeft = sensorSession.days_remaining;
    sensorContextLine = `Dexcom sensor: ${sensorSession.session_age_days.toFixed(1)} days old, ~${daysLeft.toFixed(1)} days remaining.`;
  }

  const configuredModel = String(config.ai_model || "").trim();
  const aiCandidates = Array.from(new Set([
    configuredModel,
    AI_MODEL_ALIASES["llama-3.3-70b"],
    DEFAULT_AI_MODEL,
    AI_MODEL_ALIASES["llama-3.2-3b"],
  ].filter(Boolean)));

  let digestText = "AI digest unavailable — Workers AI binding not configured.";
  let aiModelUsed = configuredModel || DEFAULT_AI_MODEL;

  if (env.AI) {
    const fallbackText = buildDeterministicDigest(type, {
      tir, low, high, aboveHigh, belowLow, urgLows, urgHighs,
      overnightAvg, latest: latest?.sgv, latestTrend, latestAgeMin,
      avgDelta, variability, latestLocalTime,
    });

    try {
      const systemPrompt = type === "hourly"
        ? "You are a concise diabetes health assistant for a Type 2 diabetic using a Dexcom G7 CGM. Write exactly 2 plain-text sentences under 80 words. Sentence 1 must state current glucose and trend status. Sentence 2 must summarize the strongest one-hour pattern using only provided numbers. No bullets, no markdown, no disclaimers, no treatment advice."
        : "You are a concise diabetes health assistant for a Type 2 diabetic using a Dexcom G7 CGM. Write exactly 4 plain-text sentences under 180 words. Sentence 1: time in range and notable highs/lows. Sentence 2: overnight pattern. Sentence 3: current reading and trend. Sentence 4: one concrete observation from short-term movement or variability. Use only provided data. No bullets, no markdown, no disclaimers, no treatment advice.";

      const userContent = [
        `Stats: ${statsLine}`,
        `Current reading: ${latest?.sgv ?? "unknown"} mg/dL at ${latestLocalTime}, trend ${latestTrend}, approximately ${latestAgeMin ?? "unknown"} minutes old.`,
        `Short-term movement: average change ${avgDelta >= 0 ? "+" : ""}${avgDelta} mg/dL per 5-minute step over the latest samples. Variability estimate: ${variability} mg/dL.${overnightAvg != null ? ` Overnight average: ${overnightAvg} mg/dL.` : ""}`,
        `Most recent values (newest first): ${recentStr} mg/dL.`,
        sensorContextLine ? sensorContextLine : null,
        `Pump profile: ${JSON.stringify(pumpProfile)}.`,
      ].filter(Boolean).join(" ");

      const maxDigestChars = type === "hourly" ? 900 : 980;
      let bestErr = null;
      for (const candidateModel of aiCandidates) {
        try {
          const aiResp = await env.AI.run(candidateModel, {
            max_tokens: type === "hourly" ? 120 : 280,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
          });
          const candidateText = normalizeAiText(aiResp?.response || "", maxDigestChars);
          if (isAiTextUsable(candidateText, type)) {
            digestText = candidateText;
            aiModelUsed = candidateModel;
            break;
          }
        } catch (err) {
          bestErr = err;
        }
      }

      if (!isAiTextUsable(digestText, type)) {
        digestText = truncateToSentence(fallbackText, type === "hourly" ? 900 : 980);
        aiModelUsed = "fallback:deterministic";
        if (bestErr) {
          await appendChangeLog(env, `AI digest fallback used (${type}) due to model/run error: ${String(bestErr).slice(0, 80)}`);
        }
      }
    } catch (e) {
      digestText = truncateToSentence(buildDeterministicDigest(type, {
        tir, low, high, aboveHigh, belowLow, urgLows, urgHighs,
        overnightAvg, latest: latest?.sgv, latestTrend, latestAgeMin,
        avgDelta, variability, latestLocalTime,
      }), type === "hourly" ? 900 : 980);
      aiModelUsed = "fallback:deterministic";
      await appendChangeLog(env, `AI digest hard-fallback used (${type}): ${String(e).slice(0, 80)}`);
    }
  }

  const digest = {
    text: digestText,
    generatedAt: Date.now(),
    date: today,
    type,
    stats: { tir: Number(tir), min: minVal, max: maxVal, avg: avgVal, readingCount: values.length },
    ai_model: aiModelUsed,
  };
  await env.BGDISPLAY_CONFIG.put(storage.key, JSON.stringify(digest));
  const logMsg = type === "hourly" ? `Hourly AI digest generated (TIR ${tir}%, ${values.length} readings)` : `Daily AI digest generated (TIR ${tir}%, ${values.length} readings)`;
  await appendChangeLog(env, logMsg);
}

// ─── Feature 2b: Digest Pushover Send (Daily + Hourly) ────────────────────────

async function sendDigestPushover(env) {
  const config = normalizeConfig(await env.BGDISPLAY_CONFIG.get("config", { type: "json" }));
  if (!config.digest_pushover_enabled) return;

  // Decrypt Pushover credentials
  let creds = null;
  try {
    const enc = await env.BGDISPLAY_CONFIG.get("pushover_creds");
    if (enc && env.KV_ENCRYPT_KEY) {
      const raw = await kvDecrypt(enc, env.KV_ENCRYPT_KEY);
      if (raw) creds = JSON.parse(raw);
    }
  } catch {}
  if (!creds?.user_key || !creds?.api_token) return;

  const centralNow = getCentralDateParts();
  const today = centralNow.date;
  
  // Check for daily digest send (at configured hour)
  const currentHour = centralNow.hour;
  
  if (currentHour === config.digest_pushover_hour) {
    const lastDailySent = await env.BGDISPLAY_CONFIG.get("last_digest_pushover");
    if (lastDailySent !== today) {
      const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
      if (digest && digest.date === today) {
        const title = "BG MiniView - Daily Summary";
        const message = truncateToSentence(digest.text, 1024);
        // priority 0 = normal; daily summaries are informational, not urgent
        const ok = await sendPushoverNotification(creds.user_key, creds.api_token, message, title, 0);
        if (ok) {
          await env.BGDISPLAY_CONFIG.put("last_digest_pushover", today);
          await appendChangeLog(env, "Daily digest sent via Pushover");
        }
      }
    }
  }
  
  // Check for hourly digest send — local hours 8–22 (8 AM – 10 PM inclusive)
  // currentHour is already in America/Chicago local time from toLocaleString above
  if (currentHour >= 8 && currentHour <= 22) {
    // DND guard: don't wake user during DND even for digest updates
    if (!isInDNDWindow(config)) {
      const hourlyKey = `hourly_digest_${currentHour}`;
      const lastHourlySent = await env.BGDISPLAY_CONFIG.get(`${hourlyKey}_pushover_sent`);
      if (lastHourlySent !== today) {
        const digest = await env.BGDISPLAY_CONFIG.get(hourlyKey, { type: "json" });
        if (digest && digest.date === today) {
          const title = "BG MiniView - Hourly Update";
          const message = truncateToSentence(digest.text, 1024);
          // priority 0 = normal (respects device quiet hours); digests are informational
          const ok = await sendPushoverNotification(creds.user_key, creds.api_token, message, title, 0);
          if (ok) {
            await env.BGDISPLAY_CONFIG.put(`${hourlyKey}_pushover_sent`, today);
            await appendChangeLog(env, `Hourly digest sent via Pushover (hour ${currentHour})`);
          }
        }
      }
    }
  }
}

// ─── Feature 4: Pushover Alert Check (runs every 5 min via cron) ──────────────

// priority: -1=quiet, 0=normal, 1=high (bypasses quiet hours), 2=emergency
async function sendPushoverNotification(userKey, apiToken, message, title, priority = 0) {
  const body = new URLSearchParams({
    token: apiToken,
    user: userKey,
    message,
    title,
    priority: String(priority),
  });
  const resp = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(8000),
  });
  return resp.ok;
}

async function loadPushoverCreds(env) {
  try {
    const enc = await env.BGDISPLAY_CONFIG.get("pushover_creds");
    if (enc && env.KV_ENCRYPT_KEY) {
      const raw = await kvDecrypt(enc, env.KV_ENCRYPT_KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return null;
}

async function getPushoverStatus(env, config) {
  const [creds, lastAlert, lastDigestPush, lastOffline] = await Promise.all([
    loadPushoverCreds(env),
    env.BGDISPLAY_CONFIG.get("last_pushover_alert"),
    env.BGDISPLAY_CONFIG.get("last_digest_pushover"),
    env.BGDISPLAY_CONFIG.get("last_offline_alert"),
  ]);
  const nowMs = Date.now();
  const centralNow = getCentralDateParts();
  return {
    configured: !!(creds?.user_key && creds?.api_token),
    alerts_enabled: !!config.pushover_enabled,
    digest_enabled: !!config.digest_pushover_enabled,
    digest_hour_central: Number(config.digest_pushover_hour ?? 7),
    current_central_date: centralNow.date,
    current_central_hour: centralNow.hour,
    cooldown_min: Number(config.pushover_alert_cooldown_min || 15),
    dnd_active: isInDNDWindow(config),
    kv_encrypt_configured: !!env.KV_ENCRYPT_KEY,
    last_bg_alert: lastAlert ? new Date(Number(lastAlert)).toISOString() : null,
    last_bg_alert_age_min: lastAlert ? Math.round((nowMs - Number(lastAlert)) / 60000) : null,
    last_digest_pushover: lastDigestPush || null,
    last_offline_alert: lastOffline ? new Date(Number(lastOffline)).toISOString() : null,
  };
}

async function buildHealthSummary(env, config, auth) {
  const nowMs = Date.now();
  const [deviceStatus, dailyDigest, pushoverStatus] = await Promise.all([
    env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }),
    env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" }),
    getPushoverStatus(env, config),
  ]);
  const offlineMin = Number(config.alert_offline_min || 15);
  const lastSeenMs = Number(deviceStatus?.lastSeen || 0);
  const deviceOnline = !!lastSeenMs && (nowMs - lastSeenMs) < offlineMin * 60000;
  const digestAgeMin = dailyDigest?.generatedAt ? Math.round((nowMs - dailyDigest.generatedAt) / 60000) : null;
  const nextDigestWindow = `Daily 7:00 AM US/Central; hourly 8:00 AM-11:00 PM US/Central`;

  return [
    `Worker health summary`,
    `Device: ${deviceOnline ? "online" : "offline"}${lastSeenMs ? `, last seen ${new Date(lastSeenMs).toISOString()}` : ""}`,
    `Digest: ${dailyDigest ? `present for ${dailyDigest.date}, age ${digestAgeMin} min, model ${(dailyDigest.ai_model || config.ai_model || "@cf/meta/llama-3.1-8b-instruct")}` : "missing"}`,
    `Schedule: ${nextDigestWindow}`,
    `Pushover: ${pushoverStatus.configured ? "configured" : "not configured"}, alerts ${pushoverStatus.alerts_enabled ? "on" : "off"}, digest push ${pushoverStatus.digest_enabled ? `on at ${pushoverStatus.digest_hour_central}:00 Central` : "off"}`,
    `Auth: device key ${auth?.keyHash ? `active (*${auth.keyHash.slice(-4)})` : "missing"}, recovery ${auth?.recoveryKeyHash ? `enabled (*${auth.recoveryKeyHash.slice(-4)})` : "disabled"}`,
    `Bindings: AI ${env.AI ? "ok" : "missing"}, KV encrypt ${env.KV_ENCRYPT_KEY ? "ok" : "missing"}`,
  ].join("\n");
}

async function getKeyAuthStatus(auth, keyCandidate = "") {
  const provided = String(keyCandidate || "").trim();
  let providedState = "not_provided";
  if (provided) {
    const hash = await sha256(provided);
    if (auth?.keyHash && hash === auth.keyHash) providedState = "active";
    else if (auth?.pendingKeyHash && hash === auth.pendingKeyHash) providedState = "pending";
    else if (auth?.recoveryKeyHash && hash === auth.recoveryKeyHash) providedState = "recovery";
    else providedState = "invalid";
  }

  return {
    provided_key_state: providedState,
    pending_rotation: !!auth?.pendingKeyHash,
    active_key_tail: auth?.keyHash ? auth.keyHash.slice(-4) : null,
    pending_key_tail: auth?.pendingKeyHash ? auth.pendingKeyHash.slice(-4) : null,
    recovery_key_tail: auth?.recoveryKeyHash ? auth.recoveryKeyHash.slice(-4) : null,
    recovery_enabled: !!auth?.recoveryKeyHash,
    last_rotated: auth?.lastRotated ? new Date(auth.lastRotated).toISOString() : null,
  };
}

async function buildFullReadinessReport(env, config, auth) {
  const nowMs = Date.now();
  const centralNow = getCentralDateParts();
  const [deviceStatus, dailyDigest, pushoverStatus, keyAuth] = await Promise.all([
    env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }),
    env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" }),
    getPushoverStatus(env, config),
    getKeyAuthStatus(auth),
  ]);
  const offlineMin = Number(config.alert_offline_min || 15);
  const deviceSeen = Number(deviceStatus?.lastSeen || 0);
  const deviceOnline = !!deviceSeen && (nowMs - deviceSeen) < offlineMin * 60000;
  const digestFresh = !!dailyDigest && dailyDigest.date === centralNow.date;
  const digestPushReady = !config.digest_pushover_enabled || (pushoverStatus.configured && Number(config.digest_pushover_hour) === 7);
  const bgAlertsReady = !config.pushover_enabled || pushoverStatus.configured;
  const checks = {
    ai_binding: !!env.AI,
    kv_encrypt_key: !!env.KV_ENCRYPT_KEY,
    auth_key_present: !!auth?.keyHash,
    device_recently_seen: deviceOnline,
    digest_present_today: digestFresh,
    digest_push_ready: digestPushReady,
    bg_alerts_ready: bgAlertsReady,
  };
  const ready = Object.values(checks).every(Boolean);
  return {
    ready,
    checks,
    context: {
      central_date: centralNow.date,
      central_hour: centralNow.hour,
      digest_date: dailyDigest?.date || null,
      digest_generated_at: dailyDigest?.generatedAt ? new Date(dailyDigest.generatedAt).toISOString() : null,
      digest_pushover_hour: Number(config.digest_pushover_hour ?? 7),
      device_last_seen: deviceSeen ? new Date(deviceSeen).toISOString() : null,
      key_auth: keyAuth,
      pushover: pushoverStatus,
    },
    summary: await buildHealthSummary(env, config, auth),
  };
}

// ─── Feature 4c: Device Offline Alert ────────────────────────────────────────

async function runDeviceOfflineCheck(env) {
  const config = normalizeConfig(await env.BGDISPLAY_CONFIG.get("config", { type: "json" }));
  if (!config.pushover_enabled) return;

  let creds = null;
  try {
    const enc = await env.BGDISPLAY_CONFIG.get("pushover_creds");
    if (enc && env.KV_ENCRYPT_KEY) {
      const raw = await kvDecrypt(enc, env.KV_ENCRYPT_KEY);
      if (raw) creds = JSON.parse(raw);
    }
  } catch {}
  if (!creds?.user_key || !creds?.api_token) return;

  // Only fire if device has been silent longer than alert_offline_min
  const offlineThresholdMs = Math.max(5, Number(config.alert_offline_min || 15)) * 60 * 1000;
  const status = await env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }) || {};
  if (!status.lastSeen) return;
  const silentMs = Date.now() - Number(status.lastSeen);
  if (silentMs < offlineThresholdMs) return;

  // Cooldown: don't repeat the offline alert more than once per cooldown window
  const cooldownMs = Math.max(5, Number(config.alert_cooldown_min || 60)) * 60 * 1000;
  const lastOfflineStr = await env.BGDISPLAY_CONFIG.get("last_offline_alert");
  if (lastOfflineStr && Date.now() - Number(lastOfflineStr) < cooldownMs) return;

  const silentMinutes = Math.round(silentMs / 60000);
  const message = `BG MiniView has not checked in for ${silentMinutes} minutes. Device may be offline or unreachable.`;
  const ok = await sendPushoverNotification(creds.user_key, creds.api_token, message, "BG MiniView - Device Offline", 1);
  if (ok) {
    await env.BGDISPLAY_CONFIG.put("last_offline_alert", String(Date.now()));
    await appendChangeLog(env, `Device offline alert sent (silent ${silentMinutes}m)`);
  }
}

async function runPushoverAlertCheck(env) {
  const config = normalizeConfig(await env.BGDISPLAY_CONFIG.get("config", { type: "json" }));
  if (!config.pushover_enabled || !config.nightscout_url) return;

  // Decrypt Pushover credentials
  let creds = null;
  try {
    const enc = await env.BGDISPLAY_CONFIG.get("pushover_creds");
    if (enc && env.KV_ENCRYPT_KEY) {
      const raw = await kvDecrypt(enc, env.KV_ENCRYPT_KEY);
      if (raw) creds = JSON.parse(raw);
    }
  } catch {}
  if (!creds?.user_key || !creds?.api_token) return;

  // Cooldown check
  const cooldownMs = (config.pushover_alert_cooldown_min || 15) * 60000;
  const lastStr = await env.BGDISPLAY_CONFIG.get("last_pushover_alert");
  if (lastStr && Date.now() - Number(lastStr) < cooldownMs) return;

  // DND guard
  if (isInDNDWindow(config)) return;

  const entry = await fetchNightscoutLatest(config);
  if (!entry?.sgv) return;

  const bg = entry.sgv;
  const urgLow = config.urgent_low || 55, urgHigh = config.urgent_high || 250;
  let alertMsg = null, isLow = false;

  if (bg <= urgLow) { isLow = true; alertMsg = `URGENT LOW: ${bg} mg/dL`; }
  else if (bg >= urgHigh) { alertMsg = `URGENT HIGH: ${bg} mg/dL`; }
  if (!alertMsg) return;

  const trend = entry.direction ? directionToTrend(entry.direction) : (entry.trend || 5);
  const fullMsg = `${alertMsg} • ${trendArrowText(trend)}`;
  const title = isLow ? "BG MiniView - Low Alert" : "BG MiniView - High Alert";

  // priority 1 = high (bypasses quiet hours on device) for urgent BG alerts
  const ok = await sendPushoverNotification(creds.user_key, creds.api_token, fullMsg, title, 1);
  if (ok) {
    await env.BGDISPLAY_CONFIG.put("last_pushover_alert", String(Date.now()));
    await appendChangeLog(env, `Pushover alert sent: ${fullMsg}`);
    await appendWorkerEvent(env, { type: "pushover-alert", msg: fullMsg });
  }
}

// ─── Feature 3: MCP Server (JSON-RPC 2.0) ─────────────────────────────────────

const MCP_TOOLS = [
  {
    name: "get_current_bg",
    description: "Fetch the latest blood glucose reading. Tries Dexcom Share first, then falls back to Nightscout. Returns value, trend direction as both numeric (Dexcom 0–8 scale) and human-readable string (e.g. \"Flat\", \"SingleUp\"), ISO timestamp, source used (\"dexcom\" or \"nightscout\"), and staleness in minutes.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_device_status",
    description: "Return device online/offline status, RSSI, firmware version, uptime, SD card, and last seen",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_config",
    description: "Return current full config with passwords redacted",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "update_config",
    description: "Update one or more config fields (snake_case keys), increment version, and trigger device sync",
    inputSchema: {
      type: "object",
      properties: {
        fields: { type: "object", description: "Key-value pairs of config fields to update" },
      },
      required: ["fields"],
    },
  },
  {
    name: "force_sync",
    description: "Queue a sync-now command so the device fetches the latest config immediately",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_change_log",
    description: "Return the last 20 config change log entries",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_bg_history",
    description: "Fetch the last N BG readings from Nightscout (default 24, max 288)",
    inputSchema: {
      type: "object",
      properties: {
        count: { type: "number", description: "Number of readings (default 24, max 288)" },
      },
      required: [],
    },
  },
  {
    name: "detect_timezone",
    description: "Detect user's timezone from their geo IP location. Returns detected IANA timezone and mapped zone (US/Central, US/Eastern, etc). Can be used to auto-set timezone on first boot.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_daily_digest",
    description: "Return today's AI-generated blood glucose morning summary",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_pushover_status",
    description: "Return Pushover configuration and recent delivery state for BG alerts, digest pushes, and offline alerts.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "send_test_pushover",
    description: "Send a controlled Pushover test message using the stored credentials. Use category='general' or 'digest'.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "general | digest" },
        message: { type: "string", description: "Optional custom message body" },
      },
      required: [],
    },
  },
  {
    name: "generate_digest",
    description: "Force-generate today's AI blood glucose summary immediately, bypassing the once-per-day guard",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_device_ages",
    description: "Return current age and remaining life for the Dexcom G7 sensor session.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "clear_cache",
    description: "Clear one or more cached data entries from KV storage. Use target='digests' to clear all AI digest cache (daily + all hourly), 'alerts' to reset Pushover alert history/cooldowns, or 'all' for everything.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "digests | alerts | all" },
      },
      required: ["target"],
    },
  },
  {
    name: "get_maintenance_status",
    description: "Return a full health snapshot: digest freshness, Dexcom sensor cache, binding availability, and alert cooldown state.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_health_summary",
    description: "Return a concise plain-text summary of worker health, digest state, Pushover readiness, and auth status.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_key_auth_status",
    description: "Return key auth status. Optionally pass a key string to check whether it matches active, pending, or recovery key state.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Optional key candidate to classify (active | pending | recovery | invalid)" },
      },
      required: [],
    },
  },
  {
    name: "get_full_readiness",
    description: "Return a single readiness report that combines auth, digest freshness, Pushover readiness, device recency, and binding health.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "run_maintenance",
    description: "Run a maintenance sweep: force-regenerate the daily AI digest and clear hourly digest cache.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_ai_model",
    description: "Change the Workers AI model used for digest generation. Available models: llama-3.1-8b (default, fast), llama-3.3-70b (higher quality, slower), llama-3.2-3b (fastest), mistral-7b, gemma-7b. Pass model alias or full @cf/ path.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: "Model alias: llama-3.1-8b | llama-3.3-70b | llama-3.2-3b | mistral-7b | gemma-7b, or full @cf/ path" },
      },
      required: ["model"],
    },
  },
];

function redactConfig(config) {
  const redacted = { ...config };
  for (const k of [
    "wifi_pass", "nightscout_secret", "dexcom_pass", "dexcom_user",
  ]) {
    if (redacted[k]) redacted[k] = "••••••••";
  }
  return redacted;
}

async function handleMCP(request, env, config, auth) {
  let body;
  try { body = await request.json(); } catch { return mcpError(null, -32700, "Parse error"); }

  const { method, id, params } = body;

  if (method === "initialize") {
    return mcpResult(id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "bg-miniview-mcp", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204 });
  }

  if (method === "tools/list") {
    return mcpResult(id, { tools: MCP_TOOLS });
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const args = params?.arguments || {};

    if (toolName === "get_current_bg") {
      let rawEntry = null;
      let source = null;

      // Try Dexcom Share first
      if (config.dexcom_user && config.dexcom_pass) {
        rawEntry = await fetchDexcomShareLatest(config);
        if (rawEntry) source = "dexcom";
      }

      // Fall back to Nightscout
      if (!rawEntry) {
        const nsEntry = await fetchNightscoutLatest(config);
        if (nsEntry) {
          rawEntry = { value: nsEntry.sgv, trend: nsEntry.trend, direction: nsEntry.direction, timestamp: nsEntry.date };
          source = "nightscout";
        }
      }

      if (!rawEntry) {
        return mcpResult(id, {
          content: [{ type: "text", text: JSON.stringify({ error: "No BG reading available from Dexcom Share or Nightscout." }) }],
        });
      }

      const { numeric: trendNumeric, name: trendName } = normalizeTrend(rawEntry.trend, rawEntry.direction);
      const nowMs = Date.now();
      const staleMin = rawEntry.timestamp ? Math.round((nowMs - rawEntry.timestamp) / 60000) : null;

      const result = {
        value: rawEntry.value,
        unit: config.bg_units || "mg/dL",
        trend_numeric: trendNumeric,
        trend_name: trendName,
        timestamp: rawEntry.timestamp ? new Date(rawEntry.timestamp).toISOString() : null,
        stale_min: staleMin,
        source,
      };
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === "get_device_status") {
      const status = await env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }) || {};
      const offlineMin = Number(config?.alert_offline_min || 15);
      const online = status.lastSeen && Date.now() - status.lastSeen < offlineMin * 60000;
      const uptimeTxt = status.uptime ? `${Math.floor(status.uptime / 86400)}d ${Math.floor((status.uptime % 86400) / 3600)}h` : "—";
      const txt = [
        `Status: ${online ? "ONLINE" : "OFFLINE"}`,
        `Last seen: ${status.lastSeen ? new Date(status.lastSeen).toISOString() : "—"}`,
        `Firmware: ${status.firmware || "—"}`,
        `RSSI: ${status.rssi ?? "—"} dBm`,
        `Battery: ${status.batteryPct ?? "—"}%`,
        `Uptime: ${uptimeTxt}`,
        `SD card: ${status.sdAvailable ? "available" : "not detected"}`,
        `Config version: v${status.config_version || 0}`,
      ].join("\n");
      return mcpResult(id, { content: [{ type: "text", text: txt }] });
    }

    if (toolName === "get_config") {
      return mcpResult(id, {
        content: [{ type: "text", text: JSON.stringify(redactConfig(config), null, 2) }],
      });
    }

    if (toolName === "update_config") {
      if (!args.fields || typeof args.fields !== "object") {
        return mcpError(id, -32602, "fields parameter must be an object");
      }
      const nowTs = Date.now();
      const merged = normalizeConfig({ ...config, ...args.fields });
      await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(merged));
      await env.BGDISPLAY_CONFIG.put("config_updated_at", String(nowTs));

      const secretMeta = await env.BGDISPLAY_CONFIG.get("secret_meta", { type: "json" }) || {};
      if (typeof args.fields.nightscout_secret === "string" && args.fields.nightscout_secret !== config.nightscout_secret) {
        secretMeta.nightscoutSecretUpdatedAt = nowTs;
      }
      if (typeof args.fields.dexcom_pass === "string" && args.fields.dexcom_pass !== config.dexcom_pass) {
        secretMeta.dexcomPassUpdatedAt = nowTs;
      }
      await env.BGDISPLAY_CONFIG.put("secret_meta", JSON.stringify(secretMeta));

      const newVersion = await incrementConfigVersion(env);
      await appendChangeLog(env, `Config updated via MCP (v${newVersion})`);
      await appendWorkerEvent(env, { type: "config-save", version: newVersion, via: "mcp" });
      if (merged.auto_backup) {
        await env.BGDISPLAY_CONFIG.put(`backup:${Date.now()}`, JSON.stringify(merged), { expirationTtl: 30 * 86400 });
      }
      // Broadcast to any connected devices
      if (env.CONFIG_SYNC) {
        try {
          const stub = env.CONFIG_SYNC.get(env.CONFIG_SYNC.idFromName("global"));
          await stub.fetch(new Request("https://do.internal/broadcast", {
            method: "POST",
            body: JSON.stringify({ type: "config-changed", version: newVersion, ts: nowTs }),
          }));
        } catch {}
      }
      return mcpResult(id, { content: [{ type: "text", text: `Config updated. New version: v${newVersion}. Updated: ${new Date(nowTs).toISOString()}.` }] });
    }

    if (toolName === "force_sync") {
      const cmd = {
        id: crypto.randomUUID(), type: "sync-now", args: {},
        createdAt: Date.now(), expiresAt: Date.now() + 10 * 60000,
      };
      await env.BGDISPLAY_CONFIG.put("command:all", JSON.stringify(cmd));
      await appendChangeLog(env, "Force sync queued via MCP");
      return mcpResult(id, { content: [{ type: "text", text: "sync-now command queued. Device will fetch config on next poll." }] });
    }

    if (toolName === "get_change_log") {
      const log = await env.BGDISPLAY_CONFIG.get("changelog", { type: "json" }) || [];
      const txt = log.slice(0, 20).map(e => `[${new Date(e.ts).toISOString()}] ${e.msg}`).join("\n") || "No entries.";
      return mcpResult(id, { content: [{ type: "text", text: txt }] });
    }

    if (toolName === "get_bg_history") {
      const count = Math.min(288, Math.max(1, Number(args.count || 24)));
      const readings = await fetchNightscoutHistory(config, count);
      if (!readings.length) return mcpResult(id, { content: [{ type: "text", text: "No history available." }] });
      const lines = readings.map(r => {
        const trend = r.direction ? directionToTrend(r.direction) : (r.trend || 5);
        const ts = r.date ? new Date(r.date).toISOString() : "—";
        return `${ts}: ${r.sgv} mg/dL ${trendArrowText(trend)}`;
      });
      return mcpResult(id, { content: [{ type: "text", text: lines.join("\n") }] });
    }

    if (toolName === "detect_timezone") {
      const cfTimeZone = request.cf?.timezone || "America/Chicago";
      const detected = detectTimezoneFromIANA(cfTimeZone);
      const result = {
        detected: detected,
        source_iana: cfTimeZone,
        confidence: cfTimeZone !== "America/Chicago" ? "high" : "default",
        supported_zones: ["US/Central", "US/Eastern", "US/Mountain", "US/Pacific"],
        description: "Use this 'detected' value to auto-set timezone on first boot. Once manually set, user can override in config.",
      };
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === "get_daily_digest") {
      const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
      if (!digest) return mcpResult(id, { content: [{ type: "text", text: "No digest generated yet. Runs daily at 7:00 AM US/Central." }] });
      const txt = `Date: ${digest.date}\nGenerated: ${new Date(digest.generatedAt).toISOString()}\n\n${digest.text}`;
      return mcpResult(id, { content: [{ type: "text", text: txt }] });
    }

    if (toolName === "get_pushover_status") {
      const status = await getPushoverStatus(env, config);
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] });
    }

    if (toolName === "send_test_pushover") {
      const category = String(args.category || "general").toLowerCase();
      if (!["general", "digest"].includes(category)) {
        return mcpError(id, -32602, "category must be 'general' or 'digest'");
      }
      const creds = await loadPushoverCreds(env);
      if (!creds?.user_key || !creds?.api_token) {
        return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Pushover credentials not configured." }, null, 2) }] });
      }
      const title = category === "digest" ? "BG MiniView - Digest Test" : "BG MiniView - Test Alert";
      const defaultMessage = category === "digest"
        ? `Digest test from MCP at ${new Date().toISOString()}. This verifies stored credentials and delivery for scheduled summaries.`
        : `Test alert from MCP at ${new Date().toISOString()}. This verifies stored credentials and delivery for BG alerts.`;
      const message = truncateToSentence(String(args.message || defaultMessage), 1024);
      const ok = await sendPushoverNotification(creds.user_key, creds.api_token, message, title, 0);
      const result = {
        ok,
        category,
        title,
        message,
        sent_at: new Date().toISOString(),
      };
      if (ok) {
        await appendChangeLog(env, `MCP test Pushover sent (${category})`);
      }
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === "generate_digest") {
      await generateDailyDigest(env, true);
      const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
      if (!digest) return mcpResult(id, { content: [{ type: "text", text: "Digest generation failed." }] });
      return mcpResult(id, { content: [{ type: "text", text: `Generated: ${digest.date}\n\n${digest.text}` }] });
    }

    if (toolName === "get_device_ages") {
      const nowSec = Math.floor(Date.now() / 1000);
      const result = { dexcom_sensor: null };

      // Dexcom sensor session
      if (config.dexcom_user && config.dexcom_pass) {
        const sess = await fetchDexcomSensorSession(config, env);
        if (sess) {
          result.dexcom_sensor = {
            session_start: sess.session_start_iso,
            age: formatAgeDays(sess.session_start_ts, nowSec),
            age_days: sess.session_age_days,
            days_remaining: sess.days_remaining,
            pct_used: parseFloat(((sess.session_age_days / 10) * 100).toFixed(1)),
            status: sess.days_remaining < 1 ? "expiring_soon" : sess.days_remaining < 2 ? "warning" : "ok",
          };
        } else {
          result.dexcom_sensor = { error: "Could not fetch sensor session (Dexcom auth failed or no readings)" };
        }
      } else {
        result.dexcom_sensor = { error: "Dexcom credentials not configured" };
      }

      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === "clear_cache") {
      const target = String(params?.arguments?.target || "").toLowerCase();
      const validTargets = ["digests", "alerts", "all"];
      if (!validTargets.includes(target)) {
        return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ error: `Invalid target. Use: ${validTargets.join(" | ")}` }) }] });
      }
      const cleared = [];
      if (target === "digests" || target === "all") {
        await env.BGDISPLAY_CONFIG.delete("daily_digest");
        cleared.push("daily_digest");
        for (let h = 0; h < 24; h++) {
          await env.BGDISPLAY_CONFIG.delete(`hourly_digest_${h}`);
          await env.BGDISPLAY_CONFIG.delete(`hourly_digest_${h}_pushover_sent`);
        }
        cleared.push("hourly_digest_0..23", "hourly_digest_*_pushover_sent");
      }
      if (target === "alerts" || target === "all") {
        await env.BGDISPLAY_CONFIG.delete("last_pushover_alert");
        await env.BGDISPLAY_CONFIG.delete("last_digest_pushover");
        await env.BGDISPLAY_CONFIG.delete("last_offline_alert");
        cleared.push("last_pushover_alert", "last_digest_pushover", "last_offline_alert");
      }
      await appendChangeLog(env, `MCP maintenance: cleared cache target=${target}`);
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ cleared, note: "These KV keys have been deleted. Next relevant operation will regenerate them." }, null, 2) }] });
    }

    if (toolName === "get_maintenance_status") {
        const nowMs = Date.now();
        const nowSec = Math.floor(nowMs / 1000);
        const [sensorCacheRaw, dailyDigest, deviceStatus, lastAlert, lastDigestPush, lastOffline] = await Promise.all([
          env.BGDISPLAY_CONFIG.get(DEXCOM_SENSOR_CACHE_KEY, { type: "json" }),
          env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" }),
          env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }),
          env.BGDISPLAY_CONFIG.get("last_pushover_alert"),
          env.BGDISPLAY_CONFIG.get("last_digest_pushover"),
          env.BGDISPLAY_CONFIG.get("last_offline_alert"),
        ]);
        const status = {
          bindings: {
            ai: !!env.AI,
            kv_encrypt: !!env.KV_ENCRYPT_KEY,
          },
          dexcom_sensor_cache: {
            exists: !!sensorCacheRaw?.session_start_ts,
            session_start: sensorCacheRaw?.session_start_iso || null,
            age_days: sensorCacheRaw?.session_age_days ?? null,
            days_remaining: sensorCacheRaw?.days_remaining ?? null,
            cache_age_min: sensorCacheRaw?.fetchedAt ? Math.round((nowSec - sensorCacheRaw.fetchedAt) / 60) : null,
          },
          daily_digest: {
            exists: !!dailyDigest,
            date: dailyDigest?.date || null,
            generated_at: dailyDigest?.generatedAt ? new Date(dailyDigest.generatedAt).toISOString() : null,
            age_minutes: dailyDigest?.generatedAt ? Math.round((nowMs - dailyDigest.generatedAt) / 60000) : null,
            tir: dailyDigest?.stats?.tir ?? null,
            ai_model: dailyDigest?.ai_model || null,
          },
          device: {
            last_seen: deviceStatus?.timestamp ? new Date(deviceStatus.timestamp * 1000).toISOString() : null,
            online: deviceStatus?.online ?? null,
            fw_version: deviceStatus?.fw_version || null,
          },
          alerts: {
            last_bg_alert: lastAlert ? new Date(Number(lastAlert)).toISOString() : null,
            last_bg_alert_age_min: lastAlert ? Math.round((nowMs - Number(lastAlert)) / 60000) : null,
            last_digest_pushover: lastDigestPush || null,
            last_offline_alert: lastOffline ? new Date(Number(lastOffline)).toISOString() : null,
          },
          ai_model: config.ai_model || "@cf/meta/llama-3.1-8b-instruct",
        };
        return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] });
    }

    if (toolName === "get_health_summary") {
      const summary = await buildHealthSummary(env, config, auth);
      return mcpResult(id, { content: [{ type: "text", text: summary }] });
    }

    if (toolName === "get_key_auth_status") {
      const result = await getKeyAuthStatus(auth, args.key || "");
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === "get_full_readiness") {
      const result = await buildFullReadinessReport(env, config, auth);
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    }

    if (toolName === "run_maintenance") {
      const report = { steps: [], errors: [] };

      // 1. Force-regenerate daily digest
      try {
        await generateDailyDigest(env, true);
        const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
        report.steps.push(`daily_digest: regenerated — TIR ${digest?.stats?.tir ?? "?"}%, "${(digest?.text || "").slice(0, 80)}..."`);
      } catch (e) { report.errors.push(`daily_digest: ${e.message}`); }

      // 2. Clear hourly digests (fresh set next cron cycle)
      try {
        for (let h = 0; h < 24; h++) await env.BGDISPLAY_CONFIG.delete(`hourly_digest_${h}`);
        report.steps.push("hourly_digests: cleared (24 slots reset, will regenerate on next cron)");
      } catch (e) { report.errors.push(`hourly_digests: ${e.message}`); }

      await appendChangeLog(env, "MCP run_maintenance completed");
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ ok: report.errors.length === 0, ...report }, null, 2) }] });
    }

    if (toolName === "set_ai_model") {
      const raw = String(params?.arguments?.model || "").trim();
      const resolved = AI_MODEL_ALIASES[raw] || (raw.startsWith("@cf/") ? raw : null);
      if (!resolved) {
        return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ error: `Unknown model "${raw}". Valid aliases: ${Object.keys(AI_MODEL_ALIASES).join(", ")}, or full @cf/ path.` }) }] });
      }
      const existing = normalizeConfig(await env.BGDISPLAY_CONFIG.get("config", { type: "json" }));
      const updated = { ...existing, ai_model: resolved };
      await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(updated));
      await appendChangeLog(env, `AI model set to ${resolved} via MCP`);
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ ok: true, ai_model: resolved, previous: existing.ai_model || `${DEFAULT_AI_MODEL} (default)` }, null, 2) }] });
    }

    return mcpError(id, -32601, `Tool not found: ${toolName}`);
  }

  return mcpError(id, -32601, `Method not found: ${method}`);
}

// ─── Signature Verification ───────────────────────────────────────────────────

async function verifyDeviceSignature(request, env, keyHash, rawBody = "") {
  const tsStr = request.headers.get("X-Sig-Ts") || "";
  const nonce = request.headers.get("X-Sig-Nonce") || "";
  const bodyHdr = (request.headers.get("X-Sig-Body") || "").toLowerCase();
  const sigHdr = (request.headers.get("X-Signature") || "").toLowerCase();

  if (!tsStr || !nonce || !bodyHdr || !sigHdr) return { ok: false, error: "Missing signature headers" };
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, error: "Invalid signature timestamp" };
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(nonce)) return { ok: false, error: "Invalid nonce format" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) return { ok: false, error: "Signature timestamp out of range" };

  const nonceKey = `sig_nonce:${keyHash}:${nonce}`;
  if (await env.BGDISPLAY_AUTH.get(nonceKey)) return { ok: false, error: "Replay detected" };

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
  return hmacSha256Hex(keyHash, `${cmd.id}|${cmd.type}|${cmd.createdAt}|${cmd.expiresAt}`);
}

function isDeviceKeyValid(auth, keyHash) {
  if (!auth || !keyHash) return false;
  return keyHash === auth.keyHash
    || (auth.pendingKeyHash && keyHash === auth.pendingKeyHash)
    || (auth.recoveryKeyHash && keyHash === auth.recoveryKeyHash);
}

async function checkReplayToken(env, scope, token, ttlSec = 600) {
  if (!token) return { ok: true };
  if (!/^[a-zA-Z0-9._:-]{8,120}$/.test(token)) return { ok: false, error: "Invalid request id" };
  const key = `reqid:${scope}:${token}`;
  if (await env.BGDISPLAY_AUTH.get(key)) return { ok: false, error: "Duplicate request" };
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

// ─── Metrics ──────────────────────────────────────────────────────────────────

function computeMetrics(status, telemetry, events) {
  const samples = Array.isArray(telemetry) ? telemetry : [];
  const ev = Array.isArray(events) ? events : [];
  let avgRssi = null, minBattery = null, maxBattery = null, staleSamples = 0;
  if (samples.length > 0) {
    let sumRssi = 0, rssiCount = 0;
    for (const s of samples) {
      if (typeof s.rssi === "number") { sumRssi += s.rssi; rssiCount++; }
      if (typeof s.batteryPct === "number") {
        minBattery = minBattery === null ? s.batteryPct : Math.min(minBattery, s.batteryPct);
        maxBattery = maxBattery === null ? s.batteryPct : Math.max(maxBattery, s.batteryPct);
      }
      if (typeof s.lastReadingAgeSec === "number" && s.lastReadingAgeSec > 1800) staleSamples++;
    }
    avgRssi = rssiCount ? Math.round(sumRssi / rssiCount) : null;
  }
  const now = Date.now(), oneHourAgo = now - 3600000;
  const eventCounts1h = { alert: 0, commandAckOk: 0, commandAckFail: 0, configSave: 0 };
  for (const e of ev) {
    if (!e?.ts || e.ts < oneHourAgo) continue;
    if (e.type === "alert") eventCounts1h.alert++;
    if (e.type === "config-save") eventCounts1h.configSave++;
    if (e.type === "command-ack") { if (e.ok) eventCounts1h.commandAckOk++; else eventCounts1h.commandAckFail++; }
  }
  return {
    samples: samples.length, avgRssi, minBattery, maxBattery,
    staleSamplePct: samples.length ? Math.round((staleSamples / samples.length) * 100) : 0,
    lastSeenTs: status?.lastSeen || null,
    lastBgValue: typeof status?.bgValue === "number" ? status.bgValue : null,
    eventCounts1h,
    sourceHealth: {
      nsOk: Number(status?.nsOk || 0), nsFail: Number(status?.nsFail || 0),
      dexOk: Number(status?.dexOk || 0), dexFail: Number(status?.dexFail || 0),
      failStreak: Number(status?.bgPollFailStreak || 0), activeSource: status?.source || "none",
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

// ─── Admin Session ────────────────────────────────────────────────────────────

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
    if (allowQuerySession) token = u.searchParams.get("session") || "";
  }
  if (!token) return false;
  const s = await env.BGDISPLAY_AUTH.get(`admin_session:${token}`, { type: "json" });
  return !!s;
}

// ─── Config Version ───────────────────────────────────────────────────────────

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

// ─── Key Rotation ─────────────────────────────────────────────────────────────

async function handleAutoRotation(env, auth) {
  const now = Date.now();
  if (auth.pendingKeyHash && auth.pendingKeyExpiry && now < auth.pendingKeyExpiry) return auth.pendingKey || null;
  if (auth.pendingKeyHash) { delete auth.pendingKey; delete auth.pendingKeyHash; delete auth.pendingKeyExpiry; }
  if (now - (auth.lastRotated || 0) < KEY_ROTATE_MS) return null;
  const newKey = generateKey();
  auth.pendingKey = newKey; auth.pendingKeyHash = await sha256(newKey); auth.pendingKeyExpiry = now + PENDING_KEY_TTL_MS;
  await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
  await appendChangeLog(env, "Auto-rotation initiated — awaiting device ACK");
  return newKey;
}

async function promoteKey(env, auth) {
  auth.keyHash = auth.pendingKeyHash; auth.lastRotated = Date.now(); auth.lastRotatedReason = "auto";
  delete auth.pendingKey; delete auth.pendingKeyHash; delete auth.pendingKeyExpiry;
  await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
  await appendChangeLog(env, "API key auto-rotated — device confirmed");
}

// ─── Device Registry ──────────────────────────────────────────────────────────

async function updateDeviceRegistry(env, chipId, patch) {
  if (!chipId || !/^[0-9a-f]{8,16}$/i.test(chipId)) return;
  const existing = await env.BGDISPLAY_AUTH.get(`device_registry:${chipId}`, { type: "json" });
  if (!existing) return;
  await env.BGDISPLAY_AUTH.put(`device_registry:${chipId}`, JSON.stringify({ ...existing, ...patch }));
}

// ─── Device Status Update ─────────────────────────────────────────────────────

async function updateDeviceStatus(env, ip, body, config) {
  const status = {
    lastSeen: Date.now(), ip: maskIP(ip),
    connection: body.connection || "wifi", uptime: body.uptime || 0,
    firmware: body.firmware || "unknown", freeMemory: body.freeMemory || 0,
    rssi: body.rssi || 0, ssid: body.ssid || "", deviceIP: body.ip || "",
    sdAvailable: body.sdAvailable || false, batteryPct: body.batteryPct ?? null,
    bgValue: body.bgValue ?? null, lastReadingAgeSec: body.lastReadingAgeSec ?? null,
    resetReason: body.resetReason || "", source: body.source || "none",
    nsOk: body.nsOk ?? 0, nsFail: body.nsFail ?? 0,
    dexOk: body.dexOk ?? 0, dexFail: body.dexFail ?? 0,
    bgPollFailStreak: body.bgPollFailStreak ?? 0,
  };
  await env.BGDISPLAY_CONFIG.put("device_status", JSON.stringify(status));

  let telemetry = await env.BGDISPLAY_CONFIG.get("telemetry_recent", { type: "json" }) || [];
  telemetry.unshift({
    ts: Date.now(), uptime: status.uptime, rssi: status.rssi,
    batteryPct: status.batteryPct, bgValue: status.bgValue, lastReadingAgeSec: status.lastReadingAgeSec,
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
  async fetch(request, env, ctx) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const ip = getClientIP(request);

    if (method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    // Feature 1: WebSocket upgrade — handle before rate limiting to avoid breaking WS handshake
    if (path === "/api/ws" && request.headers.get("Upgrade") === "websocket") {
      let auth = await env.BGDISPLAY_CONFIG.get("auth", { type: "json" });
      if (!auth) return json({ error: "Not initialized" }, 503);
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) return json({ error: "Invalid key" }, 401);
      if (!env.CONFIG_SYNC) return json({ error: "WebSocket relay not available" }, 503);
      const doId = env.CONFIG_SYNC.idFromName("global");
      const stub = env.CONFIG_SYNC.get(doId);
      // Forward the upgrade request to the DO, rewriting path to /ws
      const doReq = new Request(new URL("/ws", "https://do.internal"), {
        method: "GET", headers: request.headers,
      });
      return stub.fetch(doReq);
    }

    // First-boot init
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

    // ── GET /api/ping ────────────────────────────────────────────────────────
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
        await recordFailedAuth(env, ip, config.lockout_attempts || 5, config.lockout_duration_min || 15);
        await incrementFailedAuthCount(env);
        return json({ error: "Invalid key" }, 401);
      }
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);
      await clearFailedAuth(env, ip);
      const version = await getConfigVersion(env);
      const deviceVersion = parseInt(url.searchParams.get("v") || "0");
      return json({ v: version, changed: version > deviceVersion, ts: Date.now() });
    }

    // ── GET /api/config ──────────────────────────────────────────────────────
    if (path === "/api/config" && method === "GET") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) { await incrementFailedAuthCount(env); return json({ error: "Missing key" }, 401); }
      const lockStatus = await checkLockout(env, ip);
      if (lockStatus.locked) return json({ error: "Locked", until: lockStatus.until }, 403);
      const keyHash = await sha256(deviceKey);
      if (auth.pendingKeyHash && keyHash === auth.pendingKeyHash) {
        await promoteKey(env, auth); await clearFailedAuth(env, ip);
        const version = await getConfigVersion(env);
        const deviceConfig = { ...config };
        return json({ config: deviceConfig, config_version: version, ts: Date.now(), keyConfirmed: true });
      }
      if (!isDeviceKeyValid(auth, keyHash)) {
        await recordFailedAuth(env, ip, config.lockout_attempts || 5, config.lockout_duration_min || 15);
        await incrementFailedAuthCount(env);
        return json({ error: "Invalid key" }, 401);
      }
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);
      await clearFailedAuth(env, ip);
      const pendingKey = await handleAutoRotation(env, auth);
      auth = await env.BGDISPLAY_CONFIG.get("auth", { type: "json" });
      const version = await getConfigVersion(env);
      const deviceConfig = { ...config };
      // Auto-detect timezone on first config pull if empty
      if (!deviceConfig.timezone || deviceConfig.timezone.trim() === "") {
        const cfTimeZone = request.cf?.timezone || "America/Chicago";
        deviceConfig.timezone = detectTimezoneFromIANA(cfTimeZone);
        // Save the auto-detected timezone back to config for persistence
        config.timezone = deviceConfig.timezone;
        await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(config));
        await appendChangeLog(env, `Timezone auto-detected: ${deviceConfig.timezone} (from geo IP)`);
      }
      // Apply per-device config overrides if device sends X-Device-Id
      const configChipId = request.headers.get("X-Device-Id") || "";
      if (configChipId && /^[0-9a-f]{8,16}$/i.test(configChipId)) {
        const perDevice = await env.BGDISPLAY_CONFIG.get(`device_config:${configChipId.toLowerCase()}`, { type: "json" });
        if (perDevice) Object.assign(deviceConfig, perDevice);
        await updateDeviceRegistry(env, configChipId.toLowerCase(), { lastSeen: Date.now(), lastSeenPath: "/api/config" });
      }
      const resp = { config: deviceConfig, config_version: version, ts: Date.now() };
      if (pendingKey) { resp.newKey = pendingKey; resp.rotateNow = true; }
      return json(resp);
    }

    // ── POST /api/key-ack ────────────────────────────────────────────────────
    if (path === "/api/key-ack" && method === "POST") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      if (auth.pendingKeyHash && keyHash === auth.pendingKeyHash) { await promoteKey(env, auth); return json({ ok: true }); }
      if (isDeviceKeyValid(auth, keyHash)) return json({ ok: true });
      return json({ error: "Key mismatch" }, 401);
    }

    // ── POST /api/enroll ─────────────────────────────────────────────────────
    if (path === "/api/enroll" && method === "POST") {
      if (!(await checkRateLimit(env, `enroll:${ip}`, 5))) {
        return json({ error: "Rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const lockStatus = await checkLockout(env, ip);
      if (lockStatus.locked) return json({ error: "Locked", until: lockStatus.until }, 403);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) {
        await recordFailedAuth(env, ip, config.lockout_attempts || 5, config.lockout_duration_min || 15);
        await incrementFailedAuthCount(env);
        return json({ error: "Invalid key" }, 401);
      }
      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return json({ error: "Invalid JSON" }, 400); }
      const chipId = (typeof body.chipId === "string" ? body.chipId : "").toLowerCase().trim();
      if (!chipId || !/^[0-9a-f]{8,16}$/.test(chipId)) {
        return json({ error: "Invalid chipId — expected 8–16 hex chars" }, 400);
      }
      const existing = await env.BGDISPLAY_AUTH.get(`device_registry:${chipId}`, { type: "json" });
      if (existing && existing.keyHash !== keyHash) {
        return json({ error: "Already enrolled", hint: "Use admin to revoke and re-enroll this device." }, 409);
      }
      const newKey = generateKey();
      const newKeyHash = await sha256(newKey);
      await env.BGDISPLAY_AUTH.put(`device_registry:${chipId}`, JSON.stringify({
        chipId,
        keyHash: newKeyHash,
        keyTail: newKeyHash.slice(-4),
        enrolledAt: Date.now(),
        enrolledFrom: "api",
        previousKeyHash: keyHash,
        lastSeen: Date.now(),
        lastSeenPath: "/api/enroll",
      }));
      auth.keyHash = newKeyHash;
      auth.lastRotated = Date.now();
      auth.lastRotatedReason = "enrollment";
      delete auth.pendingKey; delete auth.pendingKeyHash; delete auth.pendingKeyExpiry;
      await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      await clearFailedAuth(env, ip);
      await appendChangeLog(env, `Device enrolled: chip ...${chipId.slice(-4)}`);
      return json({ ok: true, key: newKey, chipId });
    }

    // ── POST /api/status ─────────────────────────────────────────────────────
    if (path === "/api/status" && method === "POST") {
      if (!(await checkRateLimit(env, `device-write:${ip}`, config.device_write_rate_limit_per_min || 20))) {
        return json({ error: "Device write rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) return json({ error: "Invalid key" }, 401);
      const reqId = request.headers.get("X-Request-Id") || "";
      const replay = await checkReplayToken(env, `status:${keyHash.slice(0, 12)}`, reqId, 900);
      if (!replay.ok) return json({ error: replay.error }, 409);
      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      let parsed = {};
      try { parsed = rawBody ? JSON.parse(rawBody) : {}; } catch { return json({ error: "Invalid JSON" }, 400); }
      await updateDeviceStatus(env, ip, parsed, config);
      const chipId = request.headers.get("X-Device-Id") || "";
      if (chipId) await updateDeviceRegistry(env, chipId, { lastSeen: Date.now(), lastSeenPath: "/api/status" });
      return json({ ok: true });
    }

    // ── POST /api/log-upload ─────────────────────────────────────────────────
    if (path === "/api/log-upload" && method === "POST") {
      if (!(await checkRateLimit(env, `device-write:${ip}`, config.device_write_rate_limit_per_min || 20))) {
        return json({ error: "Device write rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) return json({ error: "Invalid key" }, 401);
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
        ? lineCountHeader : text.split("\n").filter(Boolean).length;
      const meta = { uploadedAt: Date.now(), commandId: request.headers.get("X-Command-Id") || "", lineCount: lines, bytes: text.length };
      await env.BGDISPLAY_CONFIG.put("sdlog:last_text", text);
      await env.BGDISPLAY_CONFIG.put("sdlog:last_meta", JSON.stringify(meta));
      await appendChangeLog(env, `SD logs uploaded (${meta.lineCount} lines)`);
      await appendWorkerEvent(env, { type: "sd-log-upload", lines: meta.lineCount, bytes: meta.bytes });
      return json({ ok: true, meta });
    }

    // ── GET /api/command ─────────────────────────────────────────────────────
    if (path === "/api/command" && method === "GET") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) return json({ error: "Invalid key" }, 401);
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);
      const cmd = await env.BGDISPLAY_CONFIG.get("command:all", { type: "json" });
      if (!cmd) return json({ pending: false, ts: Date.now() });
      if (cmd.expiresAt && Date.now() > cmd.expiresAt) {
        await env.BGDISPLAY_CONFIG.delete("command:all");
        return json({ pending: false, ts: Date.now() });
      }
      const cmdSig = await signCommandEnvelope(cmd, keyHash);
      return json({ pending: true, command: { id: cmd.id, type: cmd.type, args: cmd.args || {}, createdAt: cmd.createdAt, expiresAt: cmd.expiresAt, sig: cmdSig }, ts: Date.now() });
    }

    // ── POST /api/command-ack ────────────────────────────────────────────────
    if (path === "/api/command-ack" && method === "POST") {
      if (!(await checkRateLimit(env, `device-write:${ip}`, config.device_write_rate_limit_per_min || 20))) {
        return json({ error: "Device write rate limit exceeded" }, 429);
      }
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) return json({ error: "Invalid key" }, 401);
      const rawBody = await request.text();
      const sig = await verifyDeviceSignature(request, env, keyHash, rawBody);
      if (!sig.ok) return json({ error: sig.error }, 401);
      let body = {};
      try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { return json({ error: "Invalid JSON" }, 400); }
      const reqId = request.headers.get("X-Request-Id") || "";
      const replay = await checkReplayToken(env, `command-ack:${keyHash.slice(0, 12)}`, reqId || (body?.id || ""), 1800);
      if (!replay.ok) return json({ error: replay.error }, 409);
      const cmdId = body?.id;
      if (!cmdId) return json({ error: "Missing command id" }, 400);
      const cmd = await env.BGDISPLAY_CONFIG.get("command:all", { type: "json" });
      if (!cmd || cmd.id !== cmdId) return json({ ok: true, ignored: true });
      const ack = { id: cmdId, type: cmd.type, ok: !!body.ok, message: body.message || "", ts: Date.now() };
      await env.BGDISPLAY_CONFIG.put("command:last_ack", JSON.stringify(ack));
      await env.BGDISPLAY_CONFIG.delete("command:all");
      await appendChangeLog(env, `Command ${cmd.type} ${ack.ok ? "ACK" : "failed"}`);
      await appendWorkerEvent(env, { type: "command-ack", command: cmd.type, ok: ack.ok, message: ack.message });
      return json({ ok: true });
    }

    // ── GET /api/digest — Device fetches AI daily summary ────────────────────
    if (path === "/api/digest" && method === "GET") {
      const deviceKey = request.headers.get("X-Device-Key");
      if (!deviceKey) return json({ error: "Missing key" }, 401);
      const keyHash = await sha256(deviceKey);
      if (!isDeviceKeyValid(auth, keyHash)) return json({ error: "Invalid key" }, 401);
      const sig = await verifyDeviceSignature(request, env, keyHash, "");
      if (!sig.ok) return json({ error: sig.error }, 401);
      const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
      if (!digest) return json({ available: false });
      return json({ available: true, text: digest.text, generatedAt: digest.generatedAt, date: digest.date, stats: digest.stats || null });
    }

    // ── /api/detect-timezone — Auto-detect timezone from geo IP (no auth required) ──
    if (path === "/api/detect-timezone" && method === "GET") {
      const cfTimeZone = request.cf?.timezone || "America/Chicago";
      const detected = detectTimezoneFromIANA(cfTimeZone);
      return json({
        detected: detected,
        source_iana: cfTimeZone,
        confidence: cfTimeZone !== "America/Chicago" ? "high" : "default",
        supported_zones: ["US/Central", "US/Eastern", "US/Mountain", "US/Pacific"],
      });
    }

    // ── /mcp — MCP server (JSON-RPC 2.0, device-key or admin-session auth) ────
    // Key can be passed as X-Device-Key header OR ?key= query param (for Claude connector URL).
    if (path === "/mcp" && (method === "POST" || method === "GET")) {
      // Accept key from header OR query param (query param needed for Claude connector URL)
      const mcpDeviceKey = request.headers.get("X-Device-Key") || url.searchParams.get("key");
      if (mcpDeviceKey) {
        const mcpKeyHash = await sha256(mcpDeviceKey);
        if (!isDeviceKeyValid(auth, mcpKeyHash)) return json({ error: "Invalid device key" }, 401);
        if (method === "GET") {
          return json({
            name: "bg-miniview-mcp", version: "1.0.0",
            description: "BG MiniView Model Context Protocol server",
            endpoint: `${url.origin}/mcp`,
            tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description })),
          });
        }
        return handleMCP(request, env, config, auth);
      }
      // No device key — fall through to admin auth gate below
    }

    // ── Admin auth gate ───────────────────────────────────────────────────────
    const cfJwt = request.headers.get("CF-Access-Jwt-Assertion");
    const hasSession = await validateAdminSession(env, request);
    const trustedOrigin = isTrustedAdminOrigin(request, env);
    if (!cfJwt && !trustedOrigin && !hasSession) {
      return json({ error: "Unauthorized. Cloudflare Access is required." }, 401);
    }

    // ── POST /mcp — admin-session fallback (when no X-Device-Key) ────────────
    if (path === "/mcp" && method === "POST") {
      return handleMCP(request, env, config, auth);
    }

    if (path === "/api/admin/session" && method === "GET") {
      const token = await issueAdminSession(env, ip);
      return json({ ok: true, token, expiresInSec: ADMIN_SESSION_TTL_SEC });
    }

    if (path === "/api/admin/config" && method === "GET") {
      const status     = await env.BGDISPLAY_CONFIG.get("device_status",    { type: "json" }) || {};
      const changelog  = await env.BGDISPLAY_CONFIG.get("changelog",         { type: "json" }) || [];
      const events     = await env.BGDISPLAY_CONFIG.get("worker_events",     { type: "json" }) || [];
      const telemetry  = await env.BGDISPLAY_CONFIG.get("telemetry_recent",  { type: "json" }) || [];
      const lastLogUpload = await env.BGDISPLAY_CONFIG.get("sdlog:last_meta",{ type: "json" }) || null;
      const secretMeta = await env.BGDISPLAY_CONFIG.get("secret_meta",       { type: "json" }) || {};
      const pendingCmd = await env.BGDISPLAY_CONFIG.get("command:all",       { type: "json" });
      const lastCmdAck = await env.BGDISPLAY_CONFIG.get("command:last_ack",  { type: "json" });
      const failedAuth = await env.BGDISPLAY_AUTH.get("failed_auth_24h",     { type: "json" }) || { count: 0 };
      const version    = await getConfigVersion(env);
      const digest     = await env.BGDISPLAY_CONFIG.get("daily_digest",      { type: "json" }) || null;
      const pushoverConfigured = !!(await env.BGDISPLAY_CONFIG.get("pushover_creds"));

      const offlineMin = Number(config?.alert_offline_min || 15);
      const cooldownMs = Number(config?.alert_cooldown_min || 60) * 60 * 1000;
      if (status?.lastSeen && Date.now() - status.lastSeen > offlineMin * 60 * 1000) {
        if (await shouldEmitAlert(env, "device-offline", cooldownMs)) {
          await appendChangeLog(env, `Alert: device offline (>${offlineMin} min)`);
          await appendWorkerEvent(env, { type: "alert", level: "warning", msg: "device-offline" });
        }
      }

      const metrics = computeMetrics(status, telemetry, events);
      const now = Date.now(); const reminders = [];
      if (secretMeta.nightscoutSecretUpdatedAt && now - secretMeta.nightscoutSecretUpdatedAt > 30 * 86400000) {
        reminders.push({ key: "nightscout_secret", msg: "Nightscout secret older than 30 days" });
      }
      if (secretMeta.dexcomPassUpdatedAt && now - secretMeta.dexcomPassUpdatedAt > 30 * 86400000) {
        reminders.push({ key: "dexcom_pass", msg: "Dexcom password older than 30 days" });
      }

      const configUpdatedAt = Number(await env.BGDISPLAY_CONFIG.get("config_updated_at") || 0) || null;

      return json({
        config, status, changelog, metrics,
        workerEvents: events.slice(0, 20),
        telemetryRecent: telemetry.slice(0, 120),
        secretMeta, reminders, lastLogUpload,
        pendingCommand: pendingCmd || null,
        lastCommandAck: lastCmdAck || null,
        failedAuthCount: failedAuth.count,
        lastRotated: auth.lastRotated,
        nextAutoRotate: (auth.lastRotated || 0) + KEY_ROTATE_MS,
        keyTail: auth.keyHash ? auth.keyHash.slice(-4) : "????",
        recoveryKeyEnabled: !!auth.recoveryKeyHash,
        recoveryKeyTail: auth.recoveryKeyHash ? auth.recoveryKeyHash.slice(-4) : "",
        recoveryKeyUpdatedAt: auth.recoveryKeyUpdatedAt || null,
        rotateDays: 7,
        pendingRotation: !!(auth.pendingKeyHash),
        config_version: version,
        config_updated_at: configUpdatedAt,
        device_config_version: status?.config_version || 0,
        digest,
        pushoverConfigured,
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

      // Extract and encrypt Pushover credentials before merging into main config
      const pushoverUserKey = typeof body.pushover_user_key === "string" ? body.pushover_user_key.trim() : null;
      const pushoverApiToken = typeof body.pushover_api_token === "string" ? body.pushover_api_token.trim() : null;
      delete body.pushover_user_key; delete body.pushover_api_token;

      if (pushoverUserKey || pushoverApiToken) {
        if (!env.KV_ENCRYPT_KEY) {
          return json({ error: "KV_ENCRYPT_KEY worker secret is required to store Pushover credentials. Set it in Cloudflare dashboard under Worker → Settings → Variables." }, 400);
        }
        // Read existing creds to merge (don't overwrite one key if only the other was sent)
        let existing = {};
        try {
          const enc = await env.BGDISPLAY_CONFIG.get("pushover_creds");
          if (enc) { const dec = await kvDecrypt(enc, env.KV_ENCRYPT_KEY); if (dec) existing = JSON.parse(dec); }
        } catch {}
        const merged = {
          user_key: pushoverUserKey || existing.user_key || "",
          api_token: pushoverApiToken || existing.api_token || "",
        };
        const encrypted = await kvEncrypt(JSON.stringify(merged), env.KV_ENCRYPT_KEY);
        if (encrypted) await env.BGDISPLAY_CONFIG.put("pushover_creds", encrypted);
      }

      const merged = normalizeConfig({ ...config, ...body });

      const secretMeta = await env.BGDISPLAY_CONFIG.get("secret_meta", { type: "json" }) || {};
      if (typeof body.nightscout_secret === "string" && body.nightscout_secret !== config.nightscout_secret) {
        secretMeta.nightscoutSecretUpdatedAt = Date.now();
      }
      if (typeof body.dexcom_pass === "string" && body.dexcom_pass !== config.dexcom_pass) {
        secretMeta.dexcomPassUpdatedAt = Date.now();
      }

      const nowTs = Date.now();
      await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(merged));
      await env.BGDISPLAY_CONFIG.put("config_updated_at", String(nowTs));
      await env.BGDISPLAY_CONFIG.put("secret_meta", JSON.stringify(secretMeta));
      const newVersion = await incrementConfigVersion(env);
      await appendChangeLog(env, `Config updated (v${newVersion})`);
      if (merged.auto_backup) {
        await env.BGDISPLAY_CONFIG.put(`backup:${Date.now()}`, JSON.stringify(merged), { expirationTtl: 30 * 86400 });
      }
      await appendWorkerEvent(env, { type: "config-save", version: newVersion });

      // Broadcast to any connected device WebSockets (non-fatal if DO not available)
      if (env.CONFIG_SYNC) {
        ctx.waitUntil((async () => {
          try {
            const stub = env.CONFIG_SYNC.get(env.CONFIG_SYNC.idFromName("global"));
            await stub.fetch(new Request("https://do.internal/broadcast", {
              method: "POST",
              body: JSON.stringify({ type: "config-changed", version: newVersion, ts: Date.now() }),
              headers: { "Content-Type": "application/json" },
            }));
          } catch {}
        })());
      }

      return json({ ok: true, config_version: newVersion, config_updated_at: nowTs });
    }

    if (path === "/api/admin/metrics" && method === "GET") {
      const status = await env.BGDISPLAY_CONFIG.get("device_status", { type: "json" }) || {};
      const telemetry = await env.BGDISPLAY_CONFIG.get("telemetry_recent", { type: "json" }) || [];
      const events = await env.BGDISPLAY_CONFIG.get("worker_events", { type: "json" }) || [];
      return json({ metrics: computeMetrics(status, telemetry, events), telemetryRecent: telemetry.slice(0, 120), workerEvents: events.slice(0, 40) });
    }

    if (path === "/api/admin/digest" && method === "GET") {
      const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
      if (!digest) return json({ available: false });
      return json({ available: true, ...digest });
    }

    if (path === "/api/admin/digest/generate" && method === "POST") {
      await generateDailyDigest(env, true);
      const digest = await env.BGDISPLAY_CONFIG.get("daily_digest", { type: "json" });
      return json({ ok: true, digest: digest || null });
    }

    if (path === "/api/admin/logs/latest" && method === "GET") {
      const meta = await env.BGDISPLAY_CONFIG.get("sdlog:last_meta", { type: "json" });
      const text = await env.BGDISPLAY_CONFIG.get("sdlog:last_text");
      if (!meta || !text) return json({ error: "No uploaded logs yet" }, 404);
      const q = (url.searchParams.get("q") || "").toLowerCase();
      const lvl = (url.searchParams.get("lvl") || "").toUpperCase();
      const limit = Math.max(1, Math.min(400, Number(url.searchParams.get("limit") || 80)));
      const filtered = text.split("\n").filter(Boolean)
        .filter(line => !q || line.toLowerCase().includes(q))
        .filter(line => !lvl || line.includes(`"lvl":"${lvl}"`));
      if (url.searchParams.get("download") === "1") {
        const ts = new Date(meta.uploadedAt || Date.now()).toISOString().replace(/[:.]/g, "-");
        return new Response(text, {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="bg-miniview-sd-logs-${ts}.log"` },
        });
      }
      return json({ meta, total: filtered.length, preview: filtered.slice(0, limit) });
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
      const allowed = ["reboot", "sync-now", "upload-logs", "factory-reset", "fetch-digest", "display-message"];
      if (!allowed.includes(body.type)) return json({ error: "Unsupported command" }, 400);
      const cmd = { id: crypto.randomUUID(), type: body.type, args: body.args || {}, createdAt: Date.now(), expiresAt: Date.now() + 10 * 60 * 1000 };
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
      if (!body || typeof body.recovery_device_key !== "string") return json({ error: "Missing recovery_device_key" }, 400);
      const key = body.recovery_device_key.trim();
      if (!key || key.length < 16 || key.length > 96 || !key.startsWith("bg_ro_")) return json({ error: "Invalid recovery key format" }, 400);
      auth.recoveryKeyHash = await sha256(key); auth.recoveryKeyUpdatedAt = Date.now();
      await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      await appendChangeLog(env, "Recovery firmware key updated");
      await appendWorkerEvent(env, { type: "recovery-key-update" });
      return json({ ok: true, recoveryKeyTail: auth.recoveryKeyHash.slice(-4), recoveryKeyUpdatedAt: auth.recoveryKeyUpdatedAt });
    }

    if (path === "/api/admin/recovery-key" && method === "DELETE") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }
      delete auth.recoveryKeyHash; delete auth.recoveryKeyUpdatedAt;
      await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      await appendChangeLog(env, "Recovery firmware key cleared");
      await appendWorkerEvent(env, { type: "recovery-key-clear" });
      return json({ ok: true });
    }

    // ── GET /api/admin/devices ────────────────────────────────────────────────
    if (path === "/api/admin/devices" && method === "GET") {
      const list = await env.BGDISPLAY_AUTH.list({ prefix: "device_registry:" });
      const devices = [];
      for (const key of list.keys) {
        const rec = await env.BGDISPLAY_AUTH.get(key.name, { type: "json" });
        if (rec) {
          const hasPerDeviceConfig = !!(await env.BGDISPLAY_CONFIG.get(`device_config:${rec.chipId}`));
          devices.push({
            chipId: rec.chipId,
            keyTail: rec.keyTail || rec.keyHash?.slice(-4) || "????",
            enrolledAt: rec.enrolledAt,
            enrolledFrom: rec.enrolledFrom,
            lastSeen: rec.lastSeen,
            lastSeenPath: rec.lastSeenPath,
            hasPerDeviceConfig,
          });
        }
      }
      return json({ devices });
    }

    // ── DELETE /api/admin/devices/:chipId ─────────────────────────────────────
    if (path.startsWith("/api/admin/devices/") && method === "DELETE") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }
      const chipId = path.slice("/api/admin/devices/".length).trim();
      if (!chipId || !/^[0-9a-f]{8,16}$/i.test(chipId)) return json({ error: "Invalid chipId" }, 400);
      const rec = await env.BGDISPLAY_AUTH.get(`device_registry:${chipId}`, { type: "json" });
      if (!rec) return json({ error: "Device not found" }, 404);
      await env.BGDISPLAY_AUTH.delete(`device_registry:${chipId}`);
      // Restore previous key hash so device can re-authenticate with its old key after factory reset
      if (rec.keyHash === auth.keyHash && rec.previousKeyHash) {
        auth.keyHash = rec.previousKeyHash;
        auth.lastRotated = Date.now();
        auth.lastRotatedReason = "enrollment-revoked";
        await env.BGDISPLAY_CONFIG.put("auth", JSON.stringify(auth));
      }
      await appendChangeLog(env, `Device enrollment revoked: chip ...${chipId.slice(-4)}`);
      return json({ ok: true });
    }

    // ── GET /api/admin/device-config/:chipId ─────────────────────────────────
    if (path.startsWith("/api/admin/device-config/") && method === "GET") {
      const chipId = path.slice("/api/admin/device-config/".length).trim().toLowerCase();
      if (!chipId || !/^[0-9a-f]{8,16}$/.test(chipId)) return json({ error: "Invalid chipId" }, 400);
      const overrides = await env.BGDISPLAY_CONFIG.get(`device_config:${chipId}`, { type: "json" }) || {};
      return json({ chipId, overrides });
    }

    // ── POST /api/admin/device-config/:chipId ────────────────────────────────
    if (path.startsWith("/api/admin/device-config/") && method === "POST") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }
      const chipId = path.slice("/api/admin/device-config/".length).trim().toLowerCase();
      if (!chipId || !/^[0-9a-f]{8,16}$/.test(chipId)) return json({ error: "Invalid chipId" }, 400);
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ error: "Invalid JSON" }, 400);
      // Only allow known config field keys — strip unknown fields
      const globalCfg = normalizeConfig(null);
      const allowed = new Set(Object.keys(globalCfg));
      const overrides = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.has(k)));
      if (Object.keys(overrides).length === 0) {
        await env.BGDISPLAY_CONFIG.delete(`device_config:${chipId}`);
      } else {
        await env.BGDISPLAY_CONFIG.put(`device_config:${chipId}`, JSON.stringify(overrides));
      }
      await appendChangeLog(env, `Per-device config updated: chip ...${chipId.slice(-4)}`);
      // Broadcast so device pulls updated config
      if (env.CONFIG_SYNC) {
        ctx.waitUntil((async () => {
          try {
            const version = await getConfigVersion(env);
            const stub = env.CONFIG_SYNC.get(env.CONFIG_SYNC.idFromName("global"));
            await stub.fetch(new Request("https://do.internal/broadcast", {
              method: "POST",
              body: JSON.stringify({ type: "config-changed", version, ts: Date.now() }),
              headers: { "Content-Type": "application/json" },
            }));
          } catch {}
        })());
      }
      return json({ ok: true, chipId, overrideCount: Object.keys(overrides).length });
    }

    // ── DELETE /api/admin/device-config/:chipId ───────────────────────────────
    if (path.startsWith("/api/admin/device-config/") && method === "DELETE") {
      if (!(await checkRateLimit(env, `admin-write:${ip}`, config.admin_write_rate_limit_per_min || 15))) {
        return json({ error: "Admin write rate limit exceeded" }, 429);
      }
      const chipId = path.slice("/api/admin/device-config/".length).trim().toLowerCase();
      if (!chipId || !/^[0-9a-f]{8,16}$/.test(chipId)) return json({ error: "Invalid chipId" }, 400);
      await env.BGDISPLAY_CONFIG.delete(`device_config:${chipId}`);
      await appendChangeLog(env, `Per-device config cleared: chip ...${chipId.slice(-4)}`);
      return json({ ok: true });
    }

    if (path === "/api/admin/clear-log" && method === "POST") {
      await env.BGDISPLAY_CONFIG.put("changelog", JSON.stringify([]));
      return json({ ok: true });
    }

    if (path === "/api/admin/export" && method === "GET") {
      const version = await getConfigVersion(env);
      return new Response(JSON.stringify({ config, exportedAt: Date.now(), version: "3.0.0", config_version: version }, null, 2), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="bg-miniview-config-${Date.now()}.json"` },
      });
    }

    if (path === "/api/admin/import" && method === "POST") {
      const body = await request.json().catch(() => null);
      if (!body?.config) return json({ error: "Invalid import file" }, 400);
      const merged = normalizeConfig(body.config);
      const nowTs = Date.now();
      await env.BGDISPLAY_CONFIG.put("config", JSON.stringify(merged));
      await env.BGDISPLAY_CONFIG.put("config_updated_at", String(nowTs));
      const newVersion = await incrementConfigVersion(env);
      await appendChangeLog(env, `Config imported from backup (v${newVersion})`);
      await appendWorkerEvent(env, { type: "config-save", version: newVersion, via: "import" });
      return json({ ok: true, config_version: newVersion, config_updated_at: nowTs });
    }

    return json({ error: "Not found" }, 404);
  },

  // ─── Scheduled handler (cron triggers) ──────────────────────────────────────
  async scheduled(event, env, ctx) {
    // "0 12,13 * * *" = daily digest at 7:00 AM CST/CDT (guarded internally to run once/day)
    // Hourly windows intentionally over-cover UTC and rely on Central-time guards in generateDailyDigest.
    // "*/5 * * * *"    = Pushover BG alert check and digest pushes
    if (event.cron === "0 12,13 * * *") {
      ctx.waitUntil(generateDailyDigest(env, false, "daily"));
    } else if (["0 12-23 * * *", "0 0-5 * * *"].includes(event.cron)) {
      ctx.waitUntil(generateDailyDigest(env, false, "hourly"));
    } else if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(runPushoverAlertCheck(env));
      ctx.waitUntil(sendDigestPushover(env));
      ctx.waitUntil(runDeviceOfflineCheck(env));
    } else {
      // Fallback: handle both
      ctx.waitUntil(generateDailyDigest(env, false, "daily"));
      ctx.waitUntil(generateDailyDigest(env, false, "hourly"));
      ctx.waitUntil(runPushoverAlertCheck(env));
    }
  },
};

// ─── Feature 1: Durable Object — WebSocket relay for instant config push ──────
// All device WebSocket connections share one global DO instance.
// The Worker validates auth before proxying; the DO just accepts and broadcasts.

export class ConfigSyncRelay {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const msg = await request.text();
      const sockets = this.state.getWebSockets();
      let sent = 0;
      for (const ws of sockets) {
        try { ws.send(msg); sent++; } catch {}
      }
      return new Response(JSON.stringify({ ok: true, sent, total: sockets.length }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.pathname === "/count") {
      return new Response(JSON.stringify({ count: this.state.getWebSockets().length }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  webSocketMessage(ws, message) {
    try {
      const msg = JSON.parse(message);
      if (msg.type === "ping") ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
    } catch {}
  }

  webSocketClose() {}
  webSocketError() {}
}
