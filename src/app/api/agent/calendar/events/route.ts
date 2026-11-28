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
import { createCalendarEvent, setGoing } from "@/lib/calendar/mutations";

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
    going?: unknown; // other family members' emails, invited to this one event
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

  // Who else is going: invited as guests of this one event, so it shows on
  // their calendars as the same event rather than as a copy of its own.
  if (
    body.going !== undefined &&
    (!Array.isArray(body.going) || body.going.some((g) => typeof g !== "string"))
  ) {
    return NextResponse.json(
      { error: "going must be a list of family members' emails." },
      { status: 400 },
    );
  }
  const going = [
    ...new Set(
      ((body.going as string[] | undefined) ?? [])
        .map((g) => g.trim().toLowerCase())
        .filter((g) => g && g !== memberEmail),
    ),
  ];

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("family_members")
    .select("email")
    .in("email", [memberEmail, ...going]);
  const known = new Set((members ?? []).map((m) => m.email.toLowerCase()));
  const unknown = [memberEmail, ...going].filter((e) => !known.has(e));
  if (unknown.length) {
    return NextResponse.json(
      { error: `No family member with email ${unknown.join(", ")}. See /api/agent/calendar/context.` },
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
    const warnings: string[] = [];
    for (const email of going) {
      const result = await setGoing(id, email, true);
      if ("error" in result) warnings.push(`${email}: ${result.error}`);
      else if (result.warning) warnings.push(`${email}: ${result.warning}`);
    }
    return NextResponse.json(
      {
        ok: true,
        id,
        // Whether it landed on a real Google calendar or app-only.
        wrote_to_google: target.calendarSourceId !== null,
        going,
        ...(warnings.length ? { warnings } : {}),
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
