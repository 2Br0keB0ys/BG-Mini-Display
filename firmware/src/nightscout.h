// nightscout.h — Nightscout BG + trend only (no pod data)
#pragma once
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sd_logger.h"

bool fetchNightscout(AppConfig& cfg, BGReading& reading) {
  if (!strlen(cfg.nightscoutUrl)) return false;

  // Build URL — normalize trailing slash and use token param if secret provided.
  String base = String(cfg.nightscoutUrl);
  base.trim();
  while (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }
  String url = base + "/api/v1/entries.json?count=1";
  if (strlen(cfg.nightscoutSecret) > 0) {
    url += "&token="; url += cfg.nightscoutSecret;
  }

  HTTPClient http;
  http.begin(url);
  http.setTimeout(8000);
#if DIAG_MODE
  // Log domain only — never log the token value
  {
    String domain = base;
    int sl = domain.indexOf('/', 8);  // skip https://
    if (sl > 0) domain = domain.substring(0, sl);
    sdLogfEx("NS", "NS_FETCH", "request domain:%s hasToken:%d",
      domain.c_str(), strlen(cfg.nightscoutSecret) > 0 ? 1 : 0);
  }
#endif
  unsigned long _nsT0 = millis();
  int code = http.GET();
  unsigned long _nsMs = millis() - _nsT0;
  sdLogfEx("NS", "NS_FETCH", "http:%d err:%s elapsed_ms:%lu token:%d",
    code, HTTPClient::errorToString(code).c_str(), _nsMs, strlen(cfg.nightscoutSecret) > 0 ? 1 : 0);

  bool ok = false;
  if (code == 200) {
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    if (!err && doc.is<JsonArray>() && doc.size() > 0) {
      JsonObject e = doc[0];
      reading.value = (int)(e["sgv"].as<float>());
      reading.delta = e["delta"] | 0.0f;

      // Timestamp (ms epoch)
      long long ms = e["date"] | (long long)0;
      reading.timestamp = (time_t)(ms / 1000);
      reading.stale = false;
      reading.source = SOURCE_NIGHTSCOUT;

      // Trend — handle both string and numeric
      if (e["direction"].is<const char*>()) {
        const char* d = e["direction"];
        if      (!strcmp(d,"DoubleUp"))      reading.trend = 2;
        else if (!strcmp(d,"SingleUp"))      reading.trend = 3;
        else if (!strcmp(d,"FortyFiveUp"))   reading.trend = 4;
        else if (!strcmp(d,"Flat"))          reading.trend = 5;
        else if (!strcmp(d,"FortyFiveDown")) reading.trend = 6;
        else if (!strcmp(d,"SingleDown"))    reading.trend = 7;
        else if (!strcmp(d,"DoubleDown"))    reading.trend = 8;
        else                                 reading.trend = 5;
      } else {
        reading.trend = e["trend"] | 5;
      }

      ok = (reading.value > 0);
      Serial.printf("NS: BG=%d trend=%d\n", reading.value, reading.trend);
      if (ok) {
        sdLogfEx("NS", "NS_FETCH", "ok bg:%d trend:%d ts:%lu", reading.value, reading.trend, (unsigned long)reading.timestamp);
      } else {
        sdLogfEx("ERR", "NS_FETCH", "invalid_bg value:%d", reading.value);
      }
    } else {
      sdLogfEx("ERR", "NS_FETCH", "parse_or_empty err:%s", err.c_str());
    }
  } else {
    Serial.printf("NS: HTTP %d\n", code);
    {
      char msg[80];
      snprintf(msg, sizeof(msg), "Nightscout HTTP %d (%s) elapsed_ms:%lu",
        code, HTTPClient::errorToString(code).c_str(), _nsMs);
      sdLogfEx("ERR", "NS_FETCH", "%s", msg);
    }
#if DIAG_MODE
    {
      String errBody = http.getString();
      if (errBody.length() > 0) {
        sdLogfEx("NS", "NS_FETCH", "err_body_preview:%s", errBody.substring(0, 200).c_str());
      }
    }
#endif
  }
  http.end();
  return ok;
}
