// Admin auth for the BGDisplay Worker. The worker's admin gate only accepts a
// trusted Origin (worker.js `isTrustedAdminOrigin`) when it's ALSO paired with a
// shared secret (X-Admin-Dev-Key) -- Origin alone grants nothing, since this repo
// is public and its origin allowlist is public knowledge. The dev key must be
// configured by the user (Settings) to match the worker's ADMIN_DEV_KEY secret.

let cachedToken = null;

async function ensureSession(workerUrl, adminDevKey) {
  if (cachedToken) return cachedToken;
  if (!adminDevKey) {
    throw new Error('Admin dev key is not configured (see Settings)');
  }
  const res = await fetch(`${workerUrl}/api/admin/session`, {
    headers: { Origin: 'http://localhost', 'X-Admin-Dev-Key': adminDevKey },
  });
  if (!res.ok) throw new Error(`Failed to establish admin session (${res.status})`);
  const data = await res.json();
  if (!data.token) throw new Error('Worker did not return a session token');
  cachedToken = data.token;
  return cachedToken;
}

function clearSession() {
  cachedToken = null;
}

async function apiGet(workerUrl, path, adminDevKey) {
  const token = await ensureSession(workerUrl, adminDevKey);
  let res = await fetch(`${workerUrl}${path}`, {
    headers: { 'X-Admin-Session': token },
  });
  if (res.status === 401) {
    clearSession();
    const retryToken = await ensureSession(workerUrl, adminDevKey);
    res = await fetch(`${workerUrl}${path}`, {
      headers: { 'X-Admin-Session': retryToken },
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${body || res.statusText}`);
  }
  return res.json();
}

module.exports = { ensureSession, apiGet, clearSession };
