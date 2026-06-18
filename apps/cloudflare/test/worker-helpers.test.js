import { describe, it, expect } from "vitest";
import {
  compareVersions,
  parseVersionParts,
  describeTrend,
  normalizeTrend,
  normalizeConfig,
  normalizeOtaRelease,
  normalizeDndSchedule,
  buildDeterministicDigest,
} from "../src/worker.js";

describe("compareVersions", () => {
  it("treats identical versions as equal", () => {
    // This is the exact comparison the OTA manifest endpoint uses to decide
    // whether an update is "available" — a same-version release must compare
    // as equal, or devices already on that version would loop forever.
    expect(compareVersions("4.1.4", "4.1.4")).toBe(0);
  });

  it("detects a newer release", () => {
    expect(compareVersions("4.1.4", "4.1.3")).toBe(1);
  });

  it("detects an older release", () => {
    expect(compareVersions("4.1.3", "4.1.4")).toBe(-1);
  });

  it("handles a 'v' prefix and different segment counts", () => {
    expect(compareVersions("v4.2", "4.1.9")).toBe(1);
  });
});

describe("parseVersionParts", () => {
  it("strips leading non-digit characters", () => {
    expect(parseVersionParts("v4.1.4")).toEqual([4, 1, 4]);
  });

  it("returns an empty array for garbage input", () => {
    expect(parseVersionParts("not-a-version")).toEqual([]);
  });
});

describe("describeTrend", () => {
  it("translates Dexcom/Nightscout enums to plain language", () => {
    expect(describeTrend("FortyFiveDown")).toBe("falling slightly");
    expect(describeTrend("DoubleUp")).toBe("rising rapidly");
    expect(describeTrend("Flat")).toBe("steady");
  });

  it("never leaks the raw enum for not-computable/unknown trends", () => {
    // Regression test: this previously caused the AI digest to literally say
    // "NOT COMPUTABLE trend status" because the raw enum was passed straight
    // into the prompt.
    expect(describeTrend("NotComputable")).toBe("trend unavailable");
    expect(describeTrend("")).toBe("trend unavailable");
    expect(describeTrend(undefined)).toBe("trend unavailable");
  });

  it("is case- and separator-insensitive", () => {
    expect(describeTrend("forty_five_down")).toBe("falling slightly");
    expect(describeTrend("FORTY-FIVE-DOWN")).toBe("falling slightly");
  });
});

describe("normalizeTrend", () => {
  it("prefers a known Nightscout direction string over the numeric trend", () => {
    expect(normalizeTrend(0, "FortyFiveDown")).toEqual({ numeric: 5, name: "FortyFiveDown" });
  });

  it("falls back to the numeric Dexcom scale when direction is unrecognized", () => {
    expect(normalizeTrend(8, "")).toEqual({ numeric: 8, name: "NotComputable" });
  });

  it("defaults to Flat when neither input is usable", () => {
    expect(normalizeTrend(NaN, undefined)).toEqual({ numeric: 4, name: "Flat" });
  });
});

describe("normalizeConfig", () => {
  it("never returns Pushover credentials, even if present in the input", () => {
    const out = normalizeConfig({ pushover_user_key: "secret", pushover_api_token: "secret2" });
    expect(out.pushover_user_key).toBeUndefined();
    expect(out.pushover_api_token).toBeUndefined();
  });

  it("strips retired MQTT fields", () => {
    const out = normalizeConfig({ mqtt_host: "broker.local", mqtt_user: "x", mqtt_pass: "y" });
    expect(out.mqtt_host).toBeUndefined();
    expect(out.mqtt_user).toBeUndefined();
    expect(out.mqtt_pass).toBeUndefined();
  });

  it("clamps alert_stale_min into its valid range", () => {
    expect(normalizeConfig({ alert_stale_min: 1 }).alert_stale_min).toBe(5);
    expect(normalizeConfig({ alert_stale_min: 9999 }).alert_stale_min).toBe(240);
    expect(normalizeConfig({ alert_stale_min: 30 }).alert_stale_min).toBe(30);
  });

  it("rejects an unsupported insulin_pump_type", () => {
    expect(normalizeConfig({ insulin_pump_type: "spaceship" }).insulin_pump_type).toBe("none");
    expect(normalizeConfig({ insulin_pump_type: "Pump" }).insulin_pump_type).toBe("pump");
  });

  it("defaults ota_enabled to true unless explicitly false", () => {
    expect(normalizeConfig({}).ota_enabled).toBe(true);
    expect(normalizeConfig({ ota_enabled: false }).ota_enabled).toBe(false);
  });
});

describe("normalizeOtaRelease", () => {
  it("returns null when required fields are missing", () => {
    expect(normalizeOtaRelease({ channel: "stable" })).toBeNull();
    expect(normalizeOtaRelease(null)).toBeNull();
  });

  it("accepts snake_case aliases and normalizes to camelCase", () => {
    const release = normalizeOtaRelease({
      version: "4.1.4",
      r2_key: "stable/bg-display-mini-4.1.4.bin",
      size_bytes: 1332448,
    });
    expect(release.r2Key).toBe("stable/bg-display-mini-4.1.4.bin");
    expect(release.sizeBytes).toBe(1332448);
  });

  it("defaults channel to stable and lowercases/truncates it", () => {
    const release = normalizeOtaRelease({
      channel: "  BETA-channel-name-too-long  ",
      version: "1.0.0",
      r2Key: "x",
    });
    expect(release.channel).toBe(release.channel.toLowerCase());
    expect(release.channel.length).toBeLessThanOrEqual(15);
  });
});

describe("normalizeDndSchedule", () => {
  it("fills every day of the week from fallbacks when nothing is set", () => {
    const out = normalizeDndSchedule(undefined, "22:00", "07:00");
    expect(Object.keys(out)).toHaveLength(7);
    expect(out.mon).toEqual({ from: "22:00", to: "07:00" });
    expect(out.sun).toEqual({ from: "22:00", to: "07:00" });
  });

  it("keeps a valid per-day override and rejects an invalid one", () => {
    const out = normalizeDndSchedule(
      { mon: { from: "21:30", to: "06:15" }, tue: { from: "not-a-time", to: "06:00" } },
      "23:00",
      "06:00"
    );
    expect(out.mon).toEqual({ from: "21:30", to: "06:15" });
    expect(out.tue.from).toBe("23:00");
  });
});

describe("buildDeterministicDigest", () => {
  it("uses translated trend text, not a raw enum, in the hourly fallback", () => {
    const text = buildDeterministicDigest("hourly", {
      latest: 96,
      latestTrend: describeTrend("NotComputable"),
      latestLocalTime: "9:00 AM",
      latestAgeMin: 4,
      avgDelta: -9,
      variability: 6,
    });
    expect(text).toContain("trend unavailable");
    expect(text).not.toMatch(/NotComputable/i);
  });

  it("reports when the overnight average could not be calculated", () => {
    const text = buildDeterministicDigest("daily", {
      tir: 80,
      low: 70,
      high: 180,
      aboveHigh: 2,
      belowLow: 1,
      urgLows: 0,
      urgHighs: 0,
      overnightAvg: null,
      latest: 110,
      latestTrend: "steady",
      latestLocalTime: "7:00 AM",
      latestAgeMin: 5,
      avgDelta: 1,
      variability: 8,
    });
    expect(text).toContain("Overnight average could not be calculated");
  });
});
