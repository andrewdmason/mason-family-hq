import { NextResponse } from "next/server";
import { deleteCalendarEvent } from "@/lib/calendar/mutations";
import { CFO_PREFIX_PATTERN, memberEmailFor } from "@/lib/workouts/calendar";
import { eventRequest, phoneMember } from "@/lib/workouts/phone";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Delete a calendar workout from the Workouts iPhone app: a workout the member
 * knows they won't do, swiped away. Removes their session for it (and whatever
 * was logged), then the calendar entry itself, on Google Calendar too
 * (deleteCalendarEvent), so it's gone everywhere rather than hidden on one
 * phone.
 *
 *   POST { eventId }   Authorization: Bearer <supabase access token>
 *   → { deleted }
 *
 * Only the caller's own workout entries ("CFO: …" on their calendar) can go
 * this way. Safe to send again: an entry already gone answers deleted.
 */
export async function POST(request: Request) {
  const caller = await phoneMember(request);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const asked = await eventRequest(request);
  if (!asked) return NextResponse.json({ error: "bad request" }, { status: 400 });

  try {
    const email = await memberEmailFor(caller.member, caller.userId);
    const { data: event, error } = await caller.member
      .from("calendar_events")
      .select("id, member_email")
      .eq("id", asked.eventId)
      .ilike("title", CFO_PREFIX_PATTERN)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (event && (!email || event.member_email !== email)) {
      return NextResponse.json({ error: "not your workout" }, { status: 403 });
    }

    // The member's own session, under row-level security.
    const { error: sessionError } = await caller.member
      .from("workout_sessions")
      .delete()
      .eq("calendar_event_id", asked.eventId);
    if (sessionError) throw new Error(sessionError.message);

    if (event) await deleteCalendarEvent(asked.eventId);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "couldn't delete the workout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
