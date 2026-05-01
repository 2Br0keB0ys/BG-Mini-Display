import { useState } from 'react';
import Card from '../../components/Card';
import Field from '../../components/Field';
import { Badge } from '../../components/Badge';
import { fmtTs, fmtCountdown, rotateProgress } from '../../helpers';
import { apiPost, apiDelete } from '../../api';

const secIcon = <svg viewBox="0 0 24 24" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;

export default function SecuritySection({ form, onChange, meta, showToast, onConfigReload }) {
  const [rkInput, setRkInput] = useState('');
  const { used, remain, label, color } = rotateProgress(meta.lastRotated);
  const nextMs = (meta.nextAutoRotate || 0) - Date.now();

  async function saveRk() {
    const key = rkInput.trim();
    if (!key) { showToast('Enter a recovery key first'); return; }
    if (!key.startsWith('bg_ro_')) { showToast('Recovery key must start with bg_ro_'); return; }
    try {
      await apiPost('/api/admin/recovery-key', { recovery_device_key: key });
      setRkInput('');
      await onConfigReload();
      showToast('✓ Recovery key saved');
    } catch { showToast('❌ Failed to save recovery key'); }
  }

  async function clearRk() {
    try {
      await apiDelete('/api/admin/recovery-key');
      await onConfigReload();
      showToast('✓ Recovery key cleared');
    } catch { showToast('❌ Failed to clear recovery key'); }
  }

  return (
    <Card iconClass="ic-security" icon={secIcon} title="Security" sub="Access control, keys, and protection">
      <Field label="Cloudflare Access"><Badge text="Enabled" variant="green" /></Field>
      <Field label="Session timeout">
        <select className="inp" value={form.session_timeout_min || 30} onChange={e => onChange('session_timeout_min', Number(e.target.value))}>
          {[[15,'15 min'],[30,'30 min'],[60,'1 hour'],[240,'4 hours']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="IP allowlist" desc="Allow Worker access only from approved IPs.">
        <label className="toggle"><input type="checkbox" checked={!!form.ip_allowlist_enabled} onChange={e => onChange('ip_allowlist_enabled', e.target.checked)} /><span className="track" /></label>
      </Field>
      <Field label="Device API key (tail)">
        <span className="key-tag">bg_ro_••••{meta.keyTail || '????'}</span>
      </Field>
      <Field label="Recovery device key" desc={meta.recoveryKeyEnabled ? `Enabled (tail ${meta.recoveryKeyTail || '????'})${meta.recoveryKeyUpdatedAt ? ` · updated ${fmtTs(meta.recoveryKeyUpdatedAt)}` : ''}` : 'Disabled'}>
        <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="inp" style={{ width: 200 }} type="password" value={rkInput} placeholder="bg_ro_..." onChange={e => setRkInput(e.target.value)} />
          <button className="btn" onClick={saveRk}>Set</button>
          <button className="btn btn-danger" onClick={() => { if (confirm('Clear recovery key?')) clearRk(); }}>Clear</button>
        </div>
      </Field>
      <Field label="Automatic key rotation" desc={`${fmtCountdown(nextMs)} · rotates every 7 days`}>
        <div className="rotate-wrap">
          <svg width="36" height="36" viewBox="0 0 36 36">
            <circle cx="18" cy="18" r="15" fill="none" stroke="#e5e7eb" strokeWidth="3"/>
            <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${used.toFixed(1)} ${remain.toFixed(1)}`} strokeDashoffset="23.6" strokeLinecap="round" transform="rotate(-90 18 18)"/>
            <text x="18" y="22" textAnchor="middle" fontSize="9" fill="#1a1a1a" fontFamily="sans-serif">{label}</text>
          </svg>
          <Badge text={meta.pendingRotation ? 'ACK pending' : 'Active'} variant={meta.pendingRotation ? 'amber' : 'green'} />
          <div className="rotate-meta">Rotated: {fmtTs(meta.lastRotated)}</div>
        </div>
      </Field>
      <Field label="Rate limit">
        <select className="inp" value={form.rate_limit_per_min || 15} onChange={e => onChange('rate_limit_per_min', Number(e.target.value))}>
          {[[10,10],[15,15],[25,25],[30,30],[45,45],[60,60]].map(([v]) => <option key={v} value={v}>{v} / min</option>)}
        </select>
      </Field>
      <Field label="Failed login lockout">
        <label className="toggle"><input type="checkbox" checked={form.lockout_enabled !== false} onChange={e => onChange('lockout_enabled', e.target.checked)} /><span className="track" /></label>
      </Field>
      <Field label="Attempts before lockout" sub>
        <select className="inp" value={form.lockout_attempts || 5} onChange={e => onChange('lockout_attempts', Number(e.target.value))}>
          {[[3,3],[5,5],[10,10]].map(([v]) => <option key={v} value={v}>{v}</option>)}
        </select>
      </Field>
      <Field label="Lockout duration" sub>
        <select className="inp" value={form.lockout_duration_min || 15} onChange={e => onChange('lockout_duration_min', Number(e.target.value))}>
          {[[5,'5 min'],[15,'15 min'],[60,'1 hour']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      <Field label="Last device IP"><span className="key-tag">{meta.status?.ip || '—'}</span></Field>
      <Field label="Failed auth attempts (24h)">
        <Badge text={`${meta.failedAuthCount || 0} attempts`} variant={meta.failedAuthCount > 0 ? 'red' : 'green'} />
      </Field>
      <div style={{ padding: '8px 13px', background: 'var(--s2)', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 5 }}>
          Recent changes <span style={{ fontWeight: 400 }}>(v{meta.config_version || 0})</span>
        </div>
        {(meta.changelog || []).slice(0, 5).map((l, i) => (
          <div key={i} className="log-row"><span>{l.msg}</span><span>{fmtTs(l.ts)}</span></div>
        ))}
        {!(meta.changelog || []).length && <div style={{ fontSize: 12, color: 'var(--faint)', padding: '4px 0' }}>No changes recorded yet</div>}
        <div style={{ textAlign: 'right', marginTop: 6 }}>
          <button className="btn" onClick={async () => { await apiPost('/api/admin/clear-log', {}); await onConfigReload(); showToast('✓ Log cleared'); }}>Clear history</button>
        </div>
      </div>
    </Card>
  );
}
