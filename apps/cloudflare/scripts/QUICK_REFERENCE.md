# BG MiniView + Checkly + Infisical — Quick Reference

## ⚡ TL;DR Setup (5 minutes)

### Option 1: With Infisical (Recommended — Secrets Secure)

```powershell
# 1. One-time Infisical setup
# → Create project 'bg-miniview' in https://app.infisical.com
# → Add required secrets: CHECKLY_API_KEY, CHECKLY_MONITOR_KEY, WORKER_URL
# → Create service token
# → Set env var: [Environment]::SetEnvironmentVariable("INFISICAL_TOKEN", "st_...", "User")
# → Details: apps/cloudflare/scripts/INFISICAL_SETUP.md

# 2. Deploy updated worker (has new /api/status-check endpoint)
cd apps\cloudflare
npm run deploy:worker

# 3. Auto-create 10 monitors
.\scripts\setup_checkly.ps1

# ✅ Done! Visit https://app.checklyhq.com/checks
```

### Option 2: Manual (Quick, No Infisical)

```powershell
cd apps\cloudflare
npm run deploy:worker

.\scripts\setup_checkly.ps1 -ChecklyApiKey "sk_..." `
                            -MonitorKey "ckm_..." `
                            -WorkerUrl "https://bgdisplay.xxxxx.workers.dev" `
                            -NightscoutUrl "https://your-ns.com" `
                            -AlertEmail "you@example.com"
```

---

## 📊 What Gets Monitored (10 Checks)

| Check | URL | Interval | What It Validates |
|-------|-----|----------|-------------------|
| 1. BG Device Connectivity | `/api/monitor/status-check` | 5 min | `$.device.online` |
| 2. BG Config Reachability | `/api/monitor/status-check` | 60 min | `$.protectedRoutes.configAuthGuard` |
| 3. BG WebSocket Reachability | `/api/monitor/status-check` | 120 min | `$.protectedRoutes.wsAuthGuard` |
| 4. BG Digest Reachability | `/api/monitor/status-check` | 120 min | `$.protectedRoutes.digestAuthGuard` |
| 5. BG Command Reachability | `/api/monitor/status-check` | 180 min | `$.protectedRoutes.commandAuthGuard` |
| 6. Dexcom Share Connectivity | `/api/monitor/status-check` | 180 min | `$.upstream.dexcomRootReachable` |
| 7. Nightscout Connectivity | `/api/monitor/status-check` | 120 min | `$.upstream.nightscoutReachable` |
| 8. BG Daily Digest Freshness | `/api/monitor/status-check` | 360 min | `$.digest.digestIsFresh` |
| 9. BG Hourly Pipeline Alive | `/api/monitor/status-check` | 180 min | Status 200 |
| 10. BG Worker Health | `/api/detect-timezone` | 360 min | Status 200 |

---

## 🔐 Infisical Secrets Structure

```
Project: bg-miniview / Environment: production

CHECKLY_API_KEY          = sk_xxxxxxxxxxxxx
CHECKLY_MONITOR_KEY      = ckm_xxxxxxxxxxxxx
WORKER_URL               = https://bgdisplay.xxxxx.workers.dev
NIGHTSCOUT_URL           = https://your-ns.herokuapp.com  [optional]
ALERT_EMAIL              = you@example.com               [optional]
SLACK_WEBHOOK            = https://hooks.slack.com/...   [optional]
```

Service token stored in: `$env:INFISICAL_TOKEN` (Windows User scope)

---

## 📁 Files Modified/Created

```
apps/cloudflare/
├── src/
│   └── worker.js                      [MODIFIED] + /api/status-check endpoint
├── scripts/
│   ├── setup_checkly.ps1              [UPDATED] + Infisical integration
│   └── INFISICAL_SETUP.md             [NEW] Step-by-step guide
└── wrangler.toml                      [no changes needed]

CLAUDE.md                               [UPDATED] + Checkly + Infisical section
```

---

## 🚀 Deploy Steps (Order Matters)

1. **Update & Deploy Worker**
   ```bash
   cd apps/cloudflare
   npm run deploy:worker
   ```
   (Adds `/api/status-check` endpoint)

2. **Setup Infisical** (if using)
   - Follow `apps/cloudflare/scripts/INFISICAL_SETUP.md`
   - Create project + secrets + service token
   - Set `INFISICAL_TOKEN` env var

3. **Run Setup Script**
   ```powershell
   # With Infisical-first defaults:
   .\scripts\setup_checkly.ps1
   
   # Or manually:
   .\scripts\setup_checkly.ps1 -ChecklyApiKey "..." -WorkerUrl "..." ...
   ```

4. **Configure Alerts** (Optional)
   - Visit Checkly → Settings → Integrations
   - Connect Slack/Email

5. **Watch Dashboard**
   - https://app.checklyhq.com/dashboard

---

## 🆘 Troubleshooting

| Problem | Solution |
|---------|----------|
| `INFISICAL_TOKEN not set` | Run: `[Environment]::SetEnvironmentVariable("INFISICAL_TOKEN", "st_...", "User")` then restart terminal |
| `infisical: command not found` | Install: `scoop install infisical` or `npm install -g @infisical/cli` |
| `Cannot connect to Infisical` | Check token is valid + project name is `bg-miniview` + env is `production` |
| `Worker not responding` | Deploy with `npm run deploy:worker` first; wait 30s; check URL |
| `Monitor creation failed` | Check Checkly API key (from Account Settings); verify Hobby plan (10 limit) |
| Missing monitor key | Ensure `CHECKLY_MONITOR_KEY` exists in Infisical or pass `-MonitorKey` |
| Secrets not found in Infisical | Ensure exact key names (case-sensitive): `CHECKLY_API_KEY`, `CHECKLY_MONITOR_KEY`, `WORKER_URL`, etc. |

---

## 💡 Pro Tips

- **Infisical token rotation:** Regenerate in Infisical UI periodically (token = password)
- **Monitor customization:** Edit timeouts in Checkly UI (default: 10 sec timeout)
- **Region optimization:** All use US-East (single region = fewer API runs on Hobby plan)
- **Audit trail:** Check Infisical → Activity tab to see all secret access
- **Rotate monitor key safely:** Run `./scripts/rotate_monitor_key.ps1` from `apps/cloudflare`
- **Slack alerts:** Use Slack integration to route critical alerts to your team

---

## 📞 Support

- **Worker endpoint issues:** Check `/api/status-check` returns valid JSON
- **Checkly API issues:** Verify API key format (starts with `sk_` for workspace key, not personal)
- **Infisical issues:** See `INFISICAL_SETUP.md` troubleshooting section
- **Monitor not firing:** Check Checkly dashboard for execution logs + errors

---

**Last Updated:** May 8, 2026  
**Checkly Plan:** Hobby (10 monitors)  
**Worker Version:** 3.0.0+  
**Status:** Ready to Deploy ✅
