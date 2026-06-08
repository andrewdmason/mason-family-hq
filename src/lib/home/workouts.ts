// Home dashboard: the workout to focus on. Today's workout stays the focus until
// it's marked done; once completed, focus shifts to the next scheduled workout
// (with a "today ✓" indicator). With nothing today, the next upcoming workout
// shows directly.

import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/members/auth";
import { getUserTimezone, localDate } from "@/lib/date-utils";
import { listWorkoutEvents } from "@/lib/workouts/calendar";

export type FocusItem =
  | {
      kind: "session";
      date: string;
      sessionId: string;
      title: string;
      blockCount: number;
      completed: boolean;
    }
  | { kind: "event"; date: string; eventId: string; title: string };

export type HomeWorkout = {
  focus: FocusItem;
  /** A completed session exists for today while focus is a later workout. */
  todayCompleted: boolean;
} | null;

/** Today's workout, plus the next one — the building blocks for the Today tab. */
export type TodayWorkout = {
  /** Today's workout: an opened session (any state) or an unopened CFO event. */
  today: FocusItem | null;
  /** True when today's workout is an opened session that's been completed. */
  todayCompleted: boolean;
  /** The soonest workout strictly after today, if any. */
  next: FocusItem | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Shared resolver: partition the user's upcoming workouts into today's focus and
 * the next scheduled item. Opened sessions take priority over unopened calendar
 * events on the same day; an event only surfaces here when no session row exists
 * for it yet (so the Today tab knows it still needs a parse-on-open).
 */
async function resolveFocus(): Promise<TodayWorkout> {
  const supabase = await createClient();
  const userId = await requireUserId(supabase);
  const tz = await getUserTimezone();
  const today = localDate(new Date(), tz);

  // Sessions scheduled for today or later (already-opened workouts).
  const { data: sessionRows } = await supabase
    .from("workout_sessions")
    .select(
      "id, title, session_date, completed_at, created_at, calendar_event_id, workout_blocks(count)"
    )
    .gte("session_date", today)
    .order("session_date", { ascending: true })
    .order("created_at", { ascending: false });

  const sessions = ((sessionRows ?? []) as any[]).map((s) => ({
    kind: "session" as const,
    date: s.session_date as string,
    sessionId: s.id as string,
    title: (s.title as string | null) ?? "Workout",
    blockCount: s.workout_blocks?.[0]?.count ?? 0,
    completed: s.completed_at !== null,
    calendarEventId: s.calendar_event_id as string | null,
  }));
  const linkedEventIds = new Set(
    sessions.map((s) => s.calendarEventId).filter((id): id is string => !!id)
  );

  // Upcoming CFO events not yet opened into a session.
  const now = new Date();
  const events = await listWorkoutEvents(supabase, userId, {
    fromIso: new Date(now.getTime() - 12 * 3600_000).toISOString(),
    toIso: new Date(now.getTime() + 60 * 86_400_000).toISOString(),
  }).catch(() => []);
  const eventItems = events
    .filter((e) => !linkedEventIds.has(e.id))
    .map((e) => ({
      kind: "event" as const,
      date: localDate(new Date(e.startTime), tz),
      eventId: e.id,
      title: e.title,
    }))
    .filter((e) => e.date >= today);

  const sessionItems: FocusItem[] = sessions.map(
    ({ calendarEventId: _drop, ...rest }) => {
      void _drop;
      return rest;
    }
  );

  // Today: prefer an opened session over an unopened event. Among same-day
  // sessions, prefer one that's still open, then the most recently created
  // (rows are ordered created_at desc, so the first match wins).
  const todaySessions = sessions.filter((s) => s.date === today);
  const todaySessionPick =
    todaySessions.find((s) => !s.completed) ?? todaySessions[0] ?? null;
  const todaySession = todaySessionPick
    ? (sessionItems.find(
        (i) => i.kind === "session" && i.sessionId === todaySessionPick.sessionId
      ) ?? null)
    : null;
  const todayEvent = eventItems.find((e) => e.date === today) ?? null;
  const todayItem = todaySession ?? todayEvent ?? null;
  const todayCompleted =
    todayItem?.kind === "session" ? todayItem.completed : false;

  // Next: the soonest workout strictly after today (session or event).
  const future = [
    ...sessionItems.filter((i) => i.date > today),
    ...eventItems.filter((e) => e.date > today),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const nextItem = future[0] ?? null;

  return { today: todayItem, todayCompleted, next: nextItem };
}

export async function getHomeWorkout(): Promise<HomeWorkout> {
  const { today: todayItem, todayCompleted, next: nextItem } = await resolveFocus();

  // Focus rules.
  if (todayItem && !todayCompleted) {
    return { focus: todayItem, todayCompleted: false };
  }
  if (todayItem && todayCompleted) {
    // Today's done — look ahead; if nothing's next, show today's completed card.
    return { focus: nextItem ?? todayItem, todayCompleted: true };
  }
  if (nextItem) {
    return { focus: nextItem, todayCompleted: false };
  }
  return null;
}

/** Resolve today's workout and the next one for the Workouts "Today" tab. */
export async function getTodayWorkout(): Promise<TodayWorkout> {
  return resolveFocus();
}
/* eslint-enable @typescript-eslint/no-explicit-any */
