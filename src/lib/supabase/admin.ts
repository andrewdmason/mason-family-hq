import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./config";

// Local Supabase's well-known service role key — safe to commit, it only works
// against a local dev instance. Production must provide SUPABASE_SERVICE_ROLE_KEY.
const LOCAL_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const isLocalSupabase =
  supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost");

/**
 * Service-role Supabase client. Bypasses RLS — use only on the server for
 * privileged work (allowlist checks, provisioning a new member's journal,
 * stamping auth claims). Never expose to the browser.
 */
export function createAdminClient() {
  // Local wins over SUPABASE_SERVICE_ROLE_KEY on purpose. That variable holds a
  // PRODUCTION secret — the one-off import/backfill scripts need it to write to
  // prod — so it's present in .env.local even while the app is pointed at a
  // local Supabase. Handing a prod secret to local GoTrue gets rejected, and the
  // failure surfaces as a baffling "This endpoint requires a valid Bearer token"
  // from routes that pass the upstream message through (e.g. dev-login).
  // SUPABASE_LOCAL_SERVICE_ROLE_KEY is the escape hatch for a local instance
  // that isn't using the well-known demo keys.
  if (isLocalSupabase) {
    const localKey =
      process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ?? LOCAL_SERVICE_ROLE_KEY;
    return createClient(supabaseUrl, localKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  // Against any remote DB, refuse loudly rather than falling back to the local
  // key — that yields a baffling "Invalid API key".
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required when not targeting a local Supabase instance."
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
