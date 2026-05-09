// config.h — AppConfig with encrypted NVS storage
#pragma once
#include <Preferences.h>
#include "crypto.h"

#define FIRMWARE_VERSION "4.1.1"

#ifndef ENABLE_OTA
#define ENABLE_OTA 1
#endif

enum BGSource { SOURCE_NONE, SOURCE_DEXCOM, SOURCE_NIGHTSCOUT };

struct BGReading {
  int value=0; float delta=0; int trend=0;
  time_t timestamp=0; bool stale=false;
  BGSource source=SOURCE_NONE;
};

struct AppConfig {
  // Cloudflare
  char workerUrl[128]="";
  char deviceKey[64]="";

  // WiFi
  char wifiSSID[64]="";
  char wifiPass[64]="";

  // Nightscout (fallback)
  char nightscoutUrl[128]="";
  char nightscoutSecret[64]="";

  // Dexcom (primary)
  char dexcomUser[64]="";
  char dexcomPass[64]="";
  char dexcomRegion[8]="US";

  // Polling
  int  pollIntervalMin=5;
  int  staleDataWarnMin=15;
  int  configPingMin=1;      // lightweight ping interval

  // BG thresholds
  int  urgentLow=55;
  int  low=70;
  int  high=180;
  int  urgentHigh=250;
  char bgAlertStyle[16]="pulse";
  char bgUnits[8]="mg/dL";

  // Display
  bool showLastReadingTime=true;
  bool showTrendArrow=true;
  int  brightness=75;
  int  autoDimMin=5;
  int  dimToPct=15;
  bool dndEnabled=false;
  char dndFrom[8]="23:00";
  char dndTo[8]="06:00";
  bool dndUseSchedule=true;
  char dndFromByDay[7][8]={{"23:00"},{"23:00"},{"23:00"},{"23:00"},{"23:00"},{"23:00"},{"23:00"}};
  char dndToByDay[7][8]={{"06:00"},{"06:00"},{"06:00"},{"06:00"},{"06:00"},{"06:00"},{"06:00"}};
  bool clock24hr=false;
  char timezone[32]="US/Central";

  // Last known config version from Worker
  int  lastConfigVersion=0;

  // Glooko / Omnipod pump proxy (credentials are worker-side, device uses /api/omnipod)
  bool glookoEnabled=false;
  int  glookoPollMin=30;
};

inline void sanitizeConfig(AppConfig& c) {
  if (c.pollIntervalMin < 1) c.pollIntervalMin = 1;
  if (c.staleDataWarnMin < 1) c.staleDataWarnMin = 1;
  if (c.configPingMin < 1) c.configPingMin = 1;
  if (c.brightness < 0) c.brightness = 0;
  if (c.brightness > 100) c.brightness = 100;
  if (c.dimToPct < 15) c.dimToPct = 15;
  if (c.dimToPct > 100) c.dimToPct = 100;
  if (c.autoDimMin < 5) c.autoDimMin = 5;

  if (c.urgentLow < 40) c.urgentLow = 40;
  if (c.low <= c.urgentLow) c.low = c.urgentLow + 1;
  if (c.high <= c.low) c.high = c.low + 1;
  if (c.urgentHigh <= c.high) c.urgentHigh = c.high + 1;

  if (c.glookoPollMin < 30)  c.glookoPollMin = 30;
  if (c.glookoPollMin > 240) c.glookoPollMin = 240;
}

// Save config — sensitive fields encrypted, rest plain
inline void saveConfig(Preferences& p, const AppConfig& c) {
  // Plain fields
  p.putString("workerUrl",  c.workerUrl);
  p.putString("wifiSSID",   c.wifiSSID);
  p.putString("dexRegion",  c.dexcomRegion);
  p.putString("timezone",   c.timezone);
  p.putString("bgUnits",    c.bgUnits);
  p.putString("bgAlert",    c.bgAlertStyle);
  p.putString("dndFrom",    c.dndFrom);
  p.putString("dndTo",      c.dndTo);
  p.putBool("dndPerDay",    c.dndUseSchedule);
  for (int i = 0; i < 7; i++) {
    char kf[8];
    char kt[8];
    snprintf(kf, sizeof(kf), "dndF%d", i);
    snprintf(kt, sizeof(kt), "dndT%d", i);
    p.putString(kf, c.dndFromByDay[i]);
    p.putString(kt, c.dndToByDay[i]);
  }
  p.putInt("pollMin",       c.pollIntervalMin);
  p.putInt("staleMin",      c.staleDataWarnMin);
  p.putInt("pingMin",       c.configPingMin);
  p.putInt("urgLow",        c.urgentLow);
  p.putInt("low",           c.low);
  p.putInt("high",          c.high);
  p.putInt("urgHigh",       c.urgentHigh);
  p.putBool("showTime",     c.showLastReadingTime);
  p.putBool("showArrow",    c.showTrendArrow);
  p.putBool("clock24",      c.clock24hr);
  p.putBool("dndEnabled",   c.dndEnabled);
  p.putInt("brightness",    c.brightness);
  p.putInt("autoDim",       c.autoDimMin);
  p.putInt("dimTo",         c.dimToPct);
  p.putInt("cfgVersion",    c.lastConfigVersion);
  p.putBool("glookoEn",     c.glookoEnabled);
  p.putInt("glookoMin",     c.glookoPollMin);

  // Encrypted sensitive fields
  nvsPutEncrypted(p, "deviceKey",  c.deviceKey);
  nvsPutEncrypted(p, "wifiPass",   c.wifiPass);
  nvsPutEncrypted(p, "nsSecret",   c.nightscoutSecret);
  nvsPutEncrypted(p, "dexUser",    c.dexcomUser);
  nvsPutEncrypted(p, "dexPass",    c.dexcomPass);
  p.putString("nsUrl", c.nightscoutUrl);
}

inline void loadConfig(Preferences& p, AppConfig& c) {
  strlcpy(c.workerUrl,    p.getString("workerUrl","").c_str(),128);
  strlcpy(c.wifiSSID,     p.getString("wifiSSID","").c_str(),64);
  strlcpy(c.dexcomRegion, p.getString("dexRegion","US").c_str(),8);
  strlcpy(c.timezone,     p.getString("timezone","US/Central").c_str(),32);
  strlcpy(c.bgUnits,      p.getString("bgUnits","mg/dL").c_str(),8);
  strlcpy(c.bgAlertStyle, p.getString("bgAlert","pulse").c_str(),16);
  strlcpy(c.dndFrom,      p.getString("dndFrom","23:00").c_str(),8);
  strlcpy(c.dndTo,        p.getString("dndTo","06:00").c_str(),8);
  c.dndUseSchedule     = p.getBool("dndPerDay", true);
  for (int i = 0; i < 7; i++) {
    char kf[8];
    char kt[8];
    snprintf(kf, sizeof(kf), "dndF%d", i);
    snprintf(kt, sizeof(kt), "dndT%d", i);
    String from = p.getString(kf, c.dndFrom);
    String to = p.getString(kt, c.dndTo);
    strlcpy(c.dndFromByDay[i], from.c_str(), 8);
    strlcpy(c.dndToByDay[i], to.c_str(), 8);
  }
  c.pollIntervalMin    = p.getInt("pollMin",5);
  c.staleDataWarnMin   = p.getInt("staleMin",15);
  c.configPingMin      = p.getInt("pingMin",1);
  c.urgentLow          = p.getInt("urgLow",55);
  c.low                = p.getInt("low",70);
  c.high               = p.getInt("high",180);
  c.urgentHigh         = p.getInt("urgHigh",250);
  c.showLastReadingTime= p.getBool("showTime",true);
  c.showTrendArrow     = p.getBool("showArrow",true);
  c.clock24hr          = p.getBool("clock24",false);
  c.dndEnabled         = p.getBool("dndEnabled",false);
  c.brightness         = p.getInt("brightness",75);
  c.autoDimMin         = p.getInt("autoDim",10);
  c.dimToPct           = p.getInt("dimTo",10);
  c.lastConfigVersion  = p.getInt("cfgVersion",0);
  c.glookoEnabled      = p.getBool("glookoEn", false);
  c.glookoPollMin      = p.getInt("glookoMin", 30);

  // Decrypt sensitive fields
  String dk = nvsGetEncrypted(p, "deviceKey");
  strlcpy(c.deviceKey,       dk.c_str(), 64);
  String wp = nvsGetEncrypted(p, "wifiPass");
  strlcpy(c.wifiPass,        wp.c_str(), 64);
  strlcpy(c.nightscoutUrl,   p.getString("nsUrl","").c_str(), 128);
  String ns = nvsGetEncrypted(p, "nsSecret");
  strlcpy(c.nightscoutSecret,ns.c_str(), 64);
  String du = nvsGetEncrypted(p, "dexUser");
  strlcpy(c.dexcomUser,      du.c_str(), 64);
  String dp = nvsGetEncrypted(p, "dexPass");
  strlcpy(c.dexcomPass,      dp.c_str(), 64);

  sanitizeConfig(c);
}
