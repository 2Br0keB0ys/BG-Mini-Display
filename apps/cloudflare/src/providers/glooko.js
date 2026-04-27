const KNOWN_SERVERS = {
  default: "api.glooko.com",
  development: "api.glooko.work",
  production: "externalapi.glooko.com",
  eu: "eu.api.glooko.com",
  us: "us.api.glooko.com",
};

const ENDPOINTS = {
  login: "/api/v2/users/sign_in",
  latestCgmReadings: "/api/v2/cgm/readings",
  graphData: "/api/v3/graph/data",
  lastGuid: "1e0c094e-1e54-4a4f-8e6a-f94484b53789",
};

function normalizeServer(config) {
  const explicit = String(config.server || "").trim();
  if (explicit) return explicit;
  const env = String(config.env || "default").toLowerCase();
  return KNOWN_SERVERS[env] || KNOWN_SERVERS.default;
}

function buildBaseUrl(config) {
  return `https://${normalizeServer(config)}`;
}

function deriveApiBaseFromDashboard(urlStr) {
  try {
    const u = new URL(urlStr);
    const apiHost = u.hostname
      .replace(/^eu\.my\./i, "eu.api.")
      .replace(/^my\./i, "api.");
    return `${u.protocol}//${apiHost}`;
  } catch {
    return "https://api.glooko.com";
  }
}

function buildDashboardOrigin(baseUrl) {
  try {
    const u = new URL(baseUrl);
    const host = u.hostname
      .replace(/^externalapi\./i, "my.")
      .replace(/^eu\.api\./i, "eu.my.")
      .replace(/^api\./i, "my.");
    return `${u.protocol}//${host}`;
  } catch {
    return "https://my.glooko.com";
  }
}

function parseSetCookie(headers) {
  if (!headers) return "";
  const raw = headers.get("set-cookie") || "";
  // Keep only the cookie pair section before first ';'.
  return raw.split(";")[0] || "";
}

function parseMetaCsrfToken(html) {
  if (!html) return "";
  const m = html.match(/name=["']csrf-token["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1] : "";
}

function parseDashboardPatientCode(html) {
  if (!html) return "";
  let m = html.match(/window\.patient\s*=\s*["']([^"']+)["']/i);
  if (m && m[1]) return m[1];
  m = html.match(/glookoCode["']?\s*[:=]\s*["']([^"'\\]+)["']/i);
  if (m && m[1]) return m[1];
  // Some pages serialize data with escaped quotes in inline script JSON.
  m = html.match(/glookoCode\\?\"\s*:\s*\\?\"([^\\\"]+)\\?\"/i);
  return m && m[1] ? m[1] : "";
}

function parseDashboardApiUrl(html) {
  if (!html) return "";
  let m = html.match(/apiUrl\s*:\s*["']([^"']+)["']/i);
  if (m && m[1]) return m[1];
  m = html.match(/apiUrl["']?\s*[:=]\s*["']([^"']+)["']/i);
  return m && m[1] ? m[1] : "";
}

async function authenticateViaWebLogin(config, fetchImpl, signal) {
  const loginUrl = "https://my.glooko.com/users/sign_in?id=login_form&locale=en-GB";
  const loginPage = await fetchImpl(loginUrl, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
    },
    redirect: "follow",
    signal,
  });

  if (!loginPage.ok) {
    throw new Error(`Glooko web login page failed (${loginPage.status})`);
  }

  const loginCookie = parseSetCookie(loginPage.headers);

  const pageHtml = await loginPage.text();
  const csrf = parseMetaCsrfToken(pageHtml);
  if (!csrf) {
    throw new Error("Glooko web login missing CSRF token");
  }

  const regionalUrl = loginPage.url || loginUrl;
  const form = new URLSearchParams();
  form.set("authenticity_token", csrf);
  form.set("user[email]", config.email);
  form.set("user[password]", config.password);
  form.set("commit", "Log In");

  const authResp = await fetchImpl(regionalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: regionalUrl,
      Origin: (() => {
        try { return new URL(regionalUrl).origin; } catch { return "https://my.glooko.com"; }
      })(),
      "User-Agent": "Mozilla/5.0",
      ...(loginCookie ? { Cookie: loginCookie } : {}),
    },
    body: form.toString(),
    redirect: "follow",
    signal,
  });

  if (!authResp.ok) {
    throw new Error(`Glooko web auth failed (${authResp.status})`);
  }

  const cookie = parseSetCookie(authResp.headers) || parseSetCookie(loginPage.headers);
  if (!cookie) {
    throw new Error("Glooko web auth missing session cookie");
  }

  const dashboardHtml = await authResp.text();
  const looksLikeLoginPage = /name=["']?user\[email\]["']?|id=["']?user_email["']?/i.test(dashboardHtml);
  const hasCredError = /invalid email or password|incorrect email or password|authentication failed/i.test(dashboardHtml);
  const hasLockError = /account (?:is )?locked|too many attempts/i.test(dashboardHtml);

  if (looksLikeLoginPage) {
    if (hasCredError) throw new Error("Glooko web auth rejected credentials");
    if (hasLockError) throw new Error("Glooko web auth account locked/rate-limited");
    throw new Error(`Glooko web auth did not establish session (url: ${authResp.url || regionalUrl})`);
  }

  const patientCode = parseDashboardPatientCode(dashboardHtml);
  if (!patientCode) {
    throw new Error(`Glooko web auth missing patient code (url: ${authResp.url || regionalUrl})`);
  }

  const discoveredApiUrl = parseDashboardApiUrl(dashboardHtml);
  const baseUrl = discoveredApiUrl || deriveApiBaseFromDashboard(authResp.url || regionalUrl);
  return { baseUrl, cookie, patientCode };
}

function coerceTimestamp(reading) {
  const candidate =
    reading?.timestamp ||
    reading?.date ||
    reading?.dateString ||
    reading?.deviceTimestamp ||
    reading?.pumpTimestamp ||
    reading?.readingTimestamp;

  if (!candidate) return null;

  if (typeof candidate === "number") {
    return new Date(candidate > 1e12 ? candidate : candidate * 1000);
  }

  const dt = new Date(candidate);
  return Number.isFinite(dt.getTime()) ? dt : null;
}

function coerceSgv(reading) {
  const candidate =
    reading?.value ??
    reading?.sgv ??
    reading?.mgdl ??
    reading?.valueInMgPerDl ??
    reading?.valueMgdl;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
}

function normalizeDirection(reading) {
  if (typeof reading?.direction === "string" && reading.direction.trim()) {
    return reading.direction.trim();
  }
  if (typeof reading?.trendName === "string" && reading.trendName.trim()) {
    return reading.trendName.trim();
  }
  return undefined;
}

function toGlucoseReading(reading) {
  const timestamp = coerceTimestamp(reading);
  const sgv = coerceSgv(reading);
  if (!timestamp || sgv === null) return null;

  return {
    timestamp,
    sgv,
    direction: normalizeDirection(reading),
    device: reading?.device || reading?.sourceDevice || undefined,
    source: "glooko",
  };
}

function getPatientCode(userBody) {
  return (
    userBody?.userLogin?.glookoCode ||
    userBody?.user?.userLogin?.glookoCode ||
    userBody?.glookoCode ||
    ""
  );
}

function buildReadingsUrl(baseUrl, patientCode, since, now, limit) {
  const endpoint = new URL(ENDPOINTS.latestCgmReadings, baseUrl);
  endpoint.searchParams.set("patient", patientCode);
  endpoint.searchParams.set("startDate", since.toISOString());
  endpoint.searchParams.set("endDate", now.toISOString());
  endpoint.searchParams.set("lastGuid", ENDPOINTS.lastGuid);
  endpoint.searchParams.set("lastUpdatedAt", since.toISOString());
  endpoint.searchParams.set("limit", String(limit));
  return endpoint;
}

function pickReadingsArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.readings)) return payload.readings;
  if (Array.isArray(payload?.data?.readings)) return payload.data.readings;
  return [];
}

async function authenticateGlooko(config, fetchImpl, signal) {
  const explicitServer = String(config.server || "").trim();
  const preferred = normalizeServer(config);
  const candidates = explicitServer
    ? [explicitServer]
    : [preferred, KNOWN_SERVERS.default, KNOWN_SERVERS.us, KNOWN_SERVERS.production, KNOWN_SERVERS.eu, KNOWN_SERVERS.development]
      .filter((v, i, arr) => !!v && arr.indexOf(v) === i);

  const payload = JSON.stringify({
    userLogin: {
      email: config.email,
      password: config.password,
    },
    deviceInformation: {
      deviceModel: "BGDisplay",
    },
  });

  const attempts = [];
  let lastError = "Glooko login failed";
  for (const server of candidates) {
    const baseUrl = `https://${server}`;
    const response = await fetchImpl(`${baseUrl}${ENDPOINTS.login}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: payload,
      signal,
    });

    if (!response.ok) {
      lastError = `Glooko login failed (${response.status}) via ${server}`;
      attempts.push(`${server}:${response.status}`);
      continue;
    }

    const cookie = parseSetCookie(response.headers);
    const user = await response.json();
    const patientCode = getPatientCode(user);
    if (!patientCode) {
      lastError = `Glooko login missing patient code via ${server}`;
      attempts.push(`${server}:missing_patient_code`);
      continue;
    }

    return { baseUrl, cookie, patientCode };
  }

  try {
    return await authenticateViaWebLogin(config, fetchImpl, signal);
  } catch (webErr) {
    const webMsg = String(webErr?.message || webErr || "web_login_failed");
    if (attempts.length > 0) {
      throw new Error(`Glooko login failed across servers (${attempts.join(", ")}); web fallback failed: ${webMsg}`);
    }
    throw new Error(`${lastError}; web fallback failed: ${webMsg}`);
  }
}

function coerceSeriesArray(payload, name) {
  const series = payload?.series || payload || {};
  const arr = series?.[name];
  return Array.isArray(arr) ? arr : [];
}

function parseEpochSeconds(value) {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e12) return Math.floor(n / 1000);
  return Math.floor(n);
}

function latestByTimestamp(items) {
  let latest = null;
  let latestTs = 0;
  for (const item of items || []) {
    const ts = parseEpochSeconds(item?.timestamp ?? item?.x ?? item?.date ?? item?.ts);
    if (ts > latestTs) {
      latestTs = ts;
      latest = item;
    }
  }
  return { item: latest, ts: latestTs };
}

export async function fetchGlookoPumpSnapshot(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const nowFn = deps.now || (() => new Date());
  const signal = deps.signal;

  if (!config || !config.email || !config.password) {
    throw new Error("Glooko pump snapshot requires email and password");
  }

  const auth = await authenticateGlooko(config, fetchImpl, signal);
  const end = nowFn();
  const start = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000);
  const dashboardOrigin = buildDashboardOrigin(auth.baseUrl);
  const query = [
    `patient=${encodeURIComponent(auth.patientCode)}`,
    `startDate=${encodeURIComponent(start.toISOString())}`,
    `endDate=${encodeURIComponent(end.toISOString())}`,
    "locale=en-GB",
    // Glooko graph endpoint is sensitive to encoded [] in series names.
    "series[]=deliveredBolus",
    "series[]=setSiteChange",
    "series[]=reservoirChange",
  ].join("&");
  const endpoint = `${auth.baseUrl}${ENDPOINTS.graphData}?${query}`;

  const response = await fetchImpl(endpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: auth.cookie,
      "X-Requested-With": "XMLHttpRequest",
      Origin: dashboardOrigin,
      Referer: `${dashboardOrigin}/`,
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Glooko pump snapshot fetch failed (${response.status})`);
  }

  const payload = await response.json();
  const boluses = coerceSeriesArray(payload, "deliveredBolus");
  const siteChanges = coerceSeriesArray(payload, "setSiteChange");
  const reservoirChanges = coerceSeriesArray(payload, "reservoirChange");

  const latestBolus = latestByTimestamp(boluses);
  const latestSite = latestByTimestamp(siteChanges);
  const latestReservoir = latestByTimestamp(reservoirChanges);

  const bolusUnits = Number(
    latestBolus.item?.insulinDelivered ??
    latestBolus.item?.y ??
    latestBolus.item?.value ??
    -1,
  );
  const iob = Number(latestBolus.item?.insulinOnBoard ?? -1);
  const podChangeTs = Math.max(latestSite.ts || 0, latestReservoir.ts || 0);

  return {
    insulin_on_board: Number.isFinite(iob) ? iob : -1,
    last_bolus_units: Number.isFinite(bolusUnits) ? bolusUnits : -1,
    last_bolus_timestamp: latestBolus.ts || 0,
    pod_change_timestamp: podChangeTs || 0,
    timestamp: Math.floor(end.getTime() / 1000),
    source: "glooko",
  };
}

/**
 * Create an isolated Glooko data provider.
 * No env lookups and no internal timers; all config and dependencies are injected.
 *
 * @param {import('./types.js').GlookoProviderConfig} config
 * @param {{ fetchImpl?: typeof fetch, now?: () => Date }} deps
 * @returns {import('./types.js').CgmDataProvider}
 */
export function createGlookoProvider(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const nowFn = deps.now || (() => new Date());

  if (!config || !config.email || !config.password) {
    throw new Error("Glooko provider requires email and password");
  }

  return {
    async fetchReadings(options = {}) {
      const signal = options.signal;
      const now = nowFn();
      const defaultSince = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const since = options.since instanceof Date ? options.since : defaultSince;
      const minutes = Math.max(5, Math.ceil((now.getTime() - since.getTime()) / (5 * 60 * 1000)) * 5);
      const limit = Math.max(1, options.limit || Math.ceil(minutes / 5));

      const auth = await authenticateGlooko(config, fetchImpl, signal);
      const endpoint = buildReadingsUrl(auth.baseUrl, auth.patientCode, since, now, limit);

      const response = await fetchImpl(endpoint.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Cookie: auth.cookie,
        },
        signal,
      });

      if (!response.ok) {
        throw new Error(`Glooko readings fetch failed (${response.status})`);
      }

      const payload = await response.json();
      const readings = pickReadingsArray(payload)
        .map(toGlucoseReading)
        .filter(Boolean)
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      return readings.slice(0, limit);
    },
  };
}
