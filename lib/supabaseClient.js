// Supabase client layer for the PostgreSQL backend (supabase/schema.sql).
// getSupabaseAdmin() serves the DPR/Projects/Activities/Materials actions
// in lib/dprSupabaseApi.js via app/api/proxy; `supabase` (anon) is unused.
//
// Two clients are exported because they carry different privilege levels:
//
//   supabase        — anon key. Safe to import from a 'use client'
//                      component; every request is subject to whatever
//                      Row Level Security policies exist on the target
//                      table (none are enabled yet — see schema.sql).
//
//   getSupabaseAdmin() — service-role key. SERVER-ONLY (Next.js route
//                      handlers under app/api/**, or Node scripts like
//                      scripts/migrate-sheets-to-supabase.js). Bypasses
//                      RLS entirely. Never import this from a 'use client'
//                      file, and never let SUPABASE_SERVICE_ROLE_KEY reach
//                      a NEXT_PUBLIC_* env var or the browser bundle.
//
// Required env vars (.env.local):
//   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  — Supabase anon/public key
//   SUPABASE_SERVICE_ROLE_KEY      — service-role key (server-only, no
//                                    NEXT_PUBLIC_ prefix)

import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Non-fatal: this module isn't imported anywhere yet, but warn loudly
  // once it is, rather than fail silently against an empty URL.
  console.warn('[supabaseClient] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set — Supabase calls will fail until the Phase 2 cutover is configured.');
}

export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '');

// ── Server fetch with a timeout and a readable failure reason ──────────
// supabase-js turns a network-level failure into a bare "TypeError: fetch
// failed", dropping err.cause — which is where Node puts the actual reason
// (TLS, DNS, refused connection). This wrapper bounds each request and
// rethrows with that cause spelled out, so the route's 500 says what broke.
const SUPABASE_REQUEST_TIMEOUT_MS = 10000;

const TLS_TRUST_HINT =
  'TLS certificate not trusted — an HTTPS-inspecting proxy/antivirus (e.g. Sophos) is re-signing traffic. ' +
  'Run Node with --use-system-ca (`npm run dev` does), or point NODE_EXTRA_CA_CERTS at its root certificate.';

const NETWORK_ERROR_HINTS = {
  SELF_SIGNED_CERT_IN_CHAIN:         TLS_TRUST_HINT,
  DEPTH_ZERO_SELF_SIGNED_CERT:       TLS_TRUST_HINT,
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: TLS_TRUST_HINT,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE:   TLS_TRUST_HINT,
  ENOTFOUND:                'DNS lookup failed — check NEXT_PUBLIC_SUPABASE_URL.',
  ECONNREFUSED:             'Connection refused — check network access to Supabase.',
  ECONNRESET:               'Connection reset — check network/proxy, or whether the Supabase project is paused.',
  ETIMEDOUT:                'Connection timed out — check network, or whether the Supabase project is paused.',
  UND_ERR_CONNECT_TIMEOUT:  'Connection timed out — check network, or whether the Supabase project is paused.',
  TimeoutError:             `No response within ${SUPABASE_REQUEST_TIMEOUT_MS / 1000}s — Supabase may be slow or unreachable.`
};

async function supabaseServerFetch(input, init = {}) {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    const code = err?.cause?.code || err?.name || 'UNKNOWN';
    const hint = NETWORK_ERROR_HINTS[code] || err?.cause?.message || err?.message || 'network error';
    throw new Error(`Supabase request failed (${code}): ${hint}`, { cause: err });
  }
}

// Lazily constructed so a missing SUPABASE_SERVICE_ROLE_KEY only breaks
// the server code path that actually calls this — never the client bundle
// that merely imports `supabase` above.
let _supabaseAdmin = null;

export function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('getSupabaseAdmin() requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to be set (server-only env vars).');
  }

  _supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: supabaseServerFetch }
  });
  return _supabaseAdmin;
}
