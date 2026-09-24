// Browser-side client for /api/proxy (the app's only backend endpoint).
// The session is an HttpOnly cookie (lib/session.js) that same-origin
// fetches send automatically. A 401 means it expired or was revoked: we
// broadcast 'dpr:authExpired' and the app context drops to the login screen.

const API = '/api/proxy';

export const AUTH_EXPIRED_EVENT = 'dpr:authExpired';

async function handle(res) {
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Server returned an unreadable response (HTTP ${res.status})`);
  }
  return data;
}

export async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  return handle(await fetch(`${API}?${qs}`, { cache: 'no-store' }));
}

export async function apiPost(body) {
  return handle(await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

// For admin actions: resolves with the response, throws on { error } so
// callers can't accidentally show success for a failed write.
export async function apiMutate(body) {
  const res = await apiPost(body);
  if (res && res.error) throw new Error(res.error);
  return res;
}
