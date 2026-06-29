// wifi_setup.h — WiFi connection + AP captive portal (WiFi only)
#pragma once
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <M5Unified.h>
#include "config.h"
#include "crypto.h"
#include "sd_logger.h"

WebServer apServer(80);
DNSServer dnsServer;

// Defined later in bgdisplay.ino — declared here so the AP-mode loop below can
// reuse the same local factory-reset gesture as the main loop().
extern DisplayState dispState;
extern bool gFactoryResetArmed;
extern unsigned long gFactoryResetArmMs;
extern void factoryResetToInitialSetup(AppConfig& cfg, Preferences& prefs, bool reenterApMode = true);

// Local emergency reset gesture: hold the power button once to arm, hold
// again within 10s to confirm. Shared between the main loop() and
// startAPMode()'s captive-portal loop below — a device stuck in AP setup
// mode (e.g. it can't see/auth to its only saved SSID at a new location)
// still needs a way to wipe local config, since the Cloudflare command path
// requires connectivity it doesn't have by definition while stuck here.
// Pass inApMode:true when called from within an already-running AP session
// so factoryResetToInitialSetup() doesn't redundantly re-enter it.
inline bool checkFactoryResetGesture(AppConfig& cfg, Preferences& prefs, bool inApMode) {
  unsigned long now = millis();
  if (gFactoryResetArmed && (now - gFactoryResetArmMs > 10000UL)) {
    gFactoryResetArmed = false;
  }
  if (!M5.BtnPWR.wasHold()) return false;
  if (gFactoryResetArmed && (now - gFactoryResetArmMs <= 10000UL)) {
    gFactoryResetArmed = false;
    sdLog("CMD", "Local factory reset gesture confirmed");
    factoryResetToInitialSetup(cfg, prefs, !inApMode);
    return true;
  }
  gFactoryResetArmed = true;
  gFactoryResetArmMs = now;
  sdLog("CMD", "Local factory reset armed; hold again to confirm");
  setDisplayBanner(dispState, "Hold power again to reset", CLR_ORANGE, 3500UL);
  return false;
}
// Port-443 stub: iOS 18+ probes https://captive.apple.com/ via HTTPS.
// The ESP32 can't serve TLS, but opening a socket and immediately closing it
// signals "captive portal" to iOS faster than a connection timeout.
WiFiServer httpsStub(443);

inline String extractHostFromUrl(const char* url) {
  String s = String(url);
  bool secure = s.startsWith("https://");
  String rest = s.substring(secure ? 8 : 7);
  int slashIdx = rest.indexOf('/');
  String host = (slashIdx >= 0) ? rest.substring(0, slashIdx) : rest;
  int colonIdx = host.indexOf(':');
  if (colonIdx >= 0) host = host.substring(0, colonIdx);
  return host;
}

// Captive-portal / open-internet check. Some networks let WiFi association +
// DHCP succeed while gating real internet behind a browser login page, or
// simply firewall all egress traffic; either way every later HTTPS attempt
// (worker, Dexcom, Nightscout, NTP) fails identically and the failure mode is
// easy to misdiagnose after the fact from DNS-timing alone. A plain HTTP GET
// to a generate_204 endpoint comes back empty with HTTP 204 on a clean
// network; a captive portal typically answers with a redirect or an HTML
// body instead, and a fully egress-blocked network just times out. Purely
// diagnostic — does not change connect/retry behavior, just makes the
// failure mode visible in diag_wifi.log immediately. Runs before the DNS
// override below so the result reflects the network's own DHCP-leased DNS.
inline void checkCaptivePortal() {
  HTTPClient http;
  http.setConnectTimeout(4000);
  http.setTimeout(4000);
  if (!http.begin("http://connectivitycheck.gstatic.com/generate_204")) {
    sdLogfEx("ERR", "WIFI", "captive_check_failed reason:begin_failed");
    return;
  }
  unsigned long t0 = millis();
  int code = http.GET();
  unsigned long tookMs = millis() - t0;
  if (code == 204) {
    sdLogfEx("NET", "WIFI", "captive_check ok http:%d took_ms:%lu", code, tookMs);
  } else if (code > 0) {
    String location = http.header("Location");
    String body = http.getString();
    sdLogfEx("ERR", "WIFI",
      "captive_check_failed reason:unexpected_response http:%d took_ms:%lu body_len:%d redirect:%s",
      code, tookMs, (int)body.length(), location.length() ? location.c_str() : "-");
  } else {
    sdLogfEx("ERR", "WIFI", "captive_check_failed reason:%s http:%d took_ms:%lu",
      HTTPClient::errorToString(code).c_str(), code, tookMs);
  }
  http.end();
}

// Some networks (open guest WiFi, ISP "secure" DNS, content filters) hand out
// DNS resolvers via DHCP that block or fail to resolve *.workers.dev — the
// worker hostname is structurally indistinguishable from the abuse traffic
// those filters target. WiFi association and DHCP still succeed in that case
// (the device gets a real IP/gateway), only DNS for our specific host fails.
// Re-applying the DHCP-leased IP/gateway/subnet via WiFi.config() while
// substituting public DNS servers sidesteps the network's resolver entirely
// without needing a static IP.
//
// Other networks do the opposite: they allow their own DHCP-leased resolver
// fine, but firewall off egress DNS queries to any other resolver (a common
// anti-DNS-tunneling / content-filtering policy on otherwise fully open
// networks). A blind override to public DNS breaks resolution entirely there
// even though the DHCP resolver itself works. So: apply the override, verify
// it can actually resolve the worker hostname, and revert to the DHCP-leased
// resolver if not. Call after every (re)connect, since WiFi.reconnect()
// re-runs DHCP and would otherwise restore whichever DNS state preceded it.
inline void applyPublicDns(AppConfig& cfg) {
  if (WiFi.status() != WL_CONNECTED) return;
  IPAddress dhcpDns1 = WiFi.dnsIP(0);
  IPAddress dhcpDns2 = WiFi.dnsIP(1);
  IPAddress pubDns1(1, 1, 1, 1);
  IPAddress pubDns2(8, 8, 8, 8);
  bool ok = WiFi.config(WiFi.localIP(), WiFi.gatewayIP(), WiFi.subnetMask(), pubDns1, pubDns2);
  sdLogfEx("NET", "WIFI", "dns_override applied:%d dns1:%s dns2:%s",
    ok ? 1 : 0, pubDns1.toString().c_str(), pubDns2.toString().c_str());

  if (!strlen(cfg.workerUrl)) return;
  String host = extractHostFromUrl(cfg.workerUrl);
  IPAddress resolved;
  unsigned long t0 = millis();
  bool resolveOk = WiFi.hostByName(host.c_str(), resolved);
  unsigned long tookMs = millis() - t0;
  if (resolveOk) {
    sdLogfEx("NET", "WIFI", "dns_override_verify ok host:%s ip:%s took_ms:%lu",
      host.c_str(), resolved.toString().c_str(), tookMs);
    return;
  }
  sdLogfEx("ERR", "WIFI", "dns_override_verify_failed host:%s took_ms:%lu reverting_to_dhcp_dns",
    host.c_str(), tookMs);
  bool revertOk = WiFi.config(WiFi.localIP(), WiFi.gatewayIP(), WiFi.subnetMask(), dhcpDns1, dhcpDns2);
  sdLogfEx("NET", "WIFI", "dns_override_reverted ok:%d dns1:%s dns2:%s",
    revertOk ? 1 : 0, dhcpDns1.toString().c_str(), dhcpDns2.toString().c_str());
}

// Logs link-layer detail (BSSID/channel/subnet/gateway/DNS) plus a live DNS
// resolution of the configured worker hostname. Called on initial connect and
// on every reconnect so network changes (e.g. roaming between sites) are
// captured, not just the boot-time connection.
inline void logWifiDiagDetail(const char* tag, AppConfig& cfg) {
#if DIAG_MODE
  uint8_t* bssid = WiFi.BSSID();
  char bssidStr[20];
  snprintf(bssidStr, sizeof(bssidStr), "%02X:%02X:%02X:%02X:%02X:%02X",
    bssid[0], bssid[1], bssid[2], bssid[3], bssid[4], bssid[5]);
  sdLogfEx("NET", "WIFI",
    "%s detail bssid:%s ch:%d subnet:%s gw:%s dns1:%s dns2:%s",
    tag, bssidStr, (int)WiFi.channel(),
    WiFi.subnetMask().toString().c_str(),
    WiFi.gatewayIP().toString().c_str(),
    WiFi.dnsIP(0).toString().c_str(),
    WiFi.dnsIP(1).toString().c_str());

  if (strlen(cfg.workerUrl)) {
    String host = extractHostFromUrl(cfg.workerUrl);

    IPAddress resolved;
    unsigned long t0 = millis();
    bool ok = WiFi.hostByName(host.c_str(), resolved);
    unsigned long tookMs = millis() - t0;
    if (ok) {
      sdLogfEx("NET", "WIFI", "%s dns_resolve host:%s ip:%s took_ms:%lu",
        tag, host.c_str(), resolved.toString().c_str(), tookMs);
    } else {
      sdLogfEx("ERR", "WIFI", "%s dns_resolve_failed host:%s took_ms:%lu",
        tag, host.c_str(), tookMs);
    }
  }
#else
  (void)tag; (void)cfg;
#endif
}

inline void logApRequest(const char* tag) {
  String host = apServer.hostHeader();
  String uri = apServer.uri();
  String ip = apServer.client().remoteIP().toString();
  sdLogfEx("NET", "AP", "%s host:%s uri:%s from:%s", tag, host.c_str(), uri.c_str(), ip.c_str());
}

inline String escapeWifiQrField(const char* in) {
  String out;
  if (!in) return out;
  while (*in) {
    char c = *in++;
    if (c == '\\' || c == ';' || c == ',' || c == ':') out += '\\';
    out += c;
  }
  return out;
}

inline String buildWifiJoinQr(const char* ssid, const char* pass) {
  String escSsid = escapeWifiQrField(ssid);
  if (!pass || !strlen(pass)) {
    return String("WIFI:T:nopass;S:") + escSsid + ";;";
  }
  String escPass = escapeWifiQrField(pass);
  return String("WIFI:T:WPA;S:") + escSsid + ";P:" + escPass + ";;";
}

inline String fitToWidth(const String& text, int maxPx) {
  if (maxPx <= 8) return text;
  if (M5.Display.textWidth(text.c_str()) <= maxPx) return text;
  String out = text;
  while (out.length() > 1) {
    String trial = out + "...";
    if (M5.Display.textWidth(trial.c_str()) <= maxPx) return trial;
    out.remove(out.length() - 1);
  }
  return "...";
}

inline void fillRandomToken(char* out, size_t outSize, const char* alphabet, size_t len) {
  if (!out || outSize == 0 || !alphabet || !len) return;
  size_t alphabetLen = strlen(alphabet);
  if (alphabetLen == 0) {
    out[0] = '\0';
    return;
  }
  size_t n = (len < outSize - 1) ? len : (outSize - 1);
  for (size_t i = 0; i < n; i++) {
    out[i] = alphabet[esp_random() % alphabetLen];
  }
  out[n] = '\0';
}

const char AP_HTML[] PROGMEM = R"(<!DOCTYPE html><html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BG Display Mini Setup</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:1.5rem}
.card{background:white;border-radius:12px;padding:1.5rem;max-width:400px;margin:0 auto}
h1{font-size:20px;margin-bottom:6px;color:#E24B4A}
p{font-size:13px;color:#666;margin-bottom:1.5rem}
label{display:block;font-size:14px;font-weight:500;margin-bottom:6px;margin-top:16px}
input{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:15px}
button{width:100%;padding:14px;background:#E24B4A;color:white;border:none;
border-radius:8px;font-size:16px;font-weight:600;margin-top:24px;cursor:pointer}
.note{font-size:12px;color:#999;margin-top:8px}.secondary{display:block;text-align:center;margin-top:12px;color:#E24B4A;text-decoration:none;font-size:13px;font-weight:600}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}</style></head>
<body><div class="card">
<h1>BG Display Mini</h1>
<p><strong>Tip:</strong> Scan the QR code on the device screen to join the temporary setup Wi-Fi.</p>
<p>The setup hotspot changes every boot. If your phone offers to save it, that saved profile will not work next time.</p>
<p>Enter your Wi-Fi credentials. All other settings are configured via the web UI after connecting.</p>
<form action="/save" method="POST">
<label>Network (SSID)</label>
<input name="ssid" required placeholder="Wi-Fi network name" autocomplete="off">
<label>Password</label>
<input name="pass" type="password" placeholder="Leave blank for open networks" autocomplete="off">
<button type="submit">Connect</button>
</form>
<p class="note">For open networks, leave password empty. Credentials are stored encrypted on device.</p>
<a class="secondary" href="/logs.txt">Download device logs</a>
</div></body></html>)";

const char SAVED_HTML[] PROGMEM = R"(<!DOCTYPE html><html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:2rem;text-align:center}
.card{background:white;border-radius:12px;padding:2rem;max-width:360px;margin:0 auto}
h1{color:#16a34a;font-size:20px}p{color:#666;margin-top:8px;font-size:14px}</style></head>
<body><div class="card"><h1>Connecting...</h1>
<p>BG Display Mini is connecting to Wi-Fi. Disconnect from this hotspot now.</p>
<p style="margin-top:1rem;font-size:13px;color:#999">Device restarts automatically.</p>
</div></body></html>)";

bool connectWiFi(AppConfig& cfg, Preferences& prefs) {
  if (!strlen(cfg.wifiSSID)) return false;

  sdLogfEx("NET", "WIFI", "connect_attempt ssid:%s hasPass:%d", cfg.wifiSSID, strlen(cfg.wifiPass) > 0 ? 1 : 0);

  int W=M5.Display.width();
  M5.Display.fillScreen(0x0000);
  M5.Display.setTextColor(0xFFFF);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.drawString("Connecting to Wi-Fi...", W/2, 100);
  M5.Display.setTextColor(0x7BEF);
  M5.Display.drawString(cfg.wifiSSID, W/2, 125);

  WiFi.setSleep(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(cfg.wifiSSID, cfg.wifiPass);

  for (int i=0; i<24 && WiFi.status()!=WL_CONNECTED; i++) {
    delay(500);
    // Animate dots
    static char dots[5]="";
    snprintf(dots,5,"%.*s",i%4+1,"....");
    M5.Display.fillRect(W/2-20,155,60,20,0x0000);
    M5.Display.setTextColor(0x4208);
    M5.Display.drawString(dots, W/2, 165);
  }

  if (WiFi.status()==WL_CONNECTED) {
    M5.Display.setTextColor(0x07E0);
    M5.Display.drawString("Connected!", W/2, 165);
    M5.Display.setTextColor(0x7BEF);
    M5.Display.drawString(WiFi.localIP().toString().c_str(), W/2, 190);
    delay(800);
    Serial.printf("WiFi: %s (%d dBm)\n", WiFi.SSID().c_str(), WiFi.RSSI());
    sdLogfEx("NET", "WIFI", "connect_ok ip:%s rssi:%d",
      WiFi.localIP().toString().c_str(), WiFi.RSSI());
    checkCaptivePortal();
    applyPublicDns(cfg);
    logWifiDiagDetail("connect", cfg);
    return true;
  }
  Serial.println("WiFi: failed to connect");
  sdLogfEx("ERR", "WIFI", "connect_failed status:%d ssid_len:%u",
    (int)WiFi.status(), (unsigned)strlen(cfg.wifiSSID));
  return false;
}

void startAPMode(AppConfig& cfg, Preferences& prefs) {
  sdLogEx("NET", "AP", "setup_mode_started");
  char apSsid[32];
  char apPass[13];
  char suffix[7];
  fillRandomToken(suffix, sizeof(suffix), "0123456789ABCDEF", 6);
  snprintf(apSsid, sizeof(apSsid), "BG_Display_Mini_%s", suffix);
  fillRandomToken(apPass, sizeof(apPass), "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", 12);

  IPAddress apIP(192,168,4,1);
  IPAddress subnet(255,255,255,0);
  WiFi.setSleep(false);
  WiFi.mode(WIFI_AP);
  bool apCfgOk = WiFi.softAPConfig(apIP, apIP, subnet);
  bool apOk = WiFi.softAP(apSsid, apPass, 1, false, 4);
  sdLogfEx("NET", "AP", "ap_config_ok:%d ap_start_ok:%d", apCfgOk ? 1 : 0, apOk ? 1 : 0);

  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_AP_STACONNECTED) {
      sdLogfEx("NET", "AP", "sta_connected aid:%u", info.wifi_ap_staconnected.aid);
    } else if (event == ARDUINO_EVENT_WIFI_AP_STADISCONNECTED) {
      sdLogfEx("NET", "AP", "sta_disconnected aid:%u", info.wifi_ap_stadisconnected.aid);
    } else if (event == ARDUINO_EVENT_WIFI_AP_STAIPASSIGNED) {
      IPAddress ip(info.wifi_ap_staipassigned.ip.addr);
      sdLogfEx("NET", "AP", "sta_ip_assigned ip:%s", ip.toString().c_str());
    }
  });

  delay(500); // let DHCP server settle before accepting clients
  dnsServer.setTTL(0); // no caching — iOS must re-query on every request
  dnsServer.start(53,"*",apIP);
  sdLogfEx("NET", "AP", "ap_started ssid:%s ip:%s softap_ip:%s", apSsid, apIP.toString().c_str(), WiFi.softAPIP().toString().c_str());

  // Register all routes and start web server BEFORE drawing the screen.
  // iOS sends captive portal probes within ~1s of connecting; we must be ready.
  // iOS captive portal probe — return 302 redirect (NOT the 'Success' body).
  // 'Success' body tells iOS "internet is working" = no portal popup.
  // A redirect tells iOS "captive portal detected" = show the CNA popup.
  apServer.on("/hotspot-detect.html", HTTP_GET, [](){
    logApRequest("probe_ios");
    apServer.sendHeader("Location", "http://192.168.4.1", true);
    apServer.send(302, "text/plain", "");
  });
  // macOS probe — same logic
  apServer.on("/library/test/success.html", HTTP_GET, [](){
    logApRequest("probe_macos");
    apServer.sendHeader("Location", "http://192.168.4.1", true);
    apServer.send(302, "text/plain", "");
  });
  // Android/Chrome probe — redirect triggers captive portal; 204 would mean "internet OK"
  apServer.on("/generate_204", HTTP_GET, [](){
    logApRequest("probe_android");
    apServer.sendHeader("Location", "http://192.168.4.1", true);
    apServer.send(302, "text/plain", "");
  });
  apServer.on("/connecttest.txt", HTTP_GET, [](){
    logApRequest("probe_windows_connecttest");
    apServer.sendHeader("Location", "http://192.168.4.1", true);
    apServer.send(302, "text/plain", "");
  });
  apServer.on("/ncsi.txt", HTTP_GET, [](){
    logApRequest("probe_windows_ncsi");
    apServer.sendHeader("Location", "http://192.168.4.1", true);
    apServer.send(302, "text/plain", "");
  });
  apServer.on("/", HTTP_GET, [](){ apServer.send_P(200,"text/html",AP_HTML); });
  apServer.on("/logs.txt", HTTP_GET, [](){
    logApRequest("logs_txt");
    sdLogEx("NET", "AP", "logs_export_requested");
    String logs;
    int lineCount = 0;
    if (!sdCollectLogsForUpload(logs, lineCount, 700, 120000)) {
      apServer.send(204, "text/plain", "");
      return;
    }
    apServer.sendHeader("Content-Disposition", "attachment; filename=bgdisplay_logs.txt");
    apServer.send(200, "text/plain", logs);
  });
  apServer.on("/save", HTTP_POST, [&cfg,&prefs](){
    logApRequest("save_post");
    String ssid = apServer.arg("ssid");
    String pass = apServer.arg("pass");
    strlcpy(cfg.wifiSSID, ssid.c_str(), 64);
    strlcpy(cfg.wifiPass, pass.c_str(), 64);
    saveConfig(prefs, cfg);
    sdLogfEx("NET", "AP", "credentials_saved ssid:%s hasPass:%d", cfg.wifiSSID, strlen(cfg.wifiPass) > 0 ? 1 : 0);
    apServer.send_P(200,"text/html",SAVED_HTML);
    delay(2000);
    ESP.restart();
  });
  // Catch-all redirect for everything else
  apServer.onNotFound([](){
    logApRequest("not_found");
    apServer.send_P(200,"text/html",AP_HTML);
  });
  apServer.begin();
  httpsStub.begin();
  sdLogEx("NET", "AP", "web_server_started");

  int W=M5.Display.width(), H=M5.Display.height();
  String wifiQr = buildWifiJoinQr(apSsid, apPass);
  const int cardX = 16;
  const int cardY = 18;
  const int cardW = W - 32;
  const int cardH = H - 36;
  const int headH = 32;

  // Two QR codes side-by-side: left = join WiFi, right = open portal URL
  const int qrSize = 88;
  const int qrLeftX  = cardX + 10;
  const int qrRightX = cardX + cardW - qrSize - 10;
  const int qrY = cardY + headH + 10;

  const uint16_t CLR_PANEL = 0x18C3;
  const uint16_t CLR_BORDER = 0x3186;
  const uint16_t CLR_HEAD = 0x2104;
  const uint16_t CLR_TEXT_MAIN = 0xFFFF;
  const uint16_t CLR_TEXT_DIM = 0x632C;

  M5.Display.fillScreen(0x0000);
  M5.Display.fillRoundRect(cardX, cardY, cardW, cardH, 8, CLR_PANEL);
  M5.Display.drawRoundRect(cardX, cardY, cardW, cardH, 8, CLR_BORDER);
  M5.Display.fillRoundRect(cardX + 1, cardY + 1, cardW - 2, headH, 8, CLR_HEAD);
  M5.Display.drawLine(cardX + 1, cardY + headH, cardX + cardW - 2, cardY + headH, CLR_BORDER);

  M5.Display.setFont(&fonts::FreeSansBold9pt7b);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(CLR_TEXT_MAIN);
  M5.Display.drawString("Wi-Fi Setup", cardX + (cardW / 2), cardY + 17);

  // Left QR: join the setup WiFi network
  M5.Display.fillRoundRect(qrLeftX - 3, qrY - 3, qrSize + 6, qrSize + 6, 4, 0xFFFF);
  M5.Display.qrcode(wifiQr.c_str(), qrLeftX, qrY, qrSize, 0, true);
  M5.Display.setTextDatum(top_center);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.setTextColor(CLR_TEXT_MAIN);
  M5.Display.drawString("1. Scan to join", qrLeftX + (qrSize / 2), qrY + qrSize + 4);

  // Right QR: open the portal URL directly in Safari
  M5.Display.fillRoundRect(qrRightX - 3, qrY - 3, qrSize + 6, qrSize + 6, 4, 0xFFFF);
  M5.Display.qrcode("http://192.168.4.1", qrRightX, qrY, qrSize, 0, true);
  M5.Display.setTextDatum(top_center);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.setTextColor(CLR_TEXT_MAIN);
  M5.Display.drawString("2. Scan to setup", qrRightX + (qrSize / 2), qrY + qrSize + 4);

  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(CLR_TEXT_DIM);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.drawString("Or open: http://192.168.4.1", cardX + (cardW / 2), cardY + cardH - 10);

  unsigned long t=millis();
  unsigned long lastHeartbeat = 0;
  while (millis()-t<600000UL) {
    dnsServer.processNextRequest();
    apServer.handleClient();
    // iOS 26+ probes https://captive.apple.com/hotspot-detect.html via HTTPS.
    // We can't serve TLS, but sending a plain HTTP redirect on port 443 (non-TLS response)
    // is recognized by iOS as an intercepted connection = captive portal detected.
    WiFiClient tlsClient = httpsStub.available();
    if (tlsClient) {
      tlsClient.print("HTTP/1.1 302 Found\r\nLocation: http://192.168.4.1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      tlsClient.flush();
      delay(5);
      tlsClient.stop();
      sdLogEx("NET", "AP", "https_probe_443");
    }
    if (millis() - lastHeartbeat > 10000UL) {
      lastHeartbeat = millis();
      sdLogfEx("NET", "AP", "heartbeat stations:%d", WiFi.softAPgetStationNum());
    }
    M5.update();
    if (checkFactoryResetGesture(cfg, prefs, true)) return;
  }
  apServer.stop(); httpsStub.stop(); dnsServer.stop(); WiFi.mode(WIFI_STA);
}
