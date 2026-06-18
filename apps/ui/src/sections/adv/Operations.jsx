import Card from '../../components/Card';
import Field from '../../components/Field';
import { Badge } from '../../components/Badge';
import { fmtTs } from '../../helpers';
import { getSession } from '../../api';
import { WORKER_URL } from '../../constants';

const ctrlIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <path d="M12 2v10" />
    <path d="M6.2 6.2a8 8 0 1011.3 0" />
  </svg>
);
const alertIcon = (
  <svg viewBox="0 0 24 24" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export function DeviceActions({ meta, onCommand, showToast }) {
  const cmd = meta.pendingCommand;
  const ack = meta.lastCommandAck;
  const log = meta.lastLogUpload;
  const ota = meta.otaRelease;

  return (
    <Card
      iconClass="ic-system"
      icon={ctrlIcon}
      title="Device actions"
      sub="Sync, reboot, maintenance"
    >
      <Field label="Quick actions">
        <div className="quick-action-grid">
          <button className="btn" onClick={() => onCommand('sync-now')}>
            Sync now
          </button>
          <button
            className="btn"
            disabled={!ota}
            onClick={() => {
              if (!ota) return;
              if (
                confirm(`Install firmware v${ota.version} now? Device will reboot after update.`)
              ) {
                onCommand('ota-apply');
              }
            }}
          >
            Update firmware now
          </button>
          <button className="btn" onClick={() => onCommand('ota-check')}>
            Check OTA
          </button>
          <button className="btn" onClick={() => onCommand('upload-logs')}>
            Pull SD logs
          </button>
          <button className="btn btn-danger" onClick={() => onCommand('reboot')}>
            Reboot
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm('Queue factory reset? Device will wipe local config.'))
                onCommand('factory-reset');
            }}
          >
            Factory reset
          </button>
        </div>
      </Field>
      <Field
        label="Prepared OTA release"
        desc={
          ota
            ? `Channel ${ota.channel || 'stable'} · published ${fmtTs(ota.publishedAt)}`
            : 'No OTA release metadata has been prepared yet.'
        }
      >
        {ota ? (
          <span className="row-meta">
            v{ota.version}
            {ota.mandatory ? ' · mandatory' : ''}
            {ota.sizeBytes ? ` · ${Math.round(ota.sizeBytes / 1024)} KB` : ''}
          </span>
        ) : (
          <span className="row-meta">—</span>
        )}
      </Field>
      <Field
        label="Latest SD log upload"
        desc={
          log
            ? `${log.lineCount || 0} lines, ${log.bytes || 0} bytes · ${fmtTs(log.uploadedAt)}${meta.logHistoryCount ? ` · ${meta.logHistoryCount} saved package${meta.logHistoryCount === 1 ? '' : 's'}` : ''}`
            : 'No uploads yet'
        }
      >
        {log && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() => {
                const s = getSession();
                window.open(
                  `${WORKER_URL}/api/admin/logs/latest?download=1&session=${encodeURIComponent(s)}`,
                  '_blank'
                );
              }}
            >
              Download latest
            </button>
            <button
              className="btn"
              onClick={() => {
                const s = getSession();
                window.open(
                  `${WORKER_URL}/api/admin/logs/all?download=1&session=${encodeURIComponent(s)}`,
                  '_blank'
                );
              }}
            >
              Download all
            </button>
          </div>
        )}
      </Field>
      <Field label="Pending command">
        <Badge text={cmd ? `${cmd.type} queued` : 'None'} variant={cmd ? 'amber' : 'green'} />
      </Field>
      <Field label="Last ACK">
        {ack ? (
          <span className="row-meta">
            {ack.type}: {ack.ok ? 'OK' : 'Failed'} ({fmtTs(ack.ts)})
          </span>
        ) : (
          <span className="row-meta">—</span>
        )}
      </Field>
    </Card>
  );
}

export function AlertTuning({ form, onChange }) {
  return (
    <Card
      iconClass="ic-alert"
      icon={alertIcon}
      title="Worker alert tuning"
      sub="Server-side thresholds and cooldowns"
    >
      <Field label="Stale data alert threshold">
        <select
          className="inp"
          value={form.alert_stale_min || 30}
          onChange={(e) => onChange('alert_stale_min', Number(e.target.value))}
        >
          {[
            [15, '15 min'],
            [30, '30 min'],
            [45, '45 min'],
            [60, '60 min'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Low battery threshold">
        <select
          className="inp"
          value={form.alert_battery_low_pct || 15}
          onChange={(e) => onChange('alert_battery_low_pct', Number(e.target.value))}
        >
          {[
            [10, '10%'],
            [15, '15%'],
            [20, '20%'],
            [25, '25%'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Alert cooldown">
        <select
          className="inp"
          value={form.alert_cooldown_min || 60}
          onChange={(e) => onChange('alert_cooldown_min', Number(e.target.value))}
        >
          {[
            [15, '15 min'],
            [30, '30 min'],
            [60, '60 min'],
            [180, '3 hours'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Field>
    </Card>
  );
}
