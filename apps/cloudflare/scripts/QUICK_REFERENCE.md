# BG MiniView + Checkly + Infisical — Quick Reference

## ⚡ TL;DR Setup (5 minutes)

### Option 1: With Infisical (Recommended — Secrets Secure)

```powershell
# 1. One-time Infisical setup
# → Create project 'bg-miniview' in https://app.infisical.com
# → Add 5 secrets: CHECKLY_API_KEY, WORKER_URL, NIGHTSCOUT_URL, ALERT_EMAIL
# → Create service token
# → Set env var: [Environment]::SetEnvironmentVariable("INFISICAL_TOKEN", "st_...", "User")
# → Details: apps/cloudflare/scripts/INFISICAL_SETUP.md

# 2. Deploy updated worker (has new /api/status-check endpoint)
cd apps\cloudflare
npm run deploy:worker

# 3. Auto-create 10 monitors
.\scripts\setup_checkly.ps1 -UseInfisical

# ✅ Done! Visit https://app.checklyhq.com/checks
```

### Option 2: Manual (Quick, No Infisical)

```powershell
cd apps\cloudflare
npm run deploy:worker

.\scripts\setup_checkly.ps1 -ChecklyApiKey "sk_..." `
                            -WorkerUrl "https://bgdisplay.xxxxx.workers.dev" `
                            -NightscoutUrl "https://your-ns.com" `
                            -AlertEmail "you@example.com"
```

---

## 📊 What Gets Monitored (10 Checks)

| Check | URL | Interval | What It Validates |
|-------|-----|----------|-------------------|
| 1. Config Pull | `/api/config?v=4` | 5 min | Device can fetch config |
| 2. WebSocket | `/api/ws` | 5 min | Real-time sync works |
| 3. Digest Fetch | `/api/digest` | 10 min | Device can get AI summary |
| 4. Commands | `/api/command` | 5 min | Remote commands available |
| 5. Status Check | `/api/status-check` | 5 min | General connectivity |
| 6. Dexcom API | `share2.dexcom.com/...` | 30 min | Primary BG source |
| 7. Nightscout | `your-ns/api/v1/entries` | 10 min | Fallback BG source |
| 8. Digest Fresh | `/api/status-check` | 30 min | Daily digest < 24h old |
| 9. Hourly Digest | `/api/status-check` | 60 min | Hourly digests exist |
| 10. Worker Health | `/api/detect-timezone` | 30 min | Worker uptime |

---

## 🔐 Infisical Secrets Structure

```
Project: bg-miniview / Environment: production

CHECKLY_API_KEY          = sk_xxxxxxxxxxxxx
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
   # With Infisical:
   .\scripts\setup_checkly.ps1 -UseInfisical
   
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
| Secrets not found in Infisical | Ensure exact key names (case-sensitive): `CHECKLY_API_KEY`, `WORKER_URL`, etc. |

---

## 💡 Pro Tips

- **Infisical token rotation:** Regenerate in Infisical UI periodically (token = password)
- **Monitor customization:** Edit timeouts in Checkly UI (default: 10 sec timeout)
- **Region optimization:** All use US-East (single region = fewer API runs on Hobby plan)
- **Audit trail:** Check Infisical → Activity tab to see all secret access
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
