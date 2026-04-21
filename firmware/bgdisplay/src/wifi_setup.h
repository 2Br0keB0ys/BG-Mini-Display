// wifi_setup.h — WiFi connection + AP captive portal (WiFi only)
#pragma once
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <M5Unified.h>
#include "config.h"
#include "crypto.h"
#include "sd_logger.h"

WebServer apServer(80);
DNSServer dnsServer;

const char AP_HTML[] PROGMEM = R"(<!DOCTYPE html><html>
<head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BGDisplay Setup</title>
<style>*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:1.5rem}
.card{background:white;border-radius:12px;padding:1.5rem;max-width:400px;margin:0 auto}
h1{font-size:20px;margin-bottom:6px;color:#E24B4A}
p{font-size:13px;color:#666;margin-bottom:1.5rem}
label{display:block;font-size:14px;font-weight:500;margin-bottom:6px;margin-top:16px}
input{width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:15px}
button{width:100%;padding:14px;background:#E24B4A;color:white;border:none;
border-radius:8px;font-size:16px;font-weight:600;margin-top:24px;cursor:pointer}
.note{font-size:12px;color:#999;margin-top:8px}</style></head>
<body><div class="card">
<h1>BGDisplay</h1>
<p>Enter your Wi-Fi credentials. All other settings are configured via the web UI after connecting.</p>
<form action="/save" method="POST">
<label>Network (SSID)</label>
<input name="ssid" required placeholder="Wi-Fi network name" autocomplete="off">
<label>Password</label>
<input name="pass" type="password" placeholder="Leave blank for open networks" autocomplete="off">
<button type="submit">Connect</button>
</form>
<p class="note">For open networks, leave password empty. Credentials are stored encrypted on device.</p>
</div></body></html>)";

const char SAVED_HTML[] PROGMEM = R"(<!DOCTYPE html><html>
<head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Saved</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f5;padding:2rem;text-align:center}
.card{background:white;border-radius:12px;padding:2rem;max-width:360px;margin:0 auto}
h1{color:#16a34a;font-size:20px}p{color:#666;margin-top:8px;font-size:14px}</style></head>
<body><div class="card"><h1>Connecting...</h1>
<p>BGDisplay is connecting to Wi-Fi. Disconnect from this hotspot now.</p>
<p style="margin-top:1rem;font-size:13px;color:#999">Device restarts automatically.</p>
</div></body></html>)";

bool connectWiFi(AppConfig& cfg, Preferences& prefs) {
  if (!strlen(cfg.wifiSSID)) return false;

  sdLog("NET", "WiFi connect attempt");

  int W=M5.Display.width();
  M5.Display.fillScreen(0x0000);
  M5.Display.setTextColor(0xFFFF);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.drawString("Connecting to Wi-Fi...", W/2, 100);
  M5.Display.setTextColor(0x7BEF);
  M5.Display.drawString(cfg.wifiSSID, W/2, 125);

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
    return true;
  }
  Serial.println("WiFi: failed to connect");
  sdLogError("WiFi connection failed");
  return false;
}

void startAPMode(AppConfig& cfg, Preferences& prefs) {
  sdLog("NET", "AP setup mode started");
  uint64_t chipId = ESP.getEfuseMac();
  char apSsid[32];
  char apPass[20];
  snprintf(apSsid, sizeof(apSsid), "BGDisplay-Setup-%04X", (unsigned)(chipId & 0xFFFF));
  snprintf(apPass, sizeof(apPass), "bgd%06X%02X", (unsigned)((chipId >> 8) & 0xFFFFFF), (unsigned)(esp_random() & 0xFF));

  WiFi.mode(WIFI_AP);
  WiFi.softAP(apSsid, apPass);
  IPAddress apIP(192,168,4,1);
  WiFi.softAPConfig(apIP,apIP,IPAddress(255,255,255,0));
  dnsServer.start(53,"*",apIP);

  int W=M5.Display.width(), H=M5.Display.height();
  M5.Display.fillScreen(0x0000);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextColor(0xFFFF);
  M5.Display.drawString("Wi-Fi Setup", W/2, 25);
  M5.Display.drawLine(10,40,W-10,40,0x4208);
  M5.Display.setTextColor(0x7BEF);
  M5.Display.drawString("Connect your phone to:", W/2, 60);
  M5.Display.setTextColor(0x07E0);
  M5.Display.setFont(&fonts::FreeSansBold9pt7b);
  M5.Display.drawString(apSsid, W/2, 85);
  M5.Display.setFont(&fonts::FreeSans9pt7b);
  M5.Display.setTextColor(0x7BEF);
  String passLine = String("Password: ") + apPass;
  M5.Display.drawString(passLine.c_str(), W/2, 108);
  M5.Display.drawLine(10,125,W-10,125,0x4208);
  M5.Display.drawString("Then open browser:", W/2, 145);
  M5.Display.setTextColor(0xFFFF);
  M5.Display.drawString("http://192.168.4.1", W/2, 168);
  M5.Display.setTextColor(0x4208);
  M5.Display.drawString("Tap to cancel", W/2, H-12);

  apServer.on("/", HTTP_GET, [](){ apServer.send_P(200,"text/html",AP_HTML); });
  apServer.onNotFound([](){
    apServer.sendHeader("Location","http://192.168.4.1",true);
    apServer.send(302,"text/plain","");
  });
  apServer.on("/save", HTTP_POST, [&cfg,&prefs](){
    String ssid = apServer.arg("ssid");
    String pass = apServer.arg("pass");
    strlcpy(cfg.wifiSSID, ssid.c_str(), 64);
    strlcpy(cfg.wifiPass, pass.c_str(), 64);
    saveConfig(prefs, cfg);
    sdLog("NET", "WiFi credentials saved");
    apServer.send_P(200,"text/html",SAVED_HTML);
    delay(2000);
    ESP.restart();
  });
  apServer.begin();

  unsigned long t=millis();
  while (millis()-t<600000UL) {
    dnsServer.processNextRequest();
    apServer.handleClient();
    M5.update();
    if (M5.Touch.getCount() && M5.Touch.getDetail().wasPressed()) {
      delay(200); break;
    }
  }
  apServer.stop(); dnsServer.stop(); WiFi.mode(WIFI_STA);
}
