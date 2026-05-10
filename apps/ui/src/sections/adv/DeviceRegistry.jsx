import { useState, useEffect } from 'react';
import Card from '../../components/Card';
import { Badge } from '../../components/Badge';
import { fmtTs } from '../../helpers';
import { apiGet, apiDelete } from '../../api';

const regIcon = <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>;

const ONLINE_THRESHOLD_MS = 10 * 60 * 1000;

export function DeviceRegistrySection({ showToast }) {
  const [devices, setDevices] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const d = await apiGet('/api/admin/devices');
      setDevices(d.devices || []);
    } catch { showToast('Failed to load device registry'); setDevices([]); }
    setBusy(false);
  }

  useEffect(() => { load(); }, []);

  async function revoke(chipId) {
    if (!confirm(`Revoke enrollment for chip …${chipId.slice(-4)}? The device will need to re-enroll on next boot.`)) return;
    try {
      await apiDelete(`/api/admin/devices/${chipId}`);
      showToast('✓ Enrollment revoked');
      await load();
    } catch { showToast('✕ Failed to revoke enrollment'); }
  }

  const now = Date.now();

  return (
    <Card iconClass="ic-diag" icon={regIcon} title="Enrolled devices" sub="Devices provisioned and self-enrolled via the API">
      {devices === null || busy ? (
        <div className="vrow"><span style={{ color: 'var(--muted)', fontSize: 13 }}>Loading…</span></div>
      ) : devices.length === 0 ? (
        <div className="vrow">
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>No enrolled devices. Device self-enrolls at first WiFi connect after flashing.</span>
        </div>
      ) : devices.map(d => {
        const online = d.lastSeen && (now - d.lastSeen) < ONLINE_THRESHOLD_MS;
        return (
          <div key={d.chipId} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--s2)', padding: '2px 7px', borderRadius: 4, color: 'var(--fg)', letterSpacing: '.03em' }}>
              …{d.chipId?.slice(-8)}
            </span>
            <Badge text={online ? 'Online' : 'Offline'} variant={online ? 'green' : 'amber'} />
            {d.hasPerDeviceConfig && <Badge text="Overrides" variant="blue" />}
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Enrolled {fmtTs(d.enrolledAt)}
            </span>
            {d.lastSeen && (
              <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                · Seen {fmtTs(d.lastSeen)} via {d.lastSeenPath || '—'}
              </span>
            )}
            <button
              className="btn btn-danger"
              style={{ marginLeft: 'auto', fontSize: 11, padding: '3px 10px' }}
              onClick={() => revoke(d.chipId)}
            >
              Revoke
            </button>
          </div>
        );
      })}
      <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn" onClick={load} disabled={busy}>{busy ? '…' : 'Refresh'}</button>
      </div>
    </Card>
  );
}
