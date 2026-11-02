import { createClient } from "@supabase/supabase-js";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/config";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReadingScope } from "@/lib/reading/scope";

/**
 * The reading scope for a request carrying a family member's Supabase access
 * token as a bearer header rather than session cookies: the Reader iOS app's
 * Share extension, which signs in through the app but has no website cookies.
 * The client it returns acts as that member (row-level security applies, as
 * with the cookie client). Null when there's no bearer token, or it isn't a
 * family member's.
 */
export async function bearerReadingScope(request: Request): Promise<ReadingScope | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const admin = createAdminClient();
  const {
    data: { user },
  } = await admin.auth.getUser(token);
  if (!user) return null;
  const { data: member } = await admin
    .from("family_members")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!member) return null;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    client,
    userId: user.id,
    email: user.email?.toLowerCase() ?? null,
    isMemberMode: false,
  };
}
