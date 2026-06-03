// BG Display Mini v4.0.1-S — Dexcom primary, Nightscout fallback, encrypted, smart config sync
#include <M5Unified.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>
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
#include "ws_sync.h"
#include "glooko.h"

#if __has_include("secrets.h")
#include "secrets.h"
#endif

#ifndef BGDISPLAY_DEFAULT_WORKER_URL
#define BGDISPLAY_DEFAULT_WORKER_URL "https://example-worker.your-domain.workers.dev"
#endif

#ifndef BGDISPLAY_DEFAULT_DEVICE_KEY
#define BGDISPLAY_DEFAULT_DEVICE_KEY "bg_ro_replace_with_bootstrap_key"
#endif

#ifndef BGDISPLAY_DEFAULT_TIMEZONE
#define BGDISPLAY_DEFAULT_TIMEZONE "US/Central"
#endif

Preferences  prefs;
AppConfig    appConfig;
BGReading    lastReading;
DisplayState dispState;

unsigned long lastBGPoll      = 0;
unsigned long lastConfigPing  = 0;
unsigned long lastStatusPush  = 0;
unsigned long lastCommandPoll = 0;
unsigned long lastLogUpload   = 0;
unsigned long lastOTACheck    = 0;
unsigned long lastTimeDraw    = 0;
unsigned long bootTime        = millis();
unsigned long lastNoSourceWarn = 0;
unsigned long lastHeartbeatMs = 0;

#if DIAG_MODE
static const bool kVerboseDiagLogs = true;   // DIAG_MODE: full verbose diagnostic logging
#else
static const bool kVerboseDiagLogs = false;
#endif

struct SourceHealthStats {
  uint16_t nsOk = 0;
  uint16_t nsFail = 0;
  uint16_t dexOk = 0;
  uint16_t dexFail = 0;
  uint16_t consecutiveBgFailures = 0;
};

SourceHealthStats sourceHealth;
char gResetReason[20] = "unknown";
char gDigestText[1024] = "";  // Worker caps daily digest at ~980 chars; safe with 1024-byte buffer
OmnipodStatus lastOmnipod;
unsigned long lastOmnipodPoll = 0;
unsigned long lastDigestFetch = 0;
int           gDigestFetchDay = -1; // local yday of last successful digest fetch
bool gFactoryResetArmed = false;
unsigned long gFactoryResetArmMs = 0;
bool gLogUploadActive = false;   // set true during uploadSdLogs, prevents concurrent auto-reboot
bool gOtaUpdateActive = false;

String normalizeWorkerBase(const char* raw) {
  String base = raw ? String(raw) : String("");
  base.trim();
  if (!base.length()) return base;
  if (!base.startsWith("https://") && !base.startsWith("http://")) {
    base = String("https://") + base;
  }
  while (base.endsWith("/")) {
    base.remove(base.length() - 1);
  }
  return base;
}

String getDefaultWorkerBase() {
  return normalizeWorkerBase(BGDISPLAY_DEFAULT_WORKER_URL);
}

// Forward declarations
void fetchDigest(AppConfig&);
void pullCloudflareConfig(AppConfig&, Preferences&);
void pingCloudflare(AppConfig&, Preferences&);
bool pushStatus(AppConfig&);
void syncTime(const char*);
bool syncTimeFromWorker(AppConfig&);
bool hasValidClock();
void checkDailyAutoReboot();
void pollCloudflareCommand(AppConfig&, Preferences&);
void ackCloudflareCommand(AppConfig&, const char* cmdId, bool ok, const char* message);
bool uploadSdLogs(AppConfig&, const char* cmdId, int maxLines = 700, size_t maxBytes = 120000, bool failIfEmpty = true);
bool setupUnlockPressedDuringBoot(unsigned long windowMs = 6000UL);
void factoryResetToInitialSetup(AppConfig&, Preferences&);
void logConfigDiagnostics(const char* stage, const AppConfig& cfg);
void logRuntimeSnapshot(const char* stage, const AppConfig& cfg, const BGReading& reading);
void logHeartbeat(const AppConfig& cfg, const BGReading& reading);

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

String getChipIdHex() {
  uint64_t mac = ESP.getEfuseMac();
  char buf[17];
  snprintf(buf, sizeof(buf), "%016llx", mac);
  return String(buf);
}

bool enrollDevice(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return false;
  String chipId = getChipIdHex();
  String body = "{\"chipId\":\"" + chipId + "\"}";
  String path = "/api/enroll";
  HTTPClient http;
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Key", cfg.deviceKey);
  http.addHeader("X-Device-Id", chipId);
  addSignedHeaders(http, "POST", path, body, cfg);
  int code = http.POST(body);
  if (code == 200) {
    String resp = http.getString();
    http.end();
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, resp) == DeserializationError::Ok && doc.containsKey("key")) {
      strlcpy(cfg.deviceKey, doc["key"].as<const char*>(), 64);
      saveConfig(p, cfg);
      sdLog("SEC", "Device enrolled; unique key saved");
      Serial.println("[enroll] Device enrolled successfully");
      return true;
    }
  } else if (code == 409) {
    // Already enrolled under a different key — use current key as-is
    sdLog("SEC", "Device already enrolled");
    Serial.println("[enroll] Already enrolled, continuing with current key");
    http.end();
    return true;
  } else {
    char msg[64];
    snprintf(msg, sizeof(msg), "Enroll failed: HTTP %d", code);
    sdLogError(msg);
    Serial.printf("[enroll] Failed: HTTP %d\n", code);
  }
  http.end();
  return false;
}

void addSignedHeaders(HTTPClient& http, const char* method, const String& pathWithQuery, const String& body, AppConfig& cfg) {
  String keyHash = sha256HexStr(String(cfg.deviceKey));
  String bodyHash = sha256HexStr(body);
  uint32_t ts = (uint32_t)time(nullptr);
  String nonce = makeNonce();
  String canonical = String(method) + "\n" + pathWithQuery + "\n" + String(ts) + "\n" + nonce + "\n" + bodyHash;
  String sig = hmacSha256Hex(keyHash, canonical);

  http.addHeader("X-Device-Id", getChipIdHex());
  http.addHeader("X-Sig-Ts", String(ts));
  http.addHeader("X-Sig-Nonce", nonce);
  http.addHeader("X-Sig-Body", bodyHash);
  http.addHeader("X-Signature", sig);
}

bool hasValidClock() {
  return time(nullptr) > 1700000000;
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

void logConfigDiagnostics(const char* stage, const AppConfig& cfg) {
  if (!kVerboseDiagLogs) return;

  char msg[220];
  bool hasWifi = strlen(cfg.wifiSSID) > 0;
  bool hasWorker = strlen(cfg.workerUrl) > 0;
  bool hasKey = strlen(cfg.deviceKey) > 0;
  bool hasDex = strlen(cfg.dexcomUser) > 0 && strlen(cfg.dexcomPass) > 0;
  bool hasNs = strlen(cfg.nightscoutUrl) > 0;
  snprintf(
    msg,
    sizeof(msg),
    "DIAG cfg[%s] wifi:%d worker:%d key:%d dex:%d ns:%d tz:%s v:%d",
    stage ? stage : "?",
    hasWifi ? 1 : 0,
    hasWorker ? 1 : 0,
    hasKey ? 1 : 0,
    hasDex ? 1 : 0,
    hasNs ? 1 : 0,
    cfg.timezone,
    cfg.lastConfigVersion
  );
  sdLog("DBG", msg);
}

void logHttpFailure(const char* label, int code) {
  char msg[120];
  if (code < 0) {
    String err = HTTPClient::errorToString(code);
    snprintf(msg, sizeof(msg), "%s HTTP %d (%s)", label ? label : "HTTP", code, err.c_str());
  } else {
    snprintf(msg, sizeof(msg), "%s HTTP %d", label ? label : "HTTP", code);
  }
  sdLogEx("ERR", "HTTP", msg);
}

void logRuntimeSnapshot(const char* stage, const AppConfig& cfg, const BGReading& reading) {
  if (!kVerboseDiagLogs) return;

  (void)cfg;
  char msg[240];
  int wifi = WiFi.status();
  int rssi = (wifi == WL_CONNECTED) ? WiFi.RSSI() : -120;
  long nowEpoch = (long)time(nullptr);
  long ageSec = (reading.timestamp > 0 && nowEpoch > 1700000000) ? (long)(nowEpoch - reading.timestamp) : -1;
  snprintf(
    msg,
    sizeof(msg),
    "DIAG rt[%s] up:%lus wifi:%d rssi:%d clk:%ld bg:%d trend:%d age:%lds src:%d streak:%u heap:%u",
    stage ? stage : "?",
    millis() / 1000UL,
    wifi,
    rssi,
    nowEpoch,
    reading.value,
    reading.trend,
    ageSec,
    (int)reading.source,
    (unsigned)sourceHealth.consecutiveBgFailures,
    (unsigned)ESP.getFreeHeap()
  );
  sdLog("DBG", msg);
}

void logHeartbeat(const AppConfig& cfg, const BGReading& reading) {
  char msg[180];
  int wifi = WiFi.status();
  int rssi = (wifi == WL_CONNECTED) ? WiFi.RSSI() : -120;
  long nowEpoch = (long)time(nullptr);
  long ageSec = (reading.timestamp > 0 && nowEpoch > 1700000000) ? (long)(nowEpoch - reading.timestamp) : -1;
  const char* src = "none";
  if (reading.source == SOURCE_DEXCOM) src = "dex";
  else if (reading.source == SOURCE_NIGHTSCOUT) src = "ns";

  snprintf(
    msg,
    sizeof(msg),
    "uptime:%lus wifi:%d rssi:%d bg:%d trend:%d age:%lds src:%s cfgV:%d heap:%u minHeap:%u",
    millis() / 1000UL,
    wifi,
    rssi,
    reading.value,
    reading.trend,
    ageSec,
    src,
    cfg.lastConfigVersion,
    (unsigned)ESP.getFreeHeap(),
    (unsigned)ESP.getMinFreeHeap()
  );
  sdLog("HB", msg);
}

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  M5.Display.setRotation(1);
  Serial.begin(115200);
  Serial.println("BG Display Mini v" FIRMWARE_VERSION " booting...");
  strlcpy(gResetReason, resetReasonStr(esp_reset_reason()), sizeof(gResetReason));

  // Keep legacy NVS namespace for seamless upgrades from previous firmware.
  prefs.begin("bgdisplay", false);
  loadConfig(prefs, appConfig);
  logConfigDiagnostics("after-load", appConfig);

  // Bootstrap — first flash only, AP setup overwrites
  if (!strlen(appConfig.workerUrl)) {
    strlcpy(appConfig.workerUrl, BGDISPLAY_DEFAULT_WORKER_URL, 128);
  }
  if (!strlen(appConfig.deviceKey)) {
    // Store encrypted
    String dk = BGDISPLAY_DEFAULT_DEVICE_KEY;
    strlcpy(appConfig.deviceKey, dk.c_str(), 64);
  }
  if (!strlen(appConfig.timezone)) {
    strlcpy(appConfig.timezone, BGDISPLAY_DEFAULT_TIMEZONE, 32);
  }

  String normalizedWorker = normalizeWorkerBase(appConfig.workerUrl);
  if (normalizedWorker.length() > 0) {
    strlcpy(appConfig.workerUrl, normalizedWorker.c_str(), sizeof(appConfig.workerUrl));
  }

  saveConfig(prefs, appConfig);
  logConfigDiagnostics("after-bootstrap", appConfig);

  // Init SD (before display so boot screen can show SD status)
  sdInit();
  sdLog("SYS", "Boot start");
  {
    char rr[48];
    snprintf(rr, sizeof(rr), "Reset reason: %s", gResetReason);
    sdLog("SYS", rr);
  }

  initDisplay(appConfig);
  dispState.lastTouch = millis();
  showBootScreen();

  bool hasStoredWifi = strlen(appConfig.wifiSSID) > 0;
  bootProgress(18, "Connecting to WiFi...");
  if (!connectWiFi(appConfig, prefs)) {
    sdLogError("WiFi connect failed, entering AP setup");
    if (hasStoredWifi) {
      sdLog("NET", "Saved WiFi failed; falling back to AP setup");
      bootProgress(25, "WiFi failed — opening setup AP");
    } else {
      sdLog("NET", "No saved WiFi; entering initial setup AP");
      bootProgress(25, "WiFi setup — connect to BG_Display_Mini_XXXX");
    }
    startAPMode(appConfig, prefs);
  }

  if (WiFi.status() == WL_CONNECTED) {
    bootProgress(40, "Syncing time...");
    sdLog("NET", "WiFi connected");
    logRuntimeSnapshot("wifi-connected", appConfig, lastReading);
    syncTime(appConfig.timezone);
    logRuntimeSnapshot("time-sync", appConfig, lastReading);
    sdLogWifi(appConfig.wifiSSID, WiFi.RSSI());
    // Enroll on first boot with factory-default key so each device gets a unique key
    if (strcmp(appConfig.deviceKey, BGDISPLAY_DEFAULT_DEVICE_KEY) == 0) {
      bootProgress(55, "Enrolling device...");
      enrollDevice(appConfig, prefs);
    }
    bootProgress(65, "Pulling config...");
    pullCloudflareConfig(appConfig, prefs);
    logConfigDiagnostics("after-config-pull", appConfig);
    wsInit(appConfig);
    // Try Dexcom first, fall back to Nightscout
    bool ok = false;
    if (strlen(appConfig.dexcomUser) > 0) {
      bootProgress(78, "Fetching Dexcom...");
      ok = fetchDexcomShare(appConfig, lastReading);
    }
    if (!ok && strlen(appConfig.nightscoutUrl) > 0) {
      bootProgress(78, "Fetching Nightscout...");
      fetchNightscout(appConfig, lastReading);
    }
    const char* src = "BG";
    if (lastReading.source == SOURCE_NIGHTSCOUT) src = "NS";
    else if (lastReading.source == SOURCE_DEXCOM) src = "DEX";
    sdLogBG(lastReading.value, lastReading.trend, src);
    logRuntimeSnapshot("initial-fetch", appConfig, lastReading);

    bootProgress(90, "Loading digest...");
    fetchDigest(appConfig);
    lastDigestFetch = millis();
    {
      time_t epoch = time(nullptr);
      if (epoch > 1700000000) {
        struct tm t;
        localtime_r(&epoch, &t);
        gDigestFetchDay = t.tm_yday;
      }
    }
    if (strlen(gDigestText)) {
      sdLogfEx("AI", "DIGEST", "boot_ok len:%u", (unsigned)strlen(gDigestText));
    }

    bootProgress(100, "Ready");
    delay(500);
  }
}

void loop() {
  M5.update();
  unsigned long now = millis();

  wsTick(appConfig, prefs);

  if (gFactoryResetArmed && (now - gFactoryResetArmMs > 10000UL)) {
    gFactoryResetArmed = false;
  }

  // Single press on hardware power button = immediate settings sync.
  if (M5.BtnPWR.wasClicked()) {
    dispState.dndWakeUntilMs = now + 300000UL;
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

  // Local emergency reset gesture: hold power twice within 10 seconds.
  // This allows a true reset even if Cloudflare command path is unavailable.
  if (M5.BtnPWR.wasHold()) {
    if (gFactoryResetArmed && (now - gFactoryResetArmMs <= 10000UL)) {
      gFactoryResetArmed = false;
      sdLog("CMD", "Local factory reset gesture confirmed");
      factoryResetToInitialSetup(appConfig, prefs);
      return;
    }
    gFactoryResetArmed = true;
    gFactoryResetArmMs = now;
    sdLog("CMD", "Local factory reset armed; hold again to confirm");
    setDisplayBanner(dispState, "Hold power again to reset", CLR_ORANGE, 3500UL);
  }

  checkDailyAutoReboot();

  // Touch — top-right gear icon, bottom-left digest replay
  if (M5.Touch.getCount()) {
    auto tp = M5.Touch.getDetail();
    if (tp.wasPressed()) {
      dispState.lastTouch = now;
      dispState.dndWakeUntilMs = now + 300000UL;
      if (tp.x > 220 && tp.y < 40) {
        showSettingsMenu(appConfig, prefs);
      } else if (tp.x < 160 && tp.y > 170 && strlen(gDigestText)) {
        showDigestScreen(gDigestText, 10000UL);
      }
    }
  }

  // Middle hardware button — fetch fresh AI digest from server and display it
  if (M5.BtnB.wasClicked()) {
    dispState.dndWakeUntilMs = now + 300000UL;
    if (WiFi.status() == WL_CONNECTED) {
      sdLog("AI", "BtnB: fetching digest");
      setDisplayBanner(dispState, "Fetching digest...", CLR_MUTED);
      fetchDigest(appConfig);
      if (strlen(gDigestText)) {
        showDigestScreen(gDigestText, 30000UL);
      } else {
        setDisplayBanner(dispState, "No digest available", CLR_DIM, 2500UL);
      }
    } else {
      // Offline — show cached digest if available, otherwise error
      if (strlen(gDigestText)) {
        showDigestScreen(gDigestText, 30000UL);
      } else {
        setDisplayBanner(dispState, "Offline — no digest", CLR_ORANGE, 2500UL);
      }
    }
  }

  // HTTPS config ping — 30s fallback when WebSocket is down; configured interval when WS active.
  unsigned long pingMs = wsIsConnected()
    ? (unsigned long)appConfig.configPingMin * 60000UL
    : 30000UL;
  if (pingMs > 300000UL) pingMs = 300000UL;  // hard cap at 5 min
  if (WiFi.status()==WL_CONNECTED && now - lastConfigPing > pingMs) {
    lastConfigPing = now;
    sdLog("CFG", "Running HTTPS fast-sync ping");
    pingCloudflare(appConfig, prefs);
  }

  // Command poll — low-frequency control channel (reboot/sync-now)
  if (WiFi.status()==WL_CONNECTED && now - lastCommandPoll > 60000UL) {
    lastCommandPoll = now;
    sdLogEx("CMD", "CMD", "poll_tick");
    pollCloudflareCommand(appConfig, prefs);
  }

  // Log upload cadence — keep worker log explorer close to live.
  // Lower payload than manual command upload to reduce bandwidth.
  if (WiFi.status()==WL_CONNECTED && now - lastLogUpload > 120000UL) {
    lastLogUpload = now;
    sdLogEx("SYS", "LOG_UPLOAD", "cadence_upload_tick");
    gLogUploadActive = true;
    uploadSdLogs(appConfig, nullptr, 160, 28000, false);
    gLogUploadActive = false;
  }

  if (appConfig.otaEnabled && WiFi.status() == WL_CONNECTED) {
    unsigned long otaCheckMs = (unsigned long)appConfig.otaCheckMin * 60000UL;
    bool otaCheckDue = (lastOTACheck == 0) || (now - lastOTACheck > otaCheckMs);
    if (otaCheckDue) {
      lastOTACheck = now;
      CloudOtaReleaseInfo release;
      if (fetchCloudOtaRelease(appConfig, release) && release.available) {
        sdLogfEx("OTA", "OTA", "available version:%s channel:%s", release.version, release.channel);

        if (release.mandatory) {
          sdLogfEx("OTA", "OTA", "mandatory_apply_start version:%s", release.version);
          setDisplayBanner(dispState, "Mandatory OTA applying...", CLR_ORANGE, 4500UL);
          String otaResult;
          gOtaUpdateActive = true;
          bool ok = performCloudOtaUpdate(appConfig, &release, &otaResult);
          gOtaUpdateActive = false;
          if (ok) {
            sdLogfEx("OTA", "OTA", "mandatory_apply_ok version:%s", release.version);
            delay(500);
            ESP.restart();
            return;
          }
          sdLogfEx("ERR", "OTA", "mandatory_apply_fail msg:%s", otaResult.c_str());
          setDisplayBanner(dispState, "Mandatory OTA failed", CLR_RED, 3500UL);
        }
      }
    }
  }

  // BG poll — every pollIntervalMin
  bool hasDexcomCfg = strlen(appConfig.dexcomUser) > 0 && strlen(appConfig.dexcomPass) > 0;
  bool hasNightscoutCfg = strlen(appConfig.nightscoutUrl) > 0;
  if (WiFi.status()==WL_CONNECTED && !hasDexcomCfg && !hasNightscoutCfg && now - lastNoSourceWarn > 120000UL) {
    lastNoSourceWarn = now;
    sdLogError("No BG source configured (Dexcom/Nightscout)");
    setDisplayBanner(dispState, "Configure Dexcom/Nightscout", CLR_ORANGE, 3500UL);
  }

  // BG poll — every pollIntervalMin
  unsigned long pollMs = (unsigned long)appConfig.pollIntervalMin * 60000UL;
  // If all BG sources are failing repeatedly, back off polling to reduce
  // connection churn and avoid long-run instability under bad network/API states.
  if (sourceHealth.consecutiveBgFailures >= 3 && pollMs < 180000UL) pollMs = 180000UL;
  if (sourceHealth.consecutiveBgFailures >= 8 && pollMs < 300000UL) pollMs = 300000UL;
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
      logRuntimeSnapshot("bg-poll-fail", appConfig, lastReading);
      setDisplayBanner(dispState, "BG source issue", CLR_ORANGE, 1800UL);
    } else {
      sourceHealth.consecutiveBgFailures = 0;
      logRuntimeSnapshot("bg-poll-ok", appConfig, lastReading);
    }
  }

  if (now - lastHeartbeatMs > 300000UL) {
    lastHeartbeatMs = now;
    logHeartbeat(appConfig, lastReading);
  }

  // Status push every 5 min
  if (WiFi.status()==WL_CONNECTED && now - lastStatusPush > 300000UL) {
    lastStatusPush = now;
    if (pushStatus(appConfig)) {
      sdLog("SYS", "Status pushed");
    }
  }

  // WiFi watchdog
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastReconnect = 0;
    if (now - lastReconnect > 30000UL) {
      lastReconnect = now;
      Serial.println("WiFi lost — reconnecting...");
      sdLogfEx("ERR", "WIFI", "link_lost status:%d heap:%u minHeap:%u uptime_s:%lu",
        (int)WiFi.status(), (unsigned)ESP.getFreeHeap(),
        (unsigned)ESP.getMinFreeHeap(), millis() / 1000UL);
      WiFi.reconnect();
    }
  }

  // Digest auto-refresh — once per local calendar day (picks up the freshly generated morning digest)
  if (WiFi.status() == WL_CONNECTED && now - lastDigestFetch > 14400000UL) { // check every 4 h
    time_t epoch = time(nullptr);
    if (epoch > 1700000000) {
      struct tm t;
      localtime_r(&epoch, &t);
      bool newDay  = (t.tm_yday != gDigestFetchDay);
      bool noCache = (strlen(gDigestText) == 0);
      if (newDay || noCache) {
        sdLog("AI", "Auto-refreshing digest");
        fetchDigest(appConfig);
        lastDigestFetch = now;
        if (strlen(gDigestText)) gDigestFetchDay = t.tm_yday;
      } else {
        lastDigestFetch = now; // reset timer; nothing to fetch yet
      }
    }
  }

  // Pump proxy poll — only when integration is enabled
  if (appConfig.glookoEnabled && WiFi.status() == WL_CONNECTED) {
    unsigned long podPollMs = (unsigned long)appConfig.glookoPollMin * 60000UL;
    if (podPollMs < 1800000UL) podPollMs = 1800000UL; // hard floor 30 min
    if (now - lastOmnipodPoll > podPollMs) {
      lastOmnipodPoll = now;
      fetchGlookoOmnipod(appConfig, lastOmnipod);
    }
  }

  otaTick(appConfig);

  updateDisplay(appConfig, lastReading, dispState);
#if DIAG_MODE
  {
    unsigned long _loopMs = millis() - now;
    if (_loopMs > 500) {
      sdLogfEx("SYS", "SYS", "slow_loop_ms:%lu heap:%u minHeap:%u",
        _loopMs, (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMinFreeHeap());
    }
  }
#endif
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

  // Guard: don't reboot while a log upload or OTA update is in-flight.
  if (gLogUploadActive || gOtaUpdateActive) return;

  prefs.putInt("autoRbDay", dayStamp);
  sdLogfEx("SYS", "SYS", "daily_auto_reboot dayStamp:%d", dayStamp);
  Serial.println("Daily auto reboot at 3AM");
  delay(300);
  ESP.restart();
}

// ─── Smart Config Ping ────────────────────────────────────────────────────────
// Lightweight GET — Worker returns {v: N, changed: bool}
// Only does full config pull if version changed

void pingCloudflare(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;
  if (!hasValidClock()) {
    syncTime(cfg.timezone);
    if (!hasValidClock()) {
      sdLogError("Clock invalid; skipping CF ping");
      return;
    }
  }

  String path = String("/api/ping?v=") + String(cfg.lastConfigVersion);
  String base = normalizeWorkerBase(cfg.workerUrl);
  String defaultBase = getDefaultWorkerBase();
  int code = -1;
  bool usedDefaultBase = false;

  {
    HTTPClient http;
    http.begin(base + path);
    http.addHeader("X-Device-Key", cfg.deviceKey);
    addSignedHeaders(http, "GET", path, "", cfg);
    http.setTimeout(5000);
    unsigned long _pingT0 = millis();
    code = http.GET();
    unsigned long _pingMs = millis() - _pingT0;

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
        sdLogfEx("CFG", "CFG", "ping_no_changes remoteV:%d localV:%d elapsed_ms:%lu",
          version, cfg.lastConfigVersion, _pingMs);
      }
    } else {
      sdLogfEx("CFG", "CFG", "ping_http:%d elapsed_ms:%lu heap:%u",
        code, _pingMs, (unsigned)ESP.getFreeHeap());
    }
    http.end();
  }

  if (code < 0 && defaultBase.length() > 0 && base != defaultBase) {
    sdLogEx("ERR", "CFG", "ping_primary_failed_try_default");
    HTTPClient retry;
    retry.begin(defaultBase + path);
    retry.addHeader("X-Device-Key", cfg.deviceKey);
    addSignedHeaders(retry, "GET", path, "", cfg);
    retry.setTimeout(5000);
    code = retry.GET();
    usedDefaultBase = (code >= 0);

    if (code == 200) {
      StaticJsonDocument<64> doc;
      if (!deserializeJson(doc, retry.getString())) {
        bool changed = doc["changed"] | false;
        int  version = doc["v"]       | 0;
        if (changed || version > cfg.lastConfigVersion) {
          Serial.printf("Config changed (v%d -> v%d) — pulling full config\n",
            cfg.lastConfigVersion, version);
          sdLog("CFG", "Config change detected via ping");
          retry.end();
          if (usedDefaultBase) {
            strlcpy(cfg.workerUrl, defaultBase.c_str(), sizeof(cfg.workerUrl));
            saveConfig(p, cfg);
            sdLog("CFG", "Worker URL healed to default");
          }
          pullCloudflareConfig(cfg, p);
          return;
        }
        sdLogfEx("CFG", "CFG", "ping_no_changes_default remoteV:%d localV:%d", version, cfg.lastConfigVersion);
      }
    }
    retry.end();
  }

  {
    char pingMsg[64];
    snprintf(pingMsg, sizeof(pingMsg), "Ping HTTP:%d localV:%d", code, cfg.lastConfigVersion);
    if (kVerboseDiagLogs) sdLog("DBG", pingMsg);
  }

  if (usedDefaultBase && code >= 0) {
    strlcpy(cfg.workerUrl, defaultBase.c_str(), sizeof(cfg.workerUrl));
    saveConfig(p, cfg);
    sdLogEx("CFG", "CFG", "worker_url_healed_default");
  }

  if (code == 401) {
    if (!hasValidClock()) {
      sdLogError("CF ping 401; clock not synced");
    } else {
      dispState.showKeyError = true;
      sdLogError("CF: invalid device key");
    }
  } else if (code != 200) {
    logHttpFailure("CF ping", code);
  }
}

// ─── Full Config Pull ─────────────────────────────────────────────────────────

void pullCloudflareConfig(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;
  if (!hasValidClock()) {
    syncTime(cfg.timezone);
    if (!hasValidClock()) {
      sdLogError("Clock invalid; skipping CF config pull");
      return;
    }
  }

  char prevTimezone[32];  strlcpy(prevTimezone, cfg.timezone, sizeof(prevTimezone));
  char prevWifiSSID[64];  strlcpy(prevWifiSSID, cfg.wifiSSID, sizeof(prevWifiSSID));
  char prevWifiPass[64];  strlcpy(prevWifiPass, cfg.wifiPass, sizeof(prevWifiPass));

  HTTPClient http;
  String path = "/api/config";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(8000);

  unsigned long _cfPullT0 = millis();
  int code = http.GET();
  sdLogfEx("CFG", "CFG", "config_pull_http:%d localV:%d elapsed_ms:%lu heap:%u",
    code, cfg.lastConfigVersion, millis() - _cfPullT0, (unsigned)ESP.getFreeHeap());
  {
    char pullMsg[80];
    snprintf(pullMsg, sizeof(pullMsg), "Pull HTTP:%d priorV:%d", code, cfg.lastConfigVersion);
    if (kVerboseDiagLogs) sdLog("DBG", pullMsg);
  }
  if (code == 200) {
    String resp = http.getString();
    DynamicJsonDocument doc(8192);
    DeserializationError derr = deserializeJson(doc, resp);
    if (derr) {
      char errMsg[96];
      snprintf(errMsg, sizeof(errMsg), "Config parse failed: %s", derr.c_str());
      sdLogEx("ERR", "CFG", errMsg);

      String preview = resp.substring(0, 180);
      preview.replace("\n", " ");
      preview.replace("\r", " ");
      char bodyMsg[220];
      snprintf(bodyMsg, sizeof(bodyMsg), "Config body preview: %s", preview.c_str());
      if (kVerboseDiagLogs) sdLog("DBG", bodyMsg);
      http.end();
      return;
    }

    JsonObject c = doc["config"];
    {
      char keysMsg[120];
      snprintf(
        keysMsg,
        sizeof(keysMsg),
        "Pull keys wifiSsid:%d wifiPass:%d dexUser:%d dexPass:%d nsUrl:%d nsSecret:%d",
        c.containsKey("wifi_ssid") || c.containsKey("wifiSSID"),
        c.containsKey("wifi_pass") || c.containsKey("wifi_password") || c.containsKey("wifiPass"),
        c.containsKey("dexcom_user") || c.containsKey("dexcomUser"),
        c.containsKey("dexcom_pass") || c.containsKey("dexcomPass"),
        c.containsKey("nightscout_url") || c.containsKey("nightscoutUrl"),
        c.containsKey("nightscout_secret") || c.containsKey("nightscoutSecret")
      );
      if (kVerboseDiagLogs) sdLog("DBG", keysMsg);
    }
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
    if (c.containsKey("dim_to_pct"))          cfg.dimToPct          = c["dim_to_pct"];
    if (c.containsKey("clock_24hr"))          cfg.clock24hr         = c["clock_24hr"];
    if (c.containsKey("dnd_enabled"))         cfg.dndEnabled        = c["dnd_enabled"];
    if (c.containsKey("dnd_use_schedule"))    cfg.dndUseSchedule    = c["dnd_use_schedule"];
    if (c.containsKey("bg_alert_style"))      strlcpy(cfg.bgAlertStyle, c["bg_alert_style"], 16);
    if (c.containsKey("bg_units"))            strlcpy(cfg.bgUnits,      c["bg_units"],       8);
    if (c.containsKey("timezone"))            strlcpy(cfg.timezone,     c["timezone"],       32);
    if (c.containsKey("dnd_from"))            strlcpy(cfg.dndFrom,      c["dnd_from"],       8);
    if (c.containsKey("dnd_to"))              strlcpy(cfg.dndTo,        c["dnd_to"],         8);
    if (c.containsKey("glooko_enabled"))      cfg.glookoEnabled    = c["glooko_enabled"];
    if (c.containsKey("glooko_poll_min"))     cfg.glookoPollMin    = c["glooko_poll_min"];
    if (c.containsKey("ota_enabled"))         cfg.otaEnabled       = c["ota_enabled"];
    if (c.containsKey("ota_check_min"))       cfg.otaCheckMin      = c["ota_check_min"];
    if (c.containsKey("ota_channel"))         strlcpy(cfg.otaChannel, c["ota_channel"], sizeof(cfg.otaChannel));

    if (c.containsKey("dnd_schedule") && c["dnd_schedule"].is<JsonObject>()) {
      static const char* kDays[7] = {"sun", "mon", "tue", "wed", "thu", "fri", "sat"};
      JsonObject sched = c["dnd_schedule"].as<JsonObject>();
      for (int i = 0; i < 7; i++) {
        if (!sched.containsKey(kDays[i]) || !sched[kDays[i]].is<JsonObject>()) continue;
        JsonObject day = sched[kDays[i]].as<JsonObject>();
        if (day.containsKey("from")) strlcpy(cfg.dndFromByDay[i], day["from"], 8);
        if (day.containsKey("to")) strlcpy(cfg.dndToByDay[i], day["to"], 8);
      }
      cfg.dndUseSchedule = true;
    }

    // Sensitive fields — store encrypted
    bool incomingWifiSsidValid = false;
    if ((c.containsKey("wifi_ssid") && !c["wifi_ssid"].isNull()) ||
        (c.containsKey("wifiSSID") && !c["wifiSSID"].isNull())) {
      String ssid = c.containsKey("wifi_ssid")
        ? c["wifi_ssid"].as<String>()
        : c["wifiSSID"].as<String>();
      ssid.trim();
      if (ssid.length() > 0) {
        strlcpy(cfg.wifiSSID, ssid.c_str(), sizeof(cfg.wifiSSID));
        incomingWifiSsidValid = true;
      }
    }
    if (incomingWifiSsidValid &&
        (c.containsKey("wifi_pass") || c.containsKey("wifi_password") || c.containsKey("wifiPass"))) {
      String pass = "";
      if (c.containsKey("wifi_pass") && !c["wifi_pass"].isNull()) {
        pass = c["wifi_pass"].as<String>();
      } else if (c.containsKey("wifi_password") && !c["wifi_password"].isNull()) {
        pass = c["wifi_password"].as<String>();
      } else if (c.containsKey("wifiPass") && !c["wifiPass"].isNull()) {
        pass = c["wifiPass"].as<String>();
      }
      strlcpy(cfg.wifiPass, pass.c_str(), sizeof(cfg.wifiPass));
    }

    char prevNightscoutUrl[128]; strlcpy(prevNightscoutUrl, cfg.nightscoutUrl, sizeof(prevNightscoutUrl));
    char prevNightscoutSecret[64]; strlcpy(prevNightscoutSecret, cfg.nightscoutSecret, sizeof(prevNightscoutSecret));
    char prevDexcomUser[64]; strlcpy(prevDexcomUser, cfg.dexcomUser, sizeof(prevDexcomUser));
    char prevDexcomPass[64]; strlcpy(prevDexcomPass, cfg.dexcomPass, sizeof(prevDexcomPass));

    auto copyIfNonEmpty = [&](JsonObject obj, const char* keyA, const char* keyB, char* dst, size_t dstSz) {
      bool hasA = keyA && obj.containsKey(keyA) && !obj[keyA].isNull();
      bool hasB = keyB && obj.containsKey(keyB) && !obj[keyB].isNull();
      if (!hasA && !hasB) return;
      String v = hasA ? obj[keyA].as<String>() : obj[keyB].as<String>();
      v.trim();
      if (v.length() > 0) {
        strlcpy(dst, v.c_str(), dstSz);
      }
    };

    copyIfNonEmpty(c, "nightscout_url", "nightscoutUrl", cfg.nightscoutUrl, sizeof(cfg.nightscoutUrl));
    copyIfNonEmpty(c, "nightscout_secret", "nightscoutSecret", cfg.nightscoutSecret, sizeof(cfg.nightscoutSecret));
    copyIfNonEmpty(c, "dexcom_user", "dexcomUser", cfg.dexcomUser, sizeof(cfg.dexcomUser));
    copyIfNonEmpty(c, "dexcom_pass", "dexcomPass", cfg.dexcomPass, sizeof(cfg.dexcomPass));
    copyIfNonEmpty(c, "dexcom_region", "dexcomRegion", cfg.dexcomRegion, sizeof(cfg.dexcomRegion));
    bool hadSourceBefore =
      (strlen(prevNightscoutUrl) > 0) ||
      (strlen(prevDexcomUser) > 0 && strlen(prevDexcomPass) > 0);
    bool hasSourceAfter =
      (strlen(cfg.nightscoutUrl) > 0) ||
      (strlen(cfg.dexcomUser) > 0 && strlen(cfg.dexcomPass) > 0);
    if (hadSourceBefore && !hasSourceAfter) {
      strlcpy(cfg.nightscoutUrl, prevNightscoutUrl, sizeof(cfg.nightscoutUrl));
      strlcpy(cfg.nightscoutSecret, prevNightscoutSecret, sizeof(cfg.nightscoutSecret));
      strlcpy(cfg.dexcomUser, prevDexcomUser, sizeof(cfg.dexcomUser));
      strlcpy(cfg.dexcomPass, prevDexcomPass, sizeof(cfg.dexcomPass));
      sdLogEx("ERR", "CFG", "bg_creds_missing_preserved_previous");
    }

    // Update config version
    int newVersion = doc["config_version"] | cfg.lastConfigVersion;
    cfg.lastConfigVersion = newVersion;

    sanitizeConfig(cfg);
    logConfigDiagnostics("after-merge", cfg);

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
      sdLogfEx("SYS", "TIME", "timezone_changed %s->%s", prevTimezone, cfg.timezone);
      syncTime(cfg.timezone);
    }

    bool wifiCredsChanged =
      strcmp(prevWifiSSID, cfg.wifiSSID) != 0 ||
      strcmp(prevWifiPass, cfg.wifiPass) != 0;
    if (wifiCredsChanged) {
      sdLogEx("NET", "CFG", "wifi_credentials_changed_rebooting");
      setDisplayBanner(dispState, "WiFi updated, rebooting", CLR_MUTED, 2500UL);
      delay(500);
      ESP.restart();
      return;
    }

    dispState.showKeyError = false;
    Serial.printf("Config synced (v%d)\n", cfg.lastConfigVersion);
    sdLogfEx("CFG", "CFG", "config_synced v:%d", cfg.lastConfigVersion);

  } else if (code == 401) {
    if (!hasValidClock()) {
      sdLogError("CF config 401; clock not synced");
    } else {
      dispState.showKeyError = true;
      sdLogError("CF: invalid device key");
    }
  } else {
    logHttpFailure("CF config", code);
  }
  http.end();
}

// ─── Status Push ──────────────────────────────────────────────────────────────

bool pushStatus(AppConfig& cfg) {
  if (!strlen(cfg.workerUrl)) return false;
  if (!hasValidClock()) return false;
  HTTPClient http;
  String path = "/api/status";
  http.begin(String(cfg.workerUrl)+path);
  http.addHeader("Content-Type","application/json");
  http.addHeader("X-Device-Key", cfg.deviceKey);
  StaticJsonDocument<512> doc;
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
    // AI digest availability — lets MCP see whether the device has a cached digest
    doc["digestAvailable"]  = strlen(gDigestText) > 0;
    if (gDigestFetchDay >= 0) doc["digestFetchDay"] = gDigestFetchDay;
    doc["otaEnabled"]       = cfg.otaEnabled;
    doc["otaChannel"]       = cfg.otaChannel;
    // Pump proxy status (only when enabled and valid data available)
    if (cfg.glookoEnabled) {
      doc["glookoEnabled"] = true;
      if (lastOmnipod.valid) {
        doc["podActive"]      = lastOmnipod.podActive;
        doc["podMinToExpiry"] = lastOmnipod.minutesToExpiry;
        if (lastOmnipod.podChangeTimestamp > 0) {
          doc["podChangeTs"]  = (long)lastOmnipod.podChangeTimestamp;
        }
      }
    }
  String body; serializeJson(doc, body);
    addSignedHeaders(http, "POST", path, body, cfg);
  int code = http.POST(body);
  if (code < 200 || code >= 300) {
    sdLogfEx("ERR", "STATUS", "push_fail http:%d", code);
    logHttpFailure("Status push", code);
    http.end();
    return false;
  }
  sdLogfEx("SYS", "STATUS", "push_ok bg:%d src:%d cfgV:%d", lastReading.value, (int)lastReading.source, cfg.lastConfigVersion);
  http.end();
  return true;
}

void pollCloudflareCommand(AppConfig& cfg, Preferences& p) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;
  if (!hasValidClock()) return;

  HTTPClient http;
  String path = "/api/command";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(5000);

  int code = http.GET();
  if (code != 200) {
    sdLogfEx("ERR", "CMD", "poll_http:%d", code);
    http.end();
    return;
  }

  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, http.getString())) {
    sdLogEx("ERR", "CMD", "poll_parse_failed");
    http.end();
    return;
  }
  http.end();

  bool pending = doc["pending"] | false;
  sdLogfEx("CMD", "CMD", "poll_ok pending:%d", pending ? 1 : 0);
  if (!pending) return;

  const char* cmdId = doc["command"]["id"] | "";
  const char* cmdType = doc["command"]["type"] | "";
  unsigned long long createdAt = doc["command"]["createdAt"] | 0ULL;
  unsigned long long expiresAt = doc["command"]["expiresAt"] | 0ULL;
  const char* cmdSig = doc["command"]["sig"] | "";
  JsonObject cmdArgs = doc["command"]["args"].is<JsonObject>()
    ? doc["command"]["args"].as<JsonObject>() : JsonObject();

  if (!strlen(cmdId) || !strlen(cmdType)) return;
  if (!verifyCommandSignature(cfg, cmdId, cmdType, createdAt, expiresAt, cmdSig)) {
    sdLogfEx("ERR", "CMD", "signature_invalid id:%s type:%s", cmdId, cmdType);
    ackCloudflareCommand(cfg, cmdId, false, "invalid signature");
    return;
  }

  sdLogfEx("CMD", "CMD", "execute id:%s type:%s", cmdId, cmdType);

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

  if (!strcmp(cmdType, "factory-reset")) {
    sdLog("CMD", "Executing command: factory-reset");
    ackCloudflareCommand(cfg, cmdId, true, "factory reset started");
    factoryResetToInitialSetup(cfg, p);
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

  if (!strcmp(cmdType, "fetch-digest")) {
    sdLog("CMD", "Executing command: fetch-digest");
    setDisplayBanner(dispState, "Fetching digest...", CLR_MUTED);
    fetchDigest(cfg);
    lastDigestFetch = millis();
    if (strlen(gDigestText)) {
      time_t epoch = time(nullptr);
      if (epoch > 1700000000) {
        struct tm t;
        localtime_r(&epoch, &t);
        gDigestFetchDay = t.tm_yday;
      }
      setDisplayBanner(dispState, "Digest ready", CLR_GREEN, 1500UL);
      showDigestScreen(gDigestText, 30000UL);
    } else {
      setDisplayBanner(dispState, "No digest available", CLR_DIM, 2500UL);
    }
    ackCloudflareCommand(cfg, cmdId, true, strlen(gDigestText) ? "digest shown" : "no digest");
    return;
  }

  if (!strcmp(cmdType, "ota-check")) {
    sdLog("CMD", "Executing command: ota-check");
    CloudOtaReleaseInfo release;
    if (!fetchCloudOtaRelease(cfg, release)) {
      setDisplayBanner(dispState, "OTA check failed", CLR_RED, 2500UL);
      ackCloudflareCommand(cfg, cmdId, false, "ota manifest fetch failed");
      return;
    }
    if (!release.available) {
      setDisplayBanner(dispState, "Already up to date", CLR_GREEN, 2500UL);
      ackCloudflareCommand(cfg, cmdId, true, "already up to date");
      return;
    }
    char otaMsg[96];
    snprintf(otaMsg, sizeof(otaMsg), "Update ready: %s", release.version);
    setDisplayBanner(dispState, otaMsg, CLR_GREEN, 3500UL);
    ackCloudflareCommand(cfg, cmdId, true, otaMsg);
    return;
  }

  if (!strcmp(cmdType, "ota-apply")) {
    sdLog("CMD", "Executing command: ota-apply");
    setDisplayBanner(dispState, "Applying OTA...", CLR_MUTED, 5000UL);
    CloudOtaReleaseInfo release;
    if (!fetchCloudOtaRelease(cfg, release)) {
      setDisplayBanner(dispState, "OTA manifest failed", CLR_RED, 2500UL);
      ackCloudflareCommand(cfg, cmdId, false, "ota manifest fetch failed");
      return;
    }
    if (!release.available) {
      setDisplayBanner(dispState, "No update available", CLR_GREEN, 2500UL);
      ackCloudflareCommand(cfg, cmdId, false, "no update available");
      return;
    }

    String otaResult;
    gOtaUpdateActive = true;
    bool ok = performCloudOtaUpdate(cfg, &release, &otaResult);
    gOtaUpdateActive = false;

    if (!ok) {
      const char* msg = otaResult.length() ? otaResult.c_str() : "ota update failed";
      setDisplayBanner(dispState, "OTA failed", CLR_RED, 3000UL);
      ackCloudflareCommand(cfg, cmdId, false, msg);
      return;
    }

    ackCloudflareCommand(cfg, cmdId, true, otaResult.length() ? otaResult.c_str() : "ota applied, rebooting");
    delay(500);
    ESP.restart();
    return;
  }

  if (!strcmp(cmdType, "display-message")) {
    sdLog("CMD", "Executing command: display-message");
    const char* msg = cmdArgs.containsKey("message") ? cmdArgs["message"].as<const char*>() : "";
    int durSec = cmdArgs.containsKey("duration_sec") ? cmdArgs["duration_sec"].as<int>() : 5;
    if (durSec < 1) durSec = 1;
    if (durSec > 60) durSec = 60;
    if (msg && strlen(msg)) {
      sdLogfEx("CMD", "CMD", "display_message dur:%d msg_len:%u", durSec, (unsigned)strlen(msg));
      setDisplayBanner(dispState, msg, CLR_TEXT, (unsigned long)durSec * 1000UL);
      ackCloudflareCommand(cfg, cmdId, true, "displayed");
    } else {
      ackCloudflareCommand(cfg, cmdId, false, "empty message");
    }
    return;
  }

  ackCloudflareCommand(cfg, cmdId, false, "unknown command");
}

void ackCloudflareCommand(AppConfig& cfg, const char* cmdId, bool ok, const char* message) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey) || !cmdId || !strlen(cmdId)) return;
  if (!hasValidClock()) return;

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
  int code = http.POST(payload);
  sdLogfEx("CMD", "CMD_ACK", "id:%s ok:%d http:%d msg:%s", cmdId, ok ? 1 : 0, code, message ? message : "");
  http.end();
}

bool uploadSdLogs(AppConfig& cfg, const char* cmdId, int maxLines, size_t maxBytes, bool failIfEmpty) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return false;
  if (!hasValidClock()) return false;

  String logs;
  int lineCount = 0;
  bool haveLogs = sdCollectLogsForUpload(logs, lineCount, maxLines, maxBytes);
  if (!haveLogs) {
    if (failIfEmpty) sdLogEx("ERR", "LOG_UPLOAD", "no_logs_available");
    return false;
  }

  sdLogfEx("SYS", "LOG_UPLOAD", "prepare lines:%d bytes:%u cmd:%d", lineCount, (unsigned)logs.length(), (cmdId && strlen(cmdId)) ? 1 : 0);

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
    sdLogfEx("SYS", "LOG_UPLOAD", "upload_ok http:%d lines:%d bytes:%u", code, lineCount, (unsigned)logs.length());
    return true;
  }

  sdLogfEx("ERR", "LOG_UPLOAD", "upload_fail http:%d lines:%d", code, lineCount);
  logHttpFailure("Log upload", code);
  return false;
}

// ─── Daily AI Digest ──────────────────────────────────────────────────────────

void fetchDigest(AppConfig& cfg) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;
  if (!hasValidClock()) return;

  HTTPClient http;
  String path = "/api/digest";
  http.begin(String(cfg.workerUrl) + path);
  http.addHeader("X-Device-Key", cfg.deviceKey);
  addSignedHeaders(http, "GET", path, "", cfg);
  http.setTimeout(5000);

  int code = http.GET();
  sdLogfEx("AI", "DIGEST", "fetch_http:%d", code);
  if (code == 200) {
    StaticJsonDocument<1536> doc;
    if (!deserializeJson(doc, http.getString())) {
      const char* txt = doc["text"] | "";
      if (strlen(txt) > 0) {
        strlcpy(gDigestText, txt, sizeof(gDigestText));
        sdLogfEx("AI", "DIGEST", "fetched len:%u", (unsigned)strlen(gDigestText));
      }
    } else {
      sdLogEx("ERR", "DIGEST", "parse_failed");
    }
  } else if (code == 204) {
    // No digest available today — not an error
    sdLog("AI", "No digest available");
  } else {
    char msg[40];
    snprintf(msg, sizeof(msg), "Digest HTTP %d", code);
    sdLogEx("AI", "DIGEST", msg);
  }
  http.end();
}

// ─── NTP Time Sync ────────────────────────────────────────────────────────────
// Uses NIST time servers for maximum accuracy

bool syncTimeFromWorker(AppConfig& cfg) {
  if (!strlen(cfg.workerUrl)) return false;

  String base = normalizeWorkerBase(cfg.workerUrl);
  if (!base.length()) return false;

  HTTPClient http;
  String path = "/api/detect-timezone";
  http.begin(base + path);
  http.addHeader("Accept", "application/json");
  http.setTimeout(8000);

  int code = http.GET();
  if (code != 200) {
    sdLogfEx("ERR", "TIME", "worker_time_http:%d", code);
    http.end();
    return false;
  }

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, http.getString());
  http.end();
  if (err) {
    sdLogfEx("ERR", "TIME", "worker_time_parse:%s", err.c_str());
    return false;
  }

  long serverEpoch = doc["server_epoch"] | 0;
  if (serverEpoch < 1700000000L) {
    sdLogEx("ERR", "TIME", "worker_time_invalid_epoch");
    return false;
  }

  struct timeval tv;
  tv.tv_sec = (time_t)serverEpoch;
  tv.tv_usec = 0;
  settimeofday(&tv, nullptr);

  struct tm ti;
  if (getLocalTime(&ti, 2000)) {
    Serial.printf("Time synced via worker: %04d-%02d-%02d %02d:%02d:%02d\n",
      ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday,
      ti.tm_hour, ti.tm_min, ti.tm_sec);
    sdLog("SYS", "Time synced via worker fallback");
    return true;
  }

  sdLogEx("ERR", "TIME", "worker_time_apply_failed");
  return false;
}

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
    // Fallback to broad public pool in case NIST hosts are blocked by ISP/router.
    configTzTime(posix,
      "pool.ntp.org",
      "time.google.com",
      "time.cloudflare.com"
    );
    if (getLocalTime(&ti, 10000)) {
      Serial.printf("Time synced (fallback): %04d-%02d-%02d %02d:%02d:%02d\n",
        ti.tm_year+1900, ti.tm_mon+1, ti.tm_mday,
        ti.tm_hour, ti.tm_min, ti.tm_sec);
      sdLog("SYS", "NTP synced (fallback)");
      return;
    }

    // Final fallback for restrictive networks that block UDP NTP:
    // bootstrap current epoch from Worker over HTTPS.
    if (syncTimeFromWorker(appConfig)) {
      return;
    }

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

void factoryResetToInitialSetup(AppConfig& cfg, Preferences& p) {
  sdLog("CMD", "Factory reset initiated");
  setDisplayBanner(dispState, "Factory reset...", CLR_ORANGE, 3000UL);

  // Keep cloud identity so the device can pull cloud config again after Wi-Fi re-entry.
  char keepWorkerUrl[128];
  char keepDeviceKey[64];
  char keepTimezone[32];
  strlcpy(keepWorkerUrl, cfg.workerUrl, sizeof(keepWorkerUrl));
  strlcpy(keepDeviceKey, cfg.deviceKey, sizeof(keepDeviceKey));
  strlcpy(keepTimezone, cfg.timezone, sizeof(keepTimezone));

  WiFi.disconnect(true, true);
  delay(200);

  p.clear();
  cfg = AppConfig();

  // Restore cloud identity so /api/config can repopulate NS/Dexcom credentials.
  if (strlen(keepWorkerUrl)) strlcpy(cfg.workerUrl, keepWorkerUrl, sizeof(cfg.workerUrl));
  if (strlen(keepDeviceKey)) strlcpy(cfg.deviceKey, keepDeviceKey, sizeof(cfg.deviceKey));
  if (strlen(keepTimezone)) strlcpy(cfg.timezone, keepTimezone, sizeof(cfg.timezone));

  // Backward-compatible fallback for very old devices with no cloud identity stored.
  if (!strlen(cfg.workerUrl)) strlcpy(cfg.workerUrl, BGDISPLAY_DEFAULT_WORKER_URL, sizeof(cfg.workerUrl));
  if (!strlen(cfg.deviceKey)) {
    String dk = BGDISPLAY_DEFAULT_DEVICE_KEY;
    strlcpy(cfg.deviceKey, dk.c_str(), sizeof(cfg.deviceKey));
  }
  if (!strlen(cfg.timezone)) strlcpy(cfg.timezone, BGDISPLAY_DEFAULT_TIMEZONE, sizeof(cfg.timezone));
  saveConfig(p, cfg);

  sdLog("CMD", "Factory reset complete; entering setup AP");
  startAPMode(cfg, p);
  ESP.restart();
}
