#pragma once

#include <WiFi.h>
#include <ArduinoOTA.h>
#include "config.h"

inline void otaTick(const AppConfig& cfg) {
#if ENABLE_OTA
  static bool initialized = false;
  static char hostname[40] = {0};

  if (WiFi.status() != WL_CONNECTED) return;

  if (!initialized) {
    uint64_t chip = ESP.getEfuseMac();
    snprintf(hostname, sizeof(hostname), "bgdisplay-%04lx", (unsigned long)(chip & 0xFFFF));

    ArduinoOTA.setHostname(hostname);
    if (strlen(cfg.deviceKey) > 0) {
      ArduinoOTA.setPassword(cfg.deviceKey);
    }

    ArduinoOTA.onStart([]() {
      Serial.println("OTA update started");
    });
    ArduinoOTA.onEnd([]() {
      Serial.println("OTA update complete");
    });
    ArduinoOTA.onError([](ota_error_t err) {
      Serial.printf("OTA error: %u\n", (unsigned)err);
    });

    ArduinoOTA.begin();
    initialized = true;
    Serial.printf("OTA ready: %s.local\n", hostname);
  }

  ArduinoOTA.handle();
#else
  (void)cfg;
#endif
}
