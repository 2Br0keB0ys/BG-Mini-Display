// Tandem Diabetes t:slim / Control-IQ pump data fetcher
// Fetches IOB, last bolus, and pod change data from Tandem Patient Cloud API

export async function authenticateTandem(email, password, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(8000);
  
  // Tandem API endpoint: https://api.tandemdiabetes.com/v1/auth
  // Returns session token for subsequent requests
  const resp = await fetch("https://api.tandemdiabetes.com/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal,
  });
  
  if (!resp.ok) throw new Error(`Tandem auth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.sessionToken) throw new Error("No session token in Tandem response");
  return data.sessionToken;
}

export async function fetchTandemPumpSnapshot(config, deps = {}) {
  const signal = deps.signal || AbortSignal.timeout(9000);
  
  // Authenticate
  const token = await authenticateTandem(config.email, config.password, { signal });
  
  // Fetch current pump status from Tandem API
  // Endpoint: GET /v1/users/me/devices/pump/status
  const resp = await fetch("https://api.tandemdiabetes.com/v1/users/me/devices/pump/status", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal,
  });
  
  if (!resp.ok) throw new Error(`Tandem pump fetch failed: ${resp.status}`);
  const data = await resp.json();
  
  // Extract IOB, last bolus, reservoir, expiry from response
  // Expected fields vary; adjust based on actual Tandem API response
  const iob = Number(data.iobUnits) || 0;
  const lastBolusUnits = Number(data.lastBolusUnits) || 0;
  const lastBolusTs = Number(data.lastBolusTimestamp) || 0;
  const reservoirUnits = Number(data.reservoirUnits) || 0;
  const minutesToExpiry = Number(data.minutesToExpiry) || -1;
  const timestamp = Math.floor(Date.now() / 1000);
  
  return {
    source: "tandem",
    insulin_on_board: iob,
    last_bolus_units: lastBolusUnits,
    last_bolus_timestamp: lastBolusTs,
    reservoir_units: reservoirUnits,
    minutes_to_expiry: minutesToExpiry,
    pod_change_timestamp: 0, // Tandem pumps are not pod-based; use 0
    timestamp,
  };
}
