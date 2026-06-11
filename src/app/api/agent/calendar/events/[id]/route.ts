// Agent API: read / edit / delete a single event. TeamSnap and ICS events are
// synced from their feeds, so editing or deleting them here would just be
// undone by the next sync — those return 409 with guidance instead.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import { loadAgentCalendar, serializeEvent } from "@/lib/agent/calendar";
import {
  updateCalendarEvent,
  deleteCalendarEvent,
} from "@/lib/calendar/mutations";
import type { CalendarEvent } from "@/lib/calendar/types";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

type Params = { params: Promise<{ id: string }> };

async function fetchEvent(id: string): Promise<CalendarEvent | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("calendar_events")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as CalendarEvent | null) ?? null;
}

export async function GET(req: NextRequest, { params }: Params) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const ev = await fetchEvent(id);
  if (!ev) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }

  // Load a window around the event so the serialization picks up attendees,
  // duties, and conflicts with its neighbors.
  const start = new Date(ev.start_time).getTime();
  const data = await loadAgentCalendar({
    from: new Date(start - DAY_MS),
    to: new Date(start + DAY_MS),
  });

  return NextResponse.json({
    event: {
      ...serializeEvent(ev, data),
      is_canceled: ev.is_canceled,
      dismissed: ev.dismissed,
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const ev = await fetchEvent(id);
  if (!ev) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (ev.source_type === "teamsnap" || ev.source_type === "ics") {
    return NextResponse.json(
      {
        error: `This event is synced from ${ev.source_type === "teamsnap" ? "TeamSnap" : "an ICS feed"} — edits here would be overwritten by the next sync. Change it at the source instead.`,
      },
      { status: 409 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    ev.source_type === "google" &&
    typeof body.member_email === "string" &&
    body.member_email.toLowerCase() !== ev.member_email?.toLowerCase()
  ) {
    return NextResponse.json(
      {
        error:
          "A Google event belongs to its calendar's member — delete and recreate it to move it.",
      },
      { status: 409 },
    );
  }

  const str = (key: string, fallback: string | null): string | null =>
    key in body
      ? typeof body[key] === "string"
        ? (body[key] as string)
        : null
      : fallback;

  const startTime = str("start_time", ev.start_time) ?? ev.start_time;
  const endTime = str("end_time", ev.end_time);
  for (const [label, value] of [
    ["start_time", startTime],
    ["end_time", endTime],
  ] as const) {
    if (value && Number.isNaN(new Date(value).getTime())) {
      return NextResponse.json(
        { error: `${label} must be an ISO datetime.` },
        { status: 400 },
      );
    }
  }

  try {
    await updateCalendarEvent(id, {
      calendarSourceId: ev.calendar_source_id,
      memberEmail:
        typeof body.member_email === "string"
          ? body.member_email.toLowerCase()
          : ev.member_email,
      title:
        typeof body.title === "string" && body.title.trim()
          ? body.title
          : ev.title,
      location: str("location", ev.location),
      description: str("description", ev.description),
      startTime,
      endTime,
      allDay: typeof body.all_day === "boolean" ? body.all_day : ev.all_day,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't update the event." },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  if (!agentAuthorized(req)) return agentUnauthorized();
  const { id } = await params;

  const ev = await fetchEvent(id);
  if (!ev) {
    return NextResponse.json({ error: "Event not found." }, { status: 404 });
  }
  if (ev.source_type === "teamsnap" || ev.source_type === "ics") {
    return NextResponse.json(
      {
        error: `This event is synced from ${ev.source_type === "teamsnap" ? "TeamSnap" : "an ICS feed"} — deleting it here would just bring it back on the next sync. For a TeamSnap event the kid is skipping, set their RSVP to not_going instead.`,
      },
      { status: 409 },
    );
  }

  try {
    await deleteCalendarEvent(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't delete the event." },
      { status: 500 },
    );
  }
}
