// sd_logger.h — Encrypted SD card logging
// Logs are AES-128-CBC encrypted with chip-derived key
// SD card removed from device = unreadable data

#pragma once
#include <Arduino.h>
#include <SD.h>
#include <stdarg.h>
#include "crypto.h"

#define LOG_FILE "/bgdisplay.log"
#define MAX_LOG_LINES 500

bool sdAvailable = false;

inline String sdJsonEscape(const char* in) {
  if (!in) return String("");
  String out;
  while (*in) {
    char c = *in++;
    if (c == '"' || c == '\\') {
      out += '\\';
      out += c;
    } else if (c == '\n') {
      out += "\\n";
    } else if (c == '\r') {
      out += "\\r";
    } else if ((uint8_t)c < 0x20) {
      out += ' ';
    } else {
      out += c;
    }
  }
  return out;
}

inline void sdLogRawJson(const String& entry) {
  if (!sdAvailable) return;
  String enc = aesEncrypt(entry, "BGDisplay_SD_v1");

  File f = SD.open(LOG_FILE, FILE_APPEND);
  if (f) {
    f.println(enc);
    f.close();
  }

  // Rotate log if too large (>100KB). Keep at most 2 rotated files so
  // old logs don't accumulate indefinitely on the SD card.
  File check = SD.open(LOG_FILE);
  if (check) {
    size_t sz = check.size();
    check.close();
    if (sz > 102400) {
      // Drop oldest archive, shift .old.log → .old2.log, then rotate current
      SD.remove("/bgdisplay.old2.log");
      SD.rename("/bgdisplay.old.log", "/bgdisplay.old2.log");
      SD.rename(LOG_FILE, "/bgdisplay.old.log");
      Serial.println("SD: log rotated");
    }
  }
}

inline void sdLogEx(const char* level, const char* feature, const char* msg) {
  if (level && msg && (!strcmp(level, "ERR") || !strcmp(level, "HB") || !strcmp(level, "SEC"))) {
    Serial.printf("[%s/%s] %s\n", level, feature ? feature : "GEN", msg);
  }

  if (!sdAvailable) return;

  time_t now = time(nullptr);
  struct tm t; localtime_r(&now, &t);
  int year = t.tm_year + 1900;
  if (year < 0) year = 0;
  if (year > 9999) year = 9999;
  int month = t.tm_mon + 1;
  if (month < 1) month = 1;
  if (month > 12) month = 12;
  int day = t.tm_mday;
  if (day < 1) day = 1;
  if (day > 31) day = 31;
  int hour = t.tm_hour;
  if (hour < 0) hour = 0;
  if (hour > 23) hour = 23;
  int minute = t.tm_min;
  if (minute < 0) minute = 0;
  if (minute > 59) minute = 59;
  int second = t.tm_sec;
  if (second < 0) second = 0;
  if (second > 59) second = 59;
  char ts[32];
  snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02d",
    year, month, day, hour, minute, second);

  String entry =
    String("{\"ts\":\"") + ts +
    "\",\"ms\":" + String(millis()) +
    ",\"lvl\":\"" + sdJsonEscape(level) +
    "\",\"feat\":\"" + sdJsonEscape(feature ? feature : "GEN") +
    "\",\"msg\":\"" + sdJsonEscape(msg) +
    "\"}";
  sdLogRawJson(entry);
}

inline void sdLogfEx(const char* level, const char* feature, const char* fmt, ...) {
  if (!fmt) return;
  char buf[220];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  sdLogEx(level, feature, buf);
}

void sdInit() {
  // M5Stack Core2 SD pin
  if (SD.begin(4)) {
    sdAvailable = true;
    Serial.println("SD: mounted");
    // Write init marker
    File f = SD.open(LOG_FILE, FILE_APPEND);
    if (f) {
      String entry =
        String("{\"t\":") + String(millis()) +
        ",\"msg\":\"BG MiniView started\",\"fw\":\"" + String(FIRMWARE_VERSION) + "\"}";
      f.println(aesEncrypt(entry, "BGDisplay_SD_v1"));
      f.close();
    }
  } else {
    Serial.println("SD: not found or failed");
    sdAvailable = false;
  }
}

void sdLog(const char* level, const char* msg) {
  sdLogEx(level, "GEN", msg);
}

void sdLogBG(int value, int trend, const char* source) {
  if (!sdAvailable) return;
  sdLogfEx("BG", "BG", "value:%d trend:%d src:%s", value, trend, source ? source : "unknown");
}

void sdLogWifi(const char* ssid, int rssi) {
  if (!sdAvailable) return;
  sdLogfEx("NET", "WIFI", "ssid:%s rssi:%d", ssid ? ssid : "", rssi);
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

  // Send oldest data first for timeline continuity: old2 → old → current.
  appendFile("/bgdisplay.old2.log");
  if (lineCount < maxLines && out.length() < maxBytes) appendFile("/bgdisplay.old.log");
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
