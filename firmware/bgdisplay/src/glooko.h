// glooko.h — Omnipod status fetch via Worker proxy
#pragma once

#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sd_logger.h"

// Implemented in bgdisplay.ino.
extern void addSignedHeaders(HTTPClient& http, const char* method, const String& pathWithQuery, const String& body, AppConfig& cfg);

struct OmnipodStatus {
  bool valid = false;
  bool podActive = false;
  float insulinOnBoard = -1.0f;
  float reservoirUnits = -1.0f;
  int minutesToExpiry = -1;
  time_t dataTimestamp = 0;
  unsigned long fetchedAtMs = 0;
};

inline bool omnipodConfigured(const AppConfig& cfg) {
  return cfg.glookoEnabled && strlen(cfg.workerUrl) > 0 && strlen(cfg.deviceKey) > 0;
}

inline time_t parseEpochSeconds(const JsonVariantConst& v) {
  if (v.is<long long>()) {
    long long raw = v.as<long long>();
    // Handle both seconds and milliseconds epoch values.
    if (raw > 1000000000000LL) raw /= 1000LL;
    if (raw > 1700000000LL) return (time_t)raw;
  }
  return 0;
}

inline bool fetchGlookoOmnipod(AppConfig& cfg, OmnipodStatus& out) {
  if (!omnipodConfigured(cfg)) return false;

  HTTPClient http;
  String path = "/api/omnipod";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  http.addHeader("Accept", "application/json");
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(9000);

  int code = http.GET();
  if (code != 200) {
    char msg[48];
    snprintf(msg, sizeof(msg), "Omnipod proxy HTTP %d", code);
    sdLogError(msg);
    http.end();
    out.fetchedAtMs = millis();
    return false;
  }

  DynamicJsonDocument doc(3072);
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) {
    sdLogError("Omnipod proxy parse failed");
    out.fetchedAtMs = millis();
    return false;
  }

  JsonObject root = doc.as<JsonObject>();
  if (root.containsKey("available") && !root["available"].as<bool>()) {
    out.fetchedAtMs = millis();
    out.valid = false;
    sdLog("POD", "Omnipod data unavailable");
    return false;
  }

  JsonObject pod = root.containsKey("omnipod") && root["omnipod"].is<JsonObject>()
    ? root["omnipod"].as<JsonObject>()
    : root;

  bool touched = false;
  if (pod.containsKey("pod_active")) {
    out.podActive = pod["pod_active"].as<bool>();
    touched = true;
  } else if (pod.containsKey("active")) {
    out.podActive = pod["active"].as<bool>();
    touched = true;
  }

  if (pod.containsKey("insulin_on_board")) {
    out.insulinOnBoard = pod["insulin_on_board"].as<float>();
    touched = true;
  } else if (pod.containsKey("iob")) {
    out.insulinOnBoard = pod["iob"].as<float>();
    touched = true;
  }

  if (pod.containsKey("reservoir_units")) {
    out.reservoirUnits = pod["reservoir_units"].as<float>();
    touched = true;
  } else if (pod.containsKey("reservoir")) {
    out.reservoirUnits = pod["reservoir"].as<float>();
    touched = true;
  }

  if (pod.containsKey("minutes_to_expiry")) {
    out.minutesToExpiry = pod["minutes_to_expiry"].as<int>();
    touched = true;
  } else if (pod.containsKey("pod_expires_in_min")) {
    out.minutesToExpiry = pod["pod_expires_in_min"].as<int>();
    touched = true;
  }

  time_t ts = 0;
  if (pod.containsKey("timestamp")) ts = parseEpochSeconds(pod["timestamp"]);
  if (!ts && pod.containsKey("ts")) ts = parseEpochSeconds(pod["ts"]);
  if (!ts && root.containsKey("timestamp")) ts = parseEpochSeconds(root["timestamp"]);
  out.dataTimestamp = ts;

  out.fetchedAtMs = millis();
  out.valid = touched;

  if (out.valid) {
    sdLog("POD", "Omnipod proxy fetch success");
  } else {
    sdLogError("Omnipod proxy payload missing fields");
  }
  return out.valid;
}
