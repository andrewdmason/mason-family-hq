// Reading workout events off the calendar. Gym programming lands on the user's
// Google Calendar with a "CFO: " title prefix, already synced into
// calendar_events. We filter to the caller's own CFO events.

import type { SupabaseClient } from "@supabase/supabase-js";

export const CFO_PREFIX_PATTERN = "CFO:%";

export type WorkoutEvent = {
  id: string;
  title: string; // prefix stripped
  rawTitle: string;
  description: string | null;
  startTime: string;
  endTime: string | null;
  allDay: boolean;
};

export function stripCfoPrefix(title: string): string {
  return title.replace(/^CFO:\s*/i, "").trim();
}

/** The caller's family-member email (calendar_events are member-scoped). */
export async function memberEmailFor(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("family_members")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.email as string | undefined) ?? null;
}

type EventRow = {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  all_day: boolean;
};

function toEvent(r: EventRow): WorkoutEvent {
  return {
    id: r.id,
    title: stripCfoPrefix(r.title),
    rawTitle: r.title,
    description: r.description,
    startTime: r.start_time,
    endTime: r.end_time,
    allDay: r.all_day,
  };
}

/** CFO events whose start falls in [fromIso, toIso], oldest first. */
export async function listWorkoutEvents(
  supabase: SupabaseClient,
  userId: string,
  range: { fromIso: string; toIso: string }
): Promise<WorkoutEvent[]> {
  const email = await memberEmailFor(supabase, userId);
  let q = supabase
    .from("calendar_events")
    .select("id, title, description, start_time, end_time, all_day")
    .ilike("title", CFO_PREFIX_PATTERN)
    .eq("is_canceled", false)
    .gte("start_time", range.fromIso)
    .lte("start_time", range.toIso)
    .order("start_time", { ascending: true });
  if (email) q = q.eq("member_email", email);
  const { data, error } = await q;
  if (error) throw new Error(`listWorkoutEvents: ${error.message}`);
  return (data ?? []).map((r) => toEvent(r as EventRow));
}

/** A single CFO event by id (RLS lets any provisioned member read it). */
export async function getWorkoutEventById(
  supabase: SupabaseClient,
  eventId: string
): Promise<WorkoutEvent | null> {
  const { data, error } = await supabase
    .from("calendar_events")
    .select("id, title, description, start_time, end_time, all_day")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw new Error(`getWorkoutEventById: ${error.message}`);
  return data ? toEvent(data as EventRow) : null;
}
