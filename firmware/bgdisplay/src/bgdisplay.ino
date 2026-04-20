// BGDisplay v2.0 — Dexcom only, encrypted, SD logging, smart config sync
#include <M5Unified.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include <esp_system.h>
#include "mbedtls/md.h"

#include "crypto.h"
#include "config.h"
#include "display.h"
#include "nightscout.h"
#include "dexcom.h"
#include "wifi_setup.h"
#include "sd_logger.h"
#include "ota.h"

Preferences  prefs;
AppConfig    appConfig;
BGReading    lastReading;
DisplayState dispState;

unsigned long lastBGPoll      = 0;
unsigned long lastConfigPing  = 0;
unsigned long lastStatusPush  = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastLogUpload   = 0;
unsigned long lastTimeDraw    = 0;
unsigned long bootTime        = millis();

struct SourceHealthStats {
  uint16_t nsOk = 0;
  uint16_t nsFail = 0;
  uint16_t dexOk = 0;
  uint16_t dexFail = 0;
  uint16_t consecutiveBgFailures = 0;
};

SourceHealthStats sourceHealth;
char gResetReason[20] = "unknown";

// Forward declarations
void pullCloudflareConfig(AppConfig&, Preferences&);
void pingCloudflare(AppConfig&, Preferences&);
void pushStatus(AppConfig&);
void syncTime(const char*);
void checkDailyAutoReboot();
void pollCloudflareCommand(AppConfig&, Preferences&);
void ackCloudflareCommand(AppConfig&, const char* cmdId, bool ok, const char* message);
bool uploadSdLogs(AppConfig&, const char* cmdId, int maxLines = 700, size_t maxBytes = 120000, bool failIfEmpty = true);
bool setupUnlockPressedDuringBoot(unsigned long windowMs = 6000UL);

String toHex(const uint8_t* data, size_t len) {
  static const char* hex = "0123456789abcdef";
  String out;
  out.reserve(len * 2);
  for (size_t i = 0; i < len; i++) {
    out += hex[(data[i] >> 4) & 0x0F];
    out += hex[data[i] & 0x0F];
  }
  return out;
}

String sha256HexStr(const String& in) {
  uint8_t hash[32];
  mbedtls_sha256_context ctx;
  mbedtls_sha256_init(&ctx);
  mbedtls_sha256_starts(&ctx, 0);
  mbedtls_sha256_update(&ctx, (const uint8_t*)in.c_str(), in.length());
  mbedtls_sha256_finish(&ctx, hash);
  mbedtls_sha256_free(&ctx);
  return toHex(hash, sizeof(hash));
}

String hmacSha256Hex(const String& key, const String& msg) {
  uint8_t out[32];
  const mbedtls_md_info_t* info = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (!info) return "";

  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  if (mbedtls_md_setup(&ctx, info, 1) != 0) {
    mbedtls_md_free(&ctx);
    return "";
  }
  if (mbedtls_md_hmac_starts(&ctx, (const uint8_t*)key.c_str(), key.length()) != 0) {
    mbedtls_md_free(&ctx);
    return "";
  }
  mbedtls_md_hmac_update(&ctx, (const uint8_t*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, out);
  mbedtls_md_free(&ctx);
  return toHex(out, sizeof(out));
}

String makeNonce() {
  uint32_t a = esp_random();
  uint32_t b = esp_random();
  char buf[24];
  snprintf(buf, sizeof(buf), "%08lx%08lx", (unsigned long)a, (unsigned long)b);
  return String(buf);
}

void addSignedHeaders(HTTPClient& http, const char* method, const String& pathWithQuery, const String& body, AppConfig& cfg) {
  String keyHash = sha256HexStr(String(cfg.deviceKey));
  String bodyHash = sha256HexStr(body);
  uint32_t ts = (uint32_t)time(nullptr);
  String nonce = makeNonce();
  String canonical = String(method) + "\n" + pathWithQuery + "\n" + String(ts) + "\n" + nonce + "\n" + bodyHash;
  String sig = hmacSha256Hex(keyHash, canonical);

  http.addHeader("X-Sig-Ts", String(ts));
  http.addHeader("X-Sig-Nonce", nonce);
  http.addHeader("X-Sig-Body", bodyHash);
  http.addHeader("X-Signature", sig);
}

bool verifyCommandSignature(AppConfig& cfg, const char* id, const char* type, unsigned long long createdAt, unsigned long long expiresAt, const char* sig) {
  if (!id || !type || !sig || !strlen(id) || !strlen(type) || !strlen(sig)) return false;
  char buf[220];
  snprintf(buf, sizeof(buf), "%s|%s|%llu|%llu", id, type, createdAt, expiresAt);
  String keyHash = sha256HexStr(String(cfg.deviceKey));
  String expect = hmacSha256Hex(keyHash, String(buf));
  return expect.equalsIgnoreCase(String(sig));
}

const char* resetReasonStr(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_DEEPSLEEP: return "deepsleep";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "unknown";
  }
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  Serial.begin(115200);
  Serial.println("BGDisplay v2.0 booting...");
  strlcpy(gResetReason, resetReasonStr(esp_reset_reason()), sizeof(gResetReason));

  prefs.begin("bgdisplay", false);
  loadConfig(prefs, appConfig);

  // Bootstrap — first flash only, AP setup overwrites
  if (!strlen(appConfig.workerUrl)) {
    strlcpy(appConfig.workerUrl,"https://bgdisplay-worker.zanebaize.workers.dev",128);
  }
  if (!strlen(appConfig.deviceKey)) {
    // Store encrypted
    String dk = "bg_ro_REDACTED_POSSIBLE_SECRET";
    strlcpy(appConfig.deviceKey, dk.c_str(), 64);
  }
  if (!strlen(appConfig.timezone)) {
    strlcpy(appConfig.timezone,"US/Central",32);
  }
  saveConfig(prefs, appConfig);

  // Init SD (before display so boot screen can show SD status)
  sdInit();
  sdLog("SYS", "Boot start");

  initDisplay(appConfig);
  showBootScreen();

  if (!connectWiFi(appConfig, prefs)) {
    sdLogError("WiFi connect failed, entering AP setup");
    if (setupUnlockPressedDuringBoot()) {
      startAPMode(appConfig, prefs);
    } else {
      sdLogError("AP setup locked; hold power during boot to unlock");
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    sdLog("NET", "WiFi connected");
    syncTime(appConfig.timezone);
    sdLogWifi(appConfig.wifiSSID, WiFi.RSSI());
    pullCloudflareConfig(appConfig, prefs);
    // Try Dexcom first, fall back to Nightscout
    bool ok = false;
    if (strlen(appConfig.dexcomUser) > 0) {
      ok = fetchDexcomShare(appConfig, lastReading);
    }
    if (!ok && strlen(appConfig.nightscoutUrl) > 0) {
      fetchNightscout(appConfig, lastReading);
    }
    const char* src = "BG";
    if (lastReading.source == SOURCE_NIGHTSCOUT) src = "NS";
    else if (lastReading.source == SOURCE_DEXCOM) src = "DEX";
    sdLogBG(lastReading.value, lastReading.trend, src);
  }
}

void loop() {
  M5.update();
  unsigned long now = millis();

  // Single press on hardware power button = immediate settings sync.
  if (M5.BtnPWR.wasClicked()) {
    if (WiFi.status() == WL_CONNECTED) {
      sdLog("CMD", "Power button sync requested");
      setDisplayBanner(dispState, "Syncing settings...", CLR_MUTED);
      pullCloudflareConfig(appConfig, prefs);
      setDisplayBanner(dispState, "Sync complete", CLR_GREEN);
      lastConfigPing = now;
    } else {
      sdLogError("Power sync requested while offline");
      setDisplayBanner(dispState, "Sync failed: offline", CLR_RED);
    }
  }

  checkDailyAutoReboot();

  // Touch — top-right gear icon
  if (M5.Touch.getCount()) {
    auto tp = M5.Touch.getDetail();
    if (tp.wasPressed()) {
      dispState.lastTouch = now;
      if (tp.x > 220 && tp.y < 40) {
        showSettingsMenu(appConfig, prefs);
      }
    }
  }

  // HTTPS fast sync — lightweight check up to every 15s.
  // If configPingMin is smaller than 15s-equivalent, it remains in control.
  unsigned long pingMs = (unsigned long)appConfig.configPingMin * 60000UL;
  const unsigned long kFastSyncMs = 15000UL;
  if (pingMs > kFastSyncMs) pingMs = kFastSyncMs;
  if (WiFi.status()==WL_CONNECTED && now - lastConfigPing > pingMs) {
    lastConfigPing = now;
    sdLog("CFG", "Running HTTPS fast-sync ping");
    pingCloudflare(appConfig, prefs);
  }

  // Command poll — low-frequency control channel (reboot/sync-now)
  if (WiFi.status()==WL_CONNECTED && now - lastCommandPoll > 60000UL) {
    lastCommandPoll = now;
    pollCloudflareCommand(appConfig, prefs);
  }

  // Log upload cadence — keep worker log explorer close to live.
  // Lower payload than manual command upload to reduce bandwidth.
  if (WiFi.status()==WL_CONNECTED && now - lastLogUpload > 120000UL) {
    lastLogUpload = now;
    uploadSdLogs(appConfig, nullptr, 160, 28000, false);
  }

  // BG poll — every pollIntervalMin
  unsigned long pollMs = (unsigned long)appConfig.pollIntervalMin * 60000UL;
  if (WiFi.status()==WL_CONNECTED && now - lastBGPoll > pollMs) {
    lastBGPoll = now;
    bool ok = false;
    // Dexcom primary
    if (strlen(appConfig.dexcomUser) > 0) {
      ok = fetchDexcomShare(appConfig, lastReading);
      if (ok) {
        sourceHealth.dexOk++;
      } else {
        sourceHealth.dexFail++;
      }
    }
    // Nightscout fallback
    if (!ok && strlen(appConfig.nightscoutUrl) > 0) {
      ok = fetchNightscout(appConfig, lastReading);
      if (ok) {
        sourceHealth.nsOk++;
      } else {
        sourceHealth.nsFail++;
      }
    }
    if (ok) {
      const char* src = "BG";
      if (lastReading.source == SOURCE_NIGHTSCOUT) src = "NS";
      else if (lastReading.source == SOURCE_DEXCOM) src = "DEX";
      sdLogBG(lastReading.value, lastReading.trend, src);
    }
    if (!ok) {
      lastReading.stale = true;
      sourceHealth.consecutiveBgFailures++;
      sdLogError("BG poll failed — all sources unavailable");
      setDisplayBanner(dispState, "BG source issue", CLR_ORANGE, 1800UL);
    } else {
      sourceHealth.consecutiveBgFailures = 0;
    }
  }

  // Status push every 5 min
  if (WiFi.status()==WL_CONNECTED && now - lastStatusPush > 300000UL) {
    lastStatusPush = now;
    pushStatus(appConfig);
    sdLog("SYS", "Status pushed");
  }

  // WiFi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnect = 0;
    if (now - lastReconnect > 30000UL) {
      lastReconnect = now;
      Serial.println("WiFi lost — reconnecting...");
      sdLogError("WiFi lost, reconnecting");
      WiFi.reconnect();
    }
  }

  otaTick(appConfig);

  updateDisplay(appConfig, lastReading, dispState);
  delay(50);
}

void checkDailyAutoReboot() {
  // Only reboot when time is valid and only once per local calendar day.
  // Extra guards avoid reboot loops during startup.
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() < 600000UL) return; // let device run at least 10 min first

  time_t epoch = time(nullptr);
  if (epoch < 1700000000) return;

  struct tm t;
  localtime_r(&epoch, &t);
  if (t.tm_year < 124) return;

  // Trigger only at 3:00 AM local time.
  if (t.tm_hour != 3 || t.tm_min != 0) return;

  int dayStamp = (t.tm_year + 1900) * 1000 + t.tm_yday;
  int lastStamp = prefs.getInt("autoRbDay", -1);
  if (lastStamp == dayStamp) return;

  prefs.putInt("autoRbDay", dayStamp);
  sdLog("SYS", "Daily 3AM auto reboot");
  Serial.println("Daily auto reboot at 3AM");
  delay(300);
  ESP.restart();
}

// ─── Smart Config Ping ────────────────────────────────────────────────────────
// Lightweight GET — Worker returns {v: N, changed: bool}
// Only does full config pull if version changed

void pingCloudflare(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;

  HTTPClient http;
  String path = String("/api/ping?v=") + String(cfg.lastConfigVersion);
  String pingUrl = String(cfg.workerUrl) + path;
  http.begin(pingUrl);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(5000);

  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<64> doc;
    if (!deserializeJson(doc, http.getString())) {
      bool changed = doc["changed"] | false;
      int  version = doc["v"]       | 0;
      if (changed || version > cfg.lastConfigVersion) {
        Serial.printf("Config changed (v%d -> v%d) — pulling full config\n",
          cfg.lastConfigVersion, version);
        sdLog("CFG", "Config change detected via ping");
        http.end();
        pullCloudflareConfig(cfg, p);
        return;
      }
      sdLog("CFG", "Config ping: no changes");
    }
  } else if (code == 401) {
    dispState.showKeyError = true;
    sdLogError("CF: invalid device key");
  } else {
    char msg[48];
    snprintf(msg, sizeof(msg), "CF ping HTTP %d", code);
    sdLogError(msg);
  }
  http.end();
}

// ─── Full Config Pull ─────────────────────────────────────────────────────────

void pullCloudflareConfig(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;

  char prevTimezone[32];  strlcpy(prevTimezone, cfg.timezone, sizeof(prevTimezone));

  HTTPClient http;
  String path = "/api/config";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(8000);

  int code = http.GET();
  if (code == 200) {
    StaticJsonDocument<2048> doc;
    if (deserializeJson(doc, http.getString())) { http.end(); return; }

    JsonObject c = doc["config"];
    if (c.containsKey("poll_interval_min"))   cfg.pollIntervalMin   = c["poll_interval_min"];
    if (c.containsKey("stale_data_warn_min")) cfg.staleDataWarnMin  = c["stale_data_warn_min"];
    if (c.containsKey("config_ping_min"))     cfg.configPingMin     = c["config_ping_min"];
    if (c.containsKey("urgent_low"))          cfg.urgentLow         = c["urgent_low"];
    if (c.containsKey("low"))                 cfg.low               = c["low"];
    if (c.containsKey("high"))                cfg.high              = c["high"];
    if (c.containsKey("urgent_high"))         cfg.urgentHigh        = c["urgent_high"];
    if (c.containsKey("show_last_reading_time")) cfg.showLastReadingTime = c["show_last_reading_time"];
    if (c.containsKey("show_trend_arrow"))    cfg.showTrendArrow    = c["show_trend_arrow"];
    if (c.containsKey("brightness"))          cfg.brightness        = c["brightness"];
    if (c.containsKey("auto_dim_min"))        cfg.autoDimMin        = c["auto_dim_min"];
    if (c.containsKey("clock_24hr"))          cfg.clock24hr         = c["clock_24hr"];
    if (c.containsKey("dnd_enabled"))         cfg.dndEnabled        = c["dnd_enabled"];
    if (c.containsKey("bg_alert_style"))      strlcpy(cfg.bgAlertStyle, c["bg_alert_style"], 16);
    if (c.containsKey("bg_units"))            strlcpy(cfg.bgUnits,      c["bg_units"],       8);
    if (c.containsKey("timezone"))            strlcpy(cfg.timezone,     c["timezone"],       32);
    if (c.containsKey("dnd_from"))            strlcpy(cfg.dndFrom,      c["dnd_from"],       8);
    if (c.containsKey("dnd_to"))              strlcpy(cfg.dndTo,        c["dnd_to"],         8);

    // Sensitive fields — store encrypted
    if (c.containsKey("nightscout_url"))    strlcpy(cfg.nightscoutUrl,    c["nightscout_url"],    128);
    if (c.containsKey("nightscout_secret")) strlcpy(cfg.nightscoutSecret, c["nightscout_secret"], 64);
    if (c.containsKey("dexcom_user"))       strlcpy(cfg.dexcomUser,       c["dexcom_user"],       64);
    if (c.containsKey("dexcom_pass"))       strlcpy(cfg.dexcomPass,       c["dexcom_pass"],       64);
    if (c.containsKey("dexcom_region"))     strlcpy(cfg.dexcomRegion,     c["dexcom_region"],     8);

    // Update config version
    int newVersion = doc["config_version"] | cfg.lastConfigVersion;
    cfg.lastConfigVersion = newVersion;

    sanitizeConfig(cfg);

    // Automated key rotation
    if (doc["rotateNow"].as<bool>() && doc.containsKey("newKey")) {
      strlcpy(cfg.deviceKey, doc["newKey"].as<const char*>(), 64);
      saveConfig(p, cfg);
      HTTPClient ack;
      String ackPath = "/api/key-ack";
      ack.begin(String(cfg.workerUrl)+ackPath);
      ack.addHeader("X-Device-Key", cfg.deviceKey);
      addSignedHeaders(ack, "POST", ackPath, "", cfg);
      ack.POST(""); ack.end();
      sdLog("SEC","API key auto-rotated");
      Serial.println("Key rotated and ACKed");
    }

    saveConfig(p, cfg);

    if (strcmp(prevTimezone, cfg.timezone) != 0) {
      Serial.println("Timezone changed — resyncing NTP");
      sdLog("SYS", "Timezone changed, NTP resync");
      syncTime(cfg.timezone);
    }

    dispState.showKeyError = false;
    Serial.printf("Config synced (v%d)\n", cfg.lastConfigVersion);
    sdLog("CFG", "Config synced");

  } else if (code == 401) {
    dispState.showKeyError = true;
    sdLogError("CF: invalid device key");
  } else {
    char msg[48];
    snprintf(msg, sizeof(msg), "CF config HTTP %d", code);
    sdLogError(msg);
  }
  http.end();
}

// ─── Status Push ──────────────────────────────────────────────────────────────

void pushStatus(AppConfig& cfg) {
  if (!strlen(cfg.workerUrl)) return;
  HTTPClient http;
  String path = "/api/status";
  http.begin(String(cfg.workerUrl)+path);
  http.addHeader("Content-Type","application/json");
  http.addHeader("X-Device-Key", cfg.deviceKey);
  StaticJsonDocument<256> doc;
  doc["connection"]     = "wifi";
  doc["uptime"]         = (millis() - bootTime) / 1000;
  doc["firmware"]       = FIRMWARE_VERSION;
  doc["freeMemory"]     = ESP.getFreeHeap() / 1024;
  doc["rssi"]           = WiFi.RSSI();
  doc["ssid"]           = WiFi.SSID();
  doc["ip"]             = WiFi.localIP().toString();
  doc["sdAvailable"]    = sdAvailable;
  doc["config_version"] = cfg.lastConfigVersion;
  doc["batteryPct"]     = M5.Power.getBatteryLevel();
  doc["bgValue"]         = lastReading.value;
  if (lastReading.timestamp > 0) {
    doc["lastReadingAgeSec"] = (int)(time(nullptr) - lastReading.timestamp);
  } else {
    doc["lastReadingAgeSec"] = -1;
  }
    doc["resetReason"]    = gResetReason;
    doc["source"]         = (lastReading.source == SOURCE_NIGHTSCOUT) ? "nightscout" : ((lastReading.source == SOURCE_DEXCOM) ? "dexcom" : "none");
    doc["nsOk"]           = sourceHealth.nsOk;
    doc["nsFail"]         = sourceHealth.nsFail;
    doc["dexOk"]          = sourceHealth.dexOk;
    doc["dexFail"]        = sourceHealth.dexFail;
    doc["bgPollFailStreak"] = sourceHealth.consecutiveBgFailures;
  String body; serializeJson(doc, body);
    addSignedHeaders(http, "POST", path, body, cfg);
  int code = http.POST(body);
  if (code < 200 || code >= 300) {
    char msg[48];
    snprintf(msg, sizeof(msg), "Status push HTTP %d", code);
    sdLogError(msg);
  }
  http.end();
}

void pollCloudflareCommand(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;

  HTTPClient http;
  String path = "/api/command";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(5000);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return;
  }

  StaticJsonDocument<512> doc;
  if (deserializeJson(doc, http.getString())) {
    http.end();
    return;
  }
  http.end();

  bool pending = doc["pending"] | false;
  if (!pending) return;

  const char* cmdId = doc["command"]["id"] | "";
  const char* cmdType = doc["command"]["type"] | "";
  unsigned long long createdAt = doc["command"]["createdAt"] | 0ULL;
  unsigned long long expiresAt = doc["command"]["expiresAt"] | 0ULL;
  const char* cmdSig = doc["command"]["sig"] | "";

  if (!strlen(cmdId) || !strlen(cmdType)) return;
  if (!verifyCommandSignature(cfg, cmdId, cmdType, createdAt, expiresAt, cmdSig)) {
    sdLogError("Command signature verification failed");
    ackCloudflareCommand(cfg, cmdId, false, "invalid signature");
    return;
  }

  if (!strcmp(cmdType, "sync-now")) {
    sdLog("CMD", "Executing command: sync-now");
    setDisplayBanner(dispState, "Remote sync...", CLR_MUTED);
    pullCloudflareConfig(cfg, p);
    setDisplayBanner(dispState, "Remote sync done", CLR_GREEN);
    ackCloudflareCommand(cfg, cmdId, true, "synced");
    return;
  }

  if (!strcmp(cmdType, "reboot")) {
    sdLog("CMD", "Executing command: reboot");
    ackCloudflareCommand(cfg, cmdId, true, "rebooting");
    delay(300);
    ESP.restart();
    return;
  }

  if (!strcmp(cmdType, "upload-logs")) {
    sdLog("CMD", "Executing command: upload-logs");
    setDisplayBanner(dispState, "Uploading logs...", CLR_MUTED);
    bool ok = uploadSdLogs(cfg, cmdId);
    setDisplayBanner(dispState, ok ? "Logs uploaded" : "Log upload failed", ok ? CLR_GREEN : CLR_RED);
    ackCloudflareCommand(cfg, cmdId, ok, ok ? "logs uploaded" : "log upload failed");
    return;
  }

  ackCloudflareCommand(cfg, cmdId, false, "unknown command");
}

void ackCloudflareCommand(AppConfig& cfg, const char* cmdId, bool ok, const char* message) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey) || !cmdId || !strlen(cmdId)) return;

  HTTPClient http;
  String path = "/api/command-ack";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", cfg.deviceKey);

  StaticJsonDocument<192> body;
  body["id"] = cmdId;
  body["ok"] = ok;
  body["message"] = message ? message : "";
  String payload;
  serializeJson(body, payload);

  addSignedHeaders(http, "POST", path, payload, cfg);
  http.POST(payload);
  http.end();
}

bool uploadSdLogs(AppConfig& cfg, const char* cmdId, int maxLines, size_t maxBytes, bool failIfEmpty) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return false;

  String logs;
  int lineCount = 0;
  bool haveLogs = sdCollectLogsForUpload(logs, lineCount, maxLines, maxBytes);
  if (!haveLogs) {
    if (failIfEmpty) sdLogError("No SD logs available to upload");
    return false;
  }

  HTTPClient http;
  String path = "/api/log-upload";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("Content-Type", "text/plain");
  http.addHeader("X-Device-Key", cfg.deviceKey);
  if (cmdId && strlen(cmdId) > 0) {
    http.addHeader("X-Command-Id", cmdId);
  }
  http.addHeader("X-Log-Lines", String(lineCount));
  addSignedHeaders(http, "POST", path, logs, cfg);
  http.setTimeout(15000);

  int code = http.POST(logs);
  http.end();

  if (code >= 200 && code < 300) {
    sdLog("SYS", "SD logs uploaded to cloud");
    return true;
  }

  char msg[48];
  snprintf(msg, sizeof(msg), "Log upload HTTP %d", code);
  sdLogError(msg);
  return false;
}

// ─── NTP Time Sync ────────────────────────────────────────────────────────────
// Uses NIST time servers for maximum accuracy

void syncTime(const char* tz) {
  const char* posix = "CST6CDT,M3.2.0,M11.1.0";
  if      (!strcmp(tz,"US/Eastern"))  posix = "EST5EDT,M3.2.0,M11.1.0";
  else if (!strcmp(tz,"US/Mountain")) posix = "MST7MDT,M3.2.0,M11.1.0";
  else if (!strcmp(tz,"US/Pacific"))  posix = "PST8PDT,M3.2.0,M11.1.0";

  // NIST primary servers
  configTzTime(posix,
    "time.nist.gov",
    "time-a-g.nist.gov",
    "time-b-g.nist.gov"
  );

  struct tm ti;
  if (getLocalTime(&ti, 8000)) {
    Serial.printf("Time synced: %04d-%02d-%02d %02d:%02d:%02d\n",
      ti.tm_year+1900, ti.tm_mon+1, ti.tm_mday,
      ti.tm_hour, ti.tm_min, ti.tm_sec);
    sdLog("SYS", "NTP synced to NIST");
  } else {
    Serial.println("NTP sync failed");
    sdLogError("NTP sync failed");
  }
}

bool setupUnlockPressedDuringBoot(unsigned long windowMs) {
  int W = M5.Display.width();
  M5.Display.fillScreen(0x0000);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.setTextColor(0xFFFF);
  M5.Display.drawString("Setup mode locked", W / 2, 96);
  M5.Display.setTextColor(0x7BEF);
  M5.Display.drawString("Hold power button to unlock", W / 2, 124);

  unsigned long start = millis();
  while (millis() - start < windowMs) {
    M5.update();
    if (M5.BtnPWR.wasHold()) {
      M5.Display.setTextColor(0x07E0);
      M5.Display.drawString("Setup unlocked", W / 2, 152);
      delay(300);
      return true;
    }
    delay(20);
  }
  return false;
}
