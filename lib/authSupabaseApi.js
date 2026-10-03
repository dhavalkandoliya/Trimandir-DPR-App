// Supabase-backed login + user management, replacing the Apps Script
// handlers in Code.gs (handleLogin/handleGetUsers/handleCreateUser/
// handleDeleteUser/handleResetPassword). Request/response shapes match
// those handlers exactly (the client calls them via lib/client/api.js).
//
// Passwords: existing accounts were imported from the Users sheet with
// their unsalted SHA-256 hex hashes (Code.gs hashPassword()). Those still
// verify, and are upgraded to salted scrypt on the user's next successful
// login. New/reset passwords are always stored as scrypt.
//
// Sessions: route.js issues a signed cookie on successful login (see
// lib/session.js) and re-validates it against this table on every request.

import crypto from 'node:crypto';
import { getSupabaseAdmin } from './supabaseClient';

// The built-in admin account — never deletable (the Admin panel shows it as Protected).
const PROTECTED_USERNAME = 'admin'; // renamed from TPD-admin (migrations/008)

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function scryptHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

const sha256Hex = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Returns { ok, needsUpgrade }.
function verifyPassword(password, stored) {
  const s = String(stored || '');
  if (s.startsWith('scrypt$')) {
    const [, N, r, p, saltB64, keyB64] = s.split('$');
    const expected = Buffer.from(keyB64, 'base64');
    const key = crypto.scryptSync(String(password), Buffer.from(saltB64, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
    return { ok: crypto.timingSafeEqual(key, expected), needsUpgrade: false };
  }
  if (/^[a-f0-9]{64}$/.test(s)) return { ok: safeEqual(sha256Hex(password), s), needsUpgrade: true }; // legacy Sheets hash
  if (s) return { ok: safeEqual(password, s), needsUpgrade: true }; // legacy plaintext (Code.gs upgraded these lazily too)
  return { ok: false, needsUpgrade: false };
}

// ilike with LIKE wildcards escaped, so "a_b" can't match "axb".
const escapeLike = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

export async function findUser(username) {
  const name = String(username || '').trim();
  if (!name) return null;
  const { data, error } = await getSupabaseAdmin()
    .from('users').select('id, username, display_name, password_hash, role, updated_at')
    .ilike('username', escapeLike(name)).limit(2);
  if (error) throw new Error(error.message);
  return (data || []).find(u => u.username.toLowerCase() === name.toLowerCase()) || null;
}

export const publicUser = (u) => ({ username: u.username, displayName: u.display_name || u.username, role: u.role || 'user' });

// ── Handlers (same contracts as Code.gs) ─────────────────────────────

export async function login(body) {
  const password = String(body.password || '').trim();
  const user = await findUser(body.username);
  if (!user || !password) return { success: false };
  const { ok, needsUpgrade } = verifyPassword(password, user.password_hash);
  if (!ok) return { success: false };
  let version = user.updated_at;
  if (needsUpgrade) {
    // Best effort: a failed upgrade must not fail the login.
    const { data, error } = await getSupabaseAdmin().from('users')
      .update({ password_hash: scryptHash(password) }).eq('id', user.id).select('updated_at').single();
    if (error) console.error('Password hash upgrade failed for', user.username, error.message);
    else version = data.updated_at; // the upgrade bumps updated_at — the session must carry the new value
  }
  // `version` is for the session cookie only; route.js strips it from the response.
  return { success: true, user: publicUser(user), version };
}

// migrations/006_user_sites.sql not applied yet.
export const userSitesMissing = (error) => !!error && (error.code === 'PGRST205' || error.code === '42P01' || /user_sites/.test(error.message || ''));
export const USER_SITES_HINT = 'Database is missing site assignments — apply supabase/migrations/006_user_sites.sql in the Supabase SQL editor.';

// withSites (admins only): each user's assigned project ids, as `sites`.
export async function getUsers({ withSites = false } = {}) {
  const supabase = getSupabaseAdmin();
  const [{ data, error }, assigned] = await Promise.all([
    supabase.from('users').select('id, username, display_name, role').order('username', { ascending: true }),
    withSites ? supabase.from('user_sites').select('user_id, project_id') : Promise.resolve(null),
  ]);
  if (error) throw new Error(error.message);
  if (!withSites) return (data || []).map(publicUser);
  if (assigned.error && !userSitesMissing(assigned.error)) throw new Error(assigned.error.message);
  const byUser = new Map();
  (assigned.data || []).forEach(r => byUser.set(r.user_id, [...(byUser.get(r.user_id) || []), Number(r.project_id)]));
  return (data || []).map(u => ({ ...publicUser(u), sites: byUser.get(u.id) || [] }));
}

// Replaces a supervisor's site assignments with body.projectIds. Doesn't
// touch users.updated_at, so it doesn't sign them out — the server reads
// assignments on every request, so the change applies at once.
export async function setUserSites(body) {
  const user = await findUser(body.username);
  if (!user) return { error: 'User not found' };
  if (user.role === 'admin') return { error: 'Administrators see every site — no assignment needed' };
  const ids = [...new Set((Array.isArray(body.projectIds) ? body.projectIds : []).map(Number))].filter(n => Number.isInteger(n) && n > 0);
  const supabase = getSupabaseAdmin();
  let del = supabase.from('user_sites').delete().eq('user_id', user.id);
  if (ids.length) del = del.not('project_id', 'in', `(${ids.join(',')})`);
  const { error: delErr } = await del;
  if (delErr) return { error: userSitesMissing(delErr) ? USER_SITES_HINT : delErr.message };
  if (ids.length) {
    const { error } = await supabase.from('user_sites')
      .upsert(ids.map(project_id => ({ user_id: user.id, project_id })), { onConflict: 'user_id,project_id', ignoreDuplicates: true });
    if (error) return { error: error.code === '23503' ? 'One of those sites no longer exists — refresh and try again' : error.message };
  }
  return { status: 'ok' };
}

export async function createUser(body) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '').trim();
  if (!username || !password) return { error: 'Username and password are required' };
  if (await findUser(username)) return { error: 'Username exists' };
  const { error } = await getSupabaseAdmin().from('users').insert({
    username,
    display_name: String(body.displayName || username).trim() || username,
    password_hash: scryptHash(password),
    role: body.role === 'admin' ? 'admin' : 'user',
  });
  if (error) return { error: error.code === '23505' ? 'Username exists' : error.message };
  return { status: 'ok' };
}

export async function deleteUser(body) {
  const user = await findUser(body.username);
  if (!user) return { error: 'User not found' };
  if (user.username.toLowerCase() === PROTECTED_USERNAME) return { error: 'This account is protected' };
  if (body.actor && user.username.toLowerCase() === String(body.actor).toLowerCase()) return { error: "You can't delete your own account" };
  const { error } = await getSupabaseAdmin().from('users').delete().eq('id', user.id);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

export async function resetPassword(body) {
  const password = String(body.password || '').trim();
  if (!password) return { error: 'Password is required' };
  const user = await findUser(body.username);
  if (!user) return { error: 'Not found' };
  const { error } = await getSupabaseAdmin().from('users').update({ password_hash: scryptHash(password) }).eq('id', user.id);
  if (error) return { error: error.message };
  return { status: 'ok' };
}

// Exported for tests.
export const _internal = { scryptHash, verifyPassword, sha256Hex, escapeLike };
