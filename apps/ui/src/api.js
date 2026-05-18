import { WORKER_URL } from './constants';

let _session = '';
export const setSession = (t) => {
  _session = t;
};
export const getSession = () => _session;

function headers(extra = {}) {
  const h = { ...extra };
  if (_session) h['X-Admin-Session'] = _session;
  return h;
}

export async function ensureSession() {
  if (_session) return;
  const r = await fetch(`${WORKER_URL}/api/admin/session`);
  if (!r.ok) throw new Error('session');
  const d = await r.json();
  _session = d.token || '';
}

export async function apiGet(path) {
  const r = await fetch(WORKER_URL + path, { headers: headers(), cache: 'no-store' });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

export async function apiPost(path, data) {
  const r = await fetch(WORKER_URL + path, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

export async function apiDelete(path) {
  const r = await fetch(WORKER_URL + path, {
    method: 'DELETE',
    headers: headers(),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}
