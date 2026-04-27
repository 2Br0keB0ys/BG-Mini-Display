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
  int minutesToExpiry = -1;
  time_t podChangeTimestamp = 0;
  time_t siteChangeTimestamp = 0;
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
  if (!omnipodConfigured(cfg)) {
    sdLogfEx(
      "ERR",
      "POD_SYNC",
      "not_configured enabled:%d hasWorker:%d hasKey:%d",
      cfg.glookoEnabled ? 1 : 0,
      strlen(cfg.workerUrl) > 0 ? 1 : 0,
      strlen(cfg.deviceKey) > 0 ? 1 : 0
    );
    return false;
  }

  sdLogfEx("POD", "POD_SYNC", "request_start pollMin:%d", cfg.glookoPollMin);

  HTTPClient http;
  String path = "/api/omnipod";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  http.addHeader("Accept", "application/json");
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(9000);

  int code = http.GET();
  sdLogfEx("POD", "POD_SYNC", "proxy_http:%d", code);
  if (code != 200) {
    char msg[48];
    snprintf(msg, sizeof(msg), "Omnipod proxy HTTP %d", code);
    sdLogfEx("ERR", "POD_SYNC", "%s", msg);
    http.end();
    out.fetchedAtMs = millis();
    return false;
  }

  String body = http.getString();
  DynamicJsonDocument doc(3072);
  DeserializationError err = deserializeJson(doc, body);
  http.end();
  if (err) {
    String preview = body.substring(0, 180);
    preview.replace("\n", " ");
    preview.replace("\r", " ");
    sdLogfEx("ERR", "POD_SYNC", "proxy_parse_failed err:%s body:%s", err.c_str(), preview.c_str());
    out.fetchedAtMs = millis();
    return false;
  }

  JsonObject root = doc.as<JsonObject>();
  if (root.containsKey("available") && !root["available"].as<bool>()) {
    const char* reason = root["reason"] | "unknown";
    const char* source = root["source"] | "unknown";
    bool hasEndpoint = root["hasEndpoint"] | false;
    bool hasToken = root["hasToken"] | false;
    int httpCode = root["http"] | 0;
    out.fetchedAtMs = millis();
    out.valid = false;
    sdLogfEx(
      "ERR",
      "POD_SYNC",
      "data_unavailable reason:%s source:%s hasEndpoint:%d hasToken:%d upstreamHttp:%d",
      reason,
      source,
      hasEndpoint ? 1 : 0,
      hasToken ? 1 : 0,
      httpCode
    );
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

  if (pod.containsKey("minutes_to_expiry")) {
    out.minutesToExpiry = pod["minutes_to_expiry"].as<int>();
    touched = true;
  } else if (pod.containsKey("pod_expires_in_min")) {
    out.minutesToExpiry = pod["pod_expires_in_min"].as<int>();
    touched = true;
  }

  time_t podChangeTs = 0;
  if (pod.containsKey("pod_change_timestamp")) podChangeTs = parseEpochSeconds(pod["pod_change_timestamp"]);
  if (!podChangeTs && pod.containsKey("podChangeTimestamp")) podChangeTs = parseEpochSeconds(pod["podChangeTimestamp"]);
  if (!podChangeTs && pod.containsKey("last_pod_change_ts")) podChangeTs = parseEpochSeconds(pod["last_pod_change_ts"]);
  if (podChangeTs > 0) {
    out.podChangeTimestamp = podChangeTs;
    touched = true;
  }

  time_t siteChangeTs = 0;
  if (pod.containsKey("site_change_timestamp")) siteChangeTs = parseEpochSeconds(pod["site_change_timestamp"]);
  if (siteChangeTs > 0) {
    out.siteChangeTimestamp = siteChangeTs;
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
    sdLogfEx(
      "POD",
      "POD_SYNC",
      "ok active:%d expMin:%d siteChangeTs:%lu podChangeTs:%lu ts:%lu",
      out.podActive ? 1 : 0,
      out.minutesToExpiry,
      (unsigned long)out.siteChangeTimestamp,
      (unsigned long)out.podChangeTimestamp,
      (unsigned long)out.dataTimestamp
    );
  } else {
    sdLogfEx(
      "ERR",
      "POD_SYNC",
      "payload_missing_fields active:%d expiry:%d siteChange:%d",
      pod.containsKey("pod_active") || pod.containsKey("active") ? 1 : 0,
      pod.containsKey("minutes_to_expiry") || pod.containsKey("pod_expires_in_min") ? 1 : 0,
      pod.containsKey("site_change_timestamp") ? 1 : 0
    );
  }
  return out.valid;
}
