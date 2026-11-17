import { NextResponse } from "next/server";
import { prepareEvent } from "@/lib/workouts/session";
import { eventRequest, phoneMember } from "@/lib/workouts/phone";

export const runtime = "nodejs";
// Runs the AI parse when the workout hasn't been structured yet.
export const maxDuration = 120;

/**
 * Get a calendar workout ready to open, without opening it: the Workouts
 * iPhone app sends this in the background for each workout coming up, so the
 * slow part of the first open (the AI parse) is already done by the time one
 * is tapped. No session is created — see prepareEvent in
 * src/lib/workouts/session.ts.
 *
 *   POST { eventId }   Authorization: Bearer <supabase access token>
 *   → { ready }
 *
 * Safe to send again: a workout already prepared or opened answers at once.
 */
export async function POST(request: Request) {
  const caller = await phoneMember(request);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const asked = await eventRequest(request);
  if (!asked) return NextResponse.json({ error: "bad request" }, { status: 400 });

  try {
    return NextResponse.json({ ready: await prepareEvent(caller.member, asked.eventId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "couldn't prepare the workout";
    const status = message === "Workout event not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
