import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateICalFeed, type ICalEvent } from "@/lib/calendar/ical";

const DAY_MS = 86_400_000;
const DEFAULT_TZ = "America/Los_Angeles";

// One feed per member (a kid): all of that member's events. The token is the
// only credential — resolved under the service role.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token || token.length < 32) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = createAdminClient();

  const { data: feedToken } = await supabase
    .from("ical_feed_tokens")
    .select("member_email")
    .eq("token", token)
    .maybeSingle();
  if (!feedToken) return new NextResponse("Not found", { status: 404 });

  const { data: member } = await supabase
    .from("family_members")
    .select("name")
    .eq("email", feedToken.member_email)
    .maybeSingle();

  const now = Date.now();
  const { data: rows } = await supabase
    .from("calendar_events")
    .select(
      "id, title, description, location, start_time, end_time, all_day, is_canceled",
    )
    .eq("member_email", feedToken.member_email)
    .gte("start_time", new Date(now - 30 * DAY_MS).toISOString())
    .lte("start_time", new Date(now + 180 * DAY_MS).toISOString())
    .order("start_time", { ascending: true });

  const events: ICalEvent[] = (rows ?? []).map((e) => ({
    uid: `${e.id}@family-mason-hq`,
    summary: e.title,
    description: e.description,
    location: e.location,
    dtstart: new Date(e.start_time),
    dtend: e.end_time ? new Date(e.end_time) : null,
    allDay: e.all_day,
    canceled: e.is_canceled,
  }));

  const feedName = member?.name ? `${member.name}'s Calendar` : "Calendar";
  const ical = generateICalFeed({ feedName, timezone: DEFAULT_TZ, events });

  return new NextResponse(ical, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${feedName}.ics"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}
