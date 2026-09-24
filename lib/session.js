// Server-side sessions for /api/proxy.
//
// Login issues an HMAC-signed token in an HttpOnly, SameSite=Lax cookie.
// Every request re-checks the token against the users table, so deleting a
// user or resetting their password (anything that bumps users.updated_at)
// invalidates their existing sessions at once. The token carries the
// user's DB `updated_at` rather than comparing clocks, so clock skew
// between Vercel and Postgres can't expire a fresh session.
//
// Signing key: SESSION_SECRET if set, otherwise derived (HKDF) from the
// server-only service-role key — no extra env var is required to deploy.
// Rotating either invalidates every session.

import crypto from 'node:crypto';
import { findUser, publicUser } from './authSupabaseApi';

export const SESSION_COOKIE = 'dpr_session';
const SESSION_TTL_S = 7 * 24 * 60 * 60;
const REFRESH_AFTER_S = 24 * 60 * 60; // re-issue the cookie on /session once a day (sliding expiry)

let _key = null;
function signingKey() {
  if (_key) return _key;
  const explicit = process.env.SESSION_SECRET;
  if (explicit && explicit.length >= 32) {
    _key = Buffer.from(explicit, 'utf8');
  } else {
    const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base) throw new Error('No session signing key: set SESSION_SECRET (32+ chars) or SUPABASE_SERVICE_ROLE_KEY');
    _key = Buffer.from(crypto.hkdfSync('sha256', base, 'trimandir-dpr', 'session-signing-v1', 32));
  }
  return _key;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', signingKey()).update(data).digest();

export function createSessionToken(user, userVersion) {
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(JSON.stringify({ u: user.username, v: String(userVersion || ''), iat: now, exp: now + SESSION_TTL_S }));
  return `${payload}.${b64u(sign(payload))}`;
}

function decodeToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// → { user: {username, displayName, role}, token } or null
export async function getSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  const data = token && decodeToken(token);
  if (!data) return null;
  const row = await findUser(data.u);
  if (!row || String(row.updated_at || '') !== data.v) return null; // deleted, or password/role changed since login
  return { user: publicUser(row), token: data };
}

export function needsRefresh(session) {
  return session && session.token && (Math.floor(Date.now() / 1000) - session.token.iat) > REFRESH_AFTER_S;
}

function cookieAttrs(request, maxAge) {
  const secure = new URL(request.url).protocol === 'https:' || process.env.NODE_ENV === 'production';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function setSessionCookie(response, request, user, userVersion) {
  response.headers.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken(user, userVersion))}; ${cookieAttrs(request, SESSION_TTL_S)}`);
  return response;
}

export function clearSessionCookie(response, request) {
  response.headers.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttrs(request, 0)}`);
  return response;
}

// CSRF defence in depth (SameSite=Lax already keeps the cookie off
// cross-site POSTs): a browser POST that carries an Origin must match us.
export function isSameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // same-origin fetches from older browsers / non-browser clients
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export const _internal = { createSessionToken, decodeToken, readCookie };
