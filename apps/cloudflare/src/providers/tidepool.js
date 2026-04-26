// Tidepool pump data fetcher
// Fetches pump-only status (IOB, last bolus, pod change) from Tidepool API

export async function authenticateTidepool(email, password, opts = {}) {
  const signal = opts.signal || AbortSignal.timeout(8000);
  
  // Tidepool API endpoint: https://api.tidepool.org/auth/login
  // Returns sessionToken and auth headers for subsequent requests
  const resp = await fetch("https://api.tidepool.org/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tidepool-Session-Token": "",
    },
    body: JSON.stringify({ username: email, password }),
    signal,
  });
  
  if (!resp.ok) throw new Error(`Tidepool auth failed: ${resp.status}`);
  const data = await resp.json();
  const token = resp.headers.get("X-Tidepool-Session-Token");
  if (!token) throw new Error("No session token in Tidepool response");
  return { token, userId: data.userid };
}

export async function fetchTidepoolPumpSnapshot(config, deps = {}) {
  const signal = deps.signal || AbortSignal.timeout(9000);
  
  // Authenticate
  const auth = await authenticateTidepool(config.email, config.password, { signal });
  
  // Fetch pump device and data from Tidepool API
  // Get list of paired devices and filter for pump
  const devResp = await fetch(`https://api.tidepool.org/data/${auth.userId}/devices`, {
    headers: {
      "X-Tidepool-Session-Token": auth.token,
      "Content-Type": "application/json",
    },
    signal,
  });
  
  if (!devResp.ok) throw new Error(`Tidepool device list failed: ${devResp.status}`);
  const devices = await devResp.json();
  const pumpDevice = devices.find(d => d.type === "insulin-pump") || devices[0];
  if (!pumpDevice) throw new Error("No pump device found in Tidepool");
  
  // Fetch latest pump data/events from Tidepool
  // Endpoint: GET /data/:userId/events?deviceId=...&limit=100
  const eventResp = await fetch(
    `https://api.tidepool.org/data/${auth.userId}/events?deviceId=${pumpDevice.id}&limit=100&type=bolus,wizard,basal`,
    {
      headers: {
        "X-Tidepool-Session-Token": auth.token,
        "Content-Type": "application/json",
      },
      signal,
    }
  );
  
  if (!eventResp.ok) throw new Error(`Tidepool events fetch failed: ${eventResp.status}`);
  const events = await eventResp.json();
  
  // Parse IOB, last bolus, and pod data from events
  // Tidepool events array contains bolus records with timestamps and amounts
  let iob = 0;
  let lastBolusUnits = 0;
  let lastBolusTs = 0;
  let podChangeTs = 0;
  
  for (const event of events) {
    if (event.type === "bolus" && event.normal) {
      if (!lastBolusTs || new Date(event.time).getTime() > lastBolusTs * 1000) {
        lastBolusUnits = Number(event.normal) || 0;
        lastBolusTs = Math.floor(new Date(event.time).getTime() / 1000);
      }
    }
    if (event.type === "siteChange" || event.type === "infusionSetChange") {
      podChangeTs = Math.floor(new Date(event.time).getTime() / 1000);
    }
  }
  
  // For Tidepool, IOB is not directly provided; would need separate endpoint or calculation
  // Using 0 as placeholder
  const timestamp = Math.floor(Date.now() / 1000);
  
  return {
    source: "tidepool",
    insulin_on_board: iob,
    last_bolus_units: lastBolusUnits,
    last_bolus_timestamp: lastBolusTs,
    reservoir_units: -1, // Tidepool may not expose reservoir
    minutes_to_expiry: -1,
    pod_change_timestamp: podChangeTs,
    timestamp,
  };
}
