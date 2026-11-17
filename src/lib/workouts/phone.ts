import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/config";

/**
 * Who the Workouts iPhone app is calling as. The phone has a Supabase session
 * but no website cookies, so it sends its access token as a bearer; this
 * validates it (the routes under /workouts/api are excluded from the session
 * gate in middleware for that reason) and returns a client that acts as that
 * member, under row-level security. Null when the token isn't good.
 */
export async function phoneMember(
  request: Request
): Promise<{ userId: string; member: SupabaseClient } | null> {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const {
    data: { user },
  } = await createAdminClient().auth.getUser(token);
  if (!user) return null;

  const member = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: user.id, member };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The request's JSON body, with its `eventId` checked; null when either is off. */
export async function eventRequest(
  request: Request
): Promise<{ eventId: string; body: Record<string, unknown> } | null> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  const eventId = typeof body?.eventId === "string" ? body.eventId.toLowerCase() : "";
  return UUID.test(eventId) ? { eventId, body } : null;
}
