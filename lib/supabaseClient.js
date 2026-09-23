// Supabase client layer — scaffolding for the planned PostgreSQL migration
// away from the Google Sheets / Apps Script backend (see Code.gs and
// supabase/schema.sql). Not yet wired into any page or route handler.
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
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return _supabaseAdmin;
}
