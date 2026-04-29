// display.h — Double-buffered rendering via M5Canvas sprite
// All drawing goes to off-screen buffer, pushed atomically — zero flicker

#pragma once
#include <M5Unified.h>
#include <HTTPClient.h>
#include <math.h>
#include "config.h"
#include "weather.h"
#include <time.h>

// ─── Colors ───────────────────────────────────────────────────────────────────
#define CLR_BG      0x0000
#define CLR_TEXT    0xFFFF
#define CLR_MUTED   0x7BEF
#define CLR_DIM     0x2104
#define CLR_GREEN   0x07E0
#define CLR_YELLOW  0xFFE0
#define CLR_ORANGE  0xFD20
#define CLR_RED     0xF800
#define CLR_SEP     0x2945

// ─── Display State ────────────────────────────────────────────────────────────
struct DisplayState {
  unsigned long lastTouch  = 0;
  unsigned long dndWakeUntilMs = 0;
  unsigned long lastPulse  = 0;
  bool          dimmed     = false;
  bool          showKeyError = false;
  // Dirty tracking — only push new frame when something changed
  int           lastBGValue  = -1;
  int           lastTrend    = -1;
  bool          lastStale    = false;
  bool          lastKeyErr   = false;
  char          lastTimeStr[12] = "";
  int           lastRSSI     = -999;
  bool          pulseOn      = false;
  bool          initialized  = false;
  unsigned long lastAnimTick = 0;
  char          bannerText[40] = "";
  uint16_t      bannerColor = CLR_MUTED;
  unsigned long bannerUntilMs = 0;
  int           bgHist[24] = {0};
  int           bgHistCount = 0;
  int           bgHistHead = 0;
  time_t        lastHistTs = 0;
};

// Off-screen canvas — the secret to zero flicker
static M5Canvas canvas(&M5.Display);

// ─── Helpers ─────────────────────────────────────────────────────────────────

uint16_t bgColor(int v, int uLow, int low, int high, int uHigh) {
  if (v <= uLow || v <= low) return CLR_RED;
  if (v >= uHigh)             return CLR_ORANGE;
  if (v >= high)              return CLR_YELLOW;
  return CLR_GREEN;
}

const char* trendStr(int t) {
  switch(t) {
    case 2: return "^^"; case 3: return "^"; case 4: return "/^";
    case 5: return "->"; case 6: return "v/"; case 7: return "v";
    case 8: return "vv"; default: return "";
  }
}

void drawArrowPrimitive(int cx, int cy, int dx, int dy, uint16_t color) {
  int x0 = cx - dx;
  int y0 = cy - dy;
  int x1 = cx + dx;
  int y1 = cy + dy;
  // Slightly thicker shaft for readability at arm's length.
  canvas.drawLine(x0, y0, x1, y1, color);
  if (abs(dx) >= abs(dy)) {
    canvas.drawLine(x0, y0 - 1, x1, y1 - 1, color);
    canvas.drawLine(x0, y0 + 1, x1, y1 + 1, color);
  } else {
    canvas.drawLine(x0 - 1, y0, x1 - 1, y1, color);
    canvas.drawLine(x0 + 1, y0, x1 + 1, y1, color);
  }

  // Simple arrowhead computed from perpendicular vector.
  int hx = dx / 2;
  int hy = dy / 2;
  int px = -dy / 2;
  int py = dx / 2;
  canvas.fillTriangle(
    x1, y1,
    x1 - hx + px, y1 - hy + py,
    x1 - hx - px, y1 - hy - py,
    color
  );
}

void drawTrendArrow(int x, int y, int trend, uint16_t color) {
  switch (trend) {
    case 2: // DoubleUp
      drawArrowPrimitive(x, y + 4, 0, -9, color);
      drawArrowPrimitive(x + 9, y + 4, 0, -9, color);
      break;
    case 3: // SingleUp
      drawArrowPrimitive(x + 4, y + 4, 0, -9, color);
      break;
    case 4: // FortyFiveUp
      drawArrowPrimitive(x + 4, y + 4, 7, -7, color);
      break;
    case 5: // Flat
      drawArrowPrimitive(x + 4, y + 4, 9, 0, color);
      break;
    case 6: // FortyFiveDown
      drawArrowPrimitive(x + 4, y + 4, 7, 7, color);
      break;
    case 7: // SingleDown
      drawArrowPrimitive(x + 4, y + 4, 0, 9, color);
      break;
    case 8: // DoubleDown
      drawArrowPrimitive(x, y + 4, 0, 9, color);
      drawArrowPrimitive(x + 9, y + 4, 0, 9, color);
      break;
    default:
      break;
  }
}

bool isDND(const char* from, const char* to) {
  struct tm t; time_t now = time(nullptr); localtime_r(&now, &t);
  int cur = t.tm_hour*60 + t.tm_min;
  int fH=0,fM=0,tH=0,tM=0;
  sscanf(from, "%d:%d", &fH, &fM);
  sscanf(to,   "%d:%d", &tH, &tM);
  int f = fH*60+fM, e = tH*60+tM;
  return (f > e) ? (cur >= f || cur < e) : (cur >= f && cur < e);
}

void getTodayDndWindow(const AppConfig& cfg, char* from, size_t fromSz, char* to, size_t toSz) {
  strlcpy(from, cfg.dndFrom, fromSz);
  strlcpy(to, cfg.dndTo, toSz);
  if (!cfg.dndUseSchedule) return;

  time_t now = time(nullptr);
  struct tm t;
  localtime_r(&now, &t);
  int idx = t.tm_wday;
  if (idx < 0 || idx > 6) return;

  strlcpy(from, cfg.dndFromByDay[idx], fromSz);
  strlcpy(to, cfg.dndToByDay[idx], toSz);
}

int rssiToBars(int rssi) {
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  if (rssi >= -85) return 1;
  return 0;
}

void drawBatteryMeterRight(int rightX, int y, int pct) {
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;

  char p[8];
  snprintf(p, sizeof(p), "%d%%", pct);

  // Match the status time typography and keep the text right-aligned.
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(middle_right);
  if (pct <= 20) canvas.setTextColor(CLR_RED);
  else if (pct <= 40) canvas.setTextColor(CLR_YELLOW);
  else canvas.setTextColor(CLR_TEXT);
  // Align with the top-center clock baseline.
  canvas.drawString(p, rightX, y + 10);
}

// Draw WiFi bars onto canvas
void drawWifiBars(int x, int y, int bars) {
  for (int i = 0; i < 4; i++) {
    int h  = (i + 1) * 3;
    int bx = x + i * 5;
    int by = y + 12 - h;
    canvas.fillRect(bx, by, 4, h, (i < bars) ? CLR_MUTED : CLR_DIM);
  }
}

void getTimeStr(char* buf, size_t sz, bool hr24) {
  struct tm t; time_t now = time(nullptr); localtime_r(&now, &t);
  if (hr24) snprintf(buf, sz, "%02d:%02d", t.tm_hour, t.tm_min);
  else {
    int h = t.tm_hour % 12; if (!h) h = 12;
    snprintf(buf, sz, "%d:%02d%s", h, t.tm_min, t.tm_hour < 12 ? "am" : "pm");
  }
}

void getDateStr(char* buf, size_t sz) {
  struct tm t;
  time_t now = time(nullptr);
  localtime_r(&now, &t);
  static const char* kDays[] = {"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"};
  snprintf(buf, sz, "%s %d/%d", kDays[t.tm_wday], t.tm_mon + 1, t.tm_mday);
}

void setDisplayBanner(DisplayState& state, const char* msg, uint16_t color, unsigned long durationMs = 2200UL) {
  if (!msg) return;
  strlcpy(state.bannerText, msg, sizeof(state.bannerText));
  state.bannerColor = color;
  state.bannerUntilMs = millis() + durationMs;
}

void pushBgHistory(DisplayState& state, const BGReading& reading) {
  if (reading.value <= 0 || reading.timestamp <= 0) return;

  // Keep history to roughly one point per 5 minutes.
  if (state.lastHistTs > 0 && (reading.timestamp - state.lastHistTs) < 240) return;

  state.bgHist[state.bgHistHead] = reading.value;
  state.bgHistHead = (state.bgHistHead + 1) % 24;
  if (state.bgHistCount < 24) state.bgHistCount++;
  state.lastHistTs = reading.timestamp;
}

void drawBgSparkline(int cx, int y, DisplayState& state, uint16_t color) {
  if (state.bgHistCount < 3) return;

  int minV = 10000;
  int maxV = -10000;
  for (int i = 0; i < state.bgHistCount; i++) {
    int idx = (state.bgHistHead - state.bgHistCount + i + 24) % 24;
    int v = state.bgHist[idx];
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  if (maxV <= minV) maxV = minV + 1;

  const int W = 118;
  const int H = 18;
  int x0 = cx - (W / 2);
  int y0 = y - (H / 2);

  canvas.drawRect(x0 - 2, y0 - 2, W + 4, H + 4, CLR_DIM);

  int px = x0;
  int py = y0 + H - ((state.bgHist[(state.bgHistHead - state.bgHistCount + 24) % 24] - minV) * (H - 1) / (maxV - minV));
  for (int i = 1; i < state.bgHistCount; i++) {
    int idx = (state.bgHistHead - state.bgHistCount + i + 24) % 24;
    int v = state.bgHist[idx];
    int x = x0 + (i * (W - 1)) / (state.bgHistCount - 1);
    int yv = y0 + H - ((v - minV) * (H - 1) / (maxV - minV));
    canvas.drawLine(px, py, x, yv, color);
    px = x;
    py = yv;
  }
}

String timeSince(time_t ts) {
  static char buf[24];
  int s = (int)(time(nullptr) - ts);
  if (s < 0)    return "just now";
  if (s < 60)   { snprintf(buf, 24, "%ds ago", s);       return buf; }
  if (s < 3600) { snprintf(buf, 24, "%d min ago", s/60); return buf; }
  snprintf(buf, 24, "%dh ago", s/3600);
  return buf;
}

static bool weatherIsThunder(int code) {
  return code == 95 || code == 96 || code == 99;
}

static bool weatherIsRain(int code) {
  if (weatherIsThunder(code)) return true;
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
}

static bool weatherIsSunny(int code) {
  return code == 0 || code == 1;
}

static float tempCToDisplay(const AppConfig& cfg, float c) {
  if (strcmp(cfg.weatherUnits, "C") == 0 || strcmp(cfg.weatherUnits, "c") == 0) return c;
  return (c * 9.0f / 5.0f) + 32.0f;
}

static const char* tempUnitLabel(const AppConfig& cfg) {
  return (strcmp(cfg.weatherUnits, "C") == 0 || strcmp(cfg.weatherUnits, "c") == 0) ? "C" : "F";
}

void drawWeatherPanelBackground(int x, int y, int w, int h, const WeatherStatus& wx, bool flash) {
  uint16_t top = 0x2104;
  uint16_t bottom = 0x1082;
  if (weatherIsSunny(wx.weatherCode)) {
    top = 0x4B9F;
    bottom = 0x2A7A;
  } else if (weatherIsThunder(wx.weatherCode)) {
    top = flash ? 0xA514 : 0x31A6;
    bottom = 0x18C3;
  } else if (weatherIsRain(wx.weatherCode)) {
    top = 0x2A6D;
    bottom = 0x18A6;
  }

  for (int row = 0; row < h; row++) {
    uint16_t c = (row < (h / 2)) ? top : bottom;
    canvas.drawFastHLine(x, y + row, w, c);
  }

  canvas.drawRoundRect(x, y, w, h, 8, CLR_SEP);
}

void drawCloudIcon(int x, int y, uint16_t color) {
  canvas.fillCircle(x + 8, y + 12, 10, color);
  canvas.fillCircle(x + 20, y + 10, 12, color);
  canvas.fillCircle(x + 34, y + 14, 9, color);
  canvas.fillRoundRect(x + 6, y + 14, 32, 12, 6, color);
}

void drawWeatherIcon(int x, int y, const WeatherStatus& wx, unsigned long animFrame) {
  if (weatherIsSunny(wx.weatherCode)) {
    canvas.fillCircle(x + 20, y + 16, 11, CLR_YELLOW);
    for (int i = 0; i < 8; i++) {
      int dx = (i % 2 == 0) ? 14 : 12;
      int dy = (i % 2 == 0) ? 0 : 9;
      if (i == 0) canvas.drawLine(x + 20 + dx, y + 16 + dy, x + 20 + dx + 4, y + 16 + dy, CLR_YELLOW);
      if (i == 1) canvas.drawLine(x + 20 + dy, y + 16 + dx, x + 20 + dy, y + 16 + dx + 4, CLR_YELLOW);
      if (i == 2) canvas.drawLine(x + 20 - dx, y + 16 + dy, x + 20 - dx - 4, y + 16 + dy, CLR_YELLOW);
      if (i == 3) canvas.drawLine(x + 20 + dy, y + 16 - dx, x + 20 + dy, y + 16 - dx - 4, CLR_YELLOW);
      if (i == 4) canvas.drawLine(x + 20 + 10, y + 16 + 10, x + 20 + 14, y + 16 + 14, CLR_YELLOW);
      if (i == 5) canvas.drawLine(x + 20 - 10, y + 16 + 10, x + 20 - 14, y + 16 + 14, CLR_YELLOW);
      if (i == 6) canvas.drawLine(x + 20 - 10, y + 16 - 10, x + 20 - 14, y + 16 - 14, CLR_YELLOW);
      if (i == 7) canvas.drawLine(x + 20 + 10, y + 16 - 10, x + 20 + 14, y + 16 - 14, CLR_YELLOW);
    }
    return;
  }

  drawCloudIcon(x, y, 0xC638);

  if (weatherIsRain(wx.weatherCode)) {
    int phase = (int)(animFrame % 3);
    for (int i = 0; i < 5; i++) {
      int rx = x + 10 + i * 6;
      int ry = y + 28 + ((i + phase) % 3);
      canvas.drawLine(rx, ry, rx - 2, ry + 7, 0x9DFF);
    }
  }

  if (weatherIsThunder(wx.weatherCode) && (animFrame % 2 == 0)) {
    canvas.fillTriangle(x + 20, y + 24, x + 15, y + 38, x + 24, y + 38, CLR_YELLOW);
    canvas.fillTriangle(x + 22, y + 36, x + 18, y + 48, x + 27, y + 48, CLR_YELLOW);
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

void initDisplay(AppConfig& cfg) {
  int W = M5.Display.width(), H = M5.Display.height();
  canvas.createSprite(W, H);   // allocate off-screen buffer once
  canvas.setTextDatum(middle_center);
  M5.Display.fillScreen(CLR_BG);
  M5.Display.setBrightness(map(cfg.brightness, 0, 100, 0, 255));
}

void showBootScreen() {
  int W = M5.Display.width(), H = M5.Display.height();
  canvas.fillScreen(CLR_BG);

  // Brand card
  const int cardW = 260;
  const int cardH = 136;
  const int cardX = (W - cardW) / 2;
  const int cardY = (H - cardH) / 2;
  canvas.fillRoundRect(cardX, cardY, cardW, cardH, 14, 0x18C3);
  canvas.drawRoundRect(cardX, cardY, cardW, cardH, 14, CLR_SEP);

  // Simple drop-shaped logo with BG initials.
  const int logoCx = W / 2;
  const int logoCy = cardY + 30;
  canvas.fillCircle(logoCx, logoCy + 6, 16, CLR_RED);
  canvas.fillTriangle(logoCx, logoCy - 15, logoCx - 14, logoCy + 2, logoCx + 14, logoCy + 2, CLR_RED);

  canvas.setTextDatum(middle_center);
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(CLR_TEXT);
  canvas.drawString("BG", logoCx, logoCy + 8);

  canvas.setTextDatum(middle_center);
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(CLR_TEXT);
  canvas.drawString("BG MiniView", W/2, cardY + 74);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(CLR_MUTED);
  canvas.drawString("Dexcom primary  Nightscout fallback", W/2, cardY + 96);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(CLR_YELLOW);
  canvas.drawString("v" FIRMWARE_VERSION, W/2, cardY + 118);
  canvas.pushSprite(0, 0);
  delay(1200);
  return;
}

// ─── Core Draw (to off-screen canvas, then push atomically) ──────────────────

void drawFrame(AppConfig& cfg, BGReading& reading, DisplayState& state) {
  int W = M5.Display.width(), H = M5.Display.height();
  extern WeatherStatus gWeatherStatus;
  const int leftPanelX = 8;
  const int leftPanelW = 132;
  const int rightCenterX = 226;

  // Fill background — happens off-screen, no visible flash
  canvas.fillScreen(CLR_BG);
  canvas.setTextDatum(middle_center);

  // ── Status bar ──────────────────────────────────────────────────────────────

  // Source label (top left)
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(CLR_MUTED);
  canvas.setTextDatum(middle_left);
  const char* sourceLabel = "BG";
  if (reading.source == SOURCE_NIGHTSCOUT) sourceLabel = "Nightscout";
  else if (reading.source == SOURCE_DEXCOM) sourceLabel = "Dexcom";
  canvas.drawString(sourceLabel, 8, 14);

  // Time (top center)
  char timeStr[12]; getTimeStr(timeStr, sizeof(timeStr), cfg.clock24hr);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(CLR_TEXT);
  canvas.drawString(timeStr, W/2, 14);

  // Battery meter (top right)
  int batteryPct = M5.Power.getBatteryLevel();
  if (batteryPct >= 0) {
    drawBatteryMeterRight(W - 6, 4, batteryPct);
  }

  // Status row separator (mirrors bottom bar style)
  canvas.drawLine(12, 28, W - 12, 28, CLR_SEP);

  if (state.bannerText[0] && millis() < state.bannerUntilMs) {
    canvas.setTextDatum(middle_center);
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextColor(state.bannerColor);
    canvas.drawString(state.bannerText, W / 2, 42);
  }

  // Key error overlay
  if (state.showKeyError) {
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(CLR_RED);
    canvas.drawString("KEY ERROR", W/2, 14);
  }

  // Split the main area into a left weather panel and right BG panel.
  canvas.drawLine(leftPanelX + leftPanelW + 4, 34, leftPanelX + leftPanelW + 4, H - 46, CLR_SEP);

  // ── BG Number (right panel) ─────────────────────────────────────────────────

  uint16_t color = CLR_MUTED;
  if (reading.value > 0) {
    color = bgColor(reading.value, cfg.urgentLow, cfg.low, cfg.high, cfg.urgentHigh);
    // Flash for urgent (toggle already handled by dirty tracker)
    bool urgent = (reading.value <= cfg.urgentLow || reading.value >= cfg.urgentHigh);
    if (urgent && strcmp(cfg.bgAlertStyle, "flash") == 0 && state.pulseOn) {
      color = CLR_BG;
    }
  }

  String bgStr = (reading.value > 0) ? String(reading.value) : "---";

  // Vertical center between y=28 and y=H-50
  int centerY = 28 + (H - 78) / 2;

  // Use anti-aliased FreeSans for smoother large BG text.
  canvas.setFont(&fonts::FreeSansBold24pt7b);
  canvas.setTextColor(color);

  bool hasTrend = (reading.value > 0 && cfg.showTrendArrow && reading.trend > 0);
  if (hasTrend) {
    canvas.setTextDatum(middle_center);
    canvas.drawString(bgStr.c_str(), rightCenterX - 22, centerY);
    drawTrendArrow(rightCenterX + 38, centerY - 4, reading.trend, color);
  } else {
    canvas.setTextDatum(middle_center);
    canvas.drawString(bgStr.c_str(), rightCenterX, centerY);
  }

  // Last reading time / stale
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(middle_center);
  bool isStale = reading.timestamp > 0 &&
    (time(nullptr) - reading.timestamp) > (cfg.staleDataWarnMin * 60);
  if (isStale || reading.stale) {
    canvas.setTextColor(CLR_ORANGE);
    canvas.drawString("STALE DATA", rightCenterX, centerY + 30);
  } else if (cfg.showLastReadingTime && reading.timestamp > 0) {
    canvas.setTextColor(CLR_MUTED);
    canvas.drawString(timeSince(reading.timestamp).c_str(), rightCenterX, centerY + 30);
  }

  // Mini trend history for quick context beyond the single trend arrow.
  drawBgSparkline(rightCenterX, centerY + 50, state, color);

  // ── Left panel: weather status ─────────────────────────────────────────────
  unsigned long animFrame = millis() / 450UL;
  bool flash = weatherIsThunder(gWeatherStatus.weatherCode) && ((animFrame % 2UL) == 0UL);
  drawWeatherPanelBackground(leftPanelX, 36, leftPanelW, H - 84, gWeatherStatus, flash);

  canvas.setTextDatum(middle_left);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(CLR_TEXT);
  canvas.drawString("WEATHER", leftPanelX + 6, 46);

  if (gWeatherStatus.valid) {
    drawWeatherIcon(leftPanelX + 44, 56, gWeatherStatus, animFrame);

    char line[40];
    float outside = tempCToDisplay(cfg, gWeatherStatus.outsideTempC);
    snprintf(line, sizeof(line), "Out: %.0f%s", outside, tempUnitLabel(cfg));
    canvas.drawString(line, leftPanelX + 6, 106);

    if (gWeatherStatus.hasInsideTemp && !isnan(gWeatherStatus.insideTempC)) {
      float inside = tempCToDisplay(cfg, gWeatherStatus.insideTempC);
      snprintf(line, sizeof(line), "In:  %.0f%s", inside, tempUnitLabel(cfg));
    } else {
      snprintf(line, sizeof(line), "In:  --");
    }
    canvas.drawString(line, leftPanelX + 6, 126);

    if (strlen(gWeatherStatus.description) > 0) {
      canvas.setTextColor(CLR_MUTED);
      canvas.drawString(gWeatherStatus.description, leftPanelX + 6, 146);
    }
  } else {
    canvas.setTextColor(CLR_DIM);
    canvas.drawString("No weather", leftPanelX + 6, 102);
    canvas.drawString("data", leftPanelX + 6, 122);
  }

  // ── Bottom bar ───────────────────────────────────────────────────────────────

  // Separator
  canvas.drawLine(12, H - 42, W - 12, H - 42, CLR_SEP);

  canvas.setFont(&fonts::FreeSans9pt7b);

  // SSID (bottom left)
  canvas.setTextDatum(middle_left);
  canvas.setTextColor(CLR_MUTED);
  String ssid = (WiFi.status() == WL_CONNECTED) ? WiFi.SSID() : "No WiFi";
  if ((int)ssid.length() > 16) ssid = ssid.substring(0, 14) + "..";
  canvas.drawString(ssid.c_str(), 8, H - 22);

  // Date (bottom right)
  char dateStr[24];
  getDateStr(dateStr, sizeof(dateStr));
  canvas.setTextDatum(middle_right);
  canvas.drawString(dateStr, W - 8, H - 22);

  // ── Push frame to display atomically ─────────────────────────────────────────
  // This single DMA push is what makes it flicker-free
  canvas.pushSprite(0, 0);
}

// ─── Update (called from loop) ────────────────────────────────────────────────

void updateDisplay(AppConfig& cfg, BGReading& reading, DisplayState& state) {
  unsigned long now = millis();
  pushBgHistory(state, reading);

  int normalPct = cfg.brightness;
  if (normalPct < 5) normalPct = 5;
  if (normalPct > 100) normalPct = 100;

  // DND — screen off
  char dndFrom[8];
  char dndTo[8];
  getTodayDndWindow(cfg, dndFrom, sizeof(dndFrom), dndTo, sizeof(dndTo));
  bool dndNow = cfg.dndEnabled && isDND(dndFrom, dndTo);
  if (dndNow) {
    // Never hard-blackout in DND: keep data visible with low brightness.
    // This avoids "device looks dead" reports while BG updates continue.
    int dimPct = cfg.dimToPct;
    if (dimPct < 25) dimPct = 25;
    if (dimPct > normalPct) dimPct = normalPct;

    // Startup and manual wake use normal brightness for readability.
    bool wakeActive = (now <= 600000UL) || (now <= state.dndWakeUntilMs);
    int targetPct = wakeActive ? normalPct : dimPct;
    M5.Display.setBrightness(map(targetPct, 0, 100, 0, 255));
    state.dimmed = !wakeActive;
  }

  // Outside DND, guarantee screen is visible.
  int dimPct = cfg.dimToPct;
  if (dimPct < 15) dimPct = 15;
  if (dimPct > normalPct) dimPct = normalPct;

  // Auto-dim logic
  if (!dndNow && cfg.autoDimMin > 0) {
    bool shouldDim = (now - state.lastTouch) > (unsigned long)cfg.autoDimMin * 60000UL;
    if (shouldDim && !state.dimmed) {
      M5.Display.setBrightness(map(dimPct, 0, 100, 0, 255));
      state.dimmed = true;
    } else if (!shouldDim && state.dimmed) {
      M5.Display.setBrightness(map(normalPct, 0, 100, 0, 255));
      state.dimmed = false;
    }
  } else if (!dndNow && state.dimmed) {
    M5.Display.setBrightness(map(normalPct, 0, 100, 0, 255));
    state.dimmed = false;
  }

  // Time string
  char timeStr[12]; getTimeStr(timeStr, sizeof(timeStr), cfg.clock24hr);

  // RSSI (coarse — only trigger redraw on 5dBm change)
  int rssi = (WiFi.status() == WL_CONNECTED) ? WiFi.RSSI() : -120;
  int rssiCoarse = (rssi / 5) * 5;
  int lastRssiCoarse = (state.lastRSSI / 5) * 5;

  // Urgent flash toggle every 500ms
  bool urgent = reading.value > 0 &&
    (reading.value <= cfg.urgentLow || reading.value >= cfg.urgentHigh);
  bool needFlash = urgent && strcmp(cfg.bgAlertStyle, "flash") == 0;
  bool needPulse = urgent && strcmp(cfg.bgAlertStyle, "pulse") == 0;
  if ((needFlash || needPulse) && now - state.lastPulse > 500UL) {
    state.lastPulse = now;
    state.pulseOn = !state.pulseOn;
  }

  // ── Dirty checks — only redraw if something visible changed ──────────────────
  bool bgChanged    = (reading.value  != state.lastBGValue);
  bool trendChanged = (reading.trend  != state.lastTrend);
  bool staleChanged = (reading.stale  != state.lastStale);
  bool keyChanged   = (state.showKeyError != state.lastKeyErr);
  bool timeChanged  = (strcmp(timeStr, state.lastTimeStr) != 0);
  bool rssiChanged  = (rssiCoarse != lastRssiCoarse);
  bool pulseRedraw  = (needFlash || needPulse) && state.pulseOn != ((now / 500) % 2 == 0);
  bool animRedraw = (now - state.lastAnimTick) >= 450UL;
  bool firstDraw    = !state.initialized;

  if (!firstDraw && !bgChanged && !trendChanged && !staleChanged &&
      !keyChanged && !timeChanged && !rssiChanged && !pulseRedraw && !animRedraw) {
    return; // Nothing changed — skip entirely, no work done
  }

  // Update tracking state
  state.lastBGValue  = reading.value;
  state.lastTrend    = reading.trend;
  state.lastStale    = reading.stale;
  state.lastKeyErr   = state.showKeyError;
  state.lastRSSI     = rssi;
  state.lastAnimTick = now;
  state.initialized  = true;
  strlcpy(state.lastTimeStr, timeStr, sizeof(state.lastTimeStr));

  // Draw to off-screen buffer, push atomically
  drawFrame(cfg, reading, state);
}

// ─── AI Daily Digest Screen ───────────────────────────────────────────────────

static void _drawWrappedText(int x, int y, int maxW, int lineH, const char* text) {
  char line[96] = "";
  char word[64] = "";
  int  curY = y;
  const char* p = text;
  int  dispH = M5.Display.height();

  while (*p || strlen(line) > 0) {
    // Collect next word
    size_t wi = 0;
    while (*p && *p != ' ' && *p != '\n' && wi < sizeof(word) - 2) {
      word[wi++] = *p++;
    }
    word[wi] = '\0';
    bool newline = (*p == '\n');
    if (*p == ' ' || *p == '\n') p++;

    if (strlen(line) == 0) {
      strlcpy(line, word, sizeof(line));
    } else {
      char trial[96];
      snprintf(trial, sizeof(trial), "%s %s", line, word);
      if (canvas.textWidth(trial) <= maxW) {
        strlcpy(line, trial, sizeof(line));
      } else {
        canvas.setTextDatum(top_left);
        canvas.drawString(line, x, curY);
        curY += lineH;
        strlcpy(line, word, sizeof(line));
      }
    }

    if (newline || *p == '\0') {
      if (strlen(line) > 0) {
        if (curY + lineH < dispH - 14) {
          canvas.setTextDatum(top_left);
          canvas.drawString(line, x, curY);
          curY += lineH;
        }
        line[0] = '\0';
      }
    }
    if (curY + lineH >= dispH - 14) break;
    if (!*p && strlen(line) == 0) break;
  }
  // Flush remaining
  if (strlen(line) > 0 && curY + lineH < dispH - 14) {
    canvas.setTextDatum(top_left);
    canvas.drawString(line, x, curY);
  }
}

void showDigestScreen(const char* text, unsigned long durationMs = 10000) {
  if (!text || !strlen(text)) return;
  int W = M5.Display.width(), H = M5.Display.height();

  // ── Word-wrap text into a line array ──────────────────────────────────────
  static const int MAX_LINES = 70;
  static char wlines[MAX_LINES][80];
  int numLines = 0;

  canvas.setFont(&fonts::FreeSans9pt7b);

  char curLine[80] = "";
  char word[64]    = "";
  const char* p = text;

  auto flushLine = [&]() {
    if (numLines < MAX_LINES && strlen(curLine) > 0) {
      strlcpy(wlines[numLines++], curLine, 80);
      curLine[0] = '\0';
    }
  };

  while (*p && numLines < MAX_LINES) {
    size_t wi = 0;
    while (*p && *p != ' ' && *p != '\n' && wi < sizeof(word) - 2) word[wi++] = *p++;
    word[wi] = '\0';
    bool nl = (*p == '\n');
    if (*p == ' ' || *p == '\n') p++;
    if (!strlen(word) && nl) { flushLine(); continue; }
    if (!strlen(word)) continue;
    if (!strlen(curLine)) {
      strlcpy(curLine, word, sizeof(curLine));
    } else {
      char trial[80];
      snprintf(trial, sizeof(trial), "%s %s", curLine, word);
      if (canvas.textWidth(trial) <= W - 16) {
        strlcpy(curLine, trial, sizeof(curLine));
      } else {
        flushLine();
        strlcpy(curLine, word, sizeof(curLine));
      }
    }
    if (nl) flushLine();
  }
  flushLine();  // flush any remaining text

  // ── Paginated rendering ────────────────────────────────────────────────────
  const int LINE_H   = 18;
  const int HEADER_H = 32;
  const int FOOTER_H = 16;
  const int VISIBLE  = (H - HEADER_H - FOOTER_H) / LINE_H;

  int scrollLine = 0;
  unsigned long start = millis();

  auto renderPage = [&]() {
    canvas.fillScreen(CLR_BG);
    canvas.setFont(&fonts::FreeSansBold9pt7b);
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(CLR_TEXT);
    canvas.drawString("Morning Digest", W / 2, 16);
    canvas.drawLine(10, 30, W - 10, 30, CLR_SEP);
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextColor(CLR_MUTED);
    canvas.setTextDatum(top_left);
    int y = HEADER_H + 2;
    int end = scrollLine + VISIBLE;
    if (end > numLines) end = numLines;
    for (int i = scrollLine; i < end; i++, y += LINE_H) {
      canvas.drawString(wlines[i], 8, y);
    }
    bool hasMore = (scrollLine + VISIBLE) < numLines;
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextDatum(middle_center);
    if (hasMore) {
      canvas.setTextColor(CLR_TEXT);
      canvas.drawString("Tap for more  \u25BC", W / 2, H - 8);
    } else {
      canvas.setTextColor(CLR_DIM);
      canvas.drawString("Tap or \u25BC to close", W / 2, H - 8);
    }
    canvas.pushSprite(0, 0);
  };

  renderPage();

  while (millis() - start < durationMs) {
    M5.update();
    if (M5.BtnB.wasClicked()) { delay(100); break; }
    if (M5.Touch.getCount() && M5.Touch.getDetail().wasPressed()) {
      delay(150);
      if (scrollLine + VISIBLE < numLines) {
        scrollLine += VISIBLE;
        start = millis();  // reset timeout on each page turn
        renderPage();
      } else {
        break;  // last page — tap closes
      }
    }
    delay(50);
  }

  // Force full redraw on return to main screen
  extern DisplayState dispState;
  dispState.initialized = false;
}

// ─── Settings Menu ────────────────────────────────────────────────────────────

void showSettingsMenu(AppConfig& cfg, Preferences& prefs) {
  int W = M5.Display.width(), H = M5.Display.height();
  extern WeatherStatus gWeatherStatus;


  auto checkDexcom = [&](bool& configured) -> bool {
    configured = strlen(cfg.dexcomUser) > 0 && strlen(cfg.dexcomPass) > 0;
    if (!configured || WiFi.status() != WL_CONNECTED) return false;
    // Try to login to Dexcom Share (simulate, do not actually login here)
    // In real use, you might want to ping a status endpoint or cache login state
    return true; // Assume configured if credentials present
  };

  auto checkNightscout = [&](bool& configured) -> bool {
    configured = strlen(cfg.nightscoutUrl) > 0;
    if (!configured || WiFi.status() != WL_CONNECTED) return false;
    String url = String(cfg.nightscoutUrl) + "/api/v1/entries.json?count=1";
    if (strlen(cfg.nightscoutSecret) > 0) {
      url += "&token=";
      url += cfg.nightscoutSecret;
    }
    HTTPClient http;
    http.begin(url);
    http.setTimeout(3000);
    int code = http.GET();
    http.end();
    return code == 200;
  };

  auto checkWeather = [&](bool& configured) -> bool {
    configured = cfg.weatherEnabled && (strlen(cfg.weatherCity) > 0 || strlen(cfg.weatherZip) > 0);
    if (!configured || WiFi.status() != WL_CONNECTED) return false;
    unsigned long freshnessMs = (unsigned long)(cfg.weatherPollMin + 2) * 60000UL;
    return gWeatherStatus.valid && gWeatherStatus.fetchedAtMs > 0 && (millis() - gWeatherStatus.fetchedAtMs) <= freshnessMs;
  };

  auto drawStatus = [&](const char* name, int y, bool ok, bool configured) {
    canvas.setTextDatum(middle_left);
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextColor(CLR_MUTED);
    canvas.drawString(name, 12, y);

    canvas.setTextDatum(middle_right);
    if (!configured) {
      canvas.setTextColor(CLR_DIM);
      canvas.drawString("Not Configured", W - 12, y);
      return;
    }
    canvas.setTextColor(ok ? CLR_GREEN : CLR_RED);
    canvas.drawString(ok ? "Connected" : "Not Connected", W - 12, y);
  };

  auto drawSettingsScreen = [&](bool dexOk, bool dexCfg, bool nsOk, bool nsCfg, bool wxOk, bool wxCfg) {
    canvas.fillScreen(CLR_BG);
    canvas.setFont(&fonts::FreeSansBold9pt7b);
    canvas.setTextColor(CLR_TEXT);
    canvas.setTextDatum(middle_center);
    canvas.drawString("Settings", W/2, 18);
    canvas.drawLine(10, 34, W-10, 34, CLR_SEP);

    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextDatum(middle_left);
    canvas.setTextColor(CLR_MUTED);
    canvas.drawString("Network", 12, 52);

    if (WiFi.status() == WL_CONNECTED) {
      canvas.setTextColor(CLR_TEXT);
      String ssid = WiFi.SSID();
      if ((int)ssid.length() > 22) ssid = ssid.substring(0, 20) + "..";
      canvas.drawString(ssid.c_str(), 12, 72);
    } else {
      canvas.setTextColor(CLR_RED);
      canvas.drawString("No WiFi", 12, 72);
    }

    canvas.drawLine(10, 90, W-10, 90, CLR_SEP);
    canvas.setTextColor(CLR_MUTED);
    canvas.drawString("Connections (live)", 12, 104);

    drawStatus("Dexcom Share", 124, dexOk, dexCfg);
    drawStatus("Nightscout", 142, nsOk, nsCfg);
    drawStatus("Weather", 160, wxOk, wxCfg);

    canvas.drawLine(10, 186, W-10, 186, CLR_SEP);
    canvas.setTextColor(CLR_MUTED);
    canvas.setTextDatum(middle_left);
    canvas.drawString("Setup at", 12, 202);
    canvas.setTextColor(CLR_GREEN);
    canvas.drawString("setup.2brokeboys.uk", 12, 220);

    canvas.setTextColor(CLR_DIM);
    canvas.setTextDatum(middle_center);
    canvas.drawString("Tap anywhere to close", W/2, H - 10);
    canvas.pushSprite(0, 0);
  };

  unsigned long t = millis();
  unsigned long lastRefresh = 0;
  while (millis() - t < 60000UL) {
    M5.update();

    if (millis() - lastRefresh >= 5000UL || lastRefresh == 0) {
      lastRefresh = millis();
      bool dexCfg = false;
      bool nsCfg = false;
      bool wxCfg = false;
      bool dexOk = checkDexcom(dexCfg);
      bool nsOk = checkNightscout(nsCfg);
      bool wxOk = checkWeather(wxCfg);
      drawSettingsScreen(dexOk, dexCfg, nsOk, nsCfg, wxOk, wxCfg);
    }

    if (M5.Touch.getCount() && M5.Touch.getDetail().wasPressed()) {
      delay(200); break;
    }
    delay(50);
  }

  // Force full redraw when returning to main screen
  extern DisplayState dispState;
  dispState.initialized = false;
}
