#pragma once

#include <WiFi.h>
#include <ArduinoOTA.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoJson.h>
#include "config.h"
#include "sd_logger.h"

void addSignedHeaders(HTTPClient& http, const char* method, const String& pathWithQuery, const String& body, AppConfig& cfg);

struct CloudOtaReleaseInfo {
  bool available = false;
  bool mandatory = false;
  size_t sizeBytes = 0;
  char version[24] = "";
  char channel[16] = "stable";
  char notes[160] = "";
  char downloadUrl[768] = "";
};

inline String normalizeOtaChannel(const AppConfig& cfg) {
  String channel = strlen(cfg.otaChannel) ? String(cfg.otaChannel) : String("stable");
  channel.trim();
  channel.toLowerCase();
  if (!channel.length()) channel = "stable";
  return channel;
}

inline bool fetchCloudOtaRelease(AppConfig& cfg, CloudOtaReleaseInfo& info) {
  info = CloudOtaReleaseInfo();

  if (!cfg.otaEnabled || WiFi.status() != WL_CONNECTED) return false;
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return false;

  const String channel = normalizeOtaChannel(cfg);
  const String path = String("/api/ota/manifest?current=") + FIRMWARE_VERSION + "&channel=" + channel;

  HTTPClient http;
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(8000);

  int code = http.GET();
  if (code != 200) {
    sdLogfEx("ERR", "OTA", "manifest_http:%d", code);
    http.end();
    return false;
  }

  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) {
    sdLogEx("ERR", "OTA", "manifest_parse_failed");
    return false;
  }

  info.available = doc["available"] | false;
  if (!info.available) return true;

  info.mandatory = doc["mandatory"] | false;
  info.sizeBytes = doc["sizeBytes"] | 0;
  strlcpy(info.version, doc["version"] | "", sizeof(info.version));
  strlcpy(info.channel, doc["channel"] | channel.c_str(), sizeof(info.channel));
  strlcpy(info.notes, doc["notes"] | "", sizeof(info.notes));
  strlcpy(info.downloadUrl, doc["downloadUrl"] | "", sizeof(info.downloadUrl));

  if (!strlen(info.version) || !strlen(info.downloadUrl)) {
    info.available = false;
    sdLogEx("ERR", "OTA", "manifest_incomplete");
  }

  return true;
}

inline bool performCloudOtaUpdate(AppConfig& cfg, CloudOtaReleaseInfo* releaseInfo = nullptr, String* message = nullptr) {
  CloudOtaReleaseInfo localInfo;
  CloudOtaReleaseInfo* rel = releaseInfo;
  if (!rel) {
    if (!fetchCloudOtaRelease(cfg, localInfo)) {
      if (message) *message = "Manifest fetch failed";
      return false;
    }
    rel = &localInfo;
  }

  if (!rel->available) {
    if (message) *message = "Already up to date";
    return false;
  }

  if (!strlen(rel->downloadUrl)) {
    if (message) *message = "Missing download URL";
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();

  httpUpdate.rebootOnUpdate(false);
  httpUpdate.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);

  sdLogfEx("OTA", "OTA", "cloud_start version:%s channel:%s", rel->version, rel->channel);
  t_httpUpdate_return ret = httpUpdate.update(client, String(rel->downloadUrl), FIRMWARE_VERSION);

  switch (ret) {
    case HTTP_UPDATE_FAILED:
      if (message) *message = httpUpdate.getLastErrorString();
      sdLogfEx("ERR", "OTA", "cloud_fail err:%d msg:%s", httpUpdate.getLastError(), httpUpdate.getLastErrorString().c_str());
      return false;
    case HTTP_UPDATE_NO_UPDATES:
      if (message) *message = "No update available";
      sdLogEx("OTA", "OTA", "cloud_no_updates");
      return false;
    case HTTP_UPDATE_OK:
      if (message) *message = String("Updated to ") + rel->version;
      sdLogfEx("OTA", "OTA", "cloud_ok version:%s", rel->version);
      return true;
  }

  if (message) *message = "Unknown OTA result";
  return false;
}

inline void otaTick(const AppConfig& cfg) {
#if ENABLE_OTA
  static bool initialized = false;
  static char hostname[40] = {0};

  if (WiFi.status() != WL_CONNECTED) return;

  if (!initialized) {
    uint64_t chip = ESP.getEfuseMac();
    snprintf(hostname, sizeof(hostname), "bg-miniview-%04lx", (unsigned long)(chip & 0xFFFF));

    ArduinoOTA.setHostname(hostname);
    if (strlen(cfg.deviceKey) > 0) {
      ArduinoOTA.setPassword(cfg.deviceKey);
    }

    ArduinoOTA.onStart([]() {
      Serial.println("OTA update started");
      sdLogEx("OTA", "OTA", "start");
    });
    ArduinoOTA.onEnd([]() {
      Serial.println("OTA update complete");
      sdLogEx("OTA", "OTA", "complete");
    });
    ArduinoOTA.onError([](ota_error_t err) {
      Serial.printf("OTA error: %u\n", (unsigned)err);
      sdLogfEx("ERR", "OTA", "error:%u", (unsigned)err);
    });

    ArduinoOTA.begin();
    initialized = true;
    Serial.printf("OTA ready: %s.local\n", hostname);
    sdLogfEx("OTA", "OTA", "ready host:%s", hostname);
  }

  ArduinoOTA.handle();
#else
  (void)cfg;
#endif
}
