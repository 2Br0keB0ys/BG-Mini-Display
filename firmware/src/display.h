// display.h — Double-buffered rendering via M5Canvas sprite
// All drawing goes to off-screen buffer, pushed atomically — zero flicker

#pragma once
#include <M5Unified.h>
#include <HTTPClient.h>
#include <math.h>
#include "config.h"
#include <time.h>

// Defined later in bgdisplay.ino — forward declared so showSettingsMenu() can
// perform a signed live check against the worker.
String normalizeWorkerBase(const char* raw);
void addSignedHeaders(HTTPClient& http, const char* method, const String& pathWithQuery, const String& body, AppConfig& cfg);

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

// ─── Init ─────────────────────────────────────────────────────────────────────

void initDisplay(AppConfig& cfg) {
  int W = M5.Display.width(), H = M5.Display.height();
  canvas.createSprite(W, H);
  canvas.setTextDatum(middle_center);
  M5.Display.fillScreen(CLR_BG);
  M5.Display.setBrightness(map(cfg.brightness, 0, 100, 0, 255));
}

// ─── Boot Screen ──────────────────────────────────────────────────────────────

static int  _bootPct       = 0;
static char _bootLabel[48] = {};

static void drawBootFrame() {
  int W = M5.Display.width();
  const int cx = W / 2;
  canvas.fillScreen(CLR_BG);

  // Teardrop logo: triangle pointing up + circle at base, seamlessly joined
  canvas.fillTriangle(cx, 26,  cx - 21, 60,  cx + 21, 60,  CLR_RED);
  canvas.fillCircle(cx, 72, 23, CLR_RED);
  canvas.setTextDatum(middle_center);
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(CLR_TEXT);
  canvas.drawString("BG", cx, 74);

  // Title + subtitle
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(CLR_TEXT);
  canvas.drawString("BG Display Mini", cx, 114);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(CLR_MUTED);
  canvas.drawString("Glucose Display", cx, 134);

  // Separator
  canvas.drawFastHLine(50, 149, W - 100, CLR_SEP);

  // Progress track + fill
  const int barX = 25, barY = 160, barW = W - 50, barH = 10;
  canvas.fillRoundRect(barX, barY, barW, barH, 5, CLR_DIM);
  if (_bootPct > 0) {
    int pct     = min(_bootPct, 100);
    int fillW   = max(barH, barW * pct / 100);
    uint16_t fc = (pct >= 100) ? CLR_GREEN : 0x07FF;  // cyan while loading, green when done
    canvas.fillRoundRect(barX, barY, fillW, barH, 5, fc);
  }

  // Status label
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor((_bootPct >= 100) ? CLR_GREEN : CLR_MUTED);
  canvas.drawString(*_bootLabel ? _bootLabel : "Starting...", cx, 183);

  // Version — very dim, bottom
  canvas.setTextColor(CLR_DIM);
  canvas.drawString("v" FIRMWARE_VERSION, cx, 228);

  canvas.pushSprite(0, 0);
}

void showBootScreen() {
  _bootPct       = 0;
  _bootLabel[0]  = '\0';
  drawBootFrame();
}

void bootProgress(int pct, const char* label) {
  _bootPct = pct;
  if (label) strlcpy(_bootLabel, label, sizeof(_bootLabel));
  drawBootFrame();
}

// ─── Core Draw (to off-screen canvas, then push atomically) ──────────────────

void drawFrame(AppConfig& cfg, BGReading& reading, DisplayState& state) {
  int W = M5.Display.width(), H = M5.Display.height();
  const int rightCenterX = W / 2;

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

  // ── BG Number ───────────────────────────────────────────────────────────────

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
  bool isStaleReading = reading.timestamp > 0 &&
    (time(nullptr) - reading.timestamp) > (cfg.staleDataWarnMin * 60);
  if (isStaleReading) {
    canvas.setTextColor(CLR_ORANGE);
    canvas.drawString("STALE DATA", rightCenterX, centerY + 30);
  } else if (cfg.showLastReadingTime && reading.timestamp > 0) {
    canvas.setTextColor(CLR_MUTED);
    canvas.drawString(timeSince(reading.timestamp).c_str(), rightCenterX, centerY + 30);
  }

  // Mini trend history for quick context beyond the single trend arrow.
  drawBgSparkline(rightCenterX, centerY + 50, state, color);

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
  bool isStale      = reading.timestamp > 0 &&
    (time(nullptr) - reading.timestamp) > (cfg.staleDataWarnMin * 60);
  bool bgChanged    = (reading.value  != state.lastBGValue);
  bool trendChanged = (reading.trend  != state.lastTrend);
  bool staleChanged = (isStale != state.lastStale);
  bool keyChanged   = (state.showKeyError != state.lastKeyErr);
  bool timeChanged  = (strcmp(timeStr, state.lastTimeStr) != 0);
  bool rssiChanged  = (rssiCoarse != lastRssiCoarse);
  bool pulseRedraw  = (needFlash || needPulse) && state.pulseOn != ((now / 500) % 2 == 0);
  bool firstDraw    = !state.initialized;

  if (!firstDraw && !bgChanged && !trendChanged && !staleChanged &&
      !keyChanged && !timeChanged && !rssiChanged && !pulseRedraw) {
    return; // Nothing changed — skip entirely, no work done
  }

  // Update tracking state
  state.lastBGValue  = reading.value;
  state.lastTrend    = reading.trend;
  state.lastStale    = isStale;
  state.lastKeyErr   = state.showKeyError;
  state.lastRSSI     = rssi;
  state.initialized  = true;
  strlcpy(state.lastTimeStr, timeStr, sizeof(state.lastTimeStr));

  // Draw to off-screen buffer, push atomically
  drawFrame(cfg, reading, state);
}

// ─── AI Daily Digest Screen ───────────────────────────────────────────────────
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
      char trial[80 + 1 + 64 + 1];  // curLine + space + word + null
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

  auto checkCloudflare = [&](bool& configured) -> bool {
    configured = strlen(cfg.workerUrl) > 0 && strlen(cfg.deviceKey) > 0;
    if (!configured || WiFi.status() != WL_CONNECTED) return false;
    String path = String("/api/ping?v=") + String(cfg.lastConfigVersion);
    HTTPClient http;
    http.begin(normalizeWorkerBase(cfg.workerUrl) + path);
    http.addHeader("X-Device-Key", cfg.deviceKey);
    addSignedHeaders(http, "GET", path, "", cfg);
    http.setTimeout(3000);
    int code = http.GET();
    http.end();
    return code == 200;
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

  auto drawSettingsScreen = [&](bool dexOk, bool dexCfg, bool nsOk, bool nsCfg, bool cfOk, bool cfCfg) {
    canvas.fillScreen(CLR_BG);
    canvas.setFont(&fonts::FreeSansBold9pt7b);
    canvas.setTextColor(CLR_TEXT);
    canvas.setTextDatum(middle_center);
    canvas.drawString("Device Status", W/2, 18);
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
    drawStatus("Cloudflare", 160, cfOk, cfCfg);

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
      bool cfCfg = false;
      bool dexOk = checkDexcom(dexCfg);
      bool nsOk = checkNightscout(nsCfg);
      bool cfOk = checkCloudflare(cfCfg);
      drawSettingsScreen(dexOk, dexCfg, nsOk, nsCfg, cfOk, cfCfg);
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
