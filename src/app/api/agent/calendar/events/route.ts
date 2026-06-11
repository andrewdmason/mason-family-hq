// Agent API: list + create calendar events. Bearer-authenticated (see
// @/lib/agent/auth) — used by the family assistant, which has no browser
// session. Mutations share their implementation with the signed-in UI
// (@/lib/calendar/mutations), so Google writes and drive-block reconciliation
// behave identically.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentAuthorized, agentUnauthorized } from "@/lib/agent/auth";
import {
  loadAgentCalendar,
  serializeEvent,
  resolveCreateTarget,
  parseDateParam,
} from "@/lib/agent/calendar";
import { createCalendarEvent } from "@/lib/calendar/mutations";

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

export async function GET(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  const url = new URL(req.url);
  const from = parseDateParam(url.searchParams.get("from"), false);
  const to = parseDateParam(url.searchParams.get("to"), true);
  if (from === "invalid" || to === "invalid") {
    return NextResponse.json(
      { error: "from/to must be YYYY-MM-DD or ISO datetimes." },
      { status: 400 },
    );
  }
  const member = url.searchParams.get("member")?.toLowerCase() ?? null;

  const now = Date.now();
  const range = {
    from: from ?? new Date(now - DAY_MS / 2),
    to: to ?? new Date(now + 14 * DAY_MS),
  };
  const data = await loadAgentCalendar(range);
  const events = data.events
    .filter((ev) => !member || ev.member_email?.toLowerCase() === member)
    .map((ev) => serializeEvent(ev, data));

  return NextResponse.json({
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    events,
  });
}

export async function POST(req: NextRequest) {
  if (!agentAuthorized(req)) return agentUnauthorized();

  let body: {
    title?: unknown;
    member_email?: unknown;
    start_time?: unknown;
    end_time?: unknown;
    all_day?: unknown;
    location?: unknown;
    description?: unknown;
    calendar?: unknown; // "auto" (default) | "app" | a calendar source id
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const memberEmail =
    typeof body.member_email === "string"
      ? body.member_email.trim().toLowerCase()
      : "";
  const startTime =
    typeof body.start_time === "string" ? body.start_time : null;
  if (!title || !memberEmail || !startTime) {
    return NextResponse.json(
      { error: "title, member_email, and start_time are required." },
      { status: 400 },
    );
  }
  if (Number.isNaN(new Date(startTime).getTime())) {
    return NextResponse.json(
      { error: "start_time must be an ISO datetime." },
      { status: 400 },
    );
  }
  const endTime = typeof body.end_time === "string" ? body.end_time : null;
  if (endTime && Number.isNaN(new Date(endTime).getTime())) {
    return NextResponse.json(
      { error: "end_time must be an ISO datetime." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("family_members")
    .select("email")
    .eq("email", memberEmail)
    .maybeSingle();
  if (!member) {
    return NextResponse.json(
      { error: `No family member with email ${memberEmail}. See /api/agent/calendar/context.` },
      { status: 400 },
    );
  }

  const target = await resolveCreateTarget(
    admin,
    memberEmail,
    typeof body.calendar === "string" ? body.calendar : undefined,
  );
  if ("error" in target) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  try {
    const id = await createCalendarEvent({
      calendarSourceId: target.calendarSourceId,
      memberEmail,
      title,
      location: typeof body.location === "string" ? body.location : null,
      description:
        typeof body.description === "string" ? body.description : null,
      startTime,
      endTime,
      allDay: body.all_day === true,
    });
    return NextResponse.json(
      {
        ok: true,
        id,
        // Whether it landed on a real Google calendar or app-only.
        wrote_to_google: target.calendarSourceId !== null,
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't create the event." },
      { status: 500 },
    );
  }
}
