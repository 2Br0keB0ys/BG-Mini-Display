// sd_logger.h — Encrypted SD card logging
// Logs are AES-128-CBC encrypted with chip-derived key
// SD card removed from device = unreadable data

#pragma once
#include <Arduino.h>
#include <SD.h>
#include "crypto.h"

#define LOG_FILE "/bgdisplay.log"
#define MAX_LOG_LINES 500

bool sdAvailable = false;

void sdInit() {
  // M5Stack Core2 SD pin
  if (SD.begin(4)) {
    sdAvailable = true;
    Serial.println("SD: mounted");
    // Write init marker
    File f = SD.open(LOG_FILE, FILE_APPEND);
    if (f) {
      String entry = "{\"t\":" + String(millis()) + ",\"msg\":\"BGDisplay started\",\"fw\":\"" + String(FIRMWARE_VERSION) + "\"}";
      String enc = aesEncrypt(entry, "BGDisplay_SD_v1");
      f.println(enc);
      f.close();
    }
  } else {
    Serial.println("SD: not found or failed");
    sdAvailable = false;
  }
}

void sdLog(const char* level, const char* msg) {
  if (level && msg && (!strcmp(level, "ERR") || !strcmp(level, "HB"))) {
    Serial.printf("[%s] %s\n", level, msg);
  }

  if (!sdAvailable) return;

  time_t now = time(nullptr);
  struct tm t; localtime_r(&now, &t);
  char ts[32];
  snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02d",
    t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);

  String entry = "{\"ts\":\"" + String(ts) + "\",\"lvl\":\"" + level + "\",\"msg\":\"" + msg + "\"}";
  String enc = aesEncrypt(entry, "BGDisplay_SD_v1");

  File f = SD.open(LOG_FILE, FILE_APPEND);
  if (f) {
    f.println(enc);
    f.close();
  }

  // Rotate log if too large (>100KB)
  File check = SD.open(LOG_FILE);
  if (check) {
    size_t sz = check.size();
    check.close();
    if (sz > 102400) {
      SD.remove("/bgdisplay.old.log");
      SD.rename(LOG_FILE, "/bgdisplay.old.log");
      Serial.println("SD: log rotated");
    }
  }
}

void sdLogBG(int value, int trend, const char* source) {
  if (!sdAvailable) return;
  char msg[64];
  snprintf(msg, sizeof(msg), "BG:%d trend:%d src:%s", value, trend, source);
  sdLog("BG", msg);
}

void sdLogWifi(const char* ssid, int rssi) {
  if (!sdAvailable) return;
  char msg[64];
  snprintf(msg, sizeof(msg), "WiFi:%s RSSI:%d", ssid, rssi);
  sdLog("NET", msg);
}

void sdLogError(const char* msg) {
  sdLog("ERR", msg);
}

bool sdCollectLogsForUpload(String& out, int& lineCount, int maxLines = 500, size_t maxBytes = 90000) {
  out = "";
  lineCount = 0;
  if (!sdAvailable) return false;

  auto appendFile = [&](const char* path) {
    File f = SD.open(path);
    if (!f) return;

    while (f.available() && lineCount < maxLines) {
      if (out.length() >= maxBytes) break;
      String enc = f.readStringUntil('\n');
      enc.trim();
      if (enc.length() == 0) continue;

      String dec = aesDecrypt(enc, "BGDisplay_SD_v1");
      if (dec.length() == 0) continue;

      if (out.length() + dec.length() + 1 > maxBytes) break;
      out += dec;
      out += "\n";
      lineCount++;
    }

    f.close();
  };

  // Send older data first, then the active log for timeline continuity.
  appendFile("/bgdisplay.old.log");
  if (lineCount < maxLines && out.length() < maxBytes) appendFile(LOG_FILE);

  return lineCount > 0;
}

// Read and decrypt logs (for diagnostics) — prints to Serial
void sdDumpLogs(int lines = 20) {
  if (!sdAvailable) { Serial.println("SD not available"); return; }
  File f = SD.open(LOG_FILE);
  if (!f) { Serial.println("No log file"); return; }
  int count = 0;
  while (f.available() && count < lines) {
    String enc = f.readStringUntil('\n');
    enc.trim();
    if (enc.length() > 0) {
      String dec = aesDecrypt(enc, "BGDisplay_SD_v1");
      Serial.println(dec);
      count++;
    }
  }
  f.close();
}
