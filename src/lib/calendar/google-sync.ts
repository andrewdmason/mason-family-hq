// Sync Google Calendar sources into calendar_events. Mirrors ics-sync.ts: scoped
// to member_email, writing under the service-role client, idempotent via the
// unique (calendar_source_id, external_id) constraint. Reads happen on calendar
// load; writes back to Google are handled by the calendar actions, not here.

import { createAdminClient } from "@/lib/supabase/admin";
import {
  listGoogleEvents,
  googleTimesToEvent,
  FAMILYHQ_MARKER,
  type GoogleCredential,
  type GoogleEvent,
} from "./google";
import type { GoogleAttendee } from "./types";

// How far back/forward to pull. A year ahead covers school years and seasons; a
// month back keeps recently-passed events visible.
const WINDOW_PAST_MONTHS = 1;
const WINDOW_FUTURE_MONTHS = 12;

export function syncWindow(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const min = new Date(now);
  min.setMonth(min.getMonth() - WINDOW_PAST_MONTHS);
  const max = new Date(now);
  max.setMonth(max.getMonth() + WINDOW_FUTURE_MONTHS);
  return { timeMin: min.toISOString(), timeMax: max.toISOString() };
}

// A Google event's guest list as we persist it (google_attendees jsonb), or
// null when there are no guests. Entries without an email are resource rooms
// etc. — skipped.
export function attendeesJson(ev: GoogleEvent): GoogleAttendee[] | null {
  const list = (ev.attendees ?? []).flatMap((a) =>
    a.email
      ? [
          {
            email: a.email.toLowerCase(),
            responseStatus: a.responseStatus ?? "needsAction",
            ...(a.displayName ? { displayName: a.displayName } : {}),
          },
        ]
      : [],
  );
  return list.length ? list : null;
}

// Pull the RRULE body out of a series master's recurrence array ("RRULE:..."
// possibly alongside EXDATE/RDATE lines).
export function rruleFromRecurrence(
  recurrence: string[] | undefined,
): string | null {
  const line = (recurrence ?? []).find((r) => r.startsWith("RRULE:"));
  return line ? line.slice("RRULE:".length) : null;
}

export async function syncGoogleSource(
  calendarSourceId: string,
): Promise<{ synced: number; error?: string }> {
  const supabase = createAdminClient();

  const { data: source, error: sourceError } = await supabase
    .from("calendar_sources")
    .select(
      "id, member_email, google_calendar_id, google_connection_email, nickname",
    )
    .eq("id", calendarSourceId)
    .single();

  if (sourceError || !source) {
    return { synced: 0, error: "Calendar source not found" };
  }
  if (!source.google_calendar_id) {
    return { synced: 0, error: "Missing Google calendar id" };
  }

  // Whose token reaches this calendar. Defaults to the member it belongs to.
  const connectionEmail =
    source.google_connection_email ?? source.member_email;
  if (!connectionEmail) {
    return { synced: 0, error: "No Google connection for this calendar" };
  }

  // Managed members (kids, or an adult an owner set up) have no OAuth token of
  // their own — read their calendar via delegation. Everyone else uses their
  // stored OAuth token.
  const { data: mem } = source.member_email
    ? await supabase
        .from("family_members")
        .select("primary_calendar_mode")
        .eq("email", source.member_email)
        .maybeSingle()
    : { data: null };
  const cred: GoogleCredential =
    mem?.primary_calendar_mode === "managed"
      ? { kind: "dwd", subjectEmail: connectionEmail }
      : { kind: "oauth", memberEmail: connectionEmail };

  let events;
  try {
    events = await listGoogleEvents(cred, source.google_calendar_id, syncWindow());
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Failed to fetch Google events";
    await supabase
      .from("calendar_sources")
      .update({ sync_error: msg })
      .eq("id", calendarSourceId);
    return { synced: 0, error: msg };
  }

  // Series masters carry the RRULEs (the instance listing doesn't) — one extra
  // request, best-effort: without it only the "Repeats weekly" display degrades;
  // recurringEventId alone still drives this/all edit behavior.
  const rruleByMasterId = new Map<string, string>();
  try {
    const masters = await listGoogleEvents(
      cred,
      source.google_calendar_id,
      syncWindow(),
      { singleEvents: false },
    );
    for (const m of masters) {
      const rrule = rruleFromRecurrence(m.recurrence);
      if (rrule) rruleByMasterId.set(m.id, rrule);
    }
  } catch {
    // proceed without rrules
  }

  // One row per external_id (last wins) so the batched upsert never touches the
  // same conflict target twice.
  const rowByExtId = new Map<string, Record<string, unknown>>();
  for (const ev of events) {
    // Feedback-loop guard: if this calendar is also an import destination, skip
    // the events our own importer materialized here — otherwise we'd re-ingest
    // them as separate google:{id} rows that never reconcile against TeamSnap.
    if (ev.extendedProperties?.private?.[FAMILYHQ_MARKER]) continue;
    const { start_time, end_time, all_day } = googleTimesToEvent(ev);
    if (!start_time) continue;
    const externalId = `google:${ev.id}`;
    rowByExtId.set(externalId, {
      member_email: source.member_email,
      calendar_source_id: source.id,
      title: ev.summary ?? "Event",
      description: ev.description ?? null,
      location: ev.location ?? null,
      start_time,
      end_time,
      all_day,
      source_type: "google" as const,
      external_id: externalId,
      organizer_email: ev.organizer?.email?.toLowerCase() ?? null,
      is_canceled: ev.status === "cancelled",
      google_recurring_event_id: ev.recurringEventId ?? null,
      rrule: ev.recurringEventId
        ? (rruleByMasterId.get(ev.recurringEventId) ?? null)
        : null,
      google_attendees: attendeesJson(ev),
    });
  }

  const syncedExternalIds = new Set(rowByExtId.keys());
  const syncedCount = rowByExtId.size;

  if (rowByExtId.size > 0) {
    const { error: upsertError } = await supabase
      .from("calendar_events")
      .upsert([...rowByExtId.values()], {
        onConflict: "calendar_source_id,external_id",
      });
    if (upsertError) {
      await supabase
        .from("calendar_sources")
        .update({ sync_error: upsertError.message })
        .eq("id", calendarSourceId);
      return { synced: 0, error: upsertError.message };
    }
  }

  const { data: existingEvents } = await supabase
    .from("calendar_events")
    .select("id, external_id, is_canceled")
    .eq("calendar_source_id", source.id);

  // Cancel events no longer present in the window (e.g. deleted in Google).
  const cancelOps = (existingEvents ?? [])
    .filter(
      (e) =>
        !e.is_canceled &&
        e.external_id &&
        !syncedExternalIds.has(e.external_id),
    )
    .map((e) =>
      supabase
        .from("calendar_events")
        .update({ is_canceled: true })
        .eq("id", e.id),
    );
  if (cancelOps.length > 0) await Promise.all(cancelOps);

  await reconcileMaterializedOnCalendar(
    supabase,
    source.google_calendar_id,
    events,
    syncWindow(),
  );

  await supabase
    .from("calendar_sources")
    .update({ last_synced_at: new Date().toISOString(), sync_error: null })
    .eq("id", calendarSourceId);

  return { synced: syncedCount };
}

// Reconcile the TeamSnap/ICS events the importer materialized onto THIS calendar
// against what's actually there now (keyed by the real Google event id):
//   * deleted/cancelled by the user  → mark dismissed (hide, treated as a decline,
//     and materializeRow won't recreate it); restore if it reappears.
//   * a guest who declined in Google → clear their "going" (Case A).
// Scoped to the fetched window so events that merely aged out aren't dismissed.
async function reconcileMaterializedOnCalendar(
  supabase: ReturnType<typeof createAdminClient>,
  calendarId: string,
  events: GoogleEvent[],
  window: { timeMin: string; timeMax: string },
): Promise<void> {
  const googleById = new Map(events.map((e) => [e.id, e]));

  const { data: materialized } = await supabase
    .from("calendar_events")
    .select("id, google_event_id, dismissed, google_attendees")
    .eq("google_calendar_id", calendarId)
    .not("google_event_id", "is", null)
    .gte("start_time", window.timeMin)
    .lte("start_time", window.timeMax);
  if (!materialized?.length) return;

  const dismiss: string[] = [];
  const undismiss: string[] = [];
  const attendeesByEventId = new Map<
    string,
    Array<{ email?: string; responseStatus?: string }>
  >();
  for (const m of materialized) {
    const g = googleById.get(m.google_event_id as string);
    const present = !!g && g.status !== "cancelled";
    if (!present && !m.dismissed) dismiss.push(m.id as string);
    else if (present && m.dismissed) undismiss.push(m.id as string);
    if (present) {
      attendeesByEventId.set(m.id as string, g!.attendees ?? []);
      // Keep the persisted guest list current (a coach invited directly in
      // Google shows up here). Only write rows that actually changed.
      const next = attendeesJson(g!);
      if (JSON.stringify(next) !== JSON.stringify(m.google_attendees ?? null)) {
        await supabase
          .from("calendar_events")
          .update({ google_attendees: next })
          .eq("id", m.id);
      }
    }
  }

  if (dismiss.length) {
    await supabase.from("calendar_events").update({ dismissed: true }).in("id", dismiss);
  }
  if (undismiss.length) {
    await supabase
      .from("calendar_events")
      .update({ dismissed: false })
      .in("id", undismiss);
  }

  // Case A: drop "going" for any guest who declined in Google.
  const presentIds = [...attendeesByEventId.keys()];
  if (presentIds.length) {
    const { data: going } = await supabase
      .from("event_attendees")
      .select("event_id, member_email")
      .eq("going", true)
      .in("event_id", presentIds);
    for (const a of going ?? []) {
      const att = attendeesByEventId.get(a.event_id as string) ?? [];
      const declined = att.some(
        (x) => x.email === a.member_email && x.responseStatus === "declined",
      );
      if (declined) {
        await supabase
          .from("event_attendees")
          .update({ going: false })
          .eq("event_id", a.event_id)
          .eq("member_email", a.member_email);
      }
    }
  }
}

export async function syncAllGoogleSources(): Promise<{
  results: Array<{ sourceId: string; synced: number; error?: string }>;
}> {
  const supabase = createAdminClient();

  const { data: sources } = await supabase
    .from("calendar_sources")
    .select("id")
    .eq("source_type", "google")
    .eq("is_active", true);

  if (!sources?.length) return { results: [] };

  const results = [];
  for (const source of sources) {
    try {
      const result = await syncGoogleSource(source.id);
      results.push({ sourceId: source.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ sourceId: source.id, synced: 0, error: message });
    }
  }

  return { results };
}
