// weather.h — weather status fetch via Worker proxy
#pragma once

#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include "config.h"
#include "sd_logger.h"

// Implemented in bgdisplay.ino.
extern void addSignedHeaders(HTTPClient& http, const char* method, const String& pathWithQuery, const String& body, AppConfig& cfg);

struct WeatherStatus {
  bool valid = false;
  float outsideTempC = NAN;
  bool hasInsideTemp = false;
  float insideTempC = NAN;
  int weatherCode = -1;
  bool isDay = true;
  char description[48] = "";
  char location[48] = "";
  time_t dataTimestamp = 0;
  unsigned long fetchedAtMs = 0;
};

inline bool weatherConfigured(const AppConfig& cfg) {
  if (!cfg.weatherEnabled) return false;
  if (strlen(cfg.workerUrl) == 0 || strlen(cfg.deviceKey) == 0) return false;
  return strlen(cfg.weatherCity) > 0 || strlen(cfg.weatherZip) > 0;
}

inline time_t parseWeatherEpoch(const JsonVariantConst& v) {
  if (v.is<long long>()) {
    long long raw = v.as<long long>();
    if (raw > 1000000000000LL) raw /= 1000LL;
    if (raw > 1700000000LL) return (time_t)raw;
  }
  return 0;
}

inline bool fetchWeatherStatus(AppConfig& cfg, WeatherStatus& out) {
  if (!weatherConfigured(cfg)) {
    return false;
  }

  HTTPClient http;
  String path = "/api/weather";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  http.addHeader("Accept", "application/json");
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(9000);

  int code = http.GET();
  if (code != 200) {
    sdLogfEx("ERR", "WX", "proxy_http:%d", code);
    http.end();
    out.fetchedAtMs = millis();
    return false;
  }

  String body = http.getString();
  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, body);
  http.end();
  if (err) {
    sdLogfEx("ERR", "WX", "parse_failed:%s", err.c_str());
    out.fetchedAtMs = millis();
    return false;
  }

  JsonObject root = doc.as<JsonObject>();
  bool available = root["available"] | false;
  if (!available) {
    out.valid = false;
    out.fetchedAtMs = millis();
    return false;
  }

  out.outsideTempC = root["outside_temp_c"].is<float>() ? root["outside_temp_c"].as<float>() : NAN;
  out.hasInsideTemp = root["inside_temp_c"].is<float>();
  out.insideTempC = out.hasInsideTemp ? root["inside_temp_c"].as<float>() : NAN;
  out.weatherCode = root["weather_code"] | -1;
  out.isDay = root["is_day"].is<bool>() ? root["is_day"].as<bool>() : true;

  String d = root["description"] | "";
  String loc = root["location"] | "";
  strlcpy(out.description, d.c_str(), sizeof(out.description));
  strlcpy(out.location, loc.c_str(), sizeof(out.location));

  out.dataTimestamp = parseWeatherEpoch(root["timestamp"]);
  out.fetchedAtMs = millis();
  out.valid = !isnan(out.outsideTempC);
  return out.valid;
}
