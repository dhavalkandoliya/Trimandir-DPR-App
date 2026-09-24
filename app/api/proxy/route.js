import { NextResponse } from 'next/server';
import { SUPABASE_GET_ACTIONS, SUPABASE_POST_ACTIONS, runSupabaseGetAction, runSupabasePostAction } from '../../../lib/dprSupabaseApi';

// DPR/Projects/Activities/Materials operations are served from Supabase
// (see lib/dprSupabaseApi.js). Everything else — login, user management,
// and any action this proxy doesn't recognize — still forwards to the
// Google Apps Script backend, since the Users sheet hasn't been migrated.
function getGoogleScriptUrl() {
  const url = process.env.GOOGLE_SCRIPT_URL;
  if (!url) throw new Error('GOOGLE_SCRIPT_URL is not set.');
  return url;
}

async function fetchUsersFromAppsScript() {
  try {
    const res = await fetch(`${getGoogleScriptUrl()}?action=getUsers`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error('Failed to fetch users from Apps Script for bootstrap:', error);
    return [];
  }
}

export async function POST(request) {
  let body = {};
  const reqText = await request.text();
  try {
    if (reqText) body = JSON.parse(reqText);
  } catch (parseReqErr) {
    console.error('Failed to parse incoming request body as JSON:', parseReqErr, 'Raw body was:', reqText);
    return NextResponse.json({ error: 'Invalid JSON request payload.', raw: reqText }, { status: 400 });
  }

  if (SUPABASE_POST_ACTIONS.has(body.action)) {
    try {
      const result = await runSupabasePostAction(body.action, body);
      return NextResponse.json(result);
    } catch (error) {
      console.error(`Supabase POST action "${body.action}" failed:`, error);
      return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
  }

  try {
    const targetUrl = getGoogleScriptUrl();
    console.log('Forwarding POST payload to Google Script:', JSON.stringify(body));

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body),
      redirect: 'follow',
      cache: 'no-store'
    });

    const resText = await response.text();
    console.log('Proxy received response status:', response.status, 'Raw response text:', resText);

    try {
      const data = JSON.parse(resText);
      return NextResponse.json(data);
    } catch (parseResErr) {
      console.error('Failed to parse response as JSON from Google Script. Raw response was:', resText);
      return NextResponse.json(
        { error: 'Invalid JSON response from Google Script backend.', raw: resText },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error forwarding to Google Script:', error);
    return NextResponse.json(
      { error: 'Failed to process request backend.', details: error.message || String(error) },
      { status: 500 }
    );
  }
}

export async function GET(request) {
  const url    = new URL(request.url);
  const action = url.searchParams.get('action') || '';

  if (SUPABASE_GET_ACTIONS.has(action)) {
    try {
      if (action === 'getBootstrapData') {
        const [bootstrap, users] = await Promise.all([
          runSupabaseGetAction('getBootstrapData'),
          fetchUsersFromAppsScript()
        ]);
        return NextResponse.json({ ...bootstrap, users });
      }
      const result = await runSupabaseGetAction(action);
      return NextResponse.json(result);
    } catch (error) {
      console.error(`Supabase GET action "${action}" failed:`, error);
      return NextResponse.json({ error: error.message || String(error) }, { status: 500 });
    }
  }

  try {
    const googleScriptUrl = getGoogleScriptUrl();
    const params    = url.searchParams.toString();
    const targetUrl = params ? `${googleScriptUrl}?${params}` : googleScriptUrl;

    const response = await fetch(targetUrl);
    const data = await response.json();

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching from Google Script:', error);
    return NextResponse.json(
      { error: 'Failed to fetch data from backend.', details: error.message || String(error) },
      { status: 500 }
    );
  }
}
