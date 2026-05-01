import { useState, useEffect, useCallback } from 'react';
import { ensureSession, apiGet, apiPost } from './api';
import { fmtTs, to12h, to24h, validateConfig, DAYS } from './helpers';
import { WORKER_URL } from './constants';
import Header from './components/Header';
import Toast from './components/Toast';
import AdvancedDrawer from './components/AdvancedDrawer';
import WiFiSection from './sections/WiFi';
import SourcesSection from './sections/Sources';
import TargetsSection from './sections/Targets';
import DisplaySection from './sections/Display';
import PhoneAlertsSection from './sections/PhoneAlerts';
import DigestSection from './sections/Digest';
import PumpSection from './sections/Pump';

// ── Init helpers ────────────────────────────────────────────────────────────
function extractMeta(data) {
  return {
    status: data.status, changelog: data.changelog,
    failedAuthCount: data.failedAuthCount, lastRotated: data.lastRotated,
    nextAutoRotate: data.nextAutoRotate, keyTail: data.keyTail,
    recoveryKeyEnabled: !!data.recoveryKeyEnabled, recoveryKeyTail: data.recoveryKeyTail || '',
    recoveryKeyUpdatedAt: data.recoveryKeyUpdatedAt || null,
    pendingRotation: data.pendingRotation, config_version: data.config_version,
    pendingCommand: data.pendingCommand, lastCommandAck: data.lastCommandAck,
    lastLogUpload: data.lastLogUpload, reminders: data.reminders || [],
    configUpdatedAt: data.config_updated_at || null,
    digest: data.digest || null, pushoverConfigured: !!data.pushoverConfigured,
  };
}

function buildFormData(config) {
  const form = { ...config };
  DAYS.forEach(day => {
    const sched = config.dnd_schedule?.[day];
    form[`dnd_${day}_from`] = to12h(sched?.from || config.dnd_from || '23:00');
    form[`dnd_${day}_to`] = to12h(sched?.to || config.dnd_to || '06:00');
  });
  return form;
}

function collectConfig(form) {
  const c = {};
  const str = ['wifi_ssid', 'nightscout_url', 'nightscout_secret', 'dexcom_user', 'dexcom_region',
    'bg_units', 'insulin_pump_type', 'insulin_pump_brand', 'insulin_pump_model',
    'insulin_pump_loop_mode', 'insulin_pump_notes', 'timezone', 'bg_alert_style'];
  str.forEach(k => { if (form[k] !== undefined && form[k] !== '') c[k] = form[k]; });

  ['wifi_pass', 'dexcom_pass'].forEach(k => { if (form[k]) c[k] = form[k]; });
  ['pushover_user_key', 'pushover_api_token'].forEach(k => { if (form[k]) c[k] = form[k]; });
  if (form.wifi_open) c.wifi_pass = '';

  const nums = ['poll_interval_min', 'stale_data_warn_min', 'config_ping_min', 'brightness',
    'urgent_low', 'low', 'high', 'urgent_high', 'rate_limit_per_min', 'lockout_attempts',
    'lockout_duration_min', 'session_timeout_min', 'alert_offline_min', 'alert_stale_min',
    'alert_battery_low_pct', 'alert_cooldown_min', 'pushover_alert_cooldown_min', 'digest_pushover_hour'];
  nums.forEach(k => { if (form[k] !== undefined) c[k] = Number(form[k]); });

  const bools = ['show_trend_arrow', 'show_last_reading_time', 'clock_24hr', 'dnd_enabled',
    'pushover_enabled', 'digest_pushover_enabled', 'ip_allowlist_enabled', 'lockout_enabled',
    'auto_backup', 'alert_offline_enabled'];
  bools.forEach(k => { if (form[k] !== undefined) c[k] = !!form[k]; });

  const dndSchedule = {};
  DAYS.forEach(day => {
    dndSchedule[day] = {
      from: to24h(form[`dnd_${day}_from`] || '', '23:00'),
      to: to24h(form[`dnd_${day}_to`] || '', '06:00'),
    };
  });
  c.dnd_schedule = dndSchedule;
  c.dnd_use_schedule = true;
  c.dnd_from = dndSchedule.sun.from;
  c.dnd_to = dndSchedule.sun.to;

  return c;
}

export default function App() {
  const [config, setConfig] = useState({});
  const [meta, setMeta] = useState({});
  const [metrics, setMetrics] = useState(null);
  const [maint, setMaint] = useState(null);
  const [formData, setFormData] = useState({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [toast, setToast] = useState({ msg: '', show: false });

  // Unload guard
  useEffect(() => {
    const h = e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const showToast = useCallback((msg, ms = 2800) => {
    setToast({ msg, show: true });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), ms);
  }, []);

  const onFormChange = useCallback((key, value) => {
    setFormData(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  async function loadConfig() {
    const data = await apiGet('/api/admin/config');
    setConfig(data.config || {});
    setMeta(extractMeta(data));
    setFormData(buildFormData(data.config || {}));
  }

  async function loadMetrics() {
    try { const d = await apiGet('/api/admin/metrics'); setMetrics(d || null); } catch { setMetrics(null); }
  }

  async function loadMaintenance() {
    try { const d = await apiGet('/api/admin/maintenance'); setMaint(d); } catch { setMaint(null); }
  }

  async function init() {
    try {
      await ensureSession();
      await loadConfig();
      await loadMetrics();
      await loadMaintenance();
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { init(); }, []);

  async function saveConfig() {
    const updates = collectConfig(formData);
    const errors = validateConfig(updates);
    if (errors.length) { showToast('❌ ' + errors[0]); return; }
    setSaving(true);
    try {
      const prevSsid = config.wifi_ssid || '';
      const wifiChanged = (typeof updates.wifi_ssid === 'string' && updates.wifi_ssid !== prevSsid) || !!updates.wifi_pass || formData.wifi_open;
      await apiPost('/api/admin/config', updates);
      setDirty(false);
      showToast(wifiChanged ? '✓ Saved. Wi-Fi updated — device will reboot.' : '✓ Saved. Device will sync automatically.', 4000);
      await loadConfig();
      await loadMetrics();
    } catch { showToast('❌ Error saving — check Worker'); }
    finally { setSaving(false); }
  }

  async function sendCommand(type) {
    try {
      await apiPost('/api/admin/command', { type });
      showToast(`✓ ${type} command queued`);
      await loadConfig();
    } catch { showToast('❌ Failed to queue command'); }
  }

  const offlineMin = Math.max(5, Number(config.alert_offline_min || 15));
  const online = meta.status?.lastSeen && (Date.now() - meta.status.lastSeen < offlineMin * 60000);
  const sourceLabel = config.dexcom_user ? 'Dexcom primary' : (config.nightscout_url ? 'Nightscout only' : 'Not set');

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 14 }}>
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, padding: '2rem', textAlign: 'center' }}>
        <div style={{ color: 'var(--red)', fontSize: 14 }}>Could not reach Worker at <code>{WORKER_URL}</code></div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Check that wrangler is deployed and the URL is correct.</div>
      </div>
    );
  }

  return (
    <>
      <Header meta={meta} online={online} saving={saving} onSave={saveConfig} />

      <main className="page">
        {/* Hero row */}
        <div className="hero-wrap">
          <div className="hero">
            <h2>Device settings</h2>
            <p>All settings in one view. Technical controls are in Advanced tools.</p>
            <div className="hero-chips">
              <span className="chip">Dexcom primary · Nightscout fallback</span>
              <span className="chip">Config v{meta.config_version || 0}</span>
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setAdvancedOpen(true)}>Advanced tools</button>
            </div>
          </div>
          <div className="status-grid">
            {[
              ['Status', online ? 'Online' : 'Offline'],
              ['Connection', meta.status?.connection || '—'],
              ['Last seen', fmtTs(meta.status?.lastSeen)],
              ['Data source', sourceLabel],
            ].map(([k, v]) => (
              <div key={k} className="status-tile">
                <div className="tile-k">{k}</div>
                <div className="tile-v">{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Main sections */}
        <div className="sections-grid">
          <WiFiSection form={formData} onChange={onFormChange} />
          <SourcesSection form={formData} onChange={onFormChange} />
          <TargetsSection form={formData} onChange={onFormChange} />
          <DisplaySection form={formData} onChange={onFormChange} showToast={showToast} />
          <PhoneAlertsSection form={formData} onChange={onFormChange} meta={meta} />
          <DigestSection form={formData} onChange={onFormChange} meta={meta} showToast={showToast} />
          <PumpSection form={formData} onChange={onFormChange} />
        </div>
      </main>

      <AdvancedDrawer
        open={advancedOpen}
        onClose={() => setAdvancedOpen(false)}
        form={formData}
        onChange={onFormChange}
        onSave={saveConfig}
        saving={saving}
        meta={meta}
        metrics={metrics}
        maint={maint}
        showToast={showToast}
        onCommand={sendCommand}
        onConfigReload={loadConfig}
      />

      <Toast msg={toast.msg} show={toast.show} />
    </>
  );
}
