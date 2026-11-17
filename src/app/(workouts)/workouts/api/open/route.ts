import { NextResponse } from "next/server";
import { ensureSessionForEvent } from "@/lib/workouts/session";
import { eventRequest, phoneMember } from "@/lib/workouts/phone";

export const runtime = "nodejs";
// The first open of a workout nobody prepared runs the AI parse.
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
 * session, and one whose parse failed is parsed again. Quick when the phone
 * prepared the workout first (../prepare/route.ts).
 */
export async function POST(request: Request) {
  const caller = await phoneMember(request);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const asked = await eventRequest(request);
  if (!asked) return NextResponse.json({ error: "bad request" }, { status: 400 });
  const timeZone = typeof asked.body.timeZone === "string" ? asked.body.timeZone : null;

  try {
    const sessionId = await ensureSessionForEvent(caller.member, caller.userId, asked.eventId, { timeZone });
    return NextResponse.json({ sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "couldn't open the workout";
    const status = message === "Workout event not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
