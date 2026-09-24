import { NextResponse } from 'next/server';
import { SUPABASE_GET_ACTIONS, SUPABASE_POST_ACTIONS, runSupabaseGetAction, runSupabasePostAction } from '../../../lib/dprSupabaseApi';
import { AUTH_POST_ACTIONS, getUsers as getSupabaseUsers, runAuthPostAction, usersMigrated } from '../../../lib/authSupabaseApi';

// DPR/Projects/Activities/Materials operations are served from Supabase
// (lib/dprSupabaseApi.js). Login and user management are served from
// Supabase too (lib/authSupabaseApi.js) once the users table has been
// imported — until then they keep forwarding to the Google Apps Script
// backend, so an empty table can never lock everyone out. Anything else
// this proxy doesn't recognize still forwards to Apps Script.

const APPS_SCRIPT_TIMEOUT_MS = 9000; // stay inside Vercel's function limit and fail with a readable error

function getGoogleScriptUrl() {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) throw new Error('GOOGLE_SCRIPT_URL is not set.');
  return url;
}

// Never let credentials reach the logs.
function redact(body) {
  const out = { ...body };
  for (const k of ['password', 'secret', 'passwordHash', 'password_hash']) if (k in out) out[k] = '[redacted]';
  return out;
}

// When Apps Script answers with an HTML page instead of JSON (deployment
// URL revoked/changed, "Sign in" wall, quota or script error page), say
// which — the old generic message gave nothing to diagnose.
function describeNonJson(status, text) {
  const title = (String(text).match(/<title>([^<]*)<\/title>/i) || [])[1];
  const snippet = String(text).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `Google Apps Script returned HTTP ${status} with ${title ? `an HTML page ("${title.trim()}")` : 'a non-JSON response'}${snippet ? `: ${snippet}` : ''}`;
}

async function forwardToAppsScript({ method, query = '', body }) {
  const target = `${getGoogleScriptUrl()}${query}`;
  let response;
  try {
    response = await fetch(target, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: method === 'POST' ? JSON.stringify(body) : undefined,
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error && error.name === 'TimeoutError';
    const msg = timedOut
      ? `Google Apps Script did not respond within ${APPS_SCRIPT_TIMEOUT_MS / 1000}s`
      : `Could not reach Google Apps Script: ${error.cause?.code || error.message}`;
    console.error(msg, method === 'POST' ? JSON.stringify(redact(body)) : query);
    return NextResponse.json({ error: msg }, { status: 504 });
  }
  const text = await response.text();
  try {
    return NextResponse.json(JSON.parse(text));
  } catch {
    const msg = describeNonJson(response.status, text);
    console.error(msg, '| action:', method === 'POST' ? body.action : query);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

async function authOnSupabase() {
  try {
    return await usersMigrated();
  } catch (error) {
    // Can't tell (Supabase unreachable) — keep the pre-cutover behaviour.
    console.error('Users cutover check failed; forwarding auth to Apps Script:', error.message);
    return false;
  }
}

async function fetchUsersForBootstrap() {
  try {
    if (await authOnSupabase()) return await getSupabaseUsers();
    const res = await fetch(`${getGoogleScriptUrl()}?action=getUsers`, { signal: AbortSignal.timeout(APPS_SCRIPT_TIMEOUT_MS) });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Failed to fetch users for bootstrap:', error.message);
    return [];
  }
}

export async function POST(request) {
  let body = {};
  const reqText = await request.text();
  try {
    if (reqText) body = JSON.parse(reqText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request payload.' }, { status: 400 });
  }

  if (SUPABASE_POST_ACTIONS.has(body.action)) {
    try {
      return NextResponse.json(await runSupabasePostAction(body.action, body));
    } catch (error) {
      console.error(`Supabase POST action "${body.action}" failed:`, error);
      return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
  }

  if (AUTH_POST_ACTIONS.has(body.action) && await authOnSupabase()) {
    try {
      return NextResponse.json(await runAuthPostAction(body.action, body));
    } catch (error) {
      console.error(`Supabase auth action "${body.action}" failed:`, error.message);
      return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
  }

  return forwardToAppsScript({ method: 'POST', body });
}

export async function GET(request) {
  const url    = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  // The users export (password hashes) is for the migration script, which
  // calls Apps Script directly — never relay it from the public site.
  if (action === 'exportUsersForMigration') return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (SUPABASE_GET_ACTIONS.has(action)) {
    try {
      if (action === 'getBootstrapData') {
        const [bootstrap, users] = await Promise.all([
          runSupabaseGetAction('getBootstrapData'),
          fetchUsersForBootstrap()
        ]);
        return NextResponse.json({ ...bootstrap, users });
      }
      return NextResponse.json(await runSupabaseGetAction(action));
    } catch (error) {
      console.error(`Supabase GET action "${action}" failed:`, error);
      return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
  }

  if (action === 'getUsers' && await authOnSupabase()) {
    try {
      return NextResponse.json(await getSupabaseUsers());
    } catch (error) {
      console.error('Supabase getUsers failed:', error.message);
      return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
  }

  const params = url.searchParams.toString();
  return forwardToAppsScript({ method: 'GET', query: params ? `?${params}` : '' });
}
