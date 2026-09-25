import { NextResponse } from 'next/server';
import {
  ADMIN_POST_ACTIONS, SUPABASE_GET_ACTIONS, SUPABASE_POST_ACTIONS, runSupabaseGetAction, runSupabasePostAction,
} from '../../../lib/dprSupabaseApi';
import { createUser, deleteUser, getUsers, login, resetPassword } from '../../../lib/authSupabaseApi';
import { clearSessionCookie, getSession, isSameOrigin, needsRefresh, setSessionCookie } from '../../../lib/session';

// Single backend endpoint for the app. Everything is served from Supabase:
//   lib/dprSupabaseApi.js  — DPRs, projects, activities, materials, logs
//   lib/authSupabaseApi.js — login and user management
//
// Every action except login/logout/session requires a signed-in session
// (lib/session.js); admin-only actions also require role=admin. Authorship
// (by / editedBy / requestedBy / loggedBy) comes from the session, never
// from the request body. The Google Apps Script backend is no longer called
// at runtime.

const USER_ADMIN_ACTIONS = { createUser, deleteUser, resetPassword };

const json = (data, status = 200) => NextResponse.json(data, { status });
const authRequired = () => json({ error: 'Please sign in again — your session has expired.', code: 'AUTH_REQUIRED' }, 401);
const forbidden = () => json({ error: 'Only an admin can do that.', code: 'FORBIDDEN' }, 403);

async function sessionOrNull(request) {
  try {
    return await getSession(request);
  } catch (error) {
    console.error('Session check failed:', error.message);
    return null;
  }
}

async function handleLogin(request, body) {
  const result = await login(body);
  if (!result.success) return json({ success: false });
  const { version, ...publicResult } = result;
  return setSessionCookie(json(publicResult), request, result.user, version);
}

export async function POST(request) {
  if (!isSameOrigin(request)) return json({ error: 'Cross-origin request refused.' }, 403);

  let body = {};
  const reqText = await request.text();
  try {
    if (reqText) body = JSON.parse(reqText);
  } catch {
    return json({ error: 'Invalid JSON request payload.' }, 400);
  }
  const action = body.action;

  try {
    if (action === 'login') return await handleLogin(request, body);
    if (action === 'logout') return clearSessionCookie(json({ status: 'ok' }), request);

    const session = await sessionOrNull(request);
    if (!session) return authRequired();
    const actor = session.user;

    if (USER_ADMIN_ACTIONS[action]) {
      if (actor.role !== 'admin') return forbidden();
      return json(await USER_ADMIN_ACTIONS[action]({ ...body, actor: actor.username }));
    }
    if (SUPABASE_POST_ACTIONS.has(action)) {
      if (ADMIN_POST_ACTIONS.has(action) && actor.role !== 'admin') return forbidden();
      return json(await runSupabasePostAction(action, body, actor));
    }
    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (error) {
    console.error(`POST action "${action}" failed:`, error.message || error);
    return json({ error: error.message || String(error) }, 500);
  }
}

export async function GET(request) {
  const url    = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  try {
    // Who am I? Restores the signed-in user on page load (and slides the expiry).
    if (action === 'session') {
      const session = await sessionOrNull(request);
      if (!session) return clearSessionCookie(json({ user: null }), request);
      const res = json({ user: session.user });
      return needsRefresh(session) ? setSessionCookie(res, request, session.user, session.token.v) : res;
    }

    const session = await sessionOrNull(request);
    if (!session) return authRequired(); // no account names (or anything else) before sign-in

    if (action === 'getUsers') return json(await getUsers());

    if (SUPABASE_GET_ACTIONS.has(action)) {
      if (action === 'getBootstrapData') {
        const [bootstrap, users] = await Promise.all([runSupabaseGetAction('getBootstrapData'), getUsers()]);
        return json({ ...bootstrap, users });
      }
      return json(await runSupabaseGetAction(action));
    }
    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (error) {
    console.error(`GET action "${action}" failed:`, error.message || error);
    return json({ error: error.message || String(error) }, 500);
  }
}
