// Supabase-backed login + user management, replacing the Apps Script
// handlers in Code.gs (handleLogin/handleGetUsers/handleCreateUser/
// handleDeleteUser/handleResetPassword). Request/response shapes match
// those handlers exactly, so index.html's call sites don't change.
//
// Passwords: existing accounts were imported from the Users sheet with
// their unsalted SHA-256 hex hashes (Code.gs hashPassword()). Those still
// verify, and are upgraded to salted scrypt on the user's next successful
// login. New/reset passwords are always stored as scrypt.
//
// Cutover: see usersMigrated() — until the users table has rows, route.js
// keeps forwarding auth to Apps Script, so an empty table can never lock
// everyone out.

import crypto from 'node:crypto';
import { getSupabaseAdmin } from './supabaseClient';

// Mirrors SUPER_ADMIN in index.html — never deletable.
const PROTECTED_USERNAME = 'tpd-admin';

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

async function findUser(username) {
  const name = String(username || '').trim();
  if (!name) return null;
  const { data, error } = await getSupabaseAdmin()
    .from('users').select('id, username, display_name, password_hash, role')
    .ilike('username', escapeLike(name)).limit(2);
  if (error) throw new Error(error.message);
  return (data || []).find(u => u.username.toLowerCase() === name.toLowerCase()) || null;
}

const publicUser = (u) => ({ username: u.username, displayName: u.display_name || u.username, role: u.role || 'user' });

// ── Cutover gate ─────────────────────────────────────────────────────
// Cached per server instance; once the table has rows it stays migrated.
let migratedCache = { value: false, checkedAt: 0 };
const GATE_TTL_MS = 30_000;

export async function usersMigrated() {
  if (migratedCache.value) return true;
  if (Date.now() - migratedCache.checkedAt < GATE_TTL_MS) return false;
  const { count, error } = await getSupabaseAdmin().from('users').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  migratedCache = { value: (count || 0) > 0, checkedAt: Date.now() };
  return migratedCache.value;
}

// ── Handlers (same contracts as Code.gs) ─────────────────────────────

export async function login(body) {
  const password = String(body.password || '').trim();
  const user = await findUser(body.username);
  if (!user || !password) return { success: false };
  const { ok, needsUpgrade } = verifyPassword(password, user.password_hash);
  if (!ok) return { success: false };
  if (needsUpgrade) {
    // Best effort: a failed upgrade must not fail the login.
    const { error } = await getSupabaseAdmin().from('users').update({ password_hash: scryptHash(password) }).eq('id', user.id);
    if (error) console.error('Password hash upgrade failed for', user.username, error.message);
  }
  return { success: true, user: publicUser(user) };
}

export async function getUsers() {
  const { data, error } = await getSupabaseAdmin()
    .from('users').select('username, display_name, role').order('username', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(publicUser);
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

export const AUTH_POST_ACTIONS = new Set(['login', 'createUser', 'deleteUser', 'resetPassword']);

export async function runAuthPostAction(action, body) {
  switch (action) {
    case 'login':         return login(body);
    case 'createUser':    return createUser(body);
    case 'deleteUser':    return deleteUser(body);
    case 'resetPassword': return resetPassword(body);
    default: throw new Error(`runAuthPostAction: unhandled action "${action}"`);
  }
}

// Exported for tests.
export const _internal = { scryptHash, verifyPassword, sha256Hex, escapeLike };
