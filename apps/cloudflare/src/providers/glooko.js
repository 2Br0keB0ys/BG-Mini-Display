const KNOWN_SERVERS = {
  default: "api.glooko.com",
  development: "api.glooko.work",
  production: "externalapi.glooko.com",
  eu: "eu.api.glooko.com",
};

const ENDPOINTS = {
  login: "/api/v2/users/sign_in",
  latestCgmReadings: "/api/v2/cgm/readings",
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

function parseSetCookie(headers) {
  if (!headers) return "";
  const raw = headers.get("set-cookie") || "";
  // Keep only the cookie pair section before first ';'.
  return raw.split(";")[0] || "";
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

  async function authenticate(signal) {
    const baseUrl = buildBaseUrl(config);
    const response = await fetchImpl(`${baseUrl}${ENDPOINTS.login}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify({
        userLogin: {
          email: config.email,
          password: config.password,
        },
        deviceInformation: {
          deviceModel: "BGDisplay",
        },
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Glooko login failed (${response.status})`);
    }

    const cookie = parseSetCookie(response.headers);
    const user = await response.json();
    const patientCode = getPatientCode(user);
    if (!patientCode) {
      throw new Error("Glooko login response missing patient code");
    }

    return { baseUrl, cookie, patientCode };
  }

  return {
    async fetchReadings(options = {}) {
      const signal = options.signal;
      const now = nowFn();
      const defaultSince = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
      const since = options.since instanceof Date ? options.since : defaultSince;
      const minutes = Math.max(5, Math.ceil((now.getTime() - since.getTime()) / (5 * 60 * 1000)) * 5);
      const limit = Math.max(1, options.limit || Math.ceil(minutes / 5));

      const auth = await authenticate(signal);
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
