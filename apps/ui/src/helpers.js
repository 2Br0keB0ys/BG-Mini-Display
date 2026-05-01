export function fmtTs(ts) {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString())
    return 'Today ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

export function fmtUptime(s) {
  if (!s) return '—';
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function fmtCountdown(ms) {
  if (ms <= 0) return 'Overdue';
  const d = Math.floor(ms / 86400000), h = Math.floor((ms % 86400000) / 3600000);
  return d > 0 ? `${d}d ${h}h remaining` : `${h}h remaining`;
}

export function to12h(hhmm) {
  const m = String(hhmm || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return hhmm || '';
  let h = parseInt(m[1], 10);
  const min = m[2], ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

export function to24h(v, fallback = '23:00') {
  const s = String(v || '').trim();
  const m12 = s.match(/^(1[0-2]|0?[1-9]):([0-5]\d)\s*([AaPp][Mm])$/);
  if (m12) {
    let h = parseInt(m12[1], 10) % 12;
    if (m12[3].toUpperCase() === 'PM') h += 12;
    return `${String(h).padStart(2, '0')}:${m12[2]}`;
  }
  const m24 = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) return `${String(parseInt(m24[1], 10)).padStart(2, '0')}:${m24[2]}`;
  return fallback;
}

export function rotateProgress(lastRotated) {
  const total = 7 * 86400000, elapsed = Date.now() - (lastRotated || 0);
  const pct = Math.min(elapsed / total, 1);
  const r = 15, circ = 2 * Math.PI * r;
  const used = circ * pct, remain = circ - used;
  const label = Math.max(0, 7 - Math.floor(elapsed / 86400000)) + 'd';
  const color = pct > 0.85 ? '#E24B4A' : pct > 0.6 ? '#f59e0b' : '#16a34a';
  return { used, remain, label, color };
}

export function validateConfig(c) {
  const errors = [], n = k => Number(c[k]);
  if (c.urgent_low && c.low && n('urgent_low') >= n('low'))
    errors.push(`Urgent low (${c.urgent_low}) must be less than Low (${c.low}).`);
  if (c.low && c.high && n('low') >= n('high'))
    errors.push(`Low (${c.low}) must be less than High (${c.high}).`);
  if (c.high && c.urgent_high && n('high') >= n('urgent_high'))
    errors.push(`High (${c.high}) must be less than Urgent high (${c.urgent_high}).`);
  if (c.nightscout_url && !/^https?:\/\/.+/.test(c.nightscout_url))
    errors.push('Nightscout URL must start with http:// or https://');
  return errors;
}

export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const DAY_LABELS = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
