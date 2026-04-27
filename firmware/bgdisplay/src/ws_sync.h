// ws_sync.h — WebSocket relay client for instant config push from Cloudflare DO
// On boot the device opens a persistent WSS connection to /api/ws.
// Any "config-changed" message triggers an immediate pullCloudflareConfig().
// Falls back to 30-second HTTPS ping when the socket is not connected.

#pragma once
#include <WebSocketsClient.h>
#include "config.h"
#include "sd_logger.h"

static WebSocketsClient _wsClient;
static volatile bool    _wsConnected      = false;
static volatile bool    _wsTriggerPull    = false;
static bool             _wsInitialized    = false;
static uint32_t         _wsReconnectMs    = 8000;  // exponential backoff base
static unsigned long    _wsLastDisconnect = 0;

// Event callback — keep short; flag-only, no blocking calls here
static void _wsEventHandler(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      _wsConnected   = true;
      _wsReconnectMs = 8000;  // reset backoff on successful connect
      sdLog("WS", "Connected to relay");
      break;
    case WStype_DISCONNECTED:
      _wsConnected      = false;
      _wsLastDisconnect = millis();
      // Double interval up to 5 min cap on each disconnect
      if (_wsReconnectMs < 300000U) _wsReconnectMs = min(_wsReconnectMs * 2U, 300000U);
      _wsClient.setReconnectInterval(_wsReconnectMs);
      sdLog("WS", "Disconnected");
      break;
    case WStype_TEXT:
      // {"type":"config-changed","version":N} — any message triggers a pull
      _wsTriggerPull = true;
      if (payload && length > 0) {
        char msg[72];
        snprintf(msg, sizeof(msg), "Push rcvd: %.*s", (int)min((size_t)48, length), (char*)payload);
        sdLog("WS", msg);
      }
      break;
    case WStype_ERROR:
      _wsConnected = false;
      sdLog("WS", "Error");
      break;
    default:
      break;
  }
}

void wsInit(AppConfig& cfg) {
  if (!strlen(cfg.workerUrl) || !strlen(cfg.deviceKey)) return;

  // Parse host from workerUrl (e.g. "https://bgdisplay-worker.zanebaize.workers.dev")
  String url = String(cfg.workerUrl);
  bool secure = url.startsWith("https://");
  String rest = url.substring(secure ? 8 : 7);
  int slashIdx = rest.indexOf('/');
  String host  = (slashIdx >= 0) ? rest.substring(0, slashIdx) : rest;
  int colonIdx = host.indexOf(':');
  if (colonIdx >= 0) host = host.substring(0, colonIdx);
  uint16_t port = secure ? 443 : 80;

  _wsClient.setExtraHeaders(("X-Device-Key: " + String(cfg.deviceKey)).c_str());
  if (secure) {
    _wsClient.beginSSL(host.c_str(), port, "/api/ws");
  } else {
    _wsClient.begin(host.c_str(), port, "/api/ws");
  }
  _wsClient.onEvent(_wsEventHandler);
  // Start with an 8-second reconnect interval; backs off exponentially to 5 min
  // on persistent failures to avoid hammering the Worker during outages.
  _wsReconnectMs = 8000;
  _wsClient.setReconnectInterval(_wsReconnectMs);

  _wsInitialized = true;
  sdLog("WS", "Client initialized");
}

// Call from loop() every iteration.
// Calls pullCloudflareConfig when the DO pushes a config-changed event.
// Declared here; defined in bgdisplay.ino — forward declaration resolves at link time.
extern void pullCloudflareConfig(AppConfig&, Preferences&);

void wsTick(AppConfig& cfg, Preferences& prefs) {
  if (!_wsInitialized) return;
  _wsClient.loop();

  // Handle pending config pull AFTER loop() returns to avoid re-entrancy
  if (_wsTriggerPull) {
    _wsTriggerPull = false;
    sdLog("WS", "Config pull triggered by push");
    pullCloudflareConfig(cfg, prefs);
  }
}

bool wsIsConnected() {
  return _wsConnected && _wsInitialized;
}
