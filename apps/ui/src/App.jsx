import { useState, useEffect, useCallback, useRef } from 'react';
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
    status: data.status,
    changelog: data.changelog,
    failedAuthCount: data.failedAuthCount,
    lastRotated: data.lastRotated,
    nextAutoRotate: data.nextAutoRotate,
    keyTail: data.keyTail,
    recoveryKeyEnabled: !!data.recoveryKeyEnabled,
    recoveryKeyTail: data.recoveryKeyTail || '',
    recoveryKeyUpdatedAt: data.recoveryKeyUpdatedAt || null,
    pendingRotation: data.pendingRotation,
    config_version: data.config_version,
    pendingCommand: data.pendingCommand,
    lastCommandAck: data.lastCommandAck,
    lastLogUpload: data.lastLogUpload,
    reminders: data.reminders || [],
    configUpdatedAt: data.config_updated_at || null,
    digest: data.digest || null,
    pushoverConfigured: !!data.pushoverConfigured,
    otaRelease: data.otaRelease || null,
  };
}

function buildFormData(config) {
  const form = { ...config };
  DAYS.forEach((day) => {
    const sched = config.dnd_schedule?.[day];
    form[`dnd_${day}_from`] = to12h(sched?.from || config.dnd_from || '23:00');
    form[`dnd_${day}_to`] = to12h(sched?.to || config.dnd_to || '06:00');
  });
  return form;
}

function collectConfig(form) {
  const c = {};
  const str = [
    'wifi_ssid',
    'nightscout_url',
    'nightscout_secret',
    'dexcom_user',
    'dexcom_region',
    'bg_units',
    'insulin_pump_type',
    'insulin_pump_brand',
    'insulin_pump_model',
    'insulin_pump_loop_mode',
    'insulin_pump_notes',
    'timezone',
    'bg_alert_style',
    'ota_channel',
  ];
  str.forEach((k) => {
    if (form[k] !== undefined && form[k] !== '') c[k] = form[k];
  });

  ['wifi_pass', 'dexcom_pass'].forEach((k) => {
    if (form[k]) c[k] = form[k];
  });
  ['pushover_user_key', 'pushover_api_token'].forEach((k) => {
    if (form[k]) c[k] = form[k];
  });
  if (form.wifi_open) c.wifi_pass = '';

  const nums = [
    'poll_interval_min',
    'stale_data_warn_min',
    'config_ping_min',
    'brightness',
    'urgent_low',
    'low',
    'high',
    'urgent_high',
    'rate_limit_per_min',
    'lockout_attempts',
    'lockout_duration_min',
    'session_timeout_min',
    'alert_stale_min',
    'alert_battery_low_pct',
    'alert_cooldown_min',
    'pushover_alert_cooldown_min',
    'digest_pushover_hour',
    'ota_check_min',
  ];
  nums.forEach((k) => {
    if (form[k] !== undefined) c[k] = Number(form[k]);
  });

  const bools = [
    'show_trend_arrow',
    'show_last_reading_time',
    'clock_24hr',
    'dnd_enabled',
    'pushover_enabled',
    'digest_pushover_enabled',
    'ip_allowlist_enabled',
    'lockout_enabled',
    'auto_backup',
    'ota_enabled',
  ];
  bools.forEach((k) => {
    if (form[k] !== undefined) c[k] = !!form[k];
  });

  const dndSchedule = {};
  DAYS.forEach((day) => {
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

// ── Nav sections ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    id: 'sec-wifi',
    label: 'Network',
    icon: (
      <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12.55a11 11 0 0114.08 0" />
        <path d="M1.42 9a16 16 0 0121.16 0" />
        <path d="M8.53 16.11a6 6 0 016.95 0" />
        <circle cx="12" cy="20" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'sec-sources',
    label: 'Glucose sources',
    icon: (
      <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
      </svg>
    ),
  },
  {
    id: 'sec-targets',
    label: 'Targets & alerts',
    icon: (
      <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: 'sec-display',
    label: 'Display & schedule',
    icon: (
      <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    ),
  },
  {
    id: 'sec-notifs',
    label: 'Notifications',
    icon: (
      <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 01-3.46 0" />
      </svg>
    ),
  },
  {
    id: 'sec-pump',
    label: 'Insulin profile',
    icon: (
      <svg className="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="9" y1="12" x2="15" y2="12" />
        <circle cx="12" cy="17" r="1" fill="currentColor" />
      </svg>
    ),
  },
];

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
  const [activeSection, setActiveSection] = useState('sec-wifi');
  const observerRef = useRef(null);

  // Unload guard
  useEffect(() => {
    const h = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  // IntersectionObserver for sidebar active state
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveSection(e.target.id);
        });
      },
      { rootMargin: '-35% 0px -55% 0px', threshold: 0 }
    );
    NAV_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current.observe(el);
    });
    return () => observerRef.current?.disconnect();
  });

  const showToast = useCallback((msg, ms = 2800) => {
    setToast({ msg, show: true });
    setTimeout(() => setToast((prev) => ({ ...prev, show: false })), ms);
  }, []);

  const onFormChange = useCallback((key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }, []);

  async function loadConfig() {
    const data = await apiGet('/api/admin/config');
    setConfig(data.config || {});
    setMeta(extractMeta(data));
    setFormData(buildFormData(data.config || {}));
  }

  async function loadMetrics() {
    try {
      const d = await apiGet('/api/admin/metrics');
      setMetrics(d || null);
    } catch (e) {
      setMetrics(null);
    }
  }

  async function loadMaintenance() {
    try {
      const d = await apiGet('/api/admin/maintenance');
      setMaint(d);
    } catch (e) {
      setMaint(null);
    }
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
  useEffect(() => {
    init();
  }, []);

  async function saveConfig() {
    const updates = collectConfig(formData);
    const errors = validateConfig(updates);
    if (errors.length) {
      showToast('✕ ' + errors[0]);
      return;
    }
    setSaving(true);
    try {
      const prevSsid = config.wifi_ssid || '';
      const wifiChanged =
        (typeof updates.wifi_ssid === 'string' && updates.wifi_ssid !== prevSsid) ||
        !!updates.wifi_pass ||
        formData.wifi_open;
      await apiPost('/api/admin/config', updates);
      setDirty(false);
      showToast(
        wifiChanged
          ? '✓ Saved — device will reboot to reconnect.'
          : '✓ Saved — device will sync automatically.',
        4000
      );
      await loadConfig();
      await loadMetrics();
    } catch (e) {
      showToast('✕ Error saving — check Worker');
    } finally {
      setSaving(false);
    }
  }

  async function sendCommand(type, args = {}) {
    try {
      await apiPost('/api/admin/command', { type, args });
      showToast(`✓ ${type} command queued`);
      await loadConfig();
    } catch (e) {
      showToast('✕ Failed to queue command');
    }
  }

  const sourceLabel = config.dexcom_user
    ? 'Dexcom + Nightscout'
    : config.nightscout_url
      ? 'Nightscout only'
      : 'Not configured';

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 8,
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ color: 'var(--red)', fontSize: 14 }}>
          Could not reach Worker at{' '}
          <code style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{WORKER_URL}</code>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>
          Check that the Worker is deployed and the URL is correct.
        </div>
      </div>
    );
  }

  return (
    <>
      <Header meta={meta} saving={saving} onSave={saveConfig} />

      {/* Mobile nav tabs */}
      <nav className="mobnav">
        {NAV_SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={activeSection === s.id ? 'active' : ''}>
            {s.label}
          </a>
        ))}
      </nav>

      <div className="shell">
        {/* Sidebar */}
        <nav className="sidenav">
          <div className="nav-label">Device setup</div>
          {NAV_SECTIONS.map((s) => (
            <a
              key={s.id}
              className={`nav-item${activeSection === s.id ? ' active' : ''}`}
              href={`#${s.id}`}
            >
              {s.icon}
              {s.label}
            </a>
          ))}
          <div className="nav-sep" />
          <button className="nav-adv" onClick={() => setAdvancedOpen(true)}>
            <svg
              className="ni"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M21 12h-2M3 12H1M12 3V1M12 23v-2" />
            </svg>
            Advanced tools
          </button>
        </nav>

        {/* Main content */}
        <div className="main-wrap">
          <main className="page">
            {/* Status strip */}
            <div className="stat-strip">
              {[
                ['Connection', meta.status?.connection || '—', null],
                ['Last seen', fmtTs(meta.status?.lastSeen), null],
                ['Data source', sourceLabel, null],
              ].map(([k, v, clr]) => (
                <div key={k} className="stat-tile">
                  <div className="tile-k">{k}</div>
                  <div className="tile-v" style={clr ? { color: clr } : {}}>
                    {v}
                  </div>
                </div>
              ))}
            </div>

            {/* Sections with anchor IDs */}
            <div id="sec-wifi">
              <WiFiSection form={formData} onChange={onFormChange} />
            </div>
            <div id="sec-sources">
              <SourcesSection form={formData} onChange={onFormChange} />
            </div>
            <div id="sec-targets">
              <TargetsSection form={formData} onChange={onFormChange} />
            </div>
            <div id="sec-display">
              <DisplaySection form={formData} onChange={onFormChange} showToast={showToast} />
            </div>
            <div id="sec-notifs">
              <PhoneAlertsSection form={formData} onChange={onFormChange} meta={meta} />
              <DigestSection
                form={formData}
                onChange={onFormChange}
                meta={meta}
                showToast={showToast}
              />
            </div>
            <div id="sec-pump">
              <PumpSection form={formData} onChange={onFormChange} />
            </div>
          </main>
        </div>
      </div>

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
