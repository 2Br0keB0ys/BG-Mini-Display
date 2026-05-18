import { useState } from 'react';
import Card from '../../components/Card';
import Field from '../../components/Field';
import { Badge } from '../../components/Badge';
import { fmtTs, fmtCountdown, fmtUptime } from '../../helpers';
import { apiGet, apiPost, getSession } from '../../api';
import { WORKER_URL } from '../../constants';

const backupIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
const sysIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M21 12h-2M3 12H1M12 3V1M12 23v-2" />
  </svg>
);
const diagIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

export function BackupSection({ form, onChange, showToast }) {
  function doExport() {
    window.open(WORKER_URL + '/api/admin/export', '_blank');
  }

  function doImport() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json';
    inp.onchange = async (e) => {
      try {
        const text = await e.target.files[0].text();
        const data = JSON.parse(text);
        await apiPost('/api/admin/import', data);
        showToast('✓ Config imported');
      } catch {
        showToast('Import failed');
      }
    };
    inp.click();
  }

  return (
    <Card
      iconClass="ic-backup"
      icon={backupIcon}
      title="Backup and restore"
      sub="Export, import, and automatic snapshots"
    >
      <Field label="Export settings" desc="Download all settings as a JSON backup.">
        <button className="btn" onClick={doExport}>
          Export
        </button>
      </Field>
      <Field label="Import settings" desc="Restore settings from a previous JSON backup.">
        <button className="btn" onClick={doImport}>
          Import
        </button>
      </Field>
      <Field label="Automatic backup" desc="Save a snapshot to KV on every settings save.">
        <label className="toggle">
          <input
            type="checkbox"
            checked={form.auto_backup !== false}
            onChange={(e) => onChange('auto_backup', e.target.checked)}
          />
          <span className="track" />
        </label>
      </Field>
    </Card>
  );
}

export function MaintenanceSection({ meta, maint }) {
  const sdBadge = meta.status?.sdAvailable;
  return (
    <Card
      iconClass="ic-system"
      icon={sysIcon}
      title="System status"
      sub="Device health and maintenance info"
    >
      {[
        ['Firmware', meta.status?.firmware || '—'],
        ['Connection', meta.status?.connection || '—'],
        ['IP address', meta.status?.deviceIP || meta.status?.ip || '—'],
        ['RSSI', meta.status?.rssi ? `${meta.status.rssi} dBm` : '—'],
        ['Connected SSID', meta.status?.ssid || '—'],
        ['Free memory', meta.status?.freeMemory ? `${meta.status.freeMemory} KB` : '—'],
        ['Uptime', fmtUptime(meta.status?.uptime)],
        ['SD card', null],
        ['Config version', `v${meta.config_version || 0}`],
        ['Auto reboot', maint?.rebootSchedule || 'Daily 03:00 local'],
        ['BG fail streak', maint?.sourceFailStreak ?? meta.status?.bgPollFailStreak ?? 0],
        [
          'Rotation reminders',
          (meta.reminders || []).length ? `${meta.reminders.length} pending` : 'None',
        ],
      ].map(([k, v]) => (
        <div key={k} className="vrow">
          <span className="vrow-label">{k}</span>
          <span>
            {k === 'SD card' ? (
              <Badge
                text={sdBadge ? 'Available' : 'Not detected'}
                variant={sdBadge ? 'green' : 'amber'}
              />
            ) : (
              v
            )}
          </span>
        </div>
      ))}
    </Card>
  );
}

export function LogsSection({ showToast }) {
  const [logs, setLogs] = useState({ preview: [], total: 0 });
  const [q, setQ] = useState('');
  const [lvl, setLvl] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const data = await apiGet(
        `/api/admin/logs/latest?limit=120&q=${encodeURIComponent(q)}&lvl=${encodeURIComponent(lvl)}`
      );
      setLogs(data);
    } catch {
      showToast('Log query failed');
    }
    setBusy(false);
  }

  async function download() {
    const session = getSession();
    window.open(`${WORKER_URL}/api/admin/logs/latest?download=1&session=${session}`, '_blank');
  }

  return (
    <Card iconClass="ic-diag" icon={diagIcon} title="Log explorer" sub="Search uploaded SD logs">
      <div className="field-row log-filter-row">
        <div className="field-label">
          <div className="field-name">Filter logs</div>
          <div className="field-desc">Search the latest uploaded SD log package.</div>
        </div>
        <div className="field-control log-filter-controls">
          <input
            className="inp"
            type="text"
            value={q}
            placeholder="search text"
            onChange={(e) => setQ(e.target.value)}
          />
          <select className="inp inp-sm" value={lvl} onChange={(e) => setLvl(e.target.value)}>
            <option value="">All</option>
            {['ERR', 'NET', 'CFG', 'SYS', 'BG', 'CMD'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button className="btn" onClick={load} disabled={busy}>
            {busy ? '…' : 'Run'}
          </button>
          <button className="btn" onClick={download}>
            Download
          </button>
        </div>
      </div>
      <div className="diag-row">
        <span>Matched lines</span>
        <span className="row-meta">{logs.total || 0}</span>
      </div>
      {logs.preview.length ? (
        logs.preview.map((l, i) => (
          <div key={i} className="log-row" style={{ fontFamily: 'var(--mono)' }}>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{l}</span>
          </div>
        ))
      ) : (
        <div className="diag-row">
          <span style={{ color: 'var(--muted)' }}>No log lines loaded yet</span>
        </div>
      )}
    </Card>
  );
}
