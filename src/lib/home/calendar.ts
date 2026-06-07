import "server-only";

import { getCalendarEvents, getCalendarMembers } from "@/lib/calendar/queries";
import {
  isHiddenEvent,
  memberColor,
} from "@/lib/calendar/calendar-utils";
import { localDate } from "@/lib/date-utils";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { MemberDay } from "./types";

const DAY_MS = 86_400_000;

/**
 * The calendar day an event falls on. All-day events are anchored to midnight
 * UTC of their wall-clock date (see migration 00098 / commit 7a030c9), so they
 * must be read back in UTC; timed events are read in the viewer's timezone.
 */
function eventDateKey(event: CalendarEvent, tz: string): string {
  return localDate(
    new Date(event.start_time),
    event.all_day ? "UTC" : tz
  );
}

/**
 * What the *rest* of the family has going on today, grouped by person — the
 * "others' day" Home widget. Excludes the viewer's own events (they have their
 * own calendar elsewhere) and keeps family-level
 * events (no member) under a "Family" group at the end. Members with nothing on
 * today are omitted, so the widget only shows people who actually have plans.
 */
export async function getOthersDay(
  tz: string,
  viewerEmail: string | null
): Promise<MemberDay[]> {
  const today = localDate(new Date(), tz);
  const now = Date.now();
  // A tight window around today is enough; all-day events anchored to UTC
  // midnight can sit a few hours off the viewer's wall clock, so pad both ends.
  const [events, members] = await Promise.all([
    getCalendarEvents({
      rangeStart: new Date(now - DAY_MS),
      rangeEnd: new Date(now + 2 * DAY_MS),
    }),
    getCalendarMembers(),
  ]);

  const FAMILY_KEY = "__family__";
  const byMember = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    if (isHiddenEvent(event)) continue;
    if (eventDateKey(event, tz) !== today) continue;
    if (event.member_email && event.member_email === viewerEmail) continue;
    const key = event.member_email ?? FAMILY_KEY;
    const list = byMember.get(key) ?? [];
    list.push(event);
    byMember.set(key, list);
  }

  const sortByStart = (a: CalendarEvent, b: CalendarEvent) =>
    a.all_day === b.all_day
      ? a.start_time.localeCompare(b.start_time)
      : a.all_day
        ? -1
        : 1;

  // Members first (in the order getCalendarMembers returns — owner/parent/kid,
  // then name), the family bucket last.
  const result: MemberDay[] = [];
  for (const member of members) {
    if (member.email === viewerEmail) continue;
    const list = byMember.get(member.email);
    if (!list || list.length === 0) continue;
    result.push({
      email: member.email,
      name: member.name ?? member.email,
      color: member.color ?? memberColor(member.email),
      events: list.sort(sortByStart),
    });
  }
  const familyEvents = byMember.get(FAMILY_KEY);
  if (familyEvents && familyEvents.length > 0) {
    result.push({
      email: "",
      name: "Family",
      color: memberColor(null),
      events: familyEvents.sort(sortByStart),
    });
  }
  return result;
}
