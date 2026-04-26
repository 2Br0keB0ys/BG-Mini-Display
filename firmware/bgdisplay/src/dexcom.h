// dexcom.h — Dexcom Share API
// Supports both email (user@example.com) and phone number (+14056551665) login

#pragma once
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sd_logger.h"

static String dexSessionId    = "";
static String dexAccountId    = "";
static unsigned long dexSessionExpiry = 0;

static int dexTrendFromValue(const JsonVariantConst& trendVar) {
  if (trendVar.is<const char*>()) {
    const char* d = trendVar.as<const char*>();
    if      (!strcmp(d, "DoubleUp"))      return 2;
    else if (!strcmp(d, "SingleUp"))      return 3;
    else if (!strcmp(d, "FortyFiveUp"))   return 4;
    else if (!strcmp(d, "Flat"))          return 5;
    else if (!strcmp(d, "FortyFiveDown")) return 6;
    else if (!strcmp(d, "SingleDown"))    return 7;
    else if (!strcmp(d, "DoubleDown"))    return 8;
    return 5;
  }
  return trendVar.as<int>() ? trendVar.as<int>() : 5;
}

static long long parseDexcomDateMs(const char* raw) {
  if (!raw) return 0;
  const char* p = strchr(raw, '(');
  if (!p) return 0;
  p++;
  while (*p && !isdigit((unsigned char)*p) && *p != '-') p++;
  if (!*p) return 0;

  char num[24];
  size_t i = 0;
  if (*p == '-') {
    num[i++] = *p++;
  }
  while (*p && isdigit((unsigned char)*p) && i < (sizeof(num) - 1)) {
    num[i++] = *p++;
  }
  num[i] = '\0';
  if (i == 0 || (i == 1 && num[0] == '-')) return 0;
  return atoll(num);
}

// Step 1 (Nightscout-compatible): get accountId from accountName + password
bool dexAuthenticateAccount(AppConfig& cfg) {
  bool isUS = (strcmp(cfg.dexcomRegion, "US") == 0);
  const char* authUrl = isUS
    ? "https://share2.dexcom.com/ShareWebServices/Services/General/AuthenticatePublisherAccount"
    : "https://shareous1.dexcom.com/ShareWebServices/Services/General/AuthenticatePublisherAccount";

  HTTPClient http;
  http.begin(authUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept",       "application/json");
  http.addHeader("User-Agent",   "share2nightscout-bridge/0.2.5");
  http.setTimeout(10000);

  // accountName accepts email or phone when Share is enabled.
  StaticJsonDocument<256> body;
  body["accountName"]   = cfg.dexcomUser;
  body["password"]      = cfg.dexcomPass;
  body["applicationId"] = "d89443d2-327c-4a6f-89e5-496bbb0317db";

  String bs; serializeJson(body, bs);
  int code = http.POST(bs);
  sdLogfEx("DEX", "DEX_AUTH", "auth_http:%d region:%s userLen:%u", code, cfg.dexcomRegion, (unsigned)strlen(cfg.dexcomUser));

  if (code == 200) {
    String r = http.getString();
    r.replace("\"", ""); r.trim();
    if (r.length() > 10) {
      dexAccountId = r;
      http.end();
      sdLogfEx("DEX", "DEX_AUTH", "auth_ok accountIdLen:%u", (unsigned)dexAccountId.length());
      return true;
    }
  }

  Serial.printf("Dexcom auth failed: HTTP %d\n", code);
  char msg[40];
  snprintf(msg, sizeof(msg), "Dex auth HTTP %d", code);
  sdLogfEx("ERR", "DEX_AUTH", "%s", msg);
  dexAccountId = "";
  dexSessionId = "";
  http.end();
  return false;
}

// Step 2 (Nightscout-compatible): exchange accountId + password for sessionID
bool dexLogin(AppConfig& cfg) {
  if (dexAccountId.length() == 0) {
    if (!dexAuthenticateAccount(cfg)) return false;
  }

  bool isUS = (strcmp(cfg.dexcomRegion, "US") == 0);
  const char* loginUrl = isUS
    ? "https://share2.dexcom.com/ShareWebServices/Services/General/LoginPublisherAccountById"
    : "https://shareous1.dexcom.com/ShareWebServices/Services/General/LoginPublisherAccountById";

  HTTPClient http;
  http.begin(loginUrl);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept",       "application/json");
  http.addHeader("User-Agent",   "share2nightscout-bridge/0.2.5");
  http.setTimeout(10000);

  StaticJsonDocument<256> body;
  body["accountId"]     = dexAccountId;
  body["password"]      = cfg.dexcomPass;
  body["applicationId"] = "d89443d2-327c-4a6f-89e5-496bbb0317db";

  String bs; serializeJson(body, bs);
  int code = http.POST(bs);
  sdLogfEx("DEX", "DEX_LOGIN", "login_http:%d accountIdLen:%u", code, (unsigned)dexAccountId.length());

  if (code == 200) {
    String r = http.getString();
    r.replace("\"", ""); r.trim();
    if (r.length() > 10 && r != "00000000-0000-0000-0000-000000000000") {
      dexSessionId     = r;
      dexSessionExpiry = millis() + 4UL * 3600000UL;
      http.end();
      Serial.println("Dexcom: logged in");
      sdLogfEx("DEX", "DEX_LOGIN", "login_ok sessionIdLen:%u", (unsigned)dexSessionId.length());
      return true;
    }
    Serial.println("Dexcom login returned invalid sessionID");
  }

  Serial.printf("Dexcom login failed: HTTP %d\n", code);
  char msg[40];
  snprintf(msg, sizeof(msg), "Dex login HTTP %d", code);
  sdLogfEx("ERR", "DEX_LOGIN", "%s", msg);
  dexSessionId = "";
  http.end();
  return false;
}

bool fetchDexcomShare(AppConfig& cfg, BGReading& reading) {
  if (!strlen(cfg.dexcomUser) || !strlen(cfg.dexcomPass)) {
    Serial.println("Dexcom: no credentials");
    return false;
  }

  // Re-login if session missing or expired
  if (dexSessionId.length() == 0 || millis() > dexSessionExpiry) {
    if (!dexLogin(cfg)) return false;
  }

  bool isUS   = (strcmp(cfg.dexcomRegion, "US") == 0);
  String base = isUS
    ? "https://share2.dexcom.com"
    : "https://shareous1.dexcom.com";

  String url = base
    + "/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues"
    + "?sessionID=" + dexSessionId
    + "&minutes=1440&maxCount=1";

  HTTPClient http;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Accept", "application/json");
  http.addHeader("User-Agent", "share2nightscout-bridge/0.2.5");
  http.setTimeout(8000);
  int code = http.POST("");
  sdLogfEx("DEX", "DEX_FETCH", "egv_http:%d sessionLen:%u", code, (unsigned)dexSessionId.length());

  // Session expired (500) — force re-login once
  if (code == 500 || code == 401) {
    Serial.println("Dexcom fetch auth expired; retrying login");
    sdLogfEx("DEX", "DEX_FETCH", "session_retry code:%d", code);
    http.end();
    dexSessionId = "";
    dexAccountId = "";
    if (!dexLogin(cfg)) return false;
    url = base
      + "/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues"
      + "?sessionID=" + dexSessionId
      + "&minutes=1440&maxCount=1";
    http.begin(url);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Accept", "application/json");
    http.addHeader("User-Agent", "share2nightscout-bridge/0.2.5");
    http.setTimeout(8000);
    code = http.POST("");
    sdLogfEx("DEX", "DEX_FETCH", "egv_http_retry:%d", code);
  }

  bool ok = false;
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<512> doc;
    DeserializationError err = deserializeJson(doc, resp);
    if (!err && doc.is<JsonArray>() && doc.size() > 0) {
      reading.value  = doc[0]["Value"] | 0;
      reading.trend  = dexTrendFromValue(doc[0]["Trend"]);
      // Parse Dexcom WT/ST timestamp from formats like
      // "/Date(1713499200000)/" or "Date(1713499200000)"
      const char* wt = doc[0]["WT"] | "";
      long long ms = parseDexcomDateMs(wt);
      if (ms <= 0) {
        const char* st = doc[0]["ST"] | "";
        ms = parseDexcomDateMs(st);
      }
      if (ms > 0) {
        reading.timestamp = (time_t)(ms / 1000);
      } else {
        reading.timestamp = time(nullptr);
        Serial.println("Dexcom: timestamp parse failed, using current time");
      }
      reading.stale  = false;
      reading.source = SOURCE_DEXCOM;
      ok = (reading.value > 0);
      Serial.printf("Dexcom: BG=%d trend=%d\n", reading.value, reading.trend);
      if (ok) {
        sdLogfEx("DEX", "DEX_FETCH", "ok bg:%d trend:%d ts:%lu", reading.value, reading.trend, (unsigned long)reading.timestamp);
      } else {
        sdLogfEx("ERR", "DEX_FETCH", "invalid_bg value:%d", reading.value);
      }
    } else {
      Serial.println("Dexcom fetch: JSON parse error or empty array");
      sdLogfEx("ERR", "DEX_FETCH", "parse_or_empty code:%d", code);
    }
  } else {
    Serial.printf("Dexcom EGV failed: HTTP %d\n", code);
    char msg[40];
    snprintf(msg, sizeof(msg), "Dex EGV HTTP %d", code);
    sdLogfEx("ERR", "DEX_FETCH", "%s", msg);
  }

  http.end();
  return ok;
}
