// Medtronic CareLink pump data fetcher
// Fetches IOB, last bolus, and pod change data from Medtronic CareLink API

export async function authenticateMedtronic(username, password, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(8000);
  
  // Medtronic CareLink API endpoint: https://carelink.minimed.com/patient/sso/login
  // Returns session/auth token for subsequent requests
  const resp = await fetch("https://carelink.minimed.com/patient/sso/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
    signal,
  });
  
  if (!resp.ok) throw new Error(`Medtronic auth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.sessionToken && !data.authToken) throw new Error("No auth token in Medtronic response");
  return data.sessionToken || data.authToken;
}

export async function fetchMedtronicPumpSnapshot(config, deps = {}) {
  const signal = deps.signal || AbortSignal.timeout(9000);
  
  // Authenticate
  const token = await authenticateMedtronic(config.username, config.password, { signal });
  
  // Fetch current pump status from Medtronic API
  // Endpoint: GET /patient/connect/data
  const resp = await fetch("https://carelink.minimed.com/patient/connect/data", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal,
  });
  
  if (!resp.ok) throw new Error(`Medtronic pump fetch failed: ${resp.status}`);
  const data = await resp.json();
  
  // Extract IOB, last bolus, reservoir, expiry from response
  // Medtronic response structure may vary; adjust based on actual API
  const sgvData = data.lastSGValue || {};
  const pumpData = data.lastPumpData || {};
  
  const iob = Number(pumpData.insulinOnBoard) || Number(pumpData.iob) || 0;
  const lastBolusUnits = Number(pumpData.lastBolusAmount) || 0;
  const lastBolusTs = Number(pumpData.lastBolusTimestamp) || 0;
  const reservoirUnits = Number(pumpData.reservoirAmount) || 0;
  const minutesToExpiry = Number(pumpData.minutesToPumpExpiry) || -1;
  const timestamp = Math.floor(Date.now() / 1000);
  
  return {
    source: "medtronic",
    insulin_on_board: iob,
    last_bolus_units: lastBolusUnits,
    last_bolus_timestamp: lastBolusTs,
    reservoir_units: reservoirUnits,
    minutes_to_expiry: minutesToExpiry,
    pod_change_timestamp: 0, // Medtronic pumps are tubed; use 0
    timestamp,
  };
}
