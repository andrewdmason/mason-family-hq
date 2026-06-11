// Conflict detection. A conflict is two timed events for the SAME member whose
// times overlap. Adapted from KidCalendar: the involvement/declined and
// sibling-attendance concepts are gone, so this is a straight per-member overlap
// scan keyed on member_email.

import type { CalendarEvent } from "./types";

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // assume 2h when end_time is null

function getEndTime(event: CalendarEvent): number {
  if (event.end_time) return new Date(event.end_time).getTime();
  return new Date(event.start_time).getTime() + DEFAULT_DURATION_MS;
}

interface EventInterval {
  eventId: string;
  start: number;
  end: number;
}

function intervalsByMember(
  events: CalendarEvent[],
): Map<string, EventInterval[]> {
  const byMember = new Map<string, EventInterval[]>();
  for (const event of events) {
    if (event.all_day || event.is_canceled || !event.member_email) continue;
    const list = byMember.get(event.member_email) ?? [];
    list.push({
      eventId: event.id,
      start: new Date(event.start_time).getTime(),
      end: getEndTime(event),
    });
    byMember.set(event.member_email, list);
  }
  for (const list of byMember.values()) {
    list.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return byMember;
}

/**
 * Returns the set of event ids that overlap another event for the same member.
 * All-day, canceled, and family-level (member_email null) events don't conflict.
 */
export function detectConflicts(events: CalendarEvent[]): Set<string> {
  const conflictIds = new Set<string>();
  for (const list of intervalsByMember(events).values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].start >= list[i].end) break;
        conflictIds.add(list[i].eventId);
        conflictIds.add(list[j].eventId);
      }
    }
  }
  return conflictIds;
}

/**
 * Like detectConflicts, but says WHAT overlaps: event id -> the ids of the
 * same-member events it overlaps. Used by the agent API, which reports
 * conflicts rather than just badging them.
 */
export function detectConflictMap(
  events: CalendarEvent[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let set = map.get(a);
    if (!set) map.set(a, (set = new Set()));
    set.add(b);
  };
  for (const list of intervalsByMember(events).values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[j].start >= list[i].end) break;
        link(list[i].eventId, list[j].eventId);
        link(list[j].eventId, list[i].eventId);
      }
    }
  }
  return map;
}
