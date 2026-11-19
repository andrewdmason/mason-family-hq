import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { phoneMember } from "@/lib/workouts/phone";
import { runCalendarSync } from "@/lib/calendar/sync";
import { setEventRsvp } from "@/lib/calendar/attendance";
import { suggestPlaces } from "@/lib/calendar/geocoding";
import { isGoogleMadeRefusal } from "@/lib/calendar/google";
import { normalizeCaregiver } from "@/lib/calendar/caregivers";
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  changeCalendarEventOwner,
  setGoing,
  setOwnerGoing,
  setDuty,
  convertGoogleMadeEvent,
  type DutyState,
  type ManualEventInput,
} from "@/lib/calendar/mutations";

export const runtime = "nodejs";
// A sync, or a write that reaches Google, can take a while.
export const maxDuration = 60;

/**
 * Changes from the Calendar iPhone app. The phone reads the calendar straight
 * from Supabase, but every change goes through here, because the rules
 * (writing back to Google, drive blocks, TeamSnap) and the keys they need live
 * on the website: these are the same mutations the website's own actions call
 * (../../actions.ts), open to every family member.
 *
 *   POST /calendar/api/<action>   Authorization: Bearer <supabase access token>
 *
 *   create        { event }                      → { id }
 *   update        { id, event }                  → { ok }
 *   delete        { id, series? }                → { ok }
 *   owner         { id, memberEmail }            → { ok, warning? }
 *   going         { id, memberEmail, going }     → { ok, warning? }
 *   owner-going   { id, going }                  → { ok, warning? }
 *   duty          { id, duty, state }            → { ok }
 *   rsvp          { id, status }                 → { ok }
 *   convert       { id }                         → { ok }
 *   places        { query }                      → { suggestions }
 *   sync          {}                             → { ok }
 *
 * `event` is a ManualEventInput; `state` is a DutyState (null clears it). A
 * change the rules refuse answers 400 with { error }, in words fit to show.
 * `convertible: true` on an answer means Google made the event itself and
 * won't have it changed; `convert` swaps it for an ordinary copy that can be.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  const caller = await phoneMember(request);
  if (!caller) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: me } = await caller.member
    .from("family_members")
    .select("email")
    .eq("user_id", caller.userId)
    .maybeSingle();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("That wasn't JSON.");
  }
  if (!body || typeof body !== "object") return bad("That wasn't JSON.");
  const { action } = await params;

  try {
    switch (action) {
      case "create": {
        const event = eventInput(body.event);
        if (!event) return bad("The event is missing something.");
        return NextResponse.json({ id: await createCalendarEvent(event) });
      }
      case "update": {
        const id = uuid(body.id);
        const event = eventInput(body.event);
        if (!id || !event) return bad("The event is missing something.");
        await updateCalendarEvent(id, event);
        return NextResponse.json({ ok: true });
      }
      case "delete": {
        const id = uuid(body.id);
        if (!id) return bad("Which event?");
        // `series: true` deletes every occurrence of a repeating event.
        await deleteCalendarEvent(id, body.series === true ? "series" : "this");
        return NextResponse.json({ ok: true });
      }
      case "owner": {
        const id = uuid(body.id);
        const memberEmail = text(body.memberEmail);
        if (!id || !memberEmail) return bad("Which event, and whose calendar?");
        return answer(await changeCalendarEventOwner(id, memberEmail));
      }
      case "going": {
        const id = uuid(body.id);
        const memberEmail = text(body.memberEmail);
        if (!id || !memberEmail || typeof body.going !== "boolean") {
          return bad("Which event, and who?");
        }
        return answer(await setGoing(id, memberEmail, body.going));
      }
      case "owner-going": {
        const id = uuid(body.id);
        if (!id || typeof body.going !== "boolean") return bad("Which event?");
        return answer(await setOwnerGoing(id, body.going));
      }
      case "duty": {
        const id = uuid(body.id);
        const state = dutyState(body.state);
        if (!id || (body.duty !== "dropoff" && body.duty !== "pickup") || state === undefined) {
          return bad("Which event, and which drive?");
        }
        return answer(await setDuty(id, body.duty, state));
      }
      case "rsvp": {
        const id = uuid(body.id);
        const status = body.status;
        if (!id || (status !== "going" && status !== "maybe" && status !== "not_going")) {
          return bad("Which event, and what answer?");
        }
        const result = await setEventRsvp(id, status);
        if (!("error" in result)) revalidatePath("/calendar");
        return answer(result);
      }
      case "convert": {
        const id = uuid(body.id);
        if (!id) return bad("Which event?");
        return answer(await convertGoogleMadeEvent(id));
      }
      case "places": {
        const query = text(body.query) ?? "";
        if (query.length < 2) return NextResponse.json({ suggestions: [] });
        const { data: home } = await createAdminClient()
          .from("calendar_logistics_settings")
          .select("home_lat, home_lng")
          .eq("id", 1)
          .maybeSingle();
        const suggestions = await suggestPlaces(
          query,
          home?.home_lat as number | undefined,
          home?.home_lng as number | undefined,
        );
        return NextResponse.json({ suggestions });
      }
      case "sync": {
        // The page-load sync: light, and nothing written to Google.
        await runCalendarSync({ teamsnapRsvp: false, materialize: false });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  } catch (error) {
    // Google made this event itself (from an email) and won't have it changed:
    // say so, so the app can offer to swap it for an ordinary copy.
    if (isGoogleMadeRefusal(error)) {
      return NextResponse.json(
        { error: "Google made this event from an email and won't let it be changed.", convertible: true },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : "That didn't go through.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** A mutation's own answer: `{ ok }` as it is, `{ error }` as a 400. */
function answer(result: { ok: true; warning?: string; convertible?: true } | { error: string }) {
  return NextResponse.json(result, { status: "error" in result ? 400 : 200 });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function instant(value: unknown): string | null {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
}

function eventInput(value: unknown): ManualEventInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const title = text(v.title);
  const startTime = instant(v.startTime);
  if (!title || !startTime || typeof v.allDay !== "boolean") return null;
  if (v.endTime != null && !instant(v.endTime)) return null;
  return {
    calendarSourceId: uuid(v.calendarSourceId),
    memberEmail: text(v.memberEmail),
    title,
    location: text(v.location),
    description: text(v.description),
    startTime,
    endTime: instant(v.endTime),
    allDay: v.allDay,
  };
}

/** `undefined` when it isn't a duty state at all; `null` clears the duty. */
function dutyState(value: unknown): DutyState | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  if (v.isNa === true) return { assignee: null, isNa: true };
  const caregiver = typeof v.caregiver === "string" ? normalizeCaregiver(v.caregiver) : null;
  if (caregiver) return { assignee: null, isNa: false, caregiver };
  const assignee = text(v.assignee);
  return assignee ? { assignee: assignee.toLowerCase(), isNa: false } : undefined;
}
