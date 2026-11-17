import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabaseUrl, supabaseAnonKey } from "@/lib/supabase/config";
import { ensureSessionForEvent } from "@/lib/workouts/session";

export const runtime = "nodejs";
// The first open of a workout runs the AI parse.
export const maxDuration = 120;

/**
 * Open a calendar workout from the Workouts iPhone app: the website's
 * parse-on-open (src/lib/workouts/session.ts), which needs the model key the
 * phone doesn't hold. Everything else the phone reads and writes itself,
 * straight from Supabase.
 *
 *   POST { eventId, timeZone }   Authorization: Bearer <supabase access token>
 *   → { sessionId }
 *
 * Safe to send again: an event already opened and structured returns its
 * session, and one whose parse failed is parsed again. The phone has a Supabase
 * session but no website cookies, so it sends its access token and this
 * validates it (excluded from the session gate in middleware for that reason),
 * then acts as that member, under row-level security.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const {
    data: { user },
  } = await createAdminClient().auth.getUser(token);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { eventId?: unknown; timeZone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const eventId = typeof body.eventId === "string" ? body.eventId.toLowerCase() : "";
  if (!UUID.test(eventId)) return NextResponse.json({ error: "bad eventId" }, { status: 400 });
  const timeZone = typeof body.timeZone === "string" ? body.timeZone : null;

  const member = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    const sessionId = await ensureSessionForEvent(member, user.id, eventId, { timeZone });
    return NextResponse.json({ sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "couldn't open the workout";
    const status = message === "Workout event not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
