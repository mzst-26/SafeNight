/**
 * supabase.js — Server-side Supabase clients.
 *
 * TWO separate clients to prevent session contamination:
 *
 *   supabase     — For DB operations (insert, select, update, delete).
 *                  Never call auth methods on this client.
 *                  Uses SERVICE_ROLE key → bypasses RLS.
 *
 *   supabaseAuth — For auth operations (signInWithOtp, verifyOtp,
 *                  refreshSession, getUser, admin.signOut).
 *                  Auth methods set session state internally, which would
 *                  override the Authorization header and break RLS bypass
 *                  if done on the data client.
 *
 * NEVER expose these keys to the client.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[user] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

// Data client — for .from() queries. Never use .auth on this.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Auth client — for .auth methods (signInWithOtp, verifyOtp, etc.)
// Separate instance so session state doesn't contaminate the data client.
const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

module.exports = { supabase, supabaseAuth };
