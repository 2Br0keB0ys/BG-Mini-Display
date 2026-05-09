#pragma once

// Copy this file to secrets.h and fill values locally.
// secrets.h is gitignored and should never be committed.
// These values are used as firmware bootstrap defaults after flash/reset.

#define BGDISPLAY_DEFAULT_WORKER_URL "https://your-worker.your-subdomain.workers.dev"
#define BGDISPLAY_DEFAULT_DEVICE_KEY "bg_ro_replace_with_real_device_key"
#define BGDISPLAY_DEFAULT_TIMEZONE "US/Central"

// Optional Checkly heartbeat URL for direct device liveness monitoring.
// Example: https://ping.checklyhq.com/<heartbeat-id>
#define BGDISPLAY_CHECKLY_HEARTBEAT_URL ""

// Heartbeat cadence in seconds. Keep this aligned with your Checkly heartbeat period.
#define BGDISPLAY_CHECKLY_HEARTBEAT_SEC 60
