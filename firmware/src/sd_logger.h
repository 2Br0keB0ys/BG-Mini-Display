// sd_logger.h — SD card logging
//
// DIAG_MODE=1 (default): verbose plaintext per-topic files — read directly off the SD
//   card at any computer; no decryption needed. Temporary troubleshooting mode.
// DIAG_MODE=0: production — AES-128-CBC encrypted single file, chip-derived key.
//
// Log files in DIAG_MODE:
//   /diag_device.log  — device health, BG readings, system events, OTA, AI
//   /diag_wifi.log    — WiFi connect/disconnect/RSSI/IP
//   /diag_cf.log      — Cloudflare Worker + WebSocket relay
//   /diag_dex.log     — Dexcom Share auth + EGV fetch
//   /diag_ns.log      — Nightscout fetch
//
// To revert to production logging: set DIAG_MODE 0 and rebuild.

#pragma once
#include <Arduino.h>
#include <SD.h>
#include <stdarg.h>
#include "crypto.h"

// ─── Mode flag ────────────────────────────────────────────────────────────────
// 1 = verbose plaintext multi-file (troubleshooting)
// 0 = encrypted single-file (production)
#ifndef DIAG_MODE
#define DIAG_MODE 1
#endif

// ─── Log file paths ───────────────────────────────────────────────────────────
#if DIAG_MODE
  #define LOG_FILE          "/diag_device.log"
  #define LOG_FILE_WIFI     "/diag_wifi.log"
  #define LOG_FILE_CF       "/diag_cf.log"
  #define LOG_FILE_DEX      "/diag_dex.log"
  #define LOG_FILE_NS       "/diag_ns.log"
  #define DIAG_ROTATE_BYTES 5242880UL   // 5 MB per file — generous on 128 GB card
#else
  #define LOG_FILE          "/bgdisplay.log"
  #define DIAG_ROTATE_BYTES 102400UL    // 100 KB production default
#endif

bool sdAvailable = false;

// ─── JSON escape ──────────────────────────────────────────────────────────────
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

// ─── Topic routing (DIAG_MODE only) ──────────────────────────────────────────
#if DIAG_MODE
static const char* diagRouteFile(const char* feature) {
  if (!feature) return LOG_FILE;
  if (strncmp(feature, "DEX", 3) == 0)     return LOG_FILE_DEX;
  if (strncmp(feature, "NS",  2) == 0)     return LOG_FILE_NS;
  if (strcmp(feature,  "WS")  == 0 ||
      strcmp(feature,  "CFG") == 0 ||
      strcmp(feature,  "CF")  == 0 ||
      strcmp(feature,  "CMD") == 0 ||
      strcmp(feature,  "LOG_UPLOAD") == 0) return LOG_FILE_CF;
  if (strcmp(feature, "WIFI") == 0 ||
      strcmp(feature, "NET")  == 0 ||
      strcmp(feature, "AP")   == 0)        return LOG_FILE_WIFI;
  return LOG_FILE;
}

static void diagRotateFile(const char* path) {
  File chk = SD.open(path);
  if (!chk) return;
  size_t sz = chk.size();
  chk.close();
  if (sz < DIAG_ROTATE_BYTES) return;
  // Build rotated name: "/diag_device.log" → "/diag_device.old.log"
  String sp  = String(path);
  int    dot = sp.lastIndexOf('.');
  String rot = (dot > 0) ? sp.substring(0, dot) + ".old" + sp.substring(dot)
                         : sp + ".old";
  SD.remove(rot.c_str());
  SD.rename(path, rot.c_str());
  Serial.printf("SD: rotated %s\n", path);
}
#endif

// ─── Raw write ────────────────────────────────────────────────────────────────
inline void sdLogRawJson(const String& entry, const char* path = LOG_FILE) {
  if (!sdAvailable) return;
#if DIAG_MODE
  diagRotateFile(path);
  File f = SD.open(path, FILE_APPEND);
  if (f) { f.println(entry); f.close(); }
#else
  String enc = aesEncrypt(entry, "BGDisplay_SD_v1");
  File f = SD.open(LOG_FILE, FILE_APPEND);
  if (f) { f.println(enc); f.close(); }
  // Production rotation — keep 2 archives
  File chk = SD.open(LOG_FILE);
  if (chk) {
    size_t sz = chk.size();
    chk.close();
    if (sz > DIAG_ROTATE_BYTES) {
      SD.remove("/bgdisplay.old2.log");
      SD.rename("/bgdisplay.old.log", "/bgdisplay.old2.log");
      SD.rename(LOG_FILE, "/bgdisplay.old.log");
      Serial.println("SD: log rotated");
    }
  }
#endif
}

// ─── Core log writer ──────────────────────────────────────────────────────────
inline void sdLogEx(const char* level, const char* feature, const char* msg) {
  // Serial echo — everything in DIAG_MODE, only key levels in production
#if DIAG_MODE
  Serial.printf("[%s/%s] %s\n",
    level   ? level   : "?",
    feature ? feature : "GEN",
    msg     ? msg     : "");
#else
  if (level && msg && (!strcmp(level, "ERR") || !strcmp(level, "HB") || !strcmp(level, "SEC"))) {
    Serial.printf("[%s/%s] %s\n", level, feature ? feature : "GEN", msg);
  }
#endif

  if (!sdAvailable) return;

  time_t now = time(nullptr);
  struct tm t; localtime_r(&now, &t);
  char ts[32];
  snprintf(ts, sizeof(ts), "%04d-%02d-%02dT%02d:%02d:%02d",
    t.tm_year+1900, t.tm_mon+1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);

  String entry =
    String("{\"ts\":\"") + ts +
    "\",\"ms\":" + String(millis()) +
    ",\"lvl\":\"" + sdJsonEscape(level) +
    "\",\"feat\":\"" + sdJsonEscape(feature ? feature : "GEN") +
    "\",\"msg\":\"" + sdJsonEscape(msg) +
    "\"}";

#if DIAG_MODE
  sdLogRawJson(entry, diagRouteFile(feature));
#else
  sdLogRawJson(entry);
#endif
}

inline void sdLogfEx(const char* level, const char* feature, const char* fmt, ...) {
  if (!fmt) return;
  char buf[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  sdLogEx(level, feature, buf);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
void sdInit() {
  if (SD.begin(4)) {
    sdAvailable = true;
    Serial.println("SD: mounted");
#if DIAG_MODE
    Serial.println("SD: DIAG_MODE=1 — verbose plaintext logging (5 topic files, no encryption)");
    // Write boot header to every topic file so each is clearly time-stamped
    String hdr = String("{\"ts\":\"boot\",\"ms\":") + String(millis()) +
      ",\"lvl\":\"SYS\",\"feat\":\"INIT\",\"msg\":\"BG Display Mini v" FIRMWARE_VERSION
      " DIAG_MODE=1 — plaintext diag logging\"}";
    sdLogRawJson(hdr, LOG_FILE);
    sdLogRawJson(hdr, LOG_FILE_WIFI);
    sdLogRawJson(hdr, LOG_FILE_CF);
    sdLogRawJson(hdr, LOG_FILE_DEX);
    sdLogRawJson(hdr, LOG_FILE_NS);
#else
    File f = SD.open(LOG_FILE, FILE_APPEND);
    if (f) {
      String entry = String("{\"t\":") + String(millis()) +
        ",\"msg\":\"BG Display Mini started\",\"fw\":\"" + String(FIRMWARE_VERSION) + "\"}";
      f.println(aesEncrypt(entry, "BGDisplay_SD_v1"));
      f.close();
    }
#endif
  } else {
    Serial.println("SD: not found or failed");
    sdAvailable = false;
  }
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────
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

// ─── Log collection for worker upload ─────────────────────────────────────────
bool sdCollectLogsForUpload(String& out, int& lineCount, int maxLines = 500, size_t maxBytes = 90000) {
  out = "";
  lineCount = 0;
  if (!sdAvailable) return false;

#if DIAG_MODE
  // Plaintext files — read directly, no decryption.
  // Collect from all 5 topic files so the upload contains the full picture.
  auto appendFile = [&](const char* path) {
    File f = SD.open(path);
    if (!f) return;
    while (f.available() && lineCount < maxLines && out.length() < maxBytes) {
      String line = f.readStringUntil('\n');
      line.trim();
      if (line.length() == 0) continue;
      if (out.length() + line.length() + 1 > maxBytes) break;
      out += line;
      out += "\n";
      lineCount++;
    }
    f.close();
  };
  appendFile(LOG_FILE);
  if (lineCount < maxLines && out.length() < maxBytes) appendFile(LOG_FILE_WIFI);
  if (lineCount < maxLines && out.length() < maxBytes) appendFile(LOG_FILE_CF);
  if (lineCount < maxLines && out.length() < maxBytes) appendFile(LOG_FILE_DEX);
  if (lineCount < maxLines && out.length() < maxBytes) appendFile(LOG_FILE_NS);
#else
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
#endif

  return lineCount > 0;
}

// ─── Dump to Serial ───────────────────────────────────────────────────────────
void sdDumpLogs(int lines = 20) {
  if (!sdAvailable) { Serial.println("SD not available"); return; }
  File f = SD.open(LOG_FILE);
  if (!f) { Serial.println("No log file"); return; }
  int count = 0;
  while (f.available() && count < lines) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() > 0) {
#if DIAG_MODE
      Serial.println(line);  // plaintext
#else
      Serial.println(aesDecrypt(line, "BGDisplay_SD_v1"));
#endif
      count++;
    }
  }
  f.close();
}
