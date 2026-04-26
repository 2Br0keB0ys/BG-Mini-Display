import { createCgmDataProvider } from "./registry.js";

async function runExample() {
  const provider = createCgmDataProvider("glooko", {
    email: "user@example.com",
    password: "replace-me",
    env: "default",
  });

  const readings = await provider.fetchReadings({ limit: 3 });
  console.log(readings.map((r) => ({
    timestamp: r.timestamp.toISOString(),
    sgv: r.sgv,
    direction: r.direction,
    source: r.source,
  })));
}

// Example only: invoke manually when needed.
// runExample();

export { runExample };
